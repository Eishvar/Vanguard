import { useState, useRef, useEffect } from "react";
import { useMissionStore, type SurvivorRecord, type HeadingEvent } from "@/stores/missionStore";
import { LNG_PER_KM } from "@/lib/geoGrid";
import { Play, Zap, ChevronDown } from "lucide-react";


const API = "http://localhost:8000";

const INJECT_OPTIONS = [
  { label: "Inject: Drone A", droneId: "DRONE_A" },
  { label: "Inject: Drone B", droneId: "DRONE_B" },
  { label: "Inject: Drone C", droneId: "DRONE_C" },
];

const MissionControls = () => {
  const store = useMissionStore();
  const { missionStarted, currentPhase, systemStatus } = store;

  const [injectOpen, setInjectOpen] = useState(false);
  const [injected, setInjected] = useState<string | null>(null);
  const injectRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // Keep a stable ref to startMission so the event listener never goes stale
  const startMissionRef = useRef<() => void>(() => {});
  useEffect(() => { startMissionRef.current = startMission; });

  const injectFailureRef = useRef<(id: string) => void>(() => {});
  useEffect(() => { injectFailureRef.current = injectFailure; });

  // Listen for button events dispatched from TacticalMap's left control panel
  useEffect(() => {
    const handleLaunch = () => {
      if (!useMissionStore.getState().missionStarted) startMissionRef.current();
    };
    const handleInject = (e: Event) => {
      injectFailureRef.current((e as CustomEvent).detail as string);
    };
    window.addEventListener('vanguard:launch', handleLaunch);
    window.addEventListener('vanguard:inject', handleInject);
    return () => {
      window.removeEventListener('vanguard:launch', handleLaunch);
      window.removeEventListener('vanguard:inject', handleInject);
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (injectRef.current && !injectRef.current.contains(e.target as Node)) {
        setInjectOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const startMission = async () => {
    const s = useMissionStore.getState();
    s.reset();
    s.clearTransitPaths();
    s.setMissionStarted(true);
    s.setSystemStatus("ACTIVE");
    setInjected(null);

    // 1. POST to start the mission
    try {
      await fetch(`${API}/api/mission/start`, { method: "POST" });
    } catch (err) {
      s.setSystemStatus("ERROR");
      s.setMissionStarted(false);
      return;
    }

    // 2. Open SSE stream
    if (sourceRef.current) sourceRef.current.close();
    const source = new EventSource(`${API}/api/mission/stream`);
    sourceRef.current = source;

    // ── phase_change ──────────────────────────────────────────────────────
    source.addEventListener("phase_change", (e) => {
      const data = JSON.parse(e.data);
      useMissionStore.getState().setPhase(data.phase, data.round ?? 0);

      if (data.phase === "planning") {
        useMissionStore.getState().addLog(2, {
          timestamp: new Date().toLocaleTimeString(),
          type: "phase",
          source: "SYSTEM",
          message: "▶ Planning phase initiated",
        });
      }
      if (data.phase === "executing") {
        // Switch to execution tab on first executing event
        if (useMissionStore.getState().activeTab === 1) {
          useMissionStore.getState().setActiveTab(2);
        }
      }
    });

    // ── supervisor_cot ────────────────────────────────────────────────────
    source.addEventListener("supervisor_cot", (e) => {
      const data = JSON.parse(e.data);
      const st = useMissionStore.getState();
      const prefix = data.phase === "plan"
        ? "🧠 SUPERVISOR PLAN"
        : data.phase === "redistribute"
        ? "⚡ SUPERVISOR REDISTRIBUTE"
        : "👁 SUPERVISOR MONITOR";

      st.addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "info",
        source: "SUPERVISOR",
        message: `[Tick ${data.round}] ${prefix}: ${data.reasoning}`,
      });

      if (data.phase === "monitor" || data.phase === "redistribute") {
        const drones = useMissionStore.getState().drones;
        const activeDrones = drones.filter(d => d.status !== "offline").map(d => d.id);
        const offlineDrones = drones.filter(d => d.status === "offline").map(d => d.id);
        st.addLog(2, {
          timestamp: new Date().toLocaleTimeString(),
          type: "info",
          source: "SUPERVISOR",
          message: `👁 MONITOR [Tick ${data.round}] — Active: ${activeDrones.join(", ") || "none"} | Offline: ${offlineDrones.join(", ") || "none"} | Phase decision: ${data.phase}`,
        });
      }

      // Log assignments if present (plan phase)
      if (data.assignments) {
        const lines = Object.entries(data.assignments)
          .map(([drone, cells]) => `  ${drone} → ${(cells as string[]).join(", ")}`)
          .join("\n");
        st.addLog(2, {
          timestamp: new Date().toLocaleTimeString(),
          type: "success",
          source: "SUPERVISOR",
          message: `Assignments:\n${lines}`,
        });
      }
    });

    // ── drone_cot ─────────────────────────────────────────────────────────
    source.addEventListener("drone_cot", (e) => {
      const data = JSON.parse(e.data);
      const st = useMissionStore.getState();

      // CC-1: battery now comes reliably via grid_update → updateDronesFromSnapshot.
      // The fragile regex extraction has been removed.

      const action = data.action?.toUpperCase() ?? "WAIT";
      const target = data.target_cell_id ? ` → ${data.target_cell_id}` : "";
      st.addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: data.status === "offline" || data.action === "drone_offline" ? "error" : data.status === "task_complete" ? "success" : "info",
        droneId: data.drone_id,
        source: data.drone_id,
        message: `[Tick ${data.round}] ${data.drone_id} ${action}${target}: ${data.reasoning}`,
      });
      st.setLastReasoning(data.drone_id, data.reasoning);
    });

    // ── grid_update ───────────────────────────────────────────────────────
    source.addEventListener("grid_update", (e) => {
      const data = JSON.parse(e.data);
      store.updateMissionSnapshot(data);
      if (data.communication_network) {
        store.updateCommsNetwork(data.communication_network);
      }
    });

    // ── stats_update ──────────────────────────────────────────────────────
    source.addEventListener("stats_update", (e) => {
      const data = JSON.parse(e.data);
      useMissionStore.getState().updateStats(data);
    });

    // ── failure_event ─────────────────────────────────────────────────────
    source.addEventListener("failure_event", (e) => {
      const data = JSON.parse(e.data);
      const st = useMissionStore.getState();
      st.setDroneOffline(data.drone_id);
      // Immediately clear the heading queue so the drone stops moving visually.
      st.clearDroneHeadingQueue(data.drone_id);
      st.addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "error",
        droneId: data.drone_id,
        source: data.drone_id,
        message: `⚠ DRONE FAILURE [Tick ${data.round}]: ${data.drone_id} is OFFLINE. Orphaned sectors: ${data.orphaned_sectors?.join(', ') || 'none'}`,
      });
    });

    // ── terrain_initialized ───────────────────────────────────────────────
    source.addEventListener("terrain_initialized", (e) => {
      store.setMissionLaunched(true);
      store.resetBoundaryDragOffset();
      store.toggleSectorOverlay();   // flips false→true; reset() set it false before launch

      const data = JSON.parse(e.data);

      // Populate terrainConfig FIRST — other components gate on this
      const anchorLatLng = data.anchor_latlng ?? [0, 0];
      store.setTerrainConfig({
        anchorLat:    Number(anchorLatLng[0]),
        anchorLng:    Number(anchorLatLng[1]),
        gridN:        Number(data.grid_n ?? 20),
        tileM:        Number(data.tile_m ?? 200),
        obstacleElev: Number(data.obstacle_elev_threshold ?? 0),
      });
      // Sync gridAnchor to the backend-authoritative terrain anchor.
      // Uses setState directly because setGridAnchor is blocked while gridLocked.
      useMissionStore.setState({ gridAnchor: { lat: Number(anchorLatLng[0]), lng: Number(anchorLatLng[1]) } });

      // Init all drone positions to base station on terrain load.
      // Use the backend-computed base tile centre (tile 0,0 centre = 50m,50m from SW corner).
      // base_station_latlng is sent in terrain_initialized and is more accurate than anchorLatLng.
      const baseLL = data.base_station_latlng ?? anchorLatLng;
      const baseLat = Number(baseLL[0]);
      const baseLng = Number(baseLL[1]);
      // LNG_PER_KM ≈ 0.009087 for Ranau. 8m = 0.008 km.
      // Stagger: A at centre, B 8m east, C 8m west (MATCHES BACKEND X-AXIS STAGGER).
      const lngOffset8m = 0.008 * LNG_PER_KM;
      const droneBaseOffsets: Record<string, [number, number]> = {
        DRONE_A: [0, 0],
        DRONE_B: [0, lngOffset8m],
        DRONE_C: [0, -lngOffset8m],
      };
      for (const [did, [dlat, dlng]] of Object.entries(droneBaseOffsets)) {
        store.setDronePositionLatLng(did, baseLat + dlat, baseLng + dlng);
      }

      store.setTilesGrid(data.tiles_grid);
      store.setSectorsGeoJSON(data.sectors_geojson);

      if (typeof data.visual_drone_speed_mps === "number") {
        store.setVisualDroneSpeedMps(data.visual_drone_speed_mps);
      }

      const scanCount = (data.sectors_geojson?.features ?? [])
        .filter((f: any) => !f.properties.is_obstacle).length;
      const obsCount  = (data.sectors_geojson?.features ?? [])
        .filter((f: any) => f.properties.is_obstacle).length;
      store.addLog(2, {
        timestamp: new Date().toISOString(),
        type: "info",
        source: "SYSTEM",
        message: `Terrain ready: anchor=(${anchorLatLng[0].toFixed(4)}, ${anchorLatLng[1].toFixed(4)}), ${data.grid_n}×${data.grid_n} grid, ${scanCount} scan + ${obsCount} obstacle sectors.`,
      });
    });

    // ── sector_assignments ────────────────────────────────────────────────
    source.addEventListener("sector_assignments", (e) => {
      const data = JSON.parse(e.data);
      store.setSectorAssignments(data.assignments ?? {});
      store.addLog(2, {
        timestamp: new Date().toISOString(),
        type: "info",
        source: "SUPERVISOR",
        message: `Sector assignments:\n${
          Object.entries(data.assignments ?? {})
            .map(([d, sids]) => `  ${d}: sectors [${(sids as number[]).join(", ")}]`)
            .join("\n")
        }`,
      });
    });

    // ── drone_heading ─────────────────────────────────────────────────────
    source.addEventListener("drone_heading", (e) => {
      const data = JSON.parse(e.data) as HeadingEvent;
      store.enqueueHeading(data);
      if (data.node_type === "transit" || data.node_type === "initial_transit") {
        store.appendTransitWaypoint(data.drone_id, {
          lat:       data.lat,
          lng:       data.lng,
          dist_m:    data.dist_m,
          node_type: data.node_type,
        });
      }
    });

    // ── recovery_event ────────────────────────────────────────────────────
    source.addEventListener("recovery_event", (e) => {
      const data = JSON.parse(e.data);
      store.addLog(2, {
        timestamp: new Date().toISOString(),
        type: "warning",
        source: "SUPERVISOR",
        message: data.reasoning ?? "Self-healing replan triggered.",
      });

      if (
        typeof data.partial_sector_id === "number" &&
        typeof data.resume_index === "number" &&
        data.new_assignments
      ) {
        const sid = data.partial_sector_id as number;
        const survivorId = Object.keys(data.new_assignments).find((d) =>
          (data.new_assignments[d] as number[]).includes(sid)
        ) ?? "";
        if (survivorId) {
          store.setSectorHandoff(sid, {
            failedDroneId:  data.failed_drone_id,
            survivorId,
            resumeIndex:    data.resume_index,
            totalWaypoints: data.total_waypoints ?? 0,
            pctDone:        data.pct_done_by_failed_drone ?? 0,
          });
        }
      }

      if (data.new_assignments) {
        const existing = useMissionStore.getState().sectorAssignments;
        const merged = { ...existing };

        // Delete the failed drone's assignments so its ghost paths disappear.
        if (data.failed_drone_id) {
          delete merged[data.failed_drone_id];
        }

        for (const d in data.new_assignments) {
          merged[d] = [...(merged[d] ?? []), ...data.new_assignments[d]];
        }
        store.setSectorAssignments(merged);
      }
    });

    // ── comms_lost (CC-4) ─────────────────────────────────────────────────
    source.addEventListener("comms_lost", (e) => {
      const data = JSON.parse(e.data);
      useMissionStore.getState().addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "warning",
        source: data.drone_id,
        message: `📡 COMMS LOST [Tick ${data.round}]: ${data.drone_id} at tile (${data.tile_row},${data.tile_col}) — no path to base`,
      });
    });

    // ── comms_restored (CC-4) ─────────────────────────────────────────────
    source.addEventListener("comms_restored", (e) => {
      const data = JSON.parse(e.data);
      useMissionStore.getState().addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "info",
        source: data.drone_id,
        message: `📡 COMMS RESTORED [Tick ${data.round}]: ${data.drone_id} at tile (${data.tile_row},${data.tile_col})`,
      });
    });

    // ── mission_complete ──────────────────────────────────────────────────
    source.addEventListener("mission_complete", (e) => {
      const data = JSON.parse(e.data);
      const st = useMissionStore.getState();

      st.addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "success",
        source: "SYSTEM",
        message: `✓ MISSION COMPLETE — ${data.sectors_swept}/${data.rounds_completed ? data.rounds_completed : "?"} ticks, ${data.survivors_found} survivors found`,
      });

      // Build commander report for Phase 3 tab
      const report = buildReport(data);
      st.setCommanderReport(report);
      st.setActiveTab(3);
      st.setSystemStatus("COMPLETE");
      st.setMissionStarted(false);

      source.close();
      sourceRef.current = null;
    });

    // ── stream_end ────────────────────────────────────────────────────────
    source.addEventListener("stream_end", () => {
      source.close();
      sourceRef.current = null;
      const st = useMissionStore.getState();
      if (st.missionStarted) {
        st.setMissionStarted(false);
        st.setSystemStatus("STANDBY");
        st.clearHeadingQueues(); // Terminate zombie drones
      }
    });

    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      const st = useMissionStore.getState();
      if (st.missionStarted) {
        st.setMissionStarted(false);
        st.setSystemStatus("ERROR");
        st.clearHeadingQueues(); // Terminate zombie drones
        st.addLog(2, {
          timestamp: new Date().toLocaleTimeString(),
          type: "error",
          source: "SYSTEM",
          message: "✗ Stream connection lost",
        });
      }
    };
  };

  const injectFailure = async (droneId: string) => {
    setInjectOpen(false);
    setInjected(droneId);
    try {
      await fetch(`${API}/api/mission/inject-failure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drone_id: droneId }),
      });
      useMissionStore.getState().addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "warning",
        source: "SYSTEM",
        message: `⚡ Manual failure injection: ${droneId}`,
      });
    } catch {
      useMissionStore.getState().addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "error",
        source: "SYSTEM",
        message: `✗ Failed to inject failure for ${droneId}`,
      });
    }
  };

  const canInject = missionStarted;
  const coveragePct = useMissionStore((s) => s.stats?.coverage_pct ?? 0);

  return (
    <div className="border border-border bg-card/50">
      <div className="px-4 py-2.5 border-b border-border bg-secondary/30">
        <h3 className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          Mission Control
        </h3>
      </div>

      <div className="p-4 space-y-3">

        {/* ── Reset button ── */}
        <button
          onClick={() => { store.reset(); }}
          disabled={systemStatus === "ACTIVE"}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5
            bg-slate-500/10 border border-slate-500/30 text-slate-400 font-mono text-[10px]
            tracking-wider uppercase hover:bg-slate-500/20 hover:border-slate-500/50 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
        >
          ↺ RESET
        </button>

        {/* ── Coverage progress bar ── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
              Coverage
            </span>
            <span className="font-mono text-[9px] text-primary">
              {coveragePct.toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 bg-muted/50 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-700 ease-out"
              style={{ width: `${coveragePct}%` }}
            />
          </div>
        </div>

        {/* ── Status indicator ── */}
        <StatusIndicator />
      </div>
    </div>
  );
};

// ─── Small status pill ────────────────────────────────────────────────────────

const StatusIndicator = () => {
  const { systemStatus, currentRound, currentPhase } = useMissionStore();

  const colour = {
    STANDBY:  "text-muted-foreground border-border",
    ACTIVE:   "text-primary border-primary/40 animate-pulse",
    COMPLETE: "text-emerald-400 border-emerald-400/40",
    ERROR:    "text-destructive border-destructive/40",
  }[systemStatus] ?? "text-muted-foreground border-border";

  return (
    <div className={`flex items-center justify-between px-2.5 py-1.5 border font-mono text-[9px] tracking-wider uppercase ${colour}`}>
      <span>{systemStatus}</span>
      {systemStatus === "ACTIVE" && (
        <span className="text-muted-foreground">
          Tick {currentRound} · {currentPhase}
        </span>
      )}
    </div>
  );
};

// ─── Build commander report from mission_complete data ────────────────────────

function buildReport(data: any): string {
  const failedNote = data.failed_drones?.length
    ? `\n- Failed drones: ${data.failed_drones.join(", ")}`
    : "";
  const healingNote = data.self_healing_triggered
    ? "\n- Self-healing redistribution was triggered and succeeded."
    : "";

  return `## Mission Summary

**Status:** COMPLETE
**Ticks completed:** ${data.rounds_completed}
**Coverage:** ${data.sectors_swept} / ${data.total_sectors} sectors (100%)
**Survivors found:** ${data.survivors_found}
**Survivor locations:** ${data.survivor_tile_ids?.join(", ") ?? "—"}
${failedNote}${healingNote}

## Narrative

${data.narrative ?? ""}

## Assessment

${data.reasoning ?? ""}
`;
}

export default MissionControls;
