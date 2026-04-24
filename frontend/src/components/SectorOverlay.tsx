import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import { useMissionStore } from "@/stores/missionStore";

export function SectorOverlay() {
  const geojson     = useMissionStore((s) => s.sectorsGeoJSON);
  const showSectors = useMissionStore((s) => s.showSectorOverlay);

  const labelsGeoJSON = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!geojson) return null;
    const features: GeoJSON.Feature[] = geojson.features.map((f: any) => {
      const props = f.properties ?? {};
      const c = props.centroid_latlng ?? [0, 0];  // [lat, lng]
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [c[1], c[0]] },  // GeoJSON [lng, lat]
        properties: {
          sector_id:   props.sector_id,
          is_obstacle: props.is_obstacle,
          label:       props.is_obstacle ? "⛔" : String(props.sector_id),
          area_km2:    props.area_km2 ?? 0,
        },
      };
    });
    return { type: "FeatureCollection", features };
  }, [geojson]);

  if (!geojson || !showSectors) return null;

  const scanBorder: LayerProps = {
    id: "sectors-border-scan",
    type: "line",
    filter: ["==", ["get", "is_obstacle"], false],
    paint: {
      "line-color": "#14b8a6",
      "line-width": 2.0,
      "line-opacity": 0.85,
    },
  };

  const obstacleBorder: LayerProps = {
    id: "sectors-border-obs",
    type: "line",
    filter: ["==", ["get", "is_obstacle"], true],
    paint: {
      "line-color": "#ef4444",
      "line-width": 2.0,
      "line-opacity": 0.9,
      "line-dasharray": [2, 2],
    },
  };

  const labelLayer: LayerProps = {
    id: "sectors-labels",
    type: "symbol",
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate", ["linear"], ["get", "area_km2"],
        0.0, 10,
        0.5, 18,
        2.0, 32,
      ],
      "text-allow-overlap": true,
      "text-anchor": "center",
    },
    paint: {
      "text-color": "#f8fafc",
      "text-halo-color": "#0f172a",
      "text-halo-width": 1.5,
    },
  };

  return (
    <>
      <Source id="sectors-src" type="geojson" data={geojson}>
        <Layer {...scanBorder} />
        <Layer {...obstacleBorder} />
      </Source>
      {labelsGeoJSON && (
        <Source id="sectors-labels-src" type="geojson" data={labelsGeoJSON}>
          <Layer {...labelLayer} />
        </Source>
      )}
    </>
  );
}
