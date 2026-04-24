import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import { useMissionStore, type TileData, type TerrainConfig } from "@/stores/missionStore";
import { localMToLatLng } from "@/lib/terrainGeo";

/** Build a GeoJSON FeatureCollection from the tilesGrid state. */
function buildTilesGeoJSON(
  tiles: Record<string, TileData>,
  cfg: TerrainConfig,
  mode: "elevation" | "density",
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const key in tiles) {
    const t = tiles[key];
    const x0 = t.col * cfg.tileM;
    const y0 = t.row * cfg.tileM;
    const x1 = x0 + cfg.tileM;
    const y1 = y0 + cfg.tileM;
    const [swLat, swLng] = localMToLatLng(x0, y0, cfg);
    const [seLat, seLng] = localMToLatLng(x1, y0, cfg);
    const [neLat, neLng] = localMToLatLng(x1, y1, cfg);
    const [nwLat, nwLng] = localMToLatLng(x0, y1, cfg);
    features.push({
      type: "Feature",
      id: key,
      geometry: {
        type: "Polygon",
        coordinates: [[
          [swLng, swLat],
          [seLng, seLat],
          [neLng, neLat],
          [nwLng, nwLat],
          [swLng, swLat],
        ]],
      },
      properties: {
        elevation_m: t.elevation_m,
        density:     t.density,
        is_obstacle: t.is_obstacle,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Build an elevation-colour paint expression using dynamic stops
 * derived from the mission's actual obstacle threshold. This is the
 * config-driven trick: the colour ramp adapts automatically when
 * OBSTACLE_ELEV_M changes in backend/config.py.
 */
function elevationPaint(obstacleElev: number): LayerProps["paint"] {
  const lo   = obstacleElev * 0.70;
  const mid1 = obstacleElev * 0.82;
  const mid2 = obstacleElev * 0.92;
  const hi   = obstacleElev;
  const max  = obstacleElev * 1.15;
  return {
    "fill-color": [
      "interpolate", ["linear"], ["get", "elevation_m"],
      lo,   "#1e3a1e",
      mid1, "#8bb84b",
      mid2, "#f2c94c",
      hi,   "#f28c28",
      max,  "#6c1a1a",
    ],
    "fill-opacity": 0.55,
  };
}

const densityPaint: LayerProps["paint"] = {
  "fill-color": [
    "interpolate", ["linear"], ["get", "density"],
    0.00, "rgba(20,184,166,0)",
    0.05, "rgba(79,195,247,0.35)",
    0.20, "rgba(33,150,243,0.60)",
    0.50, "rgba(21,101,192,0.85)",
    1.00, "rgba(13,71,161,0.95)",
  ],
  "fill-opacity": 0.85,
};

export function TerrainOverlay() {
  const tiles  = useMissionStore((s) => s.tilesGrid);
  const mode   = useMissionStore((s) => s.mapMode);
  const cfg    = useMissionStore((s) => s.terrainConfig);

  const geojson = useMemo(() => {
    if (!cfg || mode === "none" || Object.keys(tiles).length === 0) return null;
    return buildTilesGeoJSON(tiles, cfg, mode);
  }, [tiles, mode, cfg]);

  if (!cfg || !geojson || mode === "none") return null;

  return (
    <Source id="terrain-tiles-src" type="geojson" data={geojson}>
      <Layer
        id="terrain-tiles-fill"
        type="fill"
        paint={mode === "elevation" ? elevationPaint(cfg.obstacleElev) : densityPaint}
      />
    </Source>
  );
}
