# ARCHITECTURE — FRONTEND
> Read this file for frontend tasks. For file structure and how to run, see `docs/arch/OVERVIEW.md`. For SSE event schemas, see `docs/arch/EVENTS.md`.

---

## Frontend Store (`frontend/src/stores/missionStore.ts`)

**`useMissionStore`** (Zustand):

### Key Interfaces

**`Drone`:** `{id: string, status: "active"|"offline"|"low_battery"|"rtb", sectorId: number, battery: number, lat: number, lng: number, tileRow: number, tileCol: number}` — battery 0–400; sectorId=-1 when transit/idle

**`LogEntry`:** `{timestamp: string, type: "info"|"warning"|"error"|"success"|"phase", droneId?: string, source?: string, message: string}`. `source` drives icon colour in `LogEntryRow`: SUPERVISOR=teal-400, DRONE_A=red-400, DRONE_B=purple-400, DRONE_C=cyan-400, SYSTEM/fallback=muted.

**`CommsNetwork`:** `{links: [[id_a, id_b], ...], reachable_from_base: [drone_id, ...], isolated: [drone_id, ...], entities: [{id, pos_km, radius_km}, ...]}`

### State Fields

| Field | Type | Default |
|-------|------|---------|
| `systemStatus` | `"STANDBY"\|"ACTIVE"\|"COMPLETE"\|"ERROR"` | `"STANDBY"` |
| `missionStarted` | `boolean` | `false` |
| `currentPhase` | `string` | `"init"` |
| `currentRound` | `number` | `0` |
| `drones` | `Drone[]` | 3 drones, sectorId=-1, battery=400 |
| `sweptSectors` | `number[]` | `[]`; sector IDs fully swept |
| `totalSectors` | `number` | `0`; non-obstacle sector count |
| `survivorTiles` | `Record<string, SurvivorRecord>` | `{}`; keyed by tile_id "r{row}_c{col}" |
| `stats` | `StatsSnapshot \| null` | `null` |
| `survivorsFound` | `number` | `0` |
| `survivorsFoundList` | `SurvivorRecord[]` | `[]` |
| `activeTab` | `1\|2\|3` | `2` |
| `phaseLogs` | `{1: LogEntry[], 2: LogEntry[], 3: LogEntry[]}` | `{1:[],2:[],3:[]}` |
| `commanderReport` | `string` | `""` |
| `lastReasoningByDrone` | `Record<string, string>` | `{}` |
| `showNetwork` | `boolean` | `false` |
| `commsNetwork` | `CommsNetwork \| null` | `null` |
| `missionLaunched` | `boolean` | `false`; set `true` on `terrain_initialized`; reset by `reset()` |
| `boundaryDragOffset` | `{ dx: number; dy: number }` | `{0,0}`; pure UI drag offset for BoundaryOverlay preview |
| `searchMarker` | `{ lat: number; lng: number } \| null` | `null`; set by SearchBar; cleared by SearchMarker dismiss |

### Actions

- `updateMissionSnapshot(snapshot)` — updates sweptSectors, totalSectors, drones (from drone_positions), survivorTiles; called by grid_update handler
- `setDroneOffline(droneId)` — sets `status:"offline"`
- `updateStats(stats)` — updates stats, survivorsFound, currentRound, currentPhase
- `addSurvivor(record)` — appends `SurvivorRecord` to `survivorsFoundList` (called by `survivor_alert` listener)
- `addLog(tab, entry)` — appends to phaseLogs[tab]
- `setLastReasoning(droneId, reasoning)` — drives `LiveCotPanel`
- `toggleShowNetwork()` — toggles `showNetwork`
- `updateCommsNetwork(network)` — updates `commsNetwork`
- `reset()` — full reset to default state including `commsNetwork: null`, `sweptSectors: []`, `survivorTiles: {}`

### Exported Constants

