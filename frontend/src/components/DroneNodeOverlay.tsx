import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { useMissionStore } from "@/stores/missionStore";
import type { FeatureCollection, Point } from "geojson";

export function DroneNodeOverlay() {
  const show    = useMissionStore((s) => s.showNodes);
  const geojson = useMissionStore((s) => s.sectorsGeoJSON);

  const nodeFC = useMemo<FeatureCollection<Point>>(() => {
    if (!geojson) return { type: "FeatureCollection", features: [] };
    const features: FeatureCollection<Point>["features"] = [];

    for (const f of geojson.features as any[]) {
      if (f.properties?.is_obstacle === true) continue;
      const sectorId = f.properties?.sector_id as number;

      // Read the pre-computed sweep_nodes from the backend GeoJSON property.
      // Each node: { lat, lng, type: "anchor" | "tile_border", x_m, y_m }
      const nodes = f.properties?.sweep_nodes as
        { lat: number; lng: number; type: string }[] | undefined;
      if (!nodes || nodes.length === 0) continue;

      for (const node of nodes) {
        features.push({
          type: "Feature",
          properties: {
            node_type: node.type,   // "anchor" or "tile_border" only
            sector_id: sectorId,
          },
          geometry: {
            type: "Point",
            // GeoJSON coordinate order: [lng, lat]
            coordinates: [node.lng, node.lat],
          },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }, [geojson]);

  if (!show) return null;

  return (
    <Source id="drone-nodes" type="geojson" data={nodeFC}>
      <Layer
        id="drone-nodes-layer"
        type="circle"
        paint={{
          "circle-radius": [
            "match", ["get", "node_type"],
            "anchor",      4,
            "tile_border", 3,
            3,
          ],
          "circle-color": [
            "match", ["get", "node_type"],
            "anchor",      "#000000",
            "tile_border", "#3B82F6",
            "#94a3b8",
          ],
          "circle-stroke-width": 0,
        }}
      />
    </Source>
  );
}
