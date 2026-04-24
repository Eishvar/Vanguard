// frontend/src/lib/geoGrid.ts

export interface LatLng { lat: number; lng: number; }

// Ranau, Sabah — latitude ~5.9°N
// lat_per_m = 1 / 110_574  (standard)
// lng_per_m = lat_per_m / cos(5.9° * π/180) = 1/110574 / 0.99474 ≈ 1/110043
export const LAT_PER_M = 1 / 110_574;   // degrees latitude per metre
export const LNG_PER_M = 1 / 110_043;   // degrees longitude per metre at 5.9°N

// km-scale constants (used by NetworkOverlay for comm-circle radii)
export const LAT_PER_KM = LAT_PER_M * 1000;   // ≈ 0.009044
export const LNG_PER_KM = LNG_PER_M * 1000;   // ≈ 0.009087

interface GridConfig {
  anchorLat: number; anchorLng: number; tileM: number; gridN: number;
}

/** Produce a grid-anchor descriptor from a TerrainConfig (or any GridConfig). */
export function gridAnchorFromConfig(cfg: GridConfig) {
  return { lat: cfg.anchorLat, lng: cfg.anchorLng, tileM: cfg.tileM, gridN: cfg.gridN };
}

/** Center lat/lng of a tile given (row, col) and terrain config. */
export function tileCenter(row: number, col: number, cfg: GridConfig): LatLng {
  return {
    lat: cfg.anchorLat + (row + 0.5) * cfg.tileM * LAT_PER_M,
    lng: cfg.anchorLng + (col + 0.5) * cfg.tileM * LNG_PER_M,
  };
}

/** Four corners of a tile as a closed GeoJSON ring [lng, lat][]. */
export function tileBoundsPolygon(row: number, col: number, cfg: GridConfig): [number, number][] {
  const swLat = cfg.anchorLat + row * cfg.tileM * LAT_PER_M;
  const swLng = cfg.anchorLng + col * cfg.tileM * LNG_PER_M;
  const neLat = swLat + cfg.tileM * LAT_PER_M;
  const neLng = swLng + cfg.tileM * LNG_PER_M;
  return [[swLng, swLat], [neLng, swLat], [neLng, neLat], [swLng, neLat], [swLng, swLat]];
}

/** Center of the entire terrain grid (for camera fly-to). */
export function gridCenter(cfg: GridConfig): LatLng {
  return {
    lat: cfg.anchorLat + (cfg.gridN / 2) * cfg.tileM * LAT_PER_M,
    lng: cfg.anchorLng + (cfg.gridN / 2) * cfg.tileM * LNG_PER_M,
  };
}

// ─── Preset disaster locations ────────────────────────────────────────────────

export interface PresetLocation {
  name: string;
  description: string;
  anchor: LatLng;
  initialZoom: number;
  initialPitch: number;
}

export const PRESET_LOCATIONS: PresetLocation[] = [
  {
    name: "Mt. Merapi, Indonesia",
    description: "Kaliurang resort area, Yogyakarta — active stratovolcano, 2010 & 2021 eruptions",
    anchor: { lat: -7.6420, lng: 110.4160 },
    initialZoom: 14,
    initialPitch: 45,
  },
  {
    name: "Leyte, Philippines",
    description: "Palo municipality — Typhoon Hainan 2013 landfall zone",
    anchor: { lat: 11.1430, lng: 124.9870 },
    initialZoom: 13,
    initialPitch: 30,
  },
  {
    name: "Palu, Sulawesi, Indonesia",
    description: "City center — 2018 earthquake + liquefaction + tsunami (4,340 deaths)",
    anchor: { lat: -0.9110, lng: 119.8700 },
    initialZoom: 14,
    initialPitch: 40,
  },
  {
    name: "Kelantan, Malaysia",
    description: "Kuala Krai — annual flood zone, Dec 2014 worst flooding in 100 years",
    anchor: { lat: 5.5220, lng: 102.1940 },
    initialZoom: 13,
    initialPitch: 20,
  },
  {
    name: "Taal Volcano, Philippines",
    description: "Tagaytay Ridge area — January 2020 eruption, 45km evacuation radius",
    anchor: { lat: 14.0050, lng: 120.9820 },
    initialZoom: 13,
    initialPitch: 45,
  },
];