- `DRONE_COLORS: Record<string, string>` — Tailwind text color classes
- `DRONE_BG_COLORS: Record<string, string>` — Tailwind bg color classes

---

## `MissionControls.tsx` — SSE Event Handler

Contains all frontend SSE logic. `startMission()` runs on button click:
1. Calls `store.reset()`, sets `missionStarted=true`, `systemStatus="ACTIVE"`
2. `fetch("http://localhost:8000/api/mission/start", {method:"POST"})`
3. Calls `store.lockGrid()` after POST succeeds
4. Opens `new EventSource("http://localhost:8000/api/mission/stream")`
5. Registers listeners for all named event types

**`grid_update` listener:** Calls `store.updateMissionSnapshot(data)` which sets sweptSectors, totalSectors, drones (lat/lng/sectorId/battery from drone_positions), survivorTiles. Then calls `updateCommsNetwork` when `communication_network` present.

**`buildReport(data) → string`**: Constructs markdown string from `mission_complete` payload for Tab 3.

---

## 4. Data Flow — Single Mission Round (End-to-End)

```
User clicks "LAUNCH MISSION"
  │
  ├─ store.reset() — clears all state
  ├─ store.lockGrid() — grid position fixed
  ├─ POST http://localhost:8000/api/mission/start
  │    └─ api_server.py creates Orchestrator + asyncio.Queue
  │         └─ asyncio.create_task(run_and_cleanup())
  │              └─ orchestrator.run_mission(event_queue)
  └─ EventSource("http://localhost:8000/api/mission/stream")

EXECUTION ROUND N:
  Each DroneAgent.act():
    ├─ asyncio.gather(get_drone_status, get_grid_state)  ← parallel read
    ├─ build_tactical_context() + evaluate_worker()
    ├─ [LLM] WORKER → DroneDecision
    └─ [MCP] move_drone or scan_cell

  orchestrator → _emit("drone_cot", {drone_id, round, reasoning, action, target_cell_id, status})
    └─ frontend Tab 2: addLog + setLastReasoning(drone_id, reasoning) → LiveCotPanel updates

  orchestrator → asyncio.gather(get_grid_state(), get_mission_status())  ← parallel read
  orchestrator → _emit_diffs() → possible survivor_alert, comms_lost, comms_restored
  orchestrator → _emit("grid_update", {...})
    └─ MissionControls grid_update listener:
         ├─ updateDronesFromSnapshot(data.drones)  — battery, cell, status
         ├─ updateCells(cells with lat/lng injected via cellCenter())
         └─ updateCommsNetwork(data.communication_network)
         → TacticalMap, FleetStatus, SectorCoverage re-render

  orchestrator → _emit("stats_update", {...})
    └─ updateStats() → SectorCoverage + MissionIntel re-render
```

### SimulationCore → missionStore.ts SSE Bridge

```
SimulationCore.get_grid_snapshot()            [simulation.py]
  ↓ returns {cells, drones:{drone_id:{cell_id,battery,status}}, communication_network, ...}
GameState → MCP → Orchestrator._emit("grid_update", grid_snap)
  ↓ mission_logger.log() + event_queue.put()
api_server.generate() → SSE "event: grid_update\ndata: {...}\n\n"
MissionControls.tsx grid_update listener
  ├─ updateDronesFromSnapshot(data.drones)
  └─ updateCells(data.cells with lat/lng injected)
React re-renders: TacticalMap, FleetStatus, SectorCoverage
```

---

## Component Descriptions (Frontend)

