import { create } from "zustand";
import type { FeatureCollection } from "geojson";

export interface Drone {
  id: string;
  status: "active" | "offline" | "low_battery" | "rtb";
  sectorId: number;    // current sector being swept (-1 = transit/idle)
  battery: number;
  lat: number;
  lng: number;
  tileRow: number;
  tileCol: number;
}

export interface SurvivorProfile {
  description: string;
  num_people: number;
  medical_priority: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  extraction_notes: string;
}

export interface SurvivorRecord {
  tile_id: string;
  drone_id: string;
  round: number;
  timestamp: string;
  thermal_reading: number;
  survivor_profile: SurvivorProfile;
}

// Change 1: Communication network from comms.py (embedded in grid_update events)
export interface CommsNetwork {
  links: [string, string][];
  reachable_from_base: string[];
  isolated: string[];
  entities: {
    id: string;
    pos_km: [number, number];
    radius_km: number;
  }[];
}

export interface LogEntry {
  timestamp: string;
  type: "info" | "warning" | "error" | "success" | "phase";
  droneId?: string;
  source?: string;
  message: string;
}

export interface StatsSnapshot {
  round_number: number;
  phase: string;
  total_sectors: number;
  sectors_swept: number;
  survivors_found: number;
  failed_drones: string[];
  completed: boolean;
  coverage_pct: number;
}

export interface TileData {
  row: number;
  col: number;
  elevation_m: number;
  density: number;
  is_obstacle: boolean;
  sector_id: number;
}

export interface SectorFeatureProps {
  sector_id: number;
  is_obstacle: boolean;
  area_km2: number;
  avg_elevation_m: number;
  avg_density: number;
  battery_cost: number;
  centroid_latlng: [number, number];
  sweep_path_latlng: [number, number][];
  sweep_path_length_m: number;
}

export interface SectorHandoff {
  failedDroneId: string;
  survivorId: string;
  resumeIndex: number;
  totalWaypoints: number;
  pctDone: number;
}

export interface HeadingEvent {
  drone_id:    string;
  lat:         number;
  lng:         number;
  heading_deg: number;
  sector_id:   number;
  path_index:  number;
  path_total:  number;
  dist_m:      number;
  node_type:   string;
  battery:     number;
  tile_row:    number;
  tile_col:    number;
  survivor_data?: SurvivorRecord;
}

export interface TransitWaypoint {
  lat:       number;
  lng:       number;
  dist_m:    number;
  node_type: string;   // "transit" | "initial_transit"
}

export interface DroneTransitPath {
  drone_id:  string;
  waypoints: TransitWaypoint[];
}

export type MapMode = "none" | "elevation" | "density";

/**
 * Geographic config that arrives from the backend via terrain_initialized.
 * All map components must read these from the store, NEVER from any
 * frontend constants file. The only source of truth for these values is
 * backend/config.py.
 */
export interface TerrainConfig {
  anchorLat:    number;   // SW corner latitude
  anchorLng:    number;   // SW corner longitude
  gridN:        number;   // e.g. 20
  tileM:        number;   // e.g. 200.0
  obstacleElev: number;   // threshold in metres ASL
}

interface MissionSnapshot {
  swept_sectors?: number[];
  total_sectors?: number;
  drone_positions?: Record<string, {
    id: string;
    battery: number;
    status: "active" | "offline" | "low_battery" | "rtb";
    tile_row: number;
    tile_col: number;
    lat: number;
    lng: number;
    sector_id: number;
  }>;
  survivors?: Record<string, SurvivorRecord>;
  communication_network?: CommsNetwork;
}

interface MissionState {
  systemStatus: "STANDBY" | "ACTIVE" | "COMPLETE" | "ERROR";
  missionStarted: boolean;
  currentPhase: string;
  currentRound: number;

  drones: Drone[];
  sweptSectors: number[];
  totalSectors: number;
  survivorTiles: Record<string, SurvivorRecord>;

  stats: StatsSnapshot | null;
  survivorsFound: number;
  survivorsFoundList: SurvivorRecord[];

  activeTab: 1 | 2 | 3;
  phaseLogs: { 1: LogEntry[]; 2: LogEntry[]; 3: LogEntry[] };
  commanderReport: string;
  lastReasoningByDrone: Record<string, string>;

  showNetwork: boolean;
  commsNetwork: CommsNetwork | null;

  // Pre-launch visualization state
  missionLaunched: boolean;
  boundaryDragOffset: { dx: number; dy: number };
  searchMarker: { lat: number; lng: number } | null;

  // Terrain config (populated by terrain_initialized SSE event)
  terrainConfig: TerrainConfig | null;
  visualDroneSpeedMps: number;

  // Terrain data
  tilesGrid:            Record<string, TileData>;
  sectorsGeoJSON:       FeatureCollection | null;
  sectorAssignments:    Record<string, number[]>;
  droneHeadings:        Record<string, number>;
  dronePathProgress:    Record<string, number>;
  sectorHandoffs:       Record<number, SectorHandoff>;
  dronePositionsLatLng: Record<string, [number, number]>;
  mapMode:              MapMode;
  showSectorOverlay:    boolean;
  showDronePaths:       boolean;
  showNodes:            boolean;
  terrainReady:         boolean;
  transitPaths:         Record<string, TransitWaypoint[]>;
  showTransitPaths:     boolean;

  setSystemStatus: (s: MissionState["systemStatus"]) => void;
  setMissionStarted: (v: boolean) => void;
  setPhase: (phase: string, round: number) => void;
  updateMissionSnapshot: (snapshot: MissionSnapshot) => void;
  setDroneOffline: (droneId: string) => void;
  updateStats: (stats: StatsSnapshot) => void;
  addSurvivor: (record: SurvivorRecord) => void;
  addLog: (tab: 1 | 2 | 3, entry: LogEntry) => void;
  setLastReasoning: (droneId: string, reasoning: string) => void;
  setActiveTab: (tab: 1 | 2 | 3) => void;
  setCommanderReport: (report: string) => void;
  toggleShowNetwork: () => void;
  updateCommsNetwork: (network: CommsNetwork) => void;

  setMissionLaunched: (launched: boolean) => void;
  setBoundaryDragOffset: (offset: { dx: number; dy: number }) => void;
  resetBoundaryDragOffset: () => void;
  setSearchMarker: (marker: { lat: number; lng: number } | null) => void;

  setTerrainConfig: (cfg: TerrainConfig) => void;
  setVisualDroneSpeedMps: (v: number) => void;
  setTilesGrid: (grid: Record<string, TileData>) => void;
  setSectorsGeoJSON: (gj: FeatureCollection) => void;
  setSectorAssignments: (a: Record<string, number[]>) => void;
  setDroneHeading: (droneId: string, heading: number) => void;
  setDronePositionLatLng: (droneId: string, lat: number, lng: number) => void;
  setDronePathProgress: (droneId: string, pathIndex: number) => void;
  setSectorHandoff: (sectorId: number, handoff: SectorHandoff) => void;
  setMapMode: (mode: MapMode) => void;
  toggleSectorOverlay: () => void;
  toggleDronePaths: () => void;
  toggleNodes: () => void;
  reset: () => void;

  appendTransitWaypoint: (droneId: string, wp: TransitWaypoint) => void;
  clearTransitPaths:     () => void;
  toggleTransitPaths:    () => void;

  // ── Heading event queue (per-drone, distance-based timing) ──────────────
  _headingQueues: Record<string, HeadingEvent[]>;
  _queueActive:  Record<string, boolean>;
  enqueueHeading(event: HeadingEvent): void;
  clearHeadingQueues(): void;
  clearDroneHeadingQueue: (droneId: string) => void;
  _drainNext(droneId: string): void;
}

const DEFAULT_DRONES: Drone[] = [
  { id: "DRONE_A", status: "active", sectorId: -1, battery: 100, lat: 0, lng: 0, tileRow: 0, tileCol: 0 },
  { id: "DRONE_B", status: "active", sectorId: -1, battery: 100, lat: 0, lng: 0, tileRow: 0, tileCol: 0 },
  { id: "DRONE_C", status: "active", sectorId: -1, battery: 100, lat: 0, lng: 0, tileRow: 0, tileCol: 0 },
];

