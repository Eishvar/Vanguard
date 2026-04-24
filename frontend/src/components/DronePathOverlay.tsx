import { useMemo, useRef } from "react";
import { Source, Layer, Marker } from "react-map-gl/maplibre";
import { useMissionStore, type SectorHandoff } from "@/stores/missionStore";

const DRONE_HEX: Record<string, string> = {
  DRONE_A: "#f87171",
  DRONE_B: "#c084fc",
  DRONE_C: "#22d3ee",
};

type PathSegment = {
  droneId:  string;
  sectorId: number;
  coords:   [number, number][];
  kind:     "visited" | "upcoming" | "ghost";
  colorHex: string;
};

function deduplicate(coords: [number, number][]): [number, number][] {
  if (coords.length === 0) return [];
  const res = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = res[res.length - 1];
    const curr = coords[i];
    if (Math.abs(prev[0] - curr[0]) > 1e-7 || Math.abs(prev[1] - curr[1]) > 1e-7) {
      res.push(curr);
    }
  }
  return res;
}

function getSplitCoordinates(
  path: [number, number][],
  lng: number,
  lat: number,
  direction: "forward" | "reverse",
  boundCenterIdx: number = -1
): { visited: [number, number][], upcoming: [number, number][] } {
  if (!path || path.length < 2) return { visited: path || [], upcoming: [] };

  let startIdx = 0;
  let endIdx = path.length - 1;

  // THE FIX (Image 1): Constrain the segment search topologically if a hint is provided.
  // This physically prevents the math from "jumping rows" in tight lawnmower patterns.
  if (boundCenterIdx >= 0) {
    startIdx = Math.max(0, boundCenterIdx - 40);
    endIdx = Math.min(path.length - 1, boundCenterIdx + 40);
  }

  let bestIdx = startIdx;
  let bestDist = Infinity;
  let bestProj: [number, number] = [path[startIdx][0], path[startIdx][1]];

  for (let i = startIdx; i < endIdx; i++) {
    const v = path[i];
    const w = path[i + 1];

    const l2 = (w[0] - v[0]) ** 2 + (w[1] - v[1]) ** 2;
    let t = 0;
    if (l2 !== 0) {
      t = ((lng - v[0]) * (w[0] - v[0]) + (lat - v[1]) * (w[1] - v[1])) / l2;
      t = Math.max(0, Math.min(1, t)); 
    }

    const projX = v[0] + t * (w[0] - v[0]);
    const projY = v[1] + t * (w[1] - v[1]);

    const distSq = (lng - projX) ** 2 + (lat - projY) ** 2;

    if (distSq < bestDist) {
      bestDist = distSq;
      bestIdx = i;
      bestProj = [projX, projY];
    }
  }

  let visited: [number, number][];
  let upcoming: [number, number][];

  if (direction === "forward") {
    visited = deduplicate([...path.slice(0, bestIdx + 1), bestProj]);
    upcoming = deduplicate([bestProj, ...path.slice(bestIdx + 1)]);
  } else {
    visited = deduplicate([bestProj, ...path.slice(bestIdx + 1)]);
    upcoming = deduplicate([...path.slice(0, bestIdx + 1), bestProj]);
  }

  return { visited, upcoming };
}

function splitAtPosition(
  droneId: string,
  sectorId: number,
  path: [number, number][],
  droneLng: number,
  droneLat: number,
  direction: "forward" | "reverse"
): PathSegment[] {
  if (!path || path.length < 2) return [];
  const color = DRONE_HEX[droneId] ?? "#94a3b8";
  const { visited, upcoming } = getSplitCoordinates(path, droneLng, droneLat, direction);
  const segments: PathSegment[] = [];

  if (visited.length >= 2) {
    segments.push({ droneId, sectorId, coords: visited, kind: "visited", colorHex: color });
  }
  if (upcoming.length >= 2) {
    segments.push({ droneId, sectorId, coords: upcoming, kind: "upcoming", colorHex: color });
  }
  return segments;
}

function fullyVisited(droneId: string, sectorId: number, path: [number, number][]): PathSegment[] {
  if (!path || path.length < 2) return [];
  return [{ droneId, sectorId, coords: path, kind: "visited", colorHex: DRONE_HEX[droneId] ?? "#94a3b8" }];
}

function fullyUpcoming(droneId: string, sectorId: number, path: [number, number][]): PathSegment[] {
  if (!path || path.length < 2) return [];
  return [{ droneId, sectorId, coords: path, kind: "upcoming", colorHex: DRONE_HEX[droneId] ?? "#94a3b8" }];
}