**`TacticalMap.tsx`**: MapLibre GL JS geospatial map. Uses OpenFreeMap Liberty vector style (`VECTOR_STYLE_URL`). Mounts `<GridOverlay>`, drone `<Marker>` array (with `DRONE_CELL_OFFSETS` so stacked drones stay visible), survivor `<Marker>` array, draggable grid handle (pre-mission only), always-on 3D buildings `<Layer>` (OpenFreeMap source), `<NetworkOverlay>`, `<DroneDetailCard>` popup (when `selectedDroneId` set), `<MeasureTool>`, `<NavigationControl>`, `<ScaleControl>`. Local state: `viewState`, `isDraggingGrid`, `hoveredEntityId` (for ring hover — renamed from `hoveredDroneId`), `measureActive`, `measurePoints`, `selectedDroneId`. Reads `gridAnchor`, `gridLocked`, `commsNetwork`, `showNetwork`, `lastReasoningByDrone` from store. Globe projection (`projection="globe"`), `maxPitch={50}`, `antialias={false}`, `fadeDuration={0}`.

**`GridOverlay.tsx`**: GeoJSON `<Source>` + `<Layer>` for cell fills, borders, cell ID labels (zoom 13+), coordinate labels (zoom 14+), outer boundary dashes. Derives GeoJSON from `cells` store state via `cellPolygon()` from `geoGrid.ts`.

**`NetworkOverlay.tsx`**: GeoJSON `<Source>` + `<Layer>` for comm-range rings and bidirectional animated mesh arrows. Reads `showNetwork` and `commsNetwork` from store. Props: `hoveredEntityId: string | null`, `anchor: LatLng`. Rings: teal (`#14b8a6`) if `reachable_from_base`, red (`#ef4444`) if isolated; BASE always teal. Arrows: 14-step marching-ants dash cycle at 50 ms/step; two `line-offset` ±2px layers (`network-arrows-fwd` / `network-arrows-bwd`) with opposite animation phase give simultaneous bidirectional flow; symbol layers add arrowhead icons. Animation runs via `requestAnimationFrame` inside this component only — parent does not re-render. Circle polygons approximated at 64 steps.

**`TerrainOverlay.tsx`**: GeoJSON `<Source>` + `<Layer>` for terrain tile fills. Reads `tilesGrid`, `mapMode`, and `terrainConfig` from store. Renders nothing when `mode === "none"` or tiles are absent. Two paint modes: `elevation` uses a 5-stop colour ramp (`elevationPaint`) derived dynamically from `cfg.obstacleElev` (config-driven — no hardcoded thresholds); `density` uses a fixed RGBA ramp. GeoJSON built via `localMToLatLng` from `terrainGeo.ts`. Wired into `TacticalMap` in Phase 13.

**`DroneDetailCard.tsx`**: MapLibre `<Popup anchor="bottom">` mounted inside `<Map>` when `selectedDroneId` is set in `TacticalMap`. Props: `drone`, `longitude`, `latitude`, `reasoning: string`, `onClose`. Dark-themed card (`bg-[#0d1520]`): drone ID + color dot, cell ID, GPS lat/lng, `<BatteryIcon>` + %, status badge (`ACTIVE`/`LOW BATT`/`OFFLINE`), last 120 chars of `lastReasoningByDrone` (fallback: "No reasoning yet."). Inline `<style>` overrides MapLibre popup default white background.

**`BatteryIcon.tsx`**: Reusable SVG battery fill icon. `percent` prop (0–100) drives inner bar height (0–16px). Fill: teal-400 when `percent ≥ 20`, red-400 when `percent < 20`.

**`DroneIcon.tsx`**: SVG drone icon (4-arm top-down). Switches to CSS perspective transform at zoom ≥ 16. Ping animation when active. Red X when offline. Isolated ring when comms lost.

**`PresetLocations.tsx`**: Dropdown calling `setGridAnchor` + `flyTo` for 5 preset disaster locations. Hidden once `gridLocked`.

**`MeasureTool.tsx`**: Distance measurement tool mounted inside `<Map>`. Props: `active`, `points: MeasurePoint[]`, `onRemoveLast`, `onClear`. When `active`, map clicks add `{lat, lng}` points; renders a polyline GeoJSON layer and a distance label showing total km. Controlled entirely by `TacticalMap` local state (`measureActive`, `measurePoints`).

**`SurvivorPanel.tsx`**: Right-panel survivor list. Reads `survivorsFoundList` from store. Sorted CRITICAL→LOW then by round. Each row click opens a `SurvivorReportCard` overlay. Shows "None detected" when empty.

**`SurvivorReportCard.tsx`**: Fixed fullscreen overlay for a single `SurvivorRecord`. Shows: priority badge (CRITICAL=red, HIGH=orange, MODERATE=yellow, LOW=green), thermal image with `onError` fallback placeholder, `<AudioWaveform>` + audio transcript, GPS from `cellCenter()`, data grid (cell, drone, round, collapse hours, coords, time), description, extraction notes.

**`AudioWaveform.tsx`**: CSS-animated SVG bar chart. NW_3 = distressed pattern (600ms), SE_3 = regular pattern (1200ms); returns `null` for all other cells. Animation via `@keyframes waveform-pulse` defined in `index.css`.

**`BoundaryOverlay.tsx`**: GeoJSON `<Source>` + `<Layer>` that draws a dashed amber 2km×2km rectangle from `terrainConfig` anchor. Reads `missionLaunched` from store and returns `null` once the mission starts (sectors + tiles take over). Drag offset (`boundaryDragOffset`) shifts the rectangle for pre-launch visualization; reset on `terrain_initialized`.

**`BaseStationMarker.tsx`**: `<Marker>` positioned at `baseStationLatLng(cfg)` (centre of tile row=0, col=0). Shows "📡 BASE" label with amber border. Always visible once `terrainConfig` is non-null; hidden automatically when `cfg` is null.

**`SearchBar.tsx`**: Absolutely-positioned coordinate search input at `top-16 left-4` (below PresetLocations). Parses "lat, lng" or "lat lng" formats. On submit: calls `setSearchMarker` and `onFlyTo` prop. Shows inline error message for invalid input.

**`SearchMarker.tsx`**: `<Marker>` at the last searched coordinate. Displays lat/lng label with a dismiss (×) button that calls `setSearchMarker(null)`.

**`MapHUD.tsx`**: Overlay buttons — 2D/3D pitch toggle, 🎯 HOME (flies to base station; disabled before `terrainConfig` loads), 📡 NETWORK toggle, grid lock status panel.

**`geoGrid.ts`** (`frontend/src/lib/`): Coordinate math library calibrated for Ranau, Sabah (5.9°N). All tile/grid functions take a `GridConfig` argument — no hardcoded geographic values.
- `PRESET_LOCATIONS`: 5 disaster sites (Merapi, Leyte, Palu, Kelantan, Taal) — preset anchors for the UI selector
- `gridAnchorFromConfig(cfg)` → `{lat, lng, tileM, gridN}` — extracts anchor from a TerrainConfig-shaped object
- `tileCenter(row, col, cfg)` → `LatLng` — center of a terrain tile
- `tileBoundsPolygon(row, col, cfg)` → `[lng, lat][]` — 5-point GeoJSON polygon (closed ring, GeoJSON order)
- `gridCenter(cfg)` → center of entire terrain grid
- `LAT_PER_M = 1/110574`, `LNG_PER_M = 1/110043` (Ranau 5.9°N); `LAT_PER_KM`, `LNG_PER_KM` derived from these

**`terrainGeo.ts`** (`frontend/src/lib/`): Pure coordinate-math functions for the 20×20 terrain grid. Exports only `LAT_PER_M` as a top-level constant (universal Earth property). All other functions take a `TerrainConfig` argument — no hardcoded geographic values. Key exports: `lngPerM`, `localMToLatLng`, `tileLatLngBounds`, `baseStationLatLng`, `toGeoJSONLngLat`.

**`mapStyles.ts`** (`frontend/src/lib/`): Tile source definitions.
- `SATELLITE_TILES`: EOX Sentinel-2 cloudless (no API key)
- `TERRAIN_TILES`: AWS Elevation Tiles, terrarium encoding (no API key)
- `VECTOR_STYLE_URL`: OpenFreeMap Liberty style (no API key)
- `SATELLITE_STYLE`: Custom MapLibre style JSON with satellite + terrain sources

**`MissionLogs.tsx`**: 2-tab viewer (EXECUTION + REPORT). Sticky filter toolbar: ALL|DRONES|SUPV|CRITICAL pills + text search + pin-to-bottom toggle. `LiveCotPanel` at top of Execution content. Each entry via `LogEntryRow`. Tab 3 via `MissionReportView`.

**`LogEntry.tsx`** (`LogEntryRow`): Source-aware icon colour — SUPERVISOR=teal-400, DRONE_A=red-400, DRONE_B=purple-400, DRONE_C=cyan-400. Error entries get red left-border; warning get amber.

**`LiveCotPanel.tsx`**: Reads `lastReasoningByDrone` from store. Compact per-drone reasoning strip with 2-line clamp. Renders nothing until at least one drone has CoT.

**`MissionReportView.tsx`**: All Tab 3 markdown rendering. Reads `commanderReport` from store internally. Self-contained.

**`FleetStatus.tsx`**: Right panel — per-drone status, currentCell, battery bar.

**`SectorCoverage.tsx`**: Right panel — overall progress bar + per-sector status pills (S0 ✓/○ area_km²) from sweptSectors/totalSectors/sectorsGeoJSON.

**`MissionIntel.tsx`**: Right panel — survivors found counter.

**`IntroSequence.tsx`**: Animated splash screen (glitch + split-screen). Shown once before main UI.

**`Dashboard.tsx`**: Layout shell — sidebar + header + either TacticalMap+right-panel or MissionLogs.

---

## 7. Known Frontend Inconsistencies

### Font Conflict
`tailwind.config.ts` defines `font-mono: ['IBM Plex Mono', 'monospace']` but `index.css` imports only JetBrains Mono and overrides `.font-mono`. **JetBrains Mono is what actually renders everywhere.** IBM Plex Mono is never loaded.

### Unused Code
- `HudPanel.tsx` — defines reusable HUD card. Not imported anywhere.
- `NavLink.tsx` — React Router NavLink wrapper. Not imported anywhere (app uses prop-driven page switching).
- `use-mobile.tsx` — `useIsMobile()` hook. Not imported anywhere.
- `App.css` — Vite scaffold CSS. Not imported anywhere (`main.tsx` imports only `index.css`).
- `file_list.txt` — Windows path artifact. Can be deleted.
- `components/ui/` — 40+ shadcn/ui components. Only `sonner`, `toaster`, `tooltip` are used.

### Consistency Notes
- Drone colors hardcoded in two places: `missionStore.ts` (`DRONE_COLORS`, `DRONE_BG_COLORS`) and referenced in `TacticalMap.tsx` drone SVG colors. If colors change, check both.
- Default cell neighbor lists hardcoded in `missionStore.ts` (DEFAULT_CELLS). Duplicates simulation logic. If grid changes, both must be updated.

### Frontend Constants
```typescript
// MissionControls.tsx
const API = "http://localhost:8000"

// missionStore.ts defaults
// All 3 drones: {status:"active", currentCell:"SW_2", battery:100}
// All 16 cells: status:"unscanned", has_survivor:false, damage_level:0

// TopHeader.tsx
// Clock timezone: "Asia/Kuala_Lumpur" (MYT = UTC+8) — hardcoded, updates every 1000ms

// vite.config.ts
// Dev server port: 8080 (not 3000 — important for CORS)
// HMR overlay: disabled
// Path alias: "@" → "./src"

// index.css — CSS custom properties (dark military theme)
// --background: 210 30% 5% (near-black blue-grey)
// --primary: 168 100% 40% (neon teal)
// --destructive: 345 100% 60% (red-pink)
```
