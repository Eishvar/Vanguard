// frontend/src/components/NetworkOverlay.tsx
//
// Phase D Step 10 — Change 4b: mesh network visualisation.
//
// Behaviour:
//   • Default: nothing visible.
//   • Hover drone marker → show that drone's comm-range ring only.
//   • showNetwork ON → all rings (BASE + all drones) + animated bidirectional
//     arrows on every active link.
//
// Rings: teal (#14b8a6) when reachable_from_base, red (#ef4444) when isolated.
// Arrows: marching-ants dash animation; two parallel offset lines per link give
//         a bidirectional appearance without extra geometry.
//
// Rendered via MapLibre GeoJSON Source + Layer — not DOM overlays.

import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type { FeatureCollection, Polygon, LineString } from 'geojson';
import { useMissionStore } from '@/stores/missionStore';
import { LAT_PER_KM, LNG_PER_KM, type LatLng } from '@/lib/geoGrid';

// ─── Animated dash sequence ───────────────────────────────────────────────────
//
// 14-step marching-ants cycle at 50 ms/step ≈ 700 ms per full loop.
// Stepped through in opposite phase on the backward arrow layer to give the
// illusion of traffic flowing in both directions simultaneously.

const DASH_SEQ: number[][] = [
  [0, 4, 3],         [0.5, 4, 2.5],    [1, 4, 2],         [1.5, 4, 1.5],
  [2, 4, 1],         [2.5, 4, 0.5],    [3, 4, 0],
  [0, 0.5, 3, 3.5],  [0, 1, 3, 3],     [0, 1.5, 3, 2.5],  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],  [0, 3, 3, 1],     [0, 3.5, 3, 0.5],
];
const HALF = Math.floor(DASH_SEQ.length / 2);

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/** Convert pos_km (km from grid SW corner) → geographic LatLng. */
function posKmToLatLng(pos_km: [number, number], anchor: LatLng): LatLng {
  return {
    lat: anchor.lat + pos_km[1] * LAT_PER_KM,
    lng: anchor.lng + pos_km[0] * LNG_PER_KM,
  };
}

/** Approximate a geographic circle as a closed GeoJSON polygon ring. */
function makeCirclePolygon(center: LatLng, radiusKm: number, steps = 64): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    pts.push([
      center.lng + Math.cos(angle) * radiusKm * LNG_PER_KM,
      center.lat + Math.sin(angle) * radiusKm * LAT_PER_KM,
    ]);
  }
  return pts;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** The entity ID currently hovered in TacticalMap (drone.id or 'BASE'), or null. */
  hoveredEntityId: string | null;
}

