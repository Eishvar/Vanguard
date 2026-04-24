import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import { useMissionStore } from "@/stores/missionStore";
import type { FeatureCollection, LineString, Point } from "geojson";

const DRONE_COLOR: Record<string, string> = {
  DRONE_A: "#f87171",
  DRONE_B: "#c084fc",
  DRONE_C: "#22d3ee",
};

export function TransitOverlay() {
  const show         = useMissionStore((s) => s.showTransitPaths);
  const transitPaths = useMissionStore((s) => s.transitPaths);

  const linesFC = useMemo<FeatureCollection<LineString>>(() => {
    const features: FeatureCollection<LineString>["features"] = [];
    for (const [droneId, waypoints] of Object.entries(transitPaths)) {
      if (waypoints.length < 2) continue;
      features.push({
        type: "Feature",
        properties: {
          drone_id: droneId,
          color: DRONE_COLOR[droneId] ?? "#94a3b8",
        },
        geometry: {
          type: "LineString",
          coordinates: waypoints.map((wp) => [wp.lng, wp.lat]),
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [transitPaths]);

  const pointsFC = useMemo<FeatureCollection<Point>>(() => {
    const features: FeatureCollection<Point>["features"] = [];
    for (const [droneId, waypoints] of Object.entries(transitPaths)) {
      const color = DRONE_COLOR[droneId] ?? "#94a3b8";
      for (const wp of waypoints) {
        features.push({
          type: "Feature",
          properties: {
            drone_id:  droneId,
            node_type: wp.node_type,
            color,
          },
          geometry: {
            type: "Point",
            coordinates: [wp.lng, wp.lat],
          },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }, [transitPaths]);

  if (!show) return null;

  return (
    <>
      {/* Transit path lines */}
      <Source id="transit-lines" type="geojson" data={linesFC}>
        <Layer
          id="transit-lines-layer"
          type="line"
          paint={{
            "line-color":     ["get", "color"],
            "line-width":     1.5,
            "line-opacity":   0.7,
            "line-dasharray": [4, 2],
          }}
        />
      </Source>

      {/* Transit waypoint dots */}
      <Source id="transit-points" type="geojson" data={pointsFC}>
        <Layer
          id="transit-points-layer"
          type="circle"
          paint={{
            "circle-radius":       3,
            "circle-color":        ["get", "color"],
            "circle-opacity":      0.9,
            "circle-stroke-width": 0,
          }}
        />
      </Source>
    </>
  );
}
