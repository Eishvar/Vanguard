import type { TerrainConfig } from "@/stores/missionStore";

/** Degrees of latitude per metre — roughly constant anywhere on Earth. */
export const LAT_PER_M = 1 / 110_574;

/**
 * Degrees of longitude per metre — depends on the latitude of the box centre.
 * Computed from the anchor and box size (in metres).
 */
export function lngPerM(anchorLat: number, areaM: number): number {
  const midLat = anchorLat + (areaM * LAT_PER_M) / 2;
  return 1 / (111_320 * Math.cos((midLat * Math.PI) / 180));
}

/** Convert local metres (SW-corner origin) to [lat, lng]. */
export function localMToLatLng(
  x_m: number,
  y_m: number,
  cfg: TerrainConfig,
): [number, number] {
  const areaM = cfg.gridN * cfg.tileM;
  const lat = cfg.anchorLat + y_m * LAT_PER_M;
  const lng = cfg.anchorLng + x_m * lngPerM(cfg.anchorLat, areaM);
  return [lat, lng];
}

/** Corner lat/lng bounds of a tile (row, col). */
export function tileLatLngBounds(
  row: number,
  col: number,
  cfg: TerrainConfig,
): { sw: [number, number]; ne: [number, number] } {
  const sw = localMToLatLng(col * cfg.tileM,       row * cfg.tileM,       cfg);
  const ne = localMToLatLng((col + 1) * cfg.tileM, (row + 1) * cfg.tileM, cfg);
  return { sw, ne };
}

/** Base station lat/lng (centre of tile row=0, col=0). */
export function baseStationLatLng(cfg: TerrainConfig): [number, number] {
  return localMToLatLng(cfg.tileM / 2, cfg.tileM / 2, cfg);
}

/** MapLibre-style [lng, lat] tuple — convenience for GeoJSON emit. */
export function toGeoJSONLngLat(latLng: [number, number]): [number, number] {
  return [latLng[1], latLng[0]];
}