export function NetworkOverlay({ hoveredEntityId }: Props) {
  const showNetwork        = useMissionStore((s) => s.showNetwork);
  const commsNetwork       = useMissionStore((s) => s.commsNetwork);
  const cfg                = useMissionStore((s) => s.terrainConfig);
  const dronePositionsLatLng = useMissionStore((s) => s.dronePositionsLatLng);
  const anchor: LatLng = cfg
    ? { lat: cfg.anchorLat, lng: cfg.anchorLng }
    : { lat: 0, lng: 0 };

  /**
   * Returns the geographic centre of a network entity.
   * - Drones: use live dronePositionsLatLng (or fall back to pos_km).
   * - BASE:   use the centre of tile (0,0) = (tileM/2, tileM/2) from SW corner,
   *           NOT pos_km which points to the corner (0, 0).
   */
  const getEntityCenter = useCallback(
    (e: { id: string; pos_km: [number, number] }): LatLng => {
      if (e.id !== 'BASE') {
        const livePos = dronePositionsLatLng[e.id];
        if (livePos) return { lat: livePos[0], lng: livePos[1] };
      }
      if (e.id === 'BASE' && cfg) {
        // Base station is at tile (0,0) CENTRE, not the SW corner.
        // tileM metres → km: /1000. Half-tile = tileM/2 metres from corner.
        const halfTileKm = cfg.tileM / 2000;
        return {
          lat: cfg.anchorLat + halfTileKm * LAT_PER_KM,
          lng: cfg.anchorLng + halfTileKm * LNG_PER_KM,
        };
      }
      return posKmToLatLng(e.pos_km, anchor);
    },
    [dronePositionsLatLng, cfg, anchor]
  );

  // ── Animation state ────────────────────────────────────────────────────────
  //
  // Advances at ≤20 fps while showNetwork is on.  Only NetworkOverlay re-renders
  // on each tick (not its parent TacticalMap), and the Source data memos are
  // stable between ticks, so MapLibre only receives updated paint props.

  const [dashStep, setDashStep] = useState(0);
  const animRef = useRef<number | undefined>(undefined);
  const { current: mapRef } = useMap();
  const [arrowImageReady, setArrowImageReady] = useState(false);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const register = () => {
      if (map.hasImage('arrow-icon')) { setArrowImageReady(true); return; }
      const size = 32;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#14b8a6';
      ctx.beginPath();
      ctx.moveTo(28, 16);  // tip (right)
      ctx.lineTo(8, 6);    // top-left
      ctx.lineTo(14, 16);  // notch
      ctx.lineTo(8, 26);   // bottom-left
      ctx.closePath();
      ctx.fill();
      try {
        map.addImage('arrow-icon', canvas as any);
      } catch (_e) {
         // Image already registered — ignore
      }
      setArrowImageReady(true);
    };

    if (map.isStyleLoaded()) {
      register();
    } else {
      map.once('styledata', register);
      return () => { map.off('styledata', register); };
    }
  }, [mapRef]);

  useEffect(() => {
    if (!showNetwork) {
      if (animRef.current !== undefined) cancelAnimationFrame(animRef.current);
      animRef.current = undefined;
      setDashStep(0);
      return;
    }
    let lastStep = -1;
    const tick = (ts: number) => {
      const step = Math.floor(ts / 50) % DASH_SEQ.length;
      if (step !== lastStep) { lastStep = step; setDashStep(step); }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current !== undefined) cancelAnimationFrame(animRef.current); };
  }, [showNetwork]);

  // ── Visible ring set ───────────────────────────────────────────────────────

  const visibleRingIds = useMemo<Set<string>>(() => {
    if (!commsNetwork) return new Set();
    if (showNetwork) return new Set(commsNetwork.entities.map((e) => e.id));
    if (hoveredEntityId && commsNetwork.entities.some((e) => e.id === hoveredEntityId)) {
      return new Set([hoveredEntityId]);
    }
    return new Set();
  }, [showNetwork, hoveredEntityId, commsNetwork]);

  // ── Ring GeoJSON ───────────────────────────────────────────────────────────

  const ringsGeoJSON = useMemo<FeatureCollection<Polygon>>(() => {
    if (!commsNetwork || visibleRingIds.size === 0) {
      return { type: 'FeatureCollection', features: [] };
    }
    const features = commsNetwork.entities
      .filter((e) => visibleRingIds.has(e.id))
      .map((e) => {
        const center: LatLng = getEntityCenter(e);
        // BASE is always reachable (it is the base); others consult the array.
        const reachable = e.id === 'BASE' || commsNetwork.reachable_from_base.includes(e.id);
        const color = reachable ? '#14b8a6' : '#ef4444';
        return {
          type: 'Feature' as const,
          properties: { entityId: e.id, color },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [makeCirclePolygon(center, e.radius_km)],
          },
        };
      });
    return { type: 'FeatureCollection', features };
  }, [commsNetwork, visibleRingIds, anchor, dronePositionsLatLng, getEntityCenter]);

  // ── Arrow GeoJSON ──────────────────────────────────────────────────────────

  const arrowsGeoJSON = useMemo<FeatureCollection<LineString>>(() => {
    if (!commsNetwork || !showNetwork) {
      return { type: 'FeatureCollection', features: [] };
    }
    const entityMap = new Map(commsNetwork.entities.map((e) => [e.id, e]));
    const features = commsNetwork.links.flatMap(([idA, idB]) => {
      const a = entityMap.get(idA);
      const b = entityMap.get(idB);
      if (!a || !b) return [];
      const posA = getEntityCenter(a);
      const posB = getEntityCenter(b);
      return [
        {
          type: 'Feature' as const,
          properties: { dir: 'fwd' },
          geometry: {
            type: 'LineString' as const,
            coordinates: [[posA.lng, posA.lat], [posB.lng, posB.lat]],
          },
        },
        {
          type: 'Feature' as const,
          properties: { dir: 'bwd' },
          geometry: {
            type: 'LineString' as const,
            coordinates: [[posB.lng, posB.lat], [posA.lng, posA.lat]],
          },
        },
      ];
    });
    return { type: 'FeatureCollection', features };
  }, [commsNetwork, showNetwork, anchor, dronePositionsLatLng, getEntityCenter]);

  // All hooks must be called before this conditional return.
  if (!commsNetwork) return null;

  return (
    <>
      {/* ── Comm-range rings ── */}
      <Source id="network-rings" type="geojson" data={ringsGeoJSON}>
        {/* Subtle area fill so the ring boundary is easy to read */}
        <Layer
          id="network-ring-fill"
          type="fill"
          paint={{
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.06,
          }}
        />
        {/* Dashed border circle */}
        <Layer
          id="network-ring-border"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 1.5,
            'line-opacity': 0.7,
            'line-dasharray': [4, 2],
          }}
        />
      </Source>

      {/* ── Comm links — bidirectional animated arrows ── */}
      {/* Two line layers with opposite line-offset and opposite animation phase
          give simultaneous forward + backward traffic flow on each link. */}
      <Source id="network-arrows" type="geojson" data={arrowsGeoJSON}>
        <Layer
          id="network-arrows-fwd"
          type="line"
          filter={['==', ['get', 'dir'], 'fwd']}
          paint={{
            'line-color': '#14b8a6',
            'line-width': 1.5,
            'line-opacity': 0.85,
            'line-dasharray': DASH_SEQ[dashStep],
            'line-offset': 2,
          }}
        />
        <Layer
          id="network-arrows-bwd"
          type="line"
          filter={['==', ['get', 'dir'], 'bwd']}
          paint={{
            'line-color': '#14b8a6',
            'line-width': 1.5,
            'line-opacity': 0.85,
            'line-dasharray': DASH_SEQ[(dashStep + HALF) % DASH_SEQ.length],
            'line-offset': 2,
          }}
        />
        {arrowImageReady && (
          <>
            <Layer
              id="network-arrows-fwd-sym"
              type="symbol"
              filter={['==', ['get', 'dir'], 'fwd']}
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 80,
                'icon-image': 'arrow-icon',
                'icon-size': 0.6,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
            <Layer
              id="network-arrows-bwd-sym"
              type="symbol"
              filter={['==', ['get', 'dir'], 'bwd']}
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 80,
                'icon-image': 'arrow-icon',
                'icon-size': 0.6,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
          </>
        )}
      </Source>
    </>
  );
}