export function DronePathOverlay() {
  const show        = useMissionStore((s) => s.showDronePaths);
  const geojson     = useMissionStore((s) => s.sectorsGeoJSON);
  const assignments = useMissionStore((s) => s.sectorAssignments);
  const handoffs    = useMissionStore((s) => s.sectorHandoffs);
  const drones      = useMissionStore((s) => s.drones);
  const positions   = useMissionStore((s) => s.dronePositionsLatLng);
  const sweptSectors = useMissionStore((s) => s.sweptSectors);

  const entryDirs = useRef<Record<string, "forward" | "reverse">>({});

  const sectorData = useMemo<Record<number, {
    path:  [number, number][];
    nodes: { lng: number; lat: number; type: string }[];
  }>>(() => {
    const map: Record<number, { path: [number, number][]; nodes: { lng: number; lat: number; type: string }[] }> = {};
    if (!geojson) return map;
    for (const f of geojson.features as any[]) {
      const sid   = f.properties.sector_id as number;
      const path  = f.properties.sweep_path_latlng as [number, number][];
      const nodes = f.properties.sweep_nodes as { lng: number; lat: number; type: string }[] | undefined;
      if (path && path.length >= 2) {
        map[sid] = { path, nodes: nodes ?? [] };
      }
    }
    return map;
  }, [geojson]);

  const allSegments = useMemo<PathSegment[]>(() => {
    if (!show) return [];
    const segments: PathSegment[] = [];
    const sweptSet = new Set(sweptSectors);

    for (const droneId in assignments) {
      const sectorIds = assignments[droneId];
      const drone = drones.find((d) => d.id === droneId);
      const currentSectorId = drone?.sectorId ?? -1;

      const pos = positions[droneId];
      const droneLng = pos ? pos[1] : 0;
      const droneLat = pos ? pos[0] : 0;

      for (let i = 0; i < sectorIds.length; i++) {
        const sid  = sectorIds[i];
        const data = sectorData[sid];
        if (!data) continue;

        const path = data.path;
        const droneKey = `${droneId}-${sid}`;
        let direction = entryDirs.current[droneKey];

        // Determine direction when drone first enters this sector
        if (sid === currentSectorId && !direction && droneLng !== 0 && droneLat !== 0) {
          const startPt = path[0];
          const endPt = path[path.length - 1];
          const distToStart = (droneLng - startPt[0]) ** 2 + (droneLat - startPt[1]) ** 2;
          const distToEnd = (droneLng - endPt[0]) ** 2 + (droneLat - endPt[1]) ** 2;
          direction = distToStart <= distToEnd ? "forward" : "reverse";
          entryDirs.current[droneKey] = direction;
        }
        if (!direction) direction = "forward";

        const handoff = handoffs[sid];
        if (handoff) {
          const deadDir = entryDirs.current[`${handoff.failedDroneId}-${sid}`] || "forward";
          const absResumeIndex = Math.max(0, Math.min(handoff.resumeIndex, data.nodes.length - 1));
          const targetNode = data.nodes[absResumeIndex];

          let ghostCoords: [number, number][] = [];
          let survivorCoords: [number, number][] = [];

          if (targetNode) {
            let failLng = targetNode.lng;
            let failLat = targetNode.lat;
            const deadPos = positions[handoff.failedDroneId];
            if (deadPos) { failLng = deadPos[1]; failLat = deadPos[0]; }

            let hintIdx = 0;
            let bestDist = Infinity;
            for (let j = 0; j < path.length; j++) {
              const d = (path[j][0] - failLng)**2 + (path[j][1] - failLat)**2;
              if (d < bestDist) { bestDist = d; hintIdx = j; }
            }
            const split = getSplitCoordinates(path, failLng, failLat, deadDir, hintIdx);
            ghostCoords = split.visited;
            survivorCoords = split.upcoming;
          } else {
            survivorCoords = path;
          }

          if (droneId === handoff.failedDroneId) {
            if (ghostCoords.length >= 2) {
              segments.push({ droneId, sectorId: sid, coords: ghostCoords, kind: "ghost", colorHex: DRONE_HEX[droneId] ?? "#94a3b8" });
            }
            continue;
          }

          if (droneId === handoff.survivorId) {
            // Use sweptSet as ground truth for completed sectors
            if (sweptSet.has(sid)) {
              segments.push(...fullyVisited(droneId, sid, survivorCoords));
            } else if (sid === currentSectorId) {
              segments.push(...splitAtPosition(droneId, sid, survivorCoords, droneLng, droneLat, direction));
            } else {
              segments.push(...fullyUpcoming(droneId, sid, survivorCoords));
            }
            continue;
          }
          continue;
        }

        // ── Core fix: use sweptSectors set, not array index ──────────────
        // sweptSet is populated by mark_sector_complete MCP calls — ground truth.
        // This is stable across sector_assignments rewrites from work-stealing/rerouting.
        if (sweptSet.has(sid)) {
          // Sector is definitively complete — always fully visited
          segments.push(...fullyVisited(droneId, sid, path));
        } else if (sid === currentSectorId) {
          // Drone is currently sweeping this sector — split at drone position
          segments.push(...splitAtPosition(droneId, sid, path, droneLng, droneLat, direction));
        } else {
          // Sector not yet swept and not currently active — upcoming
          segments.push(...fullyUpcoming(droneId, sid, path));
        }
      }
    }
    return segments;
  }, [show, assignments, drones, positions, handoffs, sectorData, sweptSectors]);

  const handoffMarkers = useMemo(() => {
    const markers: { sectorId: number; lng: number; lat: number; label: string }[] = [];
    for (const sidStr in handoffs) {
      const sid  = Number(sidStr);
      const data = sectorData[sid];
      if (!data || data.nodes.length === 0) continue;

      const h = handoffs[sid];

      // THE FIX (Image 2): backend resumeIndex is ABSOLUTE. Never subtract from array length!
      const absResumeIndex = Math.max(0, Math.min(h.resumeIndex, data.nodes.length - 1));
      const targetNode = data.nodes[absResumeIndex];
      if (!targetNode) continue;

      // Pin marker to the drone's frozen visual position when available (eliminates queue-lag desync).
      let markerLng = targetNode.lng;
      let markerLat = targetNode.lat;

      const deadPos = positions[h.failedDroneId];
      if (deadPos) {
        markerLng = deadPos[1];
        markerLat = deadPos[0];
      }

      markers.push({
        sectorId: sid,
        lng:      markerLng,
        lat:      markerLat,
        label:    `${h.failedDroneId} failed here (${h.pctDone.toFixed(0)}% done)`,
      });
    }
    return markers;
  }, [handoffs, sectorData, positions]);

  const buildFC = (kind: PathSegment["kind"]): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: allSegments
      .filter((s) => s.kind === kind)
      .map((s, i) => ({
        type:     "Feature",
        id:       `${kind}-${s.droneId}-${s.sectorId}-${i}`,
        geometry: { type: "LineString", coordinates: s.coords },
        properties: { droneId: s.droneId, sectorId: s.sectorId, colorHex: s.colorHex },
      })),
  });

  if (!show) return null;

  return (
    <>
      <Source id="drone-paths-upcoming" type="geojson" data={buildFC("upcoming")}>
        <Layer
          id="drone-paths-upcoming-layer"
          type="line"
          paint={{ "line-color": ["get", "colorHex"], "line-width": 2.5, "line-opacity": 0.75 }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="drone-paths-visited" type="geojson" data={buildFC("visited")}>
        <Layer
          id="drone-paths-visited-layer"
          type="line"
          paint={{ "line-color": ["get", "colorHex"], "line-width": 2.0, "line-opacity": 0.22 }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>
      <Source id="drone-paths-ghost" type="geojson" data={buildFC("ghost")}>
        <Layer
          id="drone-paths-ghost-layer"
          type="line"
          paint={{ "line-color": ["get", "colorHex"], "line-width": 2.0, "line-opacity": 0.18, "line-dasharray": [2, 3] }}
          layout={{ "line-cap": "round", "line-join": "round" }}
        />
      </Source>

      {handoffMarkers.map((m) => (
        <Marker key={m.sectorId} longitude={m.lng} latitude={m.lat} anchor="center">
          <div className="flex flex-col items-center pointer-events-none">
            <div className="w-3 h-3 rounded-full bg-white" style={{ boxShadow: "0 0 0 2px rgba(255,255,255,0.3), 0 0 10px rgba(255,255,255,0.9)" }} />
            <div className="text-[10px] mt-1 px-1.5 py-0.5 rounded bg-slate-900/90 text-white font-mono whitespace-nowrap">
              {m.label}
            </div>
          </div>
        </Marker>
      ))}
    </>
  );
}