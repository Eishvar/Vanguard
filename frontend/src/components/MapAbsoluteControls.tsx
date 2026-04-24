// frontend/src/components/MapAbsoluteControls.tsx
// Overlay controls mounted inside TacticalMap's relative container.
// Owns all SSE event handling (previously in MissionControls.tsx).

import { useState, useRef, useEffect } from 'react';
import { Play, Zap, ChevronDown, Plus, Minus, Target, Ruler, Settings2 } from 'lucide-react';
import { useMissionStore, type HeadingEvent } from '@/stores/missionStore';
import { SearchBar } from './SearchBar';
import { LNG_PER_KM } from '@/lib/geoGrid';
import { toast } from 'sonner';

const API = "http://localhost:8000";

const INJECT_OPTIONS = [
  { label: "Drone A", droneId: "DRONE_A" },
  { label: "Drone B", droneId: "DRONE_B" },
  { label: "Drone C", droneId: "DRONE_C" },
];

interface Props {
  pitch: number;
  onSetPitch: (p: number) => void;
  measureActive: boolean;
  onToggleMeasure: () => void;
  onFlyToBase: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFlyTo: (lat: number, lng: number) => void;
}

export const MapAbsoluteControls = ({
  pitch, onSetPitch,
  measureActive, onToggleMeasure,
  onFlyToBase, onZoomIn, onZoomOut, onFlyTo,
}: Props) => {
  const store = useMissionStore();
  const { missionStarted, systemStatus } = store;

  const [injectOpen,  setInjectOpen]  = useState(false);
  const [injected,    setInjected]    = useState<string | null>(null);
  const [mapModeOpen, setMapModeOpen] = useState(false);
  const injectRef  = useRef<HTMLDivElement>(null);
  const mapModeRef = useRef<HTMLDivElement>(null);
  const sourceRef  = useRef<EventSource | null>(null);

  // Overlay toggle state
  const mapMode         = useMissionStore((s) => s.mapMode);
  const setMapMode      = useMissionStore((s) => s.setMapMode);
  const showSectors     = useMissionStore((s) => s.showSectorOverlay);
  const toggleSectors   = useMissionStore((s) => s.toggleSectorOverlay);
  const showNetwork     = useMissionStore((s) => s.showNetwork);
  const toggleNetwork   = useMissionStore((s) => s.toggleShowNetwork);
  const showPaths       = useMissionStore((s) => s.showDronePaths);
  const togglePaths     = useMissionStore((s) => s.toggleDronePaths);
  const showNodes       = useMissionStore((s) => s.showNodes);
  const toggleNodes     = useMissionStore((s) => s.toggleNodes);
  const showTransit     = useMissionStore((s) => s.showTransitPaths);
  const toggleTransit   = useMissionStore((s) => s.toggleTransitPaths);
  const terrainReady    = useMissionStore((s) => s.terrainReady);
  const terrainConfig   = useMissionStore((s) => s.terrainConfig);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (injectRef.current  && !injectRef.current.contains(e.target as Node))  setInjectOpen(false);
      if (mapModeRef.current && !mapModeRef.current.contains(e.target as Node)) setMapModeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Survivor toast listener (synced with drone animation queue)
  useEffect(() => {
    const handleToast = (e: any) => {
      toast(e.detail.title, { description: e.detail.desc, duration: 6000 });
    };
    window.addEventListener("trigger-toast", handleToast);
    return () => window.removeEventListener("trigger-toast", handleToast);
  }, []);

  // ── Mission start (opens SSE stream + registers all event listeners) ────────

  const startMission = async () => {
    const s = useMissionStore.getState();
    s.reset();
    s.clearTransitPaths();
    s.setMissionStarted(true);
    s.setSystemStatus("ACTIVE");
    setInjected(null);

    try {
      await fetch(`${API}/api/mission/start`, { method: "POST" });
    } catch {
      s.setSystemStatus("ERROR");
      s.setMissionStarted(false);
      return;
    }

    if (sourceRef.current) sourceRef.current.close();
    const source = new EventSource(`${API}/api/mission/stream`);
    sourceRef.current = source;

    source.addEventListener("phase_change", (e) => {
      const data = JSON.parse(e.data);
      useMissionStore.getState().setPhase(data.phase, data.round ?? 0);
      if (data.phase === "planning") {
        useMissionStore.getState().addLog(2, {
          timestamp: new Date().toLocaleTimeString(),
          type: "phase", source: "SYSTEM",
          message: "▶ Planning phase initiated",
        });
      }
    });

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
        type: "info", source: "SUPERVISOR",
        message: `[Tick ${data.round}] ${prefix}: ${data.reasoning}`,
      });
      if (data.assignments) {
        const lines = Object.entries(data.assignments)
          .map(([drone, cells]) => `  ${drone} → ${(cells as string[]).join(", ")}`)
          .join("\n");
        st.addLog(2, {
          timestamp: new Date().toLocaleTimeString(),
          type: "success", source: "SUPERVISOR",
          message: `Assignments:\n${lines}`,
        });
      }
    });

    source.addEventListener("drone_cot", (e) => {
      const data = JSON.parse(e.data);
      const st = useMissionStore.getState();
      const action = data.action?.toUpperCase() ?? "WAIT";
      const target = data.target_cell_id ? ` → ${data.target_cell_id}` : "";
      st.addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: data.status === "task_complete" ? "success" : "info",
        droneId: data.drone_id, source: data.drone_id,
        message: `[Tick ${data.round}] ${data.drone_id} ${action}${target}: ${data.reasoning}`,
      });
      st.setLastReasoning(data.drone_id, data.reasoning);
    });

    source.addEventListener("grid_update", (e) => {
      const data = JSON.parse(e.data);
      store.updateMissionSnapshot(data);
      if (data.communication_network) store.updateCommsNetwork(data.communication_network);
    });

    source.addEventListener("stats_update", (e) => {
      useMissionStore.getState().updateStats(JSON.parse(e.data));
    });

    source.addEventListener("failure_event", (e) => {
      const data = JSON.parse(e.data);
      const st = useMissionStore.getState();
      st.setDroneOffline(data.drone_id);
      st.clearDroneHeadingQueue(data.drone_id);
      st.addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "error", droneId: data.drone_id, source: data.drone_id,
        message: `⚠ DRONE FAILURE [Tick ${data.round}]: ${data.drone_id} is OFFLINE. Orphaned sectors: ${data.orphaned_sectors?.join(', ') || 'none'}`,
      });
    });

    source.addEventListener("terrain_initialized", (e) => {
      const data = JSON.parse(e.data);
      store.setMissionLaunched(true);
      store.resetBoundaryDragOffset();
      store.toggleSectorOverlay();

      const anchorLatLng = data.anchor_latlng ?? [0, 0];
      store.setTerrainConfig({
        anchorLat:    Number(anchorLatLng[0]),
        anchorLng:    Number(anchorLatLng[1]),
        gridN:        Number(data.grid_n ?? 20),
        tileM:        Number(data.tile_m ?? 200),
        obstacleElev: Number(data.obstacle_elev_threshold ?? 0),
      });
      useMissionStore.setState({ gridAnchor: { lat: Number(anchorLatLng[0]), lng: Number(anchorLatLng[1]) } });

      const baseLL = data.base_station_latlng ?? anchorLatLng;
      const baseLat = Number(baseLL[0]);
      const baseLng = Number(baseLL[1]);
      const lngOffset8m = 0.008 * LNG_PER_KM;
      const droneBaseOffsets: Record<string, [number, number]> = {
        DRONE_A: [0, 0],
        DRONE_B: [0,  lngOffset8m],
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

      const scanCount = (data.sectors_geojson?.features ?? []).filter((f: any) => !f.properties.is_obstacle).length;
      const obsCount  = (data.sectors_geojson?.features ?? []).filter((f: any) =>  f.properties.is_obstacle).length;
      store.addLog(2, {
        timestamp: new Date().toISOString(),
        type: "info", source: "SYSTEM",
        message: `Terrain ready: anchor=(${anchorLatLng[0].toFixed(4)}, ${anchorLatLng[1].toFixed(4)}), ${data.grid_n}×${data.grid_n} grid, ${scanCount} scan + ${obsCount} obstacle sectors.`,
      });
    });

    source.addEventListener("sector_assignments", (e) => {
      const data = JSON.parse(e.data);
      store.setSectorAssignments(data.assignments ?? {});
      store.addLog(2, {
        timestamp: new Date().toISOString(), type: "info", source: "SUPERVISOR",
        message: `Sector assignments:\n${
          Object.entries(data.assignments ?? {})
            .map(([d, sids]) => `  ${d}: sectors [${(sids as number[]).join(", ")}]`)
            .join("\n")
        }`,
      });
    });

    source.addEventListener("drone_heading", (e) => {
      const data = JSON.parse(e.data) as HeadingEvent;
      store.enqueueHeading(data);
      if (data.node_type === "transit" || data.node_type === "initial_transit") {
        store.appendTransitWaypoint(data.drone_id, {
          lat: data.lat, lng: data.lng,
          dist_m: data.dist_m, node_type: data.node_type,
        });
      }
    });

    source.addEventListener("recovery_event", (e) => {
      const data = JSON.parse(e.data);
      store.addLog(2, {
        timestamp: new Date().toISOString(), type: "warning", source: "SUPERVISOR",
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
        if (data.failed_drone_id) delete merged[data.failed_drone_id];
        for (const d in data.new_assignments) {
          merged[d] = [...(merged[d] ?? []), ...data.new_assignments[d]];
        }
        store.setSectorAssignments(merged);
      }
    });

    source.addEventListener("comms_lost", (e) => {
      const data = JSON.parse(e.data);
      useMissionStore.getState().addLog(2, {
        timestamp: new Date().toLocaleTimeString(), type: "warning", source: data.drone_id,
        message: `📡 COMMS LOST [Tick ${data.round}]: ${data.drone_id} at tile (${data.tile_row},${data.tile_col}) — no path to base`,
      });
    });

    source.addEventListener("comms_restored", (e) => {
      const data = JSON.parse(e.data);
      useMissionStore.getState().addLog(2, {
        timestamp: new Date().toLocaleTimeString(), type: "info", source: data.drone_id,
        message: `📡 COMMS RESTORED [Tick ${data.round}]: ${data.drone_id} at tile (${data.tile_row},${data.tile_col})`,
      });
    });

    source.addEventListener("mission_complete", (e) => {
      const data = JSON.parse(e.data);
      const st = useMissionStore.getState();
      st.addLog(2, {
        timestamp: new Date().toLocaleTimeString(), type: "success", source: "SYSTEM",
        message: `✓ MISSION COMPLETE — ${data.sectors_swept}/${data.rounds_completed ?? "?"} ticks, ${data.survivors_found} survivors found`,
      });
      st.setCommanderReport(buildReport(data));
      st.setSystemStatus("COMPLETE");
      st.setMissionStarted(false);
      source.close();
      sourceRef.current = null;
    });

    source.addEventListener("stream_end", () => {
      source.close();
      sourceRef.current = null;
      const st = useMissionStore.getState();
      if (st.missionStarted) {
        st.setMissionStarted(false);
        st.setSystemStatus("STANDBY");
        st.clearHeadingQueues();
      }
    });

    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      const st = useMissionStore.getState();
      if (st.missionStarted) {
        st.setMissionStarted(false);
        st.setSystemStatus("ERROR");
        st.clearHeadingQueues();
        st.addLog(2, {
          timestamp: new Date().toLocaleTimeString(), type: "error", source: "SYSTEM",
          message: "✗ Stream connection lost",
        });
      }
    };
  };

  // ── Inject failure ──────────────────────────────────────────────────────────

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
        timestamp: new Date().toLocaleTimeString(), type: "warning", source: "SYSTEM",
        message: `⚡ Manual failure injection: ${droneId}`,
      });
    } catch {
      useMissionStore.getState().addLog(2, {
        timestamp: new Date().toLocaleTimeString(), type: "error", source: "SYSTEM",
        message: `✗ Failed to inject failure for ${droneId}`,
      });
    }
  };

  const activeModeCount = [
    mapMode !== "none", showSectors, showPaths, showNodes, showTransit, showNetwork,
  ].filter(Boolean).length;

  // ── Map Mode dropdown items ─────────────────────────────────────────────────

  const mapModeItems = [
    { label: "ELEVATION",  active: mapMode === "elevation", toggle: () => setMapMode(mapMode === "elevation" ? "none" : "elevation"), disabled: !terrainReady },
    { label: "DENSITY",    active: mapMode === "density",   toggle: () => setMapMode(mapMode === "density"   ? "none" : "density"),   disabled: !terrainReady },
    { label: "SECTORS",    active: showSectors,   toggle: toggleSectors,   disabled: !terrainReady },
    { label: "PATHS",      active: showPaths,     toggle: togglePaths,     disabled: !terrainReady },
    { label: "NODES",      active: showNodes,     toggle: toggleNodes,     disabled: !terrainReady },
    { label: "TRANSIT",    active: showTransit,   toggle: toggleTransit,   disabled: !terrainReady },
    { label: "NETWORK",    active: showNetwork,   toggle: toggleNetwork,   disabled: false },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 z-10 pointer-events-none font-mono">

      {/* ── Search bar — centered at top, 300 px ── */}
      <div className="absolute top-2 left-0 right-0 flex justify-center pointer-events-auto">
        <SearchBar
          onFlyTo={onFlyTo}
          className="w-[300px]"
        />
      </div>

      {/* ── Top-left: mission controls + map mode ── */}
      <div className="absolute top-2 left-2 flex flex-col gap-1.5 pointer-events-auto">

        {/* Launch + Inject row */}
        <div className="flex gap-1.5">
          <button
            onClick={startMission}
            disabled={missionStarted}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/15 border border-primary/40
              text-primary text-[9px] tracking-wider uppercase hover:bg-primary/25 transition-colors
              disabled:opacity-30 disabled:pointer-events-none"
          >
            <Play size={10} />
            {missionStarted ? "RUNNING..." : "LAUNCH MISSION"}
          </button>

          <div className="relative" ref={injectRef}>
            <button
              onClick={() => setInjectOpen((o) => !o)}
              disabled={!missionStarted}
              className="flex items-center gap-1 px-2 py-1.5 border border-destructive/40
                bg-destructive/10 text-destructive/80 text-[9px] tracking-wider uppercase
                hover:bg-destructive/20 hover:border-destructive/60 hover:text-destructive
                transition-colors disabled:opacity-25 disabled:pointer-events-none"
            >
              <Zap size={10} />
              {injected ? injected.replace("DRONE_", "") : "INJECT"}
              <ChevronDown size={9} className={`transition-transform ${injectOpen ? "rotate-180" : ""}`} />
            </button>

            {injectOpen && (
              <div className="absolute top-full left-0 mt-0.5 z-50 border border-destructive/30 bg-card shadow-lg min-w-[120px]">
                {INJECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.droneId}
                    onClick={() => injectFailure(opt.droneId)}
                    className="w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase
                      text-destructive/70 hover:bg-destructive/15 hover:text-destructive transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 2D/3D + Map Mode row */}
        <div className="flex gap-1.5 items-center">
          {/* 2D/3D toggle */}
          <div className="flex border border-slate-600 overflow-hidden">
            <button
              onClick={() => onSetPitch(0)}
              className={`px-2 py-1 text-[9px] transition-colors
                ${pitch === 0
                  ? "bg-teal-500/25 border-r border-teal-500/40 text-teal-300"
                  : "bg-slate-900/80 border-r border-slate-600 text-slate-400 hover:text-slate-200"}`}
            >
              2D
            </button>
            <button
              onClick={() => onSetPitch(45)}
              className={`px-2 py-1 text-[9px] transition-colors
                ${pitch > 0
                  ? "bg-teal-500/25 text-teal-300"
                  : "bg-slate-900/80 text-slate-400 hover:text-slate-200"}`}
            >
              3D
            </button>
          </div>

          {/* Map Mode dropdown */}
          <div className="relative" ref={mapModeRef}>
            <button
              onClick={() => setMapModeOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-2 py-1 text-[9px] border transition-colors
                ${activeModeCount > 0
                  ? "bg-teal-500/15 border-teal-400/50 text-teal-300"
                  : "bg-slate-900/80 border-slate-600 text-slate-400 hover:border-teal-500/30 hover:text-slate-200"}`}
            >
              <Settings2 size={11} />
              MAP MODE
              {activeModeCount > 0 && (
                <span className="bg-teal-500 text-slate-900 text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {activeModeCount}
                </span>
              )}
              <ChevronDown size={9} className={`transition-transform ${mapModeOpen ? "rotate-180" : ""}`} />
            </button>

            {mapModeOpen && (
              <div className="absolute top-full left-0 mt-0.5 z-50 bg-card border border-border shadow-lg min-w-[140px]">
                {mapModeItems.map(({ label, active, toggle, disabled }) => (
                  <button
                    key={label}
                    onClick={toggle}
                    disabled={disabled}
                    className={`w-full text-left px-3 py-1.5 text-[9px] tracking-wider uppercase flex items-center gap-2 transition-colors
                      ${disabled
                        ? "text-muted-foreground/30 cursor-not-allowed"
                        : active
                        ? "text-primary bg-primary/10 hover:bg-primary/15"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/10"
                      }`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${active && !disabled ? "bg-primary" : "bg-border"}`} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status pill */}
        <StatusPill />
      </div>

      {/* ── Bottom-left: zoom, home, measure ── */}
      <div className="absolute bottom-8 left-2 flex flex-col items-start gap-1 pointer-events-auto">
        <button
          onClick={onToggleMeasure}
          title="Measure distance"
          className={`px-2 py-1 text-[9px] border transition-colors flex items-center gap-1
            ${measureActive
              ? "bg-amber-500/20 border-amber-400/50 text-amber-300"
              : "bg-slate-900/80 border-slate-600 text-slate-400 hover:border-amber-500/30 hover:text-slate-200"}`}
        >
          <Ruler size={11} />
          MEASURE
        </button>

        <button
          onClick={onFlyToBase}
          disabled={!terrainConfig}
          title="Center on base station"
          className="px-2 py-1 text-[9px] border border-slate-600 bg-slate-900/80 text-slate-400
            hover:border-amber-500/50 hover:text-slate-200 transition-colors flex items-center gap-1
            disabled:opacity-40 disabled:pointer-events-none"
        >
          <Target size={11} />
          HOME
        </button>

        {/* Zoom buttons */}
        <div className="flex flex-col border border-slate-600 overflow-hidden">
          <button
            onClick={onZoomIn}
            className="w-8 h-7 flex items-center justify-center bg-slate-900/80 text-slate-400
              hover:bg-slate-800 hover:text-slate-200 border-b border-slate-600 transition-colors"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={onZoomOut}
            className="w-8 h-7 flex items-center justify-center bg-slate-900/80 text-slate-400
              hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <Minus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Status indicator (inline to avoid extra imports) ─────────────────────────

const StatusPill = () => {
  const { systemStatus, currentRound, currentPhase } = useMissionStore();
  const colour = {
    STANDBY:  "text-muted-foreground border-border",
    ACTIVE:   "text-primary border-primary/40 animate-pulse",
    COMPLETE: "text-emerald-400 border-emerald-400/40",
    ERROR:    "text-destructive border-destructive/40",
  }[systemStatus] ?? "text-muted-foreground border-border";
  return (
    <div className={`flex items-center justify-between px-2 py-1 border text-[8px] tracking-wider uppercase bg-slate-900/80 ${colour}`}>
      <span>{systemStatus}</span>
      {systemStatus === "ACTIVE" && (
        <span className="text-muted-foreground ml-2">T{currentRound} · {currentPhase}</span>
      )}
    </div>
  );
};

// ── Build commander report from mission_complete payload ─────────────────────

function buildReport(data: any): string {
  const failedNote = data.failed_drones?.length
    ? `\n- Failed drones: ${data.failed_drones.join(", ")}`
    : "";
  const healingNote = data.self_healing_triggered
    ? "\n- Self-healing redistribution was triggered and succeeded."
    : "";
  return `## Mission Summary\n\n**Status:** COMPLETE\n**Ticks completed:** ${data.rounds_completed}\n**Coverage:** ${data.sectors_swept} / ${data.total_sectors} sectors (100%)\n**Survivors found:** ${data.survivors_found}\n**Survivor locations:** ${data.survivor_tile_ids?.join(", ") ?? "—"}\n${failedNote}${healingNote}\n\n## Narrative\n\n${data.narrative ?? ""}\n\n## Assessment\n\n${data.reasoning ?? ""}\n`;
}