export const useMissionStore = create<MissionState>((set, get) => ({
  systemStatus: "STANDBY",
  missionStarted: false,
  currentPhase: "init",
  currentRound: 0,
  drones: DEFAULT_DRONES.map(d => ({ ...d })),
  sweptSectors: [],
  totalSectors: 0,
  survivorTiles: {},
  stats: null,
  survivorsFound: 0,
  survivorsFoundList: [],
  activeTab: 2,
  phaseLogs: { 1: [], 2: [], 3: [] },
  commanderReport: "",
  lastReasoningByDrone: {},
  showNetwork: false,
  commsNetwork: null,

  missionLaunched: false,
  boundaryDragOffset: { dx: 0, dy: 0 },
  searchMarker: null,

  terrainConfig: null,
  visualDroneSpeedMps: 333,

  tilesGrid:            {},
  sectorsGeoJSON:       null,
  sectorAssignments:    {},
  droneHeadings:        {},
  dronePathProgress:    {},
  sectorHandoffs:       {},
  dronePositionsLatLng: {},
  mapMode:              "none" as MapMode,
  _headingQueues: {},
  _queueActive:  {},
  showSectorOverlay:    false,
  showDronePaths:       true,
  showNodes:            false,
  terrainReady:         false,
  transitPaths:         {},
  showTransitPaths:     false,

  setSystemStatus: (s) => set({ systemStatus: s }),
  setMissionStarted: (v) => set({ missionStarted: v }),
  setPhase: (phase, round) => set({ currentPhase: phase, currentRound: round }),

  updateMissionSnapshot: (snapshot) =>
    set((state) => {
      // THE FIX: Do NOT overwrite drone positions from the backend snapshot!
      // The _drainNext queue is the absolute source of truth for visual drone state.
      return {
        sweptSectors:  snapshot.swept_sectors  ?? state.sweptSectors,
        totalSectors:  snapshot.total_sectors  ?? state.totalSectors,
        survivorTiles: snapshot.survivors
          ? { ...state.survivorTiles, ...snapshot.survivors }
          : state.survivorTiles,
      };
    }),

  setDroneOffline: (droneId) =>
    set((state) => ({
      drones: state.drones.map((d) =>
        d.id === droneId ? { ...d, status: "offline" } : d
      ),
    })),

  updateStats: (stats) =>
    set({
      stats,
      survivorsFound: stats.survivors_found,
      currentRound: stats.round_number,
      currentPhase: stats.phase,
    }),

  addSurvivor: (record) =>
    set((state) => ({
      survivorsFoundList: [...state.survivorsFoundList, record],
    })),

  addLog: (tab, entry) =>
    set((state) => ({
      phaseLogs: { ...state.phaseLogs, [tab]: [...state.phaseLogs[tab], entry] },
    })),

  setLastReasoning: (droneId, reasoning) =>
    set((state) => ({
      lastReasoningByDrone: { ...state.lastReasoningByDrone, [droneId]: reasoning },
    })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setCommanderReport: (report) => set({ commanderReport: report }),

  toggleShowNetwork: () => set((s) => ({ showNetwork: !s.showNetwork })),
  updateCommsNetwork: (network) => set({ commsNetwork: network }),

  setMissionLaunched: (launched) => set({ missionLaunched: launched }),
  setBoundaryDragOffset: (offset) => set({ boundaryDragOffset: offset }),
  resetBoundaryDragOffset: () => set({ boundaryDragOffset: { dx: 0, dy: 0 } }),
  setSearchMarker: (marker) => set({ searchMarker: marker }),

  setTerrainConfig: (cfg) => set({ terrainConfig: cfg }),
  setVisualDroneSpeedMps: (v) => set({ visualDroneSpeedMps: v }),

  setTilesGrid: (grid) => set({ tilesGrid: grid, terrainReady: true }),

  setSectorsGeoJSON: (gj) => set({ sectorsGeoJSON: gj }),

  setSectorAssignments: (a) => set({ sectorAssignments: a }),

  setDroneHeading: (droneId, heading) =>
    set((s) => ({ droneHeadings: { ...s.droneHeadings, [droneId]: heading } })),

  setDronePositionLatLng: (droneId, lat, lng) =>
    set((s) => ({
      dronePositionsLatLng: { ...s.dronePositionsLatLng, [droneId]: [lat, lng] },
    })),

  setDronePathProgress: (droneId, pathIndex) =>
    set((s) => ({
      dronePathProgress: { ...s.dronePathProgress, [droneId]: pathIndex },
    })),

  setSectorHandoff: (sectorId, handoff) =>
    set((s) => ({
      sectorHandoffs: { ...s.sectorHandoffs, [sectorId]: handoff },
    })),

  enqueueHeading: (event) => {
    set((s) => {
      const queues = { ...s._headingQueues };
      if (!queues[event.drone_id]) queues[event.drone_id] = [];
      queues[event.drone_id] = [...queues[event.drone_id], event];
      return { _headingQueues: queues };
    });
    if (!get()._queueActive[event.drone_id]) {
      get()._drainNext(event.drone_id);
    }
  },

  _drainNext: (droneId: string) => {
    // Stop draining immediately if drone is offline
    const drone = get().drones.find((d) => d.id === droneId);
    if (drone?.status === "offline") {
      set((s) => ({
        _headingQueues: { ...s._headingQueues, [droneId]: [] },
        _queueActive:   { ...s._queueActive,   [droneId]: false },
      }));
      return;
    }

    const queue = get()._headingQueues[droneId] ?? [];
    if (queue.length === 0) {
      set((s) => ({
        _queueActive: { ...s._queueActive, [droneId]: false },
      }));
      return;
    }
    const [item, ...rest] = queue;
    set((s) => ({
      _headingQueues: { ...s._headingQueues, [droneId]: rest },
      _queueActive:   { ...s._queueActive,  [droneId]: true  },
    }));
    get().setDronePositionLatLng(droneId, item.lat, item.lng);
    get().setDroneHeading(droneId, item.heading_deg);
    get().setDronePathProgress(droneId, item.path_index);
    set((s) => ({
      drones: s.drones.map((d) =>
        d.id === droneId
          ? { ...d, battery: item.battery, sectorId: item.sector_id }
          : d
      ),
    }));

    if (item.survivor_data) {
      const data = item.survivor_data;
      get().addSurvivor(data);
      get().addLog(2, {
        timestamp: new Date().toLocaleTimeString(),
        type: "warning",
        source: data.drone_id ?? "SYSTEM",
        message: `🔴 SURVIVOR FOUND [R${data.round}]: ${data.tile_id}${data.drone_id ? ` by ${data.drone_id}` : ""}`,
      });
      window.dispatchEvent(new CustomEvent("trigger-toast", {
        detail: {
          title: `SURVIVOR FOUND — ${data.tile_id}`,
          desc: `${data.survivor_profile?.medical_priority ?? "UNKNOWN"} · ${data.survivor_profile?.num_people ?? 1} person(s)${data.drone_id ? ` · ${data.drone_id}` : ""}`,
        },
      }));
    }

    const speedMps = get().visualDroneSpeedMps;
    const durationMs = Math.max(50, (item.dist_m / speedMps) * 1000);
    setTimeout(() => get()._drainNext(droneId), durationMs);
  },

  clearHeadingQueues: () =>
    set({ _headingQueues: {}, _queueActive: {} }),

  clearDroneHeadingQueue: (droneId) =>
    set((s) => ({
      _headingQueues: { ...s._headingQueues, [droneId]: [] },
      _queueActive:   { ...s._queueActive,   [droneId]: false },
    })),

  setMapMode: (mode) => set({ mapMode: mode }),

  toggleSectorOverlay: () =>
    set((s) => ({ showSectorOverlay: !s.showSectorOverlay })),

  toggleDronePaths: () =>
    set((s) => ({ showDronePaths: !s.showDronePaths })),

  toggleNodes: () =>
    set((s) => ({ showNodes: !s.showNodes })),

  appendTransitWaypoint: (droneId, wp) =>
    set((s) => ({
      transitPaths: {
        ...s.transitPaths,
        [droneId]: [...(s.transitPaths[droneId] ?? []), wp],
      },
    })),

  clearTransitPaths: () => set({ transitPaths: {} }),

  toggleTransitPaths: () =>
    set((s) => ({ showTransitPaths: !s.showTransitPaths })),

  reset: () =>
    set({
      systemStatus:   "STANDBY",
      missionStarted: false,
      currentPhase:   "init",
      currentRound:   0,
      drones:         DEFAULT_DRONES.map(d => ({ ...d })),
      sweptSectors:   [],
      totalSectors:   0,
      survivorTiles:  {},
      stats:          null,
      survivorsFound: 0,
      survivorsFoundList: [],
      activeTab:      2,
      phaseLogs:      { 1: [], 2: [], 3: [] },
      commanderReport: "",
      lastReasoningByDrone: {},
      missionLaunched: false,
      boundaryDragOffset: { dx: 0, dy: 0 },
      searchMarker:   null,
      showNetwork:    false,
      commsNetwork:   null,
      terrainConfig:  null,
      visualDroneSpeedMps: 333,
      tilesGrid:      {},
      sectorsGeoJSON: null,
      sectorAssignments:    {},
      droneHeadings:        {},
      dronePathProgress:    {},
      sectorHandoffs:       {},
      dronePositionsLatLng: {},
      mapMode:              "none" as MapMode,
      showSectorOverlay:    false,
      showDronePaths:       true,
      showNodes:            false,
      terrainReady:         false,
      transitPaths:         {},
      showTransitPaths:     false,
      _headingQueues:       {},
      _queueActive:         {},
    }),
}));

export const DRONE_COLORS: Record<string, string> = {
  DRONE_A: "text-red-400",
  DRONE_B: "text-purple-400",
  DRONE_C: "text-cyan-400",
};

export const DRONE_BG_COLORS: Record<string, string> = {
  DRONE_A: "bg-red-400",
  DRONE_B: "bg-purple-400",
  DRONE_C: "bg-cyan-400",
};

declare global {
  interface Window {
    useMissionStore: any;
  }
}

window.useMissionStore = useMissionStore;
