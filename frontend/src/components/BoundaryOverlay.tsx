import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { useMissionStore } from "@/stores/missionStore";
import { localMToLatLng } from "@/lib/terrainGeo";

export function BoundaryOverlay() {
  const cfg        = useMissionStore((s) => s.terrainConfig);
  const dragOffset = useMissionStore((s) => s.boundaryDragOffset);

  const boundaryGeoJSON = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!cfg) return null;
    const areaM  = cfg.gridN * cfg.tileM;
    const swLat  = cfg.anchorLat + dragOffset.dy;
    const swLng  = cfg.anchorLng + dragOffset.dx;
    const shifted = { ...cfg, anchorLat: swLat, anchorLng: swLng };

    const [swLat2, swLng2] = localMToLatLng(0,     0,     shifted);
    const [seLat,  seLng]  = localMToLatLng(areaM, 0,     shifted);
    const [neLat,  neLng]  = localMToLatLng(areaM, areaM, shifted);
    const [nwLat,  nwLng]  = localMToLatLng(0,     areaM, shifted);

    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [swLng2, swLat2],
            [seLng,  seLat],
            [neLng,  neLat],
            [nwLng,  nwLat],
            [swLng2, swLat2],
          ],
        },
        properties: {},
      }],
    };
  }, [cfg, dragOffset]);

  if (!boundaryGeoJSON) return null;

  return (
    <Source id="boundary-src" type="geojson" data={boundaryGeoJSON}>
      <Layer
        id="boundary-outline"
        type="line"
        paint={{
          "line-color": "#f59e0b",
          "line-width": 2.5,
          "line-dasharray": [3, 3],
          "line-opacity": 0.85,
        }}
      />
    </Source>
  );
}
