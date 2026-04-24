// frontend/src/components/MeasureTool.tsx
//
// Measure distance tool — mirrors Google Maps "measure distance".
// Renders a GeoJSON LineString + point Markers via MapLibre.
// State (active, points) is owned by TacticalMap and passed as props.

import { Source, Layer, Marker } from 'react-map-gl/maplibre';
import { useMemo } from 'react';
import type { FeatureCollection, LineString } from 'geojson';

export interface MeasurePoint {
  lat: number;
  lng: number;
}

interface Props {
  active: boolean;
  points: MeasurePoint[];
  onRemoveLast: () => void;
  onClear: () => void;
}

// ── Haversine great-circle distance (metres) ─────────────────────────────────

function haversineM(a: MeasurePoint, b: MeasurePoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function totalDistanceM(pts: MeasurePoint[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversineM(pts[i - 1], pts[i]);
  return d;
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

// ─────────────────────────────────────────────────────────────────────────────

export function MeasureTool({ active, points, onRemoveLast, onClear }: Props) {
  if (!active && points.length === 0) return null;

  // Build GeoJSON LineString for all connected points
  const lineGeoJSON = useMemo<FeatureCollection<LineString>>(() => ({
    type: 'FeatureCollection',
    features: points.length >= 2
      ? [{
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: points.map(p => [p.lng, p.lat]),
          },
        }]
      : [],
  }), [points]);

  const totalM = totalDistanceM(points);

  return (
    <>
      {/* ── Line layer ── */}
      <Source id="measure-line" type="geojson" data={lineGeoJSON}>
        <Layer
          id="measure-line-layer"
          type="line"
          paint={{
            'line-color': '#f59e0b',   // amber-400
            'line-width': 2,
            'line-dasharray': [4, 2],
          }}
        />
      </Source>

      {/* ── Point markers ── */}
      {points.map((pt, i) => {
        const isLast = i === points.length - 1;
        return (
          <Marker key={i} longitude={pt.lng} latitude={pt.lat} anchor="center">
            <div className="relative flex items-center justify-center">
              {/* Dot */}
              <div className="w-3 h-3 rounded-full bg-amber-400 border-2 border-white shadow" />
              {/* X button on last point */}
              {isLast && points.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveLast(); }}
                  className="absolute -top-4 -right-4 w-4 h-4 rounded-full bg-slate-800 border border-amber-400 text-amber-400 text-[9px] flex items-center justify-center hover:bg-amber-400/20 leading-none"
                  title="Remove last point"
                >
                  ×
                </button>
              )}
            </div>
          </Marker>
        );
      })}

      {/* ── Distance label — anchored near last point ── */}
      {points.length >= 2 && (() => {
        const last = points[points.length - 1];
        return (
          <Marker longitude={last.lng} latitude={last.lat} anchor="bottom-left" offset={[12, -8]}>
            <div className="bg-slate-900/90 border border-amber-400/60 rounded px-2 py-0.5 text-amber-300 font-mono text-[10px] whitespace-nowrap shadow">
              {formatDistance(totalM)}
            </div>
          </Marker>
        );
      })()}

      {/* ── Clear button (floating, not on map) ── */}
      {points.length > 0 && (
        <div className="absolute top-16 right-4 z-20">
          <button
            onClick={onClear}
            className="bg-slate-900/90 border border-amber-400/50 text-amber-300 text-[10px] font-mono px-2 py-1 rounded hover:bg-amber-400/10 transition-colors"
          >
            ✕ CLEAR
          </button>
        </div>
      )}
    </>
  );
}
