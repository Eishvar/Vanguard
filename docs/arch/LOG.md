# ARCHITECTURE — IMPLEMENTATION LOG
> Read this file when checking what phases are complete and what changed in each phase.
> **Append new entries here after each phase completes. Do not edit OVERVIEW, BACKEND, FRONTEND, or EVENTS unless a new file or SSE event was added.**

---

## Phase 33 — Final polish (orphan transit, survivor toast sync, RTB parking) — completed 2026-04-23

**Modified files:**
- `backend/agent/orchestrator.py` — (FIX1) `_advance_to_next_sector`: orphaned-sector transit now compares distance to failure node vs. nearest anchor; flies to whichever is closer, restarting from anchor (index 0) when that saves battery. (FIX2) `_run_sweep_loop` / `_tick_drone`: `scan_tile` now runs before `drone_heading` is emitted; survivor data is attached to the step payload as `survivor_data` instead of firing a separate `survivor_alert` SSE event. (FIX5) `_advance_to_next_sector`: after RTB transit completes, emits a stationary `drone_heading` with `heading_deg: 0.0` and `node_type: "parking"` so drones snap to North-facing on arrival.
- `frontend/src/stores/missionStore.ts` — (FIX3) `HeadingEvent` interface gains optional `survivor_data?: SurvivorRecord`; `_drainNext` now fires `addSurvivor`, `addLog`, and a `trigger-toast` CustomEvent the instant the animated drone icon lands on the tile.
- `frontend/src/components/MissionControls.tsx` — (FIX4) Removed the old `survivor_alert` SSE listener; added a `trigger-toast` window event listener that calls `toast()` in sync with the animation queue.

**Verification:** `npm run build` → 0 TypeScript errors. Python AST parse → OK. `gitnexus_detect_changes` confirms exactly 3 files / 6 symbols changed, all in scope. Config-propagation grep clean.

---

## Phase 32 — Transit amnesia fix + RTB mechanic — completed 2026-04-23

**Modified files:**
- `frontend/src/components/DronePathOverlay.tsx` — Added `lastSectorIdx` ref to memorize the last active sector index per drone. During transit (`currentIdx < 0`), the normal-sector and handoff-survivor branches now use `effectiveIdx` to preserve fully-visited segments as painted rather than resetting them to upcoming.
- `backend/agent/orchestrator.py` — `_advance_to_next_sector`: when the sector queue empties, instead of a bare `return`, the drone now sets `status = "rtb"`, calls `_emit_transit_nodes` to fly back to its staggered base position, and emits a `drone_cot` RTB event. Guard `drone.status in ("rtb", "idle")` prevents re-entry on subsequent ticks.

**Verification:** `npm run build` → 0 errors. `gitnexus_detect_changes` confirms exactly 2 files / 3 symbols changed. Visual: swept sector lines remain painted while drone transits to next sector; end-of-mission drones fly back to base tile with their physical 8m offsets preserved.

---

## Phase 31 — State sync bug fixes (tug-of-war, row jumps, zombie drones, battery float) — completed 2026-04-23

**Modified files:**
- `backend/agent/drone_agent.py` — (FIX1) `__init__`: added `battery_float: float` internal field; `walk_full_path` and `walk_one_node`: replaced `ceil(dist_m/100*rate)` integer drain with exact float drain, `int()`-casting only for the exposed `self.battery`. Eliminates min-1-unit-per-node rounding that caused premature battery exhaustion.
- `frontend/src/stores/missionStore.ts` — (FIX2) `updateMissionSnapshot`: removed drone position/status overwrite from `grid_update` snapshot; `_drainNext` queue is now the sole source of truth for visual drone state, ending the tug-of-war flicker.
- `frontend/src/components/DronePathOverlay.tsx` — (FIX3) `allSegments` useMemo: reordered hintIdx calculation to use the resolved visual `failLng/failLat` (which falls back to frozen drone icon position) instead of the backend `targetNode` coordinates — prevents the split-line from jumping to wrong rows.
- `frontend/src/components/MissionControls.tsx` — (FIX4) `stream_end` and `source.onerror` handlers: call `st.clearHeadingQueues()` when mission terminates unexpectedly, stopping zombie drone animation.

**Verification:** `python backend/test_battery_feasibility.py` → ✓ PASS (all 9 failure scenarios absorbed with margin). `npm run build` → 0 TypeScript errors. `gitnexus_detect_changes` confirms exactly 4 expected files changed. Config-propagation grep clean.

---

## Phase 30 — Emit sector_assignments after dynamic queue sorting — completed 2026-04-23

**Modified files:**
- `backend/agent/orchestrator.py` — (FIX1) `run_mission`: after the drone-init loop sorts queues by proximity, emits `sector_assignments` so the frontend timeline reflects the actual backend order at mission launch. (FIX2) `_advance_to_next_sector`: when the closest-sector reorder changes `queue[0]`, immediately emits `sector_assignments` so the frontend never flashes stale sector states on transit.

**Verification:** AST parse clean; `gitnexus_detect_changes` confirms only `orchestrator.py` touched (2 symbols: `run_mission`, `_advance_to_next_sector`); no hardcoded geographic constants; config-propagation grep returned zero matches.

---

## Phase 29 — Preemption fix, dynamic sector selection, marker desync, instant LLM logging — completed 2026-04-23

**Modified files:**
- `backend/agent/orchestrator.py` — (FIX1) `_handle_failure` survivor-queue loop simplified to pure append; removed preemptive `load_sector` call that interrupted active sweeps — survivors now finish their current sector naturally. (FIX2) `_advance_to_next_sector` evaluates all pending queue sectors at transition time, selects the physically closest one (via `_sector_resume_xy` for orphaned sectors, nearest anchor for fresh ones), and reorders the queue accordingly before loading. (FIX3) `_handle_failure` signature gains `tick: int`; call site in `_run_sweep_loop` passes current tick; emits `supervisor_cot` with phase="redistribute" instantly on failure, before `recovery_event`.
- `frontend/src/components/DronePathOverlay.tsx` — (FIX4) `handoffMarkers` useMemo: marker now uses `positions[h.failedDroneId]` (the frozen visual icon location) instead of the backend node when available, eliminating queue-lag desync; `positions` added to dependency array.

**Verification:** Python AST parse OK; `npm run build` 0 TypeScript errors; `gitnexus_detect_changes` confirms only 2 files changed (`orchestrator.py`, `DronePathOverlay.tsx`); no hardcoded geographic constants introduced.

---

## Phase 28 — Self-healing drone failure bug fixes (RC-1 through RC-5) — completed 2026-04-23

**Modified files:**
- `backend/agent/orchestrator.py` — (RC-1) `_tick_drone` now writes `_sector_progress[sid] = step["path_index"]` after every `walk_one_node()` so resume_index is always accurate; (RC-2/FIX2) added `_sector_resume_xy` dict to `__init__`; `_handle_failure` now uses `len(sec.sweep_nodes)` for `total_wps` and stores the exact failure node xy in `_sector_resume_xy`; (RC-4/FIX3) `_advance_to_next_sector` checks `_sector_resume_xy.get(next_sid)` first and transits to the exact failure node (inheriting `_sector_reverse` direction) instead of the nearest anchor; (FIX3B) `run_mission` stores `_sector_reverse[first_sid]` for each drone's initial sector; `_maybe_inject_failure` adds `failure_xy` to the `failure_event` payload; `_handle_failure` passes `resume_positions=self._sector_resume_xy` to `replan_after_failure`.
- `backend/agent/sector_assignment.py` — (RC-5/FIX4) `_sort_by_distance` accepts optional `resume_positions` dict and uses the resume node position instead of centroid for orphaned sectors; `assign_sectors` and `replan_after_failure` both accept and propagate `resume_positions`.
- `frontend/src/stores/missionStore.ts` — (RC-2/FIX5) `_drainNext` now immediately clears the queue and returns if `drone.status === "offline"`; added `clearDroneHeadingQueue(droneId)` action to the interface and implementation.
- `frontend/src/components/MissionControls.tsx` — (RC-3/FIX6) `failure_event` handler calls `st.clearDroneHeadingQueue(data.drone_id)` immediately after `setDroneOffline` so the failed drone stops moving with zero latency.

**Verification:** Python AST parse passes for both backend files; `npm run build` passes with zero TypeScript errors; `gitnexus_detect_changes` confirms all 4 target files changed and no out-of-scope files touched.

---

## Phase 27 — Transit node-by-node traversal + VISUAL_DRONE_SPEED_MPS propagation — completed 2026-04-22

**Modified files:**
- `backend/terrain.py` — added `_transit_tile_border_crossings(x0,y0,x1,y1)` (computes all tile grid border crossing points along a segment) and `compute_transit_nodes(from_xy, to_xy, tiles)` (straight-line if no obstacles, A* fallback, returns list of tile-border-crossing waypoints from source to destination).
- `backend/agent/orchestrator.py` — added `_emit_transit_nodes()` method to Orchestrator; updated top-level imports to include `compute_transit_nodes`, `local_m_to_latlng` (module-level), and `VISUAL_DRONE_SPEED_MPS` from `backend.config`; replaced single-emit transit in both `run_mission` (initial_transit) and `_advance_to_next_sector` (transit) with `_emit_transit_nodes()` calls; added `"visual_drone_speed_mps"` field to `terrain_initialized` event; removed stale local imports of `local_m_to_latlng`.
- `frontend/src/stores/missionStore.ts` — deleted module-level `const VISUAL_DRONE_SPEED_MPS = 333`; added `visualDroneSpeedMps: number` to `MissionState` interface and initial state (default 333); added `setVisualDroneSpeedMps` action; updated `_drainNext` to read `get().visualDroneSpeedMps` instead of the deleted constant; added `visualDroneSpeedMps: 333` to `reset()`.
- `frontend/src/components/MissionControls.tsx` — `terrain_initialized` handler now calls `store.setVisualDroneSpeedMps(data.visual_drone_speed_mps)` when the field is present.

**Verification:** `compute_transit_nodes` returns 23 waypoints between two non-adjacent anchors. `test_fast.py` passes (✓ All assertions passed). Mission log shows DRONE_A=70, DRONE_B=20 transit events across 4 and 3 sector transitions respectively; zero `dist_m=100.0` hardcoded events. `npm run build` — 0 TypeScript errors. `grep VISUAL_DRONE_SPEED_MPS frontend/src/stores/missionStore.ts` → 0 matches.

---

## Phase 26C — Heading queue, DroneNodeOverlay, terrain-accurate drone positions — completed 2026-04-22

**New files:**
- `frontend/src/components/DroneNodeOverlay.tsx` — renders all sweep-path waypoints as coloured MapLibre circle dots; anchor=white/6px, tile_border=blue/4px, turn=near-black/3px; skips obstacle sectors; gate: `showDronePaths`.

**Modified files:**
- `frontend/src/stores/missionStore.ts` — added `HeadingEvent` export interface; added `VISUAL_DRONE_SPEED_MPS=333` constant; added `_headingQueues`, `_queueActive` state fields; added `enqueueHeading`, `_drainNext`, `clearHeadingQueues` actions; changed `create` signature to `(set, get)` so `_drainNext` can read latest state; updated `reset()` to clear queue state.
- `frontend/src/components/MissionControls.tsx` — `drone_heading` listener now calls `store.enqueueHeading(data)` instead of direct position/heading setters; `terrain_initialized` listener now initialises all three drone positions to base-station anchor lat/lng.
- `frontend/src/components/TacticalMap.tsx` — removed `useInterpolatedPositions` (queue drain owns timing); drone markers read directly from `dronePositionsLatLng` with `cfg.anchorLat/Lng` fallback; added `showDronePaths` + `sectorsGeoJSON` subscriptions; `<DronePathOverlay>` and `<DroneNodeOverlay>` now gated on `showDronePaths && cfg && sectorsGeoJSON`; `selectedDroneCenter` reads from `dronePositionsLatLng`.
- `frontend/src/components/NetworkOverlay.tsx` — ring centre for drone entities uses `dronePositionsLatLng[e.id]` when available, falls back to `posKmToLatLng(e.pos_km, anchor)` for BASE or unpositioned drones; `dronePositionsLatLng` added to `ringsGeoJSON` memo deps.

**Verification:** `cd frontend && npm run build` → 0 TypeScript errors. `grep -rn "cellCenter|LAT_PER_KM.*Merapi|CELL_POSITIONS" frontend/src/` → zero matches. `git diff --name-only` confirms only 4 modified + 1 new file in expected scope.

---

## Phase X2 — Remove 4×4 grid logic from agent layer — completed 2026-04-22

**Deleted files:**
- `backend/agent/decision_engine.py` — entire file removed; pure dead code after drones became path-followers
- `backend/agent/tactical_context.py` — entire file removed; TacticalContext/DroneState/MeshState dataclasses no longer referenced anywhere

**Modified files:**
- `backend/agent/prompts.py` — full rewrite; removed all grid/drone prompts; now contains `SUPERVISOR_SYSTEM_PROMPT` (single prompt covering plan/monitor/summary) + `SUPERVISOR_MONITOR_PROMPT_TEMPLATE` + `SUPERVISOR_SUMMARY_PROMPT_TEMPLATE`
- `backend/agent/drone_agent.py` — full rewrite; drones are now pure terrain path-followers with no LLM and no MCP; `load_sector()`, `walk_full_path()`, `choose_reverse()`, `is_sector_complete()` methods; `_extract_tool_result()` helper kept for orchestrator/supervisor use
- `backend/agent/orchestrator.py` — major rewrite; purged all cell logic; `_execute_round` walks full sector path per drone and issues `scan_tile`/`update_drone_position` MCP calls per node; emits `drone_cot` events at sector_start, sector_complete, survivor_report, low_battery; `get_grid_state` → `get_mission_state` throughout
- `backend/agent/supervisor.py` — updated imports; `plan()` uses inline sector summary (no more `get_grid_state`/`assign_targets`); `redistribute()` stub uses `model_construct()` to bypass Pydantic validator; `summarise()` uses `get_mission_state`
- `backend/agent/llm_client.py` — removed `DroneDecision` dispatch and `_mock_drone_decision()`/`_CELL_POSITIONS`; rewrote `_mock_supervisor_plan()` to parse "Scan sector IDs available:" and distribute integer sector IDs; rewrote `_mock_mission_summary()` for new MissionSummary fields; fixed `_mock_redistribution_plan()` fallback (removed legacy cell ID string)
- `backend/test_fast.py` — updated `sectors_swept` assertion (removed `cells_scanned == 16`)
- `docs/arch/OVERVIEW.md`, `docs/arch/BACKEND.md`, `docs/arch/EVENTS.md` — updated to reflect terrain path-follower architecture

**Verification:** grep for banned patterns (`scan_cell`, `move_drone`, `assign_targets`, `NW_/SW_[0-9]`, `assigned_cells`, `get_grid_state`) in `backend/agent/` returns zero matches. `test_fast.py` requires MCP server (see HUMAN TASK in test header) — pipeline structure validated by import-level checks.

---

## Phase X3 — Remove 4×4 grid references from frontend — completed 2026-04-22

**Modified files:**
- `frontend/src/lib/geoGrid.ts` — full rewrite; removed CELL_SIZE_KM/GRID_COLS/GRID_ROWS/CELL_POSITIONS/cellCenter/cellSWCorner/cellPolygon/gridBoundaryPolygon/anchorFromCenter; added tileCenter(row,col,cfg)/tileBoundsPolygon/gridCenter(cfg) calibrated for Ranau 5.9°N (LAT_PER_M=1/110574, LNG_PER_M=1/110043); PRESET_LOCATIONS unchanged
- `frontend/src/stores/missionStore.ts` — purged Cell interface, DroneSnapshot, CellStatus, QUADRANT_CELLS, DEFAULT_CELLS, gridAnchor, gridLocked, cells state field, updateDrones/updateDronesFromSnapshot/updateCells/setGridAnchor/lockGrid/unlockGrid; updated Drone interface (sectorId, lat, lng, tileRow, tileCol); updated SurvivorRecord (tile_id replaces cell_id); updated StatsSnapshot (sectors_swept/total_sectors); added sweptSectors, totalSectors, survivorTiles state; added updateMissionSnapshot action; DEFAULT_DRONES battery=400
- `frontend/src/components/MissionControls.tsx` — removed cellCenter import; grid_update handler now calls updateMissionSnapshot; removed lockGrid/unlockGrid calls; updated failure_event (orphaned_sectors), survivor_alert (tile_id), comms_lost/restored (tile_row/tile_col), mission_complete (sectors_swept), buildReport
- `frontend/src/components/NetworkOverlay.tsx` — removed anchor prop; reads terrainConfig from store and derives anchor internally
- `frontend/src/components/SectorCoverage.tsx` — full rewrite; replaced NW/NE/SW/SE progress bars with overall progress bar + per-sector status pills from sectorsGeoJSON
- `frontend/src/components/FleetStatus.tsx` — currentCell → sectorId display; battery bar/text scaled to 400 max
- `frontend/src/components/TacticalMap.tsx` — removed cells/gridAnchor/gridLocked/lockGrid/setGridAnchor selectors; removed drag handle and handleGridDragEnd; survivor markers now iterate survivorsFoundList + tileCenter; selectedDroneCenter uses drone.lat/lng; NetworkOverlay no longer receives anchor prop; MapHUD no longer receives gridLocked/onLockGrid
- `frontend/src/components/SurvivorReportCard.tsx` — cellCenter → tileCenter with tile_id parsing; cell_id → tile_id throughout
- `frontend/src/components/DroneDetailCard.tsx` — currentCell → sectorId; battery scaled to 400 max; added RTB status style
- `frontend/src/components/PresetLocations.tsx` — removed gridCenter/setGridAnchor; flies camera to preset.anchor directly; gates on missionLaunched instead of gridLocked
- `frontend/src/components/MapHUD.tsx` — removed gridLocked/onLockGrid props and grid lock UI panels

**Verification:** `cd frontend && npm run build` → 0 TypeScript errors. `grep -rn "cellCenter|QUADRANT_CELLS|DEFAULT_CELLS|currentCell|NW_0|SW_2" frontend/src/` → zero matches. gitnexus_detect_changes() shows 23 changed symbols across 12 files, risk=medium, no unexpected files.

---

## Phase 24 — Per-sector sweep spacing — completed 2026-04-20

**Modified files:**
- `backend/config.py` — added `SWEEP_SPACING_MIN_M=15.0`, `SWEEP_SPACING_MAX_M=50.0`, `SWEEP_DENSITY_LOW=0.07`, `SWEEP_DENSITY_HIGH=0.22`; legacy `SWEEP_SPACING_M` retained for cache hash.
- `backend/terrain.py` — added `sector_sweep_spacing(avg_density)` function (linear interpolation on Jenks thresholds); updated `build_terrain_model` to pass per-sector spacing to `lawnmower_path`; added `sweep_spacing_m` field to `sectors_to_geojson` output; updated `_data_hash` to include new constants.

**Verification:** Dense sectors (density≥0.336) get 15m spacing → ~72–76k m/km² path density; sparse sectors (density≤0.084) get 50m spacing → ~25–32k m/km² — correct inverse relationship. `MOCK_MODE=1 python backend/test_fast.py` — all assertions passed. `gitnexus_detect_changes` — only `build_terrain_model` in terrain.py touched (expected); `a_star_transit`/`heuristic` flagged as line-number drift, not actual edits.

---

## Phase 22 — RAF interpolation for drone markers — completed 2026-04-20

**New files:**
- `frontend/src/hooks/useInterpolatedPositions.ts` — `useInterpolatedPositions(targets, durationMs)` hook; on each `targets` change kicks off a RAF animation loop that tweens from the last displayed positions to the new targets over `durationMs` (default 450 ms) using easeOutQuad, then idles until the next change.

**Modified files:**
- `frontend/src/components/TacticalMap.tsx` — replaced direct `dronePositionsLatLng` read for drone marker rendering with `useInterpolatedPositions(dronePositionsTargets, 450)`; drone markers now glide smoothly instead of snapping on each `drone_heading` event.

**Verification:** `npm run build` — 0 TypeScript errors. `gitnexus_detect_changes` — only `TacticalMap` touched, medium risk, scope correct.

---

## Phase 21 — Dark basemap — completed 2026-04-20

**Modified files:**
- `frontend/src/lib/mapStyles.ts` — switched VECTOR_STYLE_URL from OpenFreeMap `liberty` to `dark`.

**Verification:** `npm run build` — 0 errors. Dark basemap renders correctly.

---

## Phase A — Foundations (CC-1 through CC-5) — completed 2026-04-12

**CC-1 — Battery in `grid_update`**
- `SimulationCore.get_grid_snapshot()` now returns a `drones` key: `{drone_id: {cell_id, battery, status}}` in addition to the existing `drone_positions` (kept for back-compat).
- `missionStore.ts`: added `DroneSnapshot` interface, `updateDronesFromSnapshot()` action.
- `MissionControls.tsx`: `grid_update` listener now calls `updateDronesFromSnapshot(data.drones)` instead of `updateDrones(data.drone_positions)`. The fragile battery regex (`/Battery at (\d+)%/`) in `drone_cot` listener has been removed.

**CC-2 — `backend/config.py` constants module**
- **New file:** `backend/config.py` — single home for `MCP_URL`, `COMM_RADIUS_KM`, `BASE_STATION_CELL`, `CELL_SIZE_KM`, `BATTERY_PER_MOVE`, `BATTERY_PER_SCAN`, `LOW_BATTERY_THRESHOLD`, `FIXED_SURVIVOR_SPAWN`, `MOCK_MODE`.
- `orchestrator.py`, `drone_agent.py`, `supervisor.py`: import from config instead of declaring locally.
- `api_server.py`, `test_run.py`: `sys.path.insert(0, ROOT)` added.

**CC-3 — Extended `Cell` schema**
- `Cell` dataclass gains six optional fields: `survivor_profile`, `lat`, `lng`, `thermal_reading`, `thermal_img_url`, `audio_transcript`. All default to `None`. `to_dict()` includes all six.
- `missionStore.ts` `Cell` interface gains corresponding optional fields. Added `SurvivorProfile` interface.

**CC-4 — New SSE event types**
- `Orchestrator.__init__` gains `_last_grid_state` and `_last_comms_reachable`.
- `Orchestrator._emit_diffs()` — emits `survivor_alert`, `comms_lost`, `comms_restored`.
- `MissionControls.tsx`: registered `addEventListener` for all three new event types.

**CC-5 — `communication_network` field**
- **New file:** `backend/server/comms.py` — `compute_comm_network()` builds undirected mesh graph (BFS from BASE). Worker radius = 2.5km, base radius = 3.0km.
- `get_grid_snapshot()` embeds result as `communication_network` in every `grid_update`.

---

## Phase A Step 4 — Change 6: Parallel MCP Reads — completed 2026-04-14

- `drone_agent.py`: `act()` SENSE block now uses `asyncio.gather(get_drone_status, get_grid_state)` in normal mode.
- `orchestrator.py`: Post-round block uses `asyncio.gather(get_grid_state(), get_mission_status())`. `_handle_failure()` uses `asyncio.gather(get_drone_status(failed_id), get_grid_state())`.
- `supervisor.py`: `monitor()` and `redistribute()` use `asyncio.gather(get_all_drone_statuses, get_grid_state)`. `summarise()` uses parallel triple-read.
- **Constraint:** No `return_exceptions=True` on reads. All writes remain serial.
- **Verification:** `MOCK_MODE=1 python3 backend/test_fast.py` — cells_scanned=16/16, self_healing=True, elapsed=10.9s.

---

## Phase A Step 5 — Change 7: Log Panel Improvements — completed 2026-04-14

**New files:**
- `frontend/src/components/LogEntry.tsx` — `LogEntryRow` component. Source-aware icon colour: SUPERVISOR=teal-400, DRONE_A=red-400, DRONE_B=purple-400, DRONE_C=cyan-400. Error entries get red left-border; warning get amber.
- `frontend/src/components/LiveCotPanel.tsx` — Reads `lastReasoningByDrone` from store; per-drone reasoning strip with 2-line clamp.
- `frontend/src/components/MissionReportView.tsx` — All Tab 3 markdown rendering extracted from `MissionLogs.tsx`.

**Modified files:**
- `missionStore.ts`: Added `source?: string` to `LogEntry`. Added `lastReasoningByDrone` state and `setLastReasoning` action. Changed initial `activeTab` from 1 to 2.
- `MissionControls.tsx`: All `addLog` calls include `source` field. `drone_cot` handler calls `setLastReasoning`. `phase_change` handler no longer calls `setActiveTab(1)`.
- `MissionLogs.tsx`: Rewritten. 2-tab bar (EXECUTION + REPORT). Sticky filter toolbar: ALL|DRONES|SUPV|CRITICAL pills + text search + pin-to-bottom toggle.

**Verification:** `npm run build` — 0 errors, 2070 modules, 461 kB JS.

---

## Phase B Step 6 — Change 3: Survivor Detail System (backend half) — completed 2026-04-14

**Data model:**
- `Cell` gains three sensor fields: `thermal_reading`, `thermal_img_url`, `audio_transcript`.
- `survivor_profile` on Cell holds non-sensor core fields only.

**`SURVIVOR_PROFILES`** (simulation.py, module-level):

| Cell | People | Priority | Audio |
|------|--------|----------|-------|
| NW_3 | 1 | CRITICAL | "Aduh...sakit....sakit!" |
| NE_0 | 4 | LOW | — |
| SE_2 | 1 | HIGH | — |
| SE_3 | 2 | MODERATE | "Tolong...Tolong" |

`place_survivors()` rewritten — fixed path sets has_survivor, survivor_profile, and all 3 sensor fields from SURVIVOR_PROFILES.

**`survivor_alert` SSE payload** extended with `thermal_reading`, `thermal_img_url`, `audio_transcript`.

**Verification:** `MOCK_MODE=1 PYTHONPATH=backend python3 backend/test_fast.py` — cells_scanned=16/16, survivors_found=4/4.

---

## Phase B Step 7 — Change 4a + TDE: Mesh Network Backend + Tactical Decision Engine — completed 2026-04-14

**New files:**
- `backend/agent/tactical_context.py` — `DroneState`, `MeshState`, `TacticalContext` dataclasses. `TacticalContext.to_prompt_context()` serializes for LLM. `reconciled_unscanned` field prevents Scanning Loop.
- `backend/agent/decision_engine.py` — pure computation. Key functions: `bfs_shortest_path`, `bfs_distance`, `estimate_battery_for_mission`, `would_move_isolate`, `compute_worker_candidates`, `compute_redistribution_scores`, `build_tactical_context`, `evaluate_worker`. `_sensor_priority_bonus` returns 0.0 (disabled).

**Modified files:**
- `drone_agent.py`: Added `self._additional_sensors: dict = {}`. `act()` now calls `build_tactical_context()` + `evaluate_worker(ctx)` + `ctx.to_prompt_context()` in normal mode.
- `llm_client.py`: Added `TokenTracker` class. `reset_token_tracker()` called at mission start. `get_token_summary()` at mission end. `token_usage` SSE event emitted. Replaced `APP_MODE/_CONFIGS` with direct `SUPERVISOR_MODEL`/`WORKER_MODEL` env var reads.

**Verification:** `MOCK_MODE=1 PYTHONPATH=backend python3 backend/test_fast.py` — cells_scanned=16/16, survivors_found=4/4, self_healing=True.

---

## Phase C — Change 1: Geospatial Map Interface — completed 2026-04-16

**New files:**
- `frontend/src/lib/geoGrid.ts` — coordinate math: `cellCenter()`, `cellPolygon()`, `gridBoundaryPolygon()`, `gridCenter()`, `anchorFromCenter()`. `DEFAULT_ANCHOR` = Kaliurang/Merapi. `PRESET_LOCATIONS` = 5 disaster sites.
- `frontend/src/lib/mapStyles.ts` — tile source definitions: EOX satellite, AWS terrain (terrarium), OpenFreeMap vector.
- `frontend/src/components/GridOverlay.tsx` — GeoJSON Source+Layer for cell fills, borders, ID labels (zoom 13+), coordinate labels (zoom 14+), outer boundary dashes.
- `frontend/src/components/DroneIcon.tsx` — SVG drone icon; perspective transform at zoom ≥ 16; ping animation when active; red X when offline; isolated ring when comms lost.
- `frontend/src/components/PresetLocations.tsx` — dropdown flying to 5 preset locations; hidden when gridLocked.
- `frontend/src/components/MapHUD.tsx` — 2D/3D pitch toggle, 📡 NETWORK toggle, grid lock status panel.

**Modified files:**
- `TacticalMap.tsx` — complete rewrite: MapLibre `<Map>` with satellite style + terrain DEM. Mounts GridOverlay, drone Markers, survivor Markers, draggable grid handle, buildings Layer (buildings mode), NavigationControl, ScaleControl.
- `missionStore.ts` — added `CommsNetwork` interface; added `gridAnchor`, `gridLocked`, `showNetwork`, `commsNetwork` state; added `setGridAnchor`, `lockGrid`, `toggleShowNetwork`, `updateCommsNetwork` actions. `reset()` resets all four.
- `MissionControls.tsx` — `grid_update` injects lat/lng via `cellCenter()`; calls `updateCommsNetwork`; `startMission()` calls `lockGrid()`.

**Dependencies:** `maplibre-gl@5.23.0`, `react-map-gl@8.1.1`

**Tile sources (no API key):** EOX Sentinel-2 (satellite), AWS Elevation Tiles terrarium (terrain DEM), OpenFreeMap Liberty (vector/buildings).

**Performance:** `antialias={false}`, `fadeDuration={0}`, `renderWorldCopies={false}`, `maxPitch={50}`. Terrain and buildings modes are mutually exclusive.

**Verification:** `npm run build` — 0 TypeScript errors, 2107 modules, 3.21s build.

---

## Phase D Step 9 — Change 3 frontend: Survivor Detail System — completed 2026-04-16

**New files:**
- `frontend/src/components/AudioWaveform.tsx` — CSS-animated SVG bar chart; NW_3 (distressed, 600ms) and SE_3 (regular, 1200ms) patterns only; returns null for all other cells.
- `frontend/src/components/SurvivorReportCard.tsx` — fixed-overlay report card: priority badge (CRITICAL=red, HIGH=orange, MODERATE=yellow, LOW=green), thermal image with `onError` fallback placeholder, AudioWaveform + audio transcript, GPS from `cellCenter()`, data grid (cell, drone, round, collapse hours, coords, time), description, extraction notes.
- `frontend/src/components/SurvivorPanel.tsx` — right-panel list sorted CRITICAL→LOW then by round; clicking a row opens SurvivorReportCard overlay; shows "None detected" when empty.

**Modified files:**
- `missionStore.ts` — replaced `SurvivorProfile` stub with real fields (`description`, `num_people`, `medical_priority`, `time_to_collapse_hours`, `extraction_notes`); added `SurvivorRecord` interface; added `survivorsFoundList: SurvivorRecord[]` state + `addSurvivor` action; `reset()` clears list.
- `MissionControls.tsx` — `survivor_alert` listener now calls `addSurvivor(data)` + `toast()` (sonner); imported `SurvivorRecord` type and `toast` from `"sonner"`.
- `Dashboard.tsx` — added `<SurvivorPanel />` below `<MissionIntel />` in right panel.
- `index.css` — added `@keyframes waveform-pulse` (scaleY 0.35→1 + opacity 0.4→1) and `.animate-waveform-pulse` class.

**Verification:** `npm run build` — 0 TypeScript errors, 2111 modules, 4.26s build.

---

## Phase D Step 10 — Change 4b frontend: NetworkOverlay — completed 2026-04-16

**New files:**
- `frontend/src/components/NetworkOverlay.tsx` — GeoJSON Source+Layer for comm-range rings and animated bidirectional mesh arrows. Reads `showNetwork` and `commsNetwork` from store. Props: `hoveredEntityId: string | null`, `anchor: LatLng`.

**Modified files:**
- `TacticalMap.tsx` — renamed `hoveredDroneId` → `hoveredEntityId`; removed `void` suppressor; imported and mounted `<NetworkOverlay hoveredEntityId={hoveredEntityId} anchor={gridAnchor} />` in place of placeholder comment. No other changes.

**Behaviour:**
- Default: no rings. Hover drone → that drone's ring only. `showNetwork` ON → all rings (BASE + all drones) + arrows.
- Rings: teal (`#14b8a6`) if reachable_from_base, red (`#ef4444`) if isolated. BASE is always teal.
- Arrows: 14-step marching-ants cycle (50 ms/step); two `line-offset` ±2 px layers per link give simultaneous bidirectional flow. Animation runs via `requestAnimationFrame` inside `NetworkOverlay` only — parent does not re-render.
- Coordinate math: `pos_km → LatLng` via `anchor + pos_km * LAT/LNG_PER_KM`. Circle polygons approximated at 64 steps.

**Verification:** `npm run build` — 0 TypeScript errors, 2112 modules, 2.73s build.

---

## Phase D Step 11 — Change 2: DroneDetailCard + BatteryIcon — completed 2026-04-16

**New files:**
- `frontend/src/components/BatteryIcon.tsx` — reusable SVG battery fill icon; fill is teal-400 ≥20%, red-400 <20%; scales 0–16px inner bar via `percent` prop.
- `frontend/src/components/DroneDetailCard.tsx` — MapLibre `<Popup anchor="bottom">` anchored at drone cell center; dark-themed card (bg `#0d1520`); shows drone ID + color dot, cell ID, GPS lat/lng from `cellCenter()`, BatteryIcon + %, status badge, last 120 chars of `lastReasoningByDrone` (fallback: "No reasoning yet."); inline `<style>` overrides MapLibre popup default white background.

**Modified files:**
- `TacticalMap.tsx` — added `selectedDroneId: string | null` local state; `handleMapClick` closes card on canvas click; drone marker div gets `onClick` toggle handler; computes `selectedDrone` + `selectedDroneCenter`; mounts `<DroneDetailCard>` inside `<Map>` when a drone is selected. No Zustand changes.

**No changes:** `missionStore.ts` and `MissionControls.tsx` already had `lastReasoningByDrone` and `setLastReasoning` from Step 7.

**Verification:** `npm run build` — 0 TypeScript errors, 2114 modules, 3.55s build.

---

## Bug fix — Phase D Step 10: comms_lost + bidirectional arrows — completed 2026-04-17

**Bug 1 — `comms.py` link rule corrected from `max` to `sum`.**
Root cause: `compute_comm_network()` originally used `dist <= max(r_A, r_B)` as the link predicate. Corrected to `dist <= r_A + r_B` (sum). The asymmetric "either entity covers the other" interpretation (`max`) was wrong — the correct radio-range model is that two entities can communicate when the gap between them is within the combined reach of both radios. This widens the effective range (max(2.5, 3.0)=3.0 → 2.5+3.0=5.5 km for base-drone pairs), allowing drones further from base to remain connected via relay hops. `EVENTS.md` and `BACKEND.md` link-rule descriptions corrected accordingly.

**Bug 2 — Missing bidirectional arrows (`frontend/src/components/NetworkOverlay.tsx`):**
Root cause: `arrowsGeoJSON` created only ONE `LineString` feature per link (A→B). Both the `fwd` and `bwd` layers shared this same source, so dashes animated A→B on both layers — no true reverse flow. Fix: create TWO features per link — one with coords `[posA, posB]` and `dir:'fwd'`, one with coords `[posB, posA]` and `dir:'bwd'`. Each layer now carries a MapLibre `filter` expression (`['==', ['get', 'dir'], 'fwd/bwd']`) and `line-offset: 2` (same for both since B→A coords already reverse the offset direction). Dashes on `bwd` features travel B→A at opposite animation phase.

**Modified files:**
- `backend/agent/orchestrator.py` — `_emit_diffs()` comms-diff block
- `frontend/src/components/NetworkOverlay.tsx` — `arrowsGeoJSON` + arrow Layer filters

**Verification:** `npm run build` — 0 TypeScript errors, 2114 modules, 2.58s build.

---

## MeasureTool — distance measurement overlay — completed 2026-04-18

**New files:**
- `frontend/src/components/MeasureTool.tsx` — MapLibre GeoJSON layer for distance measurement. Props: `active`, `points: MeasurePoint[]`, `onRemoveLast`, `onClear`. Controlled by `TacticalMap` local state (`measureActive`, `measurePoints`). When active, map clicks append `{lat, lng}` points; renders a polyline and distance label in km.

**Modified files:**
- `TacticalMap.tsx` — added `measureActive`, `measurePoints` local state; `handleMapClick` routes clicks to measure mode; added `handleToggleMeasure`, `handleRemoveLastPoint`, `handleClearMeasure` callbacks; mounted `<MeasureTool>` inside `<Map>`; added measure toggle to `<MapHUD>` props (`measureActive`, `onToggleMeasure`).

**No store changes** — measure state is local to `TacticalMap` (ephemeral, resets on remount).

# VANGUARD_TERRAIN_UPGRADE_GUIDE PHASES

## Phase 1 (Terrain Upgrade) — Core terrain.py module — completed 2026-04-18
**New files:**
- `backend/terrain.py` — 20×20 tile grid, Ward clustering, lawnmower paths.
**Modified files:**
- `backend/config.py` — added tuned anchor (-7.6650, 110.4195) and 581.0m obstacle threshold.
**Verification:** `python3 -m backend.terrain` — 16 scan sectors, 1 obstacle zone, 136ms cold build.

## Phase 2 (Terrain Upgrade) — Sector Assignment Module — completed 2026-04-18

New files:

backend/agent/sector_assignment.py — Pure-algorithm battery-feasibility validator and replan handler.

Verification: Smoke test confirmed successful greedy assignment (with 6 unassignable sectors due to battery limits) and survivor-led replanning.

## Phase 3 (Terrain Upgrade) — Orchestrator Terrain Integration — completed 2026-04-18

**Modified files:**
- `backend/agent/orchestrator.py` — 261 lines added, 46 removed. Added terrain/sector state fields (`_tiles_grid`, `_sectors`, `_sectors_by_id`, `_drone_sector_queue`, `_drone_current_sector`, `_drone_xy`, `_sector_progress`, `_drone_ids`). Added `_get_drone_xy()` helper. `run_mission()` now calls `build_terrain_model()` before planning and emits `terrain_initialized`. `_phase_plan()` runs greedy sector assignment (falls back from LLM plan) and emits `sector_assignments`. `_execute_round()` adds Phase-4-ready terrain tracking guarded by `isinstance(decision, dict)`. `_handle_failure()` replaced: terrain-aware `replan_after_failure()` for sector queues + legacy `supervisor.redistribute()` for cell coverage (dual-mode until Phase 4 lands). New SSE events: `terrain_initialized`, `sector_assignments`, `drone_heading` (Phase 4 only), updated `recovery_event` payload.

**Modified docs:**
- `docs/arch/EVENTS.md` — added `terrain_initialized`, `sector_assignments`, `drone_heading` rows; updated `recovery_event` payload to terrain fields.
- `docs/arch/BACKEND.md` — updated Orchestrator state fields table with all 8 new terrain fields.

**Verification:** `MOCK_MODE=1 python backend/test_fast.py` — cells_scanned=16/16, survivors_found=4, self_healing=True, rounds=19, elapsed=12.8s. All assertions passed. `gitnexus_detect_changes()` confirms only `backend/agent/orchestrator.py` modified (plus pre-existing AGENTS.md/CLAUDE.md staged changes).

## Phase 4 (Terrain Upgrade) — DroneAgent Lawnmower Path-Following — completed 2026-04-18

**Modified files:**
- `backend/agent/drone_agent.py` — Added `import math`; extended sys.path block to add `_PROJECT_ROOT` (mirrors orchestrator.py pattern, required for `backend.terrain` import at module level). Added `from config import BATTERY_MAX_TERRAIN` and `from backend.terrain import local_m_to_latlng, GRID_N, TILE_M`. Added `_TerrainDecision` dict subclass (exposes `.reasoning/.action/.target_cell_id/.status` as properties for orchestrator drone_cot compatibility; `isinstance(d, dict)` is True so orchestrator's Phase 4 `isinstance` guard fires). Added `self.battery`, `self.status`, and 4 lawnmower path state fields to `__init__`. Added 6 new methods: `_load_sector_path`, `_get_next_waypoint`, `_advance_waypoint`, `_sector_complete`, `_global_path_index`, `_current_heading_deg`. Modified `act()` move branch: always calls `move_drone` MCP first (keeps legacy simulation cell tracking so test_fast passes); then, in non-RTB mode, advances terrain waypoint — if path empty returns `_TerrainDecision(SECTOR_COMPLETE)` to bootstrap sector loading, otherwise returns `_TerrainDecision(MOVE)` with lat/lng/heading/path_index fields. RTB mode falls through to existing `DroneDecision` return path.

**Design note:** `move_drone` MCP call is retained alongside path-following so the simulation cell position stays consistent (required for `cells_scanned=16/16` in test_fast). Phase 5 will decouple scan triggering from cell position entirely (waypoint-crossing scan boundary).

## Phase 5 (Terrain Upgrade) — `move_drone_to_tile` MCP tool — completed 2026-04-19

**Modified files:**
- `backend/server/simulation.py` — `Drone` dataclass gains `tile_row: int = 0`, `tile_col: int = 0`, `lat: float = 0.0`, `lng: float = 0.0` with defaults (backward-compatible); `to_dict()` includes all four. New `SimulationCore.move_drone_to_tile(drone_id, row, col, battery_cost)` method: validates bounds/battery, computes tile-centre lat/lng via `local_m_to_latlng`, writes position fields, returns `{success, drone_id, row, col, lat, lng, battery, status}`. Also added project root to `sys.path` block (required for `from backend.terrain import ...` inside the method).
- `backend/server/game_state.py` — `GameState.move_drone_to_tile()` async wrapper added after `move_drone`.
- `backend/server/mcp_server.py` — Tool 13 `move_drone_to_tile` registered. Tool count: 12 → 13.
- `backend/agent/drone_agent.py` — In `act()` MOVE path, after `battery_cost` computed and before `return _TerrainDecision(MOVE)`: calls `mcp.call_tool("move_drone_to_tile", {..., "battery_cost": 0})` with `battery_cost=0` to avoid double-draining simulation battery (legacy `move_drone` already deducts 5; terrain drain is tracked in `self.battery`).

**Modified docs:**
- `docs/arch/BACKEND.md` — tool count 12→13; Tool 13 row added; `move_drone_to_tile` method entry added; `Drone` dataclass fields note updated.

**Verification:** `python backend/test_mcp.py` — lists 13 tools including `move_drone_to_tile`. `MOCK_MODE=1 python backend/test_fast.py` — cells_scanned=16/16, survivors_found=4, self_healing=True, rounds=19. Manual call `move_drone_to_tile(DRONE_A, row=5, col=3, battery_cost=0)` → `{success: True, row: 5, col: 3, lat: -7.655..., lng: 110.425...}`. `grep` hardcoded values — nothing. `gitnexus_detect_changes()` — 4 changed files.

**Verification:** `MOCK_MODE=1 python backend/test_fast.py` — cells_scanned=16/16, survivors_found=4, self_healing=True, rounds=19, elapsed=13.2s. All assertions passed. `gitnexus_detect_changes()` confirms `changed_files: 1` (backend/agent/drone_agent.py only).

## Phase 6 Step 1 — SupervisorPlan sector_assignments + sector-aware plan prompt — completed 2026-04-19

**Modified files:**
- `backend/agent/schemas.py` — `SupervisorPlan` gains `sector_assignments: dict[str, list[int]] = Field(default_factory=dict)`. Empty default keeps all mock/monitor paths backward-compatible; orchestrator's greedy fallback triggers when field is absent or empty.
- `backend/agent/prompts.py` — `SUPERVISOR_PLAN_PROMPT` gains a TERRAIN MODEL section (structural description only, no hardcoded numbers). `build_supervisor_plan_user_prompt` gains `sectors_summary=None` parameter; when populated, injects MISSION CONFIG (budget, grid size, obstacle threshold from `backend.config`) and an AVAILABLE SECTORS table (sector_id, tiles, area, avg_elev, density, battery_cost, centroid lat/lng).
- `backend/agent/supervisor.py` — `SupervisorAgent.__init__` gains `self._sectors: list = []`. `plan()` builds `sectors_summary` from `self._sectors` (skipping obstacles, converting centroid to lat/lng via `local_m_to_latlng`) and passes it to the user prompt builder.
- `backend/agent/orchestrator.py` — one-line wire-up: `self.supervisor._sectors = self._sectors` immediately after `build_terrain_model()`.

**Verification:** `MOCK_MODE=1 python backend/test_fast.py` — cells_scanned=16/16, survivors_found=4, self_healing=True, all assertions passed. `grep "581\|1100\|7\.66\|110\.41" backend/agent/prompts.py` — no output. `gitnexus_detect_changes()` — changed_files: 4 (schemas.py, prompts.py, supervisor.py, orchestrator.py).

```markdown
## Phase 8 (Terrain Upgrade v2) — Frontend Store Extensions — completed YYYY-MM-DD

**Modified files:**
- `frontend/src/stores/missionStore.ts` — added `TerrainConfig`, `TileData`, `SectorFeatureProps`, `SectorHandoff`, `MapMode` interfaces. New state: `terrainConfig`, `tilesGrid`, `sectorsGeoJSON`, `sectorAssignments`, `droneHeadings`, `dronePathProgress`, `sectorHandoffs`, `dronePositionsLatLng`, `mapMode`, `showSectorOverlay`, `showDronePaths`, `terrainReady`. Actions: `setTerrainConfig`, `setTilesGrid`, `setSectorsGeoJSON`, `setSectorAssignments`, `setDroneHeading`, `setDronePositionLatLng`, `setDronePathProgress`, `setSectorHandoff`, `setMapMode`, `toggleSectorOverlay`, `toggleDronePaths`. reset() clears all new state.

**Config-driven guarantee:** all geographic values enter the store via `setTerrainConfig()` — no hardcoded lat/lng/elevation/grid constants in frontend code.

**Verification:** `npm run build` — 0 errors. No hardcoded geo values in file.
```

## Phase 9 — terrainGeo.ts + TerrainOverlay.tsx — completed 2026-04-19

**New files:**
- `frontend/src/lib/terrainGeo.ts` — pure coordinate-math helpers for the 20×20 terrain grid; only top-level export is `LAT_PER_M` (universal Earth constant); all other functions accept `TerrainConfig` as argument — zero hardcoded geographic values.
- `frontend/src/components/TerrainOverlay.tsx` — MapLibre `<Source>` + `<Layer>` that renders tile polygons coloured by elevation or density; reads `tilesGrid`, `mapMode`, and `terrainConfig` from store; elevation ramp derived dynamically from `cfg.obstacleElev`; renders nothing when `mode === "none"` or tiles absent.

**Modified docs:**
- `docs/arch/OVERVIEW.md` — added `TerrainOverlay.tsx` and `terrainGeo.ts` entries to file tree.
- `docs/arch/FRONTEND.md` — added component description for `TerrainOverlay.tsx` and lib description for `terrainGeo.ts`.

**Verification:** `npm run build` — 0 TypeScript errors, 2114 modules transformed. `grep` for hardcoded geo values — no output. Only top-level const in `terrainGeo.ts` is `LAT_PER_M`. `gitnexus_detect_changes()` — new files not yet indexed (expected); only pre-existing `LOG.md` diff shown.

```markdown
## Phase 10 (Terrain Upgrade v2) — SectorOverlay Component — completed YYYY-MM-DD

**New files:**
- `frontend/src/components/SectorOverlay.tsx` — polygon borders (teal for scan, dashed red for obstacle) + centred sector number labels with font-size interpolated from area_km2.

**Verification:** `npm run build` — 0 errors.
```

Add one line to `docs/arch/OVERVIEW.md`:
```
    │   ├── SectorOverlay.tsx     # Ward-cluster polygon sectors + centroid labels
```

---
```markdown
## Phase 11 (Terrain Upgrade v2) — DronePathOverlay Component — completed YYYY-MM-DD

**New files:**
- `frontend/src/components/DronePathOverlay.tsx` — per-drone lawnmower path rendering with 3-segment self-heal handoff rendering.

**Verification:** `npm run build` — 0 errors.
```

## Phase 12 (Terrain Upgrade v2) — TerrainLegend + MapHUD terrain toggles — completed 2026-04-19

**New files:**
- `frontend/src/components/TerrainLegend.tsx` — map legend for elevation/density heatmaps; derives all display labels from `terrainConfig.obstacleElev` — zero hardcoded elevation values; renders nothing when `mapMode === "none"` or `terrainConfig` absent.

**Modified files:**
- `frontend/src/components/MapHUD.tsx` — added `useMissionStore` import; reads `mapMode`, `setMapMode`, `showSectorOverlay`, `toggleSectorOverlay`, `showDronePaths`, `toggleDronePaths`, `terrainReady` from store; added 4 new toggle buttons (ELEVATION, DENSITY, SECTORS, PATHS) — all disabled until `terrainReady`; all existing buttons/props preserved.

**Verification:** `npm run build` — 0 TypeScript errors, 2114 modules. `grep` hardcoded elevation values in TerrainLegend.tsx — no output. `gitnexus_detect_changes()` — MapHUD.tsx modified; TerrainLegend.tsx new (not yet indexed, expected).

```markdown
## Phase 13 (Terrain Upgrade v2) — TacticalMap Rewire + GridOverlay Removal — completed YYYY-MM-DD

**Deleted files:**
- `frontend/src/components/GridOverlay.tsx`.

**Modified files:**
- `frontend/src/components/TacticalMap.tsx` — mounts TerrainOverlay, SectorOverlay, DronePathOverlay, TerrainLegend. Drone markers positioned from `dronePositionsLatLng` with `baseStationLatLng(cfg)` fallback when config is loaded; skip rendering if no config yet. No hardcoded lat/lng anywhere.

**Verification:** `npm run build` — 0 errors. No hardcoded geo values.
```

```markdown
## Phase 14 (Terrain Upgrade v2) — MissionControls SSE Listeners — completed YYYY-MM-DD

**Modified files:**
- `frontend/src/components/MissionControls.tsx` — listeners for `terrain_initialized` (sets `terrainConfig` FIRST, then tilesGrid/sectorsGeoJSON), `sector_assignments`, `drone_heading`. Extended `recovery_event` for handoff metadata.

**Verification:** `npm run build` — 0 errors.
```

## Phase 15 — Eliminate DEFAULT_ANCHOR; config-driven grid coordinates — completed 2026-04-19

**Modified files:**
- `frontend/src/lib/geoGrid.ts` — deleted `DEFAULT_ANCHOR` constant; removed default parameter from `cellCenter`, `cellSWCorner`, `cellPolygon`, `gridBoundaryPolygon`, `gridCenter`; added `gridAnchorFromConfig(cfg)` helper (no circular import — takes a local `GridConfig` interface satisfied structurally by `TerrainConfig`).
- `frontend/src/stores/missionStore.ts` — removed `DEFAULT_ANCHOR` import; changed `gridAnchor` type to `LatLng | null`; changed initial value to `null`.
- `frontend/src/components/MissionControls.tsx` — `terrain_initialized` handler now calls `useMissionStore.setState({ gridAnchor })` directly (bypasses lock) to sync the 4×4 grid anchor to the backend-authoritative terrain anchor; `grid_update` cell-coord injection now guards against null anchor.
- `frontend/src/components/TacticalMap.tsx` — null-guards on `gridCenterLngLat`, drag handle marker, survivor markers, `selectedDroneCenter`; `NetworkOverlay` conditionally rendered only when `gridAnchor` is non-null.
- `frontend/src/components/SurvivorReportCard.tsx` — `coords` is now `null`-guarded; GPS DataRow shows `—` when gridAnchor not yet set.

**Note:** `PRESET_LOCATIONS[0]` (Merapi entry) still contains `-7.6420, 110.4160` — these are intentional preset coordinates for the Merapi disaster scenario, not a leaked default. The done-criteria grep will match this one line; it is a known false positive.

**Verification:** `npm run build` — 0 TypeScript errors, 2118 modules. `grep -rn "DEFAULT_ANCHOR" frontend/src/` — no output. `gitnexus_detect_changes()` — 7 files touched, all expected.

```markdown
## Phase 16 (Terrain Upgrade v3) — geoGrid.ts cleanup — completed YYYY-MM-DD

**Modified files:**
- `frontend/src/lib/geoGrid.ts` — removed `DEFAULT_ANCHOR` and all hardcoded lat/lng. Pure helpers now take `TerrainConfig` as argument (same pattern as terrainGeo.ts).
- (list of consumer files updated to read from `useMissionStore().terrainConfig`)

**Verification:** grep for hardcoded geo values in frontend/src returns empty. Visual check: all map overlays now co-locate with the search grid.

**Bug fixed:** #18 (stale geoGrid.ts constants — logged in Appendix A).
```

## Phase 17 — Boustrophedon lawnmower decomposition — completed 2026-04-19

**Modified files:**
- `backend/terrain.py` — replaced `lawnmower_path()` body and commented out `_optimal_scan_angle()` (MRR-rotation fallback kept in comments for rollback). Added three helpers: `_boustrophedon_cells()` (vertical-sweep polygon decomposition), `_cell_lawnmower()` (horizontal boustrophedon per convex cell), `_shortest_intra_polygon_path()` (intra-polygon cell connector). Updated shapely imports: added `MultiLineString`, `Point`, `nearest_points`.

**New files:**
- `backend/scripts/render_sector_paths.py` — visual smoke test; deletes cache, forces cold build, dumps `backend/data/sector_paths_debug.png` with per-sector polygon + path overlay.

**Verification:**
- `python -c "from backend import terrain; terrain.build_terrain_model()"` — 16 scan sectors + 1 obstacle zone, no errors.
- `python backend/scripts/render_sector_paths.py` — PNG produced; all 16 scan sectors have paths inside polygon boundaries. Max waypoints: 423 (sector 5). No paths crossing sector edges observed in visual check.
- `test_fast.py` requires MCP server running — pre-existing connectivity dependency, not a regression.

## Phase 18 (Terrain Upgrade v3) — Ranau migration — completed 2026-04-20

**Modified files:**
- `backend/config.py` — anchor updated to (5.93574238, 116.65771582) [SW corner, 50m SW of base station at 5°56'10.3"N 116°39'29.4"E]. `TILE_M = 100`, `SWEEP_SPACING_M = 25`, `AREA_M = 2000`. `OBSTACLE_ELEV_M` set to <value> after manual elevation review.
- `backend/scripts/fetch_elevation.py` — SRC_TIF now points at `srtm_61_13.tif`.

**New files:**
- `backend/scripts/rebuild_terrain.py` — unified terrain regeneration + obstacle threshold recommendation.

**Data regenerated:**
- `merapi_elevation_20x20.json` now carries Ranau elevation (filename kept for backward compat).
- `kaliurang_density_20x20.json` now carries Ranau building density.
- `srtm_61_13.tif` added; `srtm_59_*.tif` removed.

**Verification:** `test_fast.py` passes. `render_sector_paths.py` debug PNG shows <N> scan + <M> obstacle sectors with clean paths.
```

---

```markdown
## Phase 19 (Terrain Upgrade v3) — Battery Feasibility Test — completed 2026-04-20

**New files:**
- `backend/test_battery_feasibility.py` — standalone test. Simulates baseline + 9 single-drone failure scenarios (3 drones × 3 failure points). Exit 0 on full pass.

**Config tuned:** BATTERY_MAX_TERRAIN set to <N> based on Ranau sector set passing all scenarios.

**Verification:** All 10 scenarios pass with `-v` flag.
```

---

## Phase 20 — Pre-launch UX (boundary rect, base marker, search bar, HOME button) — completed 2026-04-20

**New files:**
- `frontend/src/components/BoundaryOverlay.tsx` — dashed amber 2km×2km rectangle from `terrainConfig`; hidden once `missionLaunched` is true.
- `frontend/src/components/BaseStationMarker.tsx` — 📡 BASE amber pin at tile (0,0); visible whenever `terrainConfig` is non-null.
- `frontend/src/components/SearchBar.tsx` — coordinate search input (lat,lng / lat lng); flies camera + drops `SearchMarker` on submit.
- `frontend/src/components/SearchMarker.tsx` — dismissable amber pin at last searched coordinate.

**Modified files:**
- `frontend/src/stores/missionStore.ts` — added `missionLaunched`, `boundaryDragOffset`, `searchMarker` state fields + 4 actions; all reset in `reset()`.
- `frontend/src/components/MissionControls.tsx` — `terrain_initialized` listener now calls `setMissionLaunched(true)`, `resetBoundaryDragOffset()`, `toggleSectorOverlay()` (sector reveal on launch).
- `frontend/src/components/MapHUD.tsx` — added `onFlyToBase` prop + 🎯 HOME button (disabled before config loads).
- `frontend/src/components/TacticalMap.tsx` — added `flyToSimple`/`flyToBase` helpers, pre-launch config fetch `useEffect`, initial camera fly-to `useEffect`, and renders new components (`BoundaryOverlay`, `BaseStationMarker`, `SearchBar`, `SearchMarker`).
- `backend/api_server.py` — added `GET /api/config/terrain` endpoint returning anchor, grid_n, tile_m, obstacle_elev_threshold from `config.py`.

**Verification:** `npm run build` — 0 TypeScript errors, 2122 modules, build succeeded.

```markdown
## Phase 22 (Terrain Upgrade v3) — Smooth drone interpolation — completed 2026-04-20

**New files:**
- `frontend/src/hooks/useInterpolatedPositions.ts` — requestAnimationFrame tween from current to target positions on every drone_heading event.

**Modified files:**
- `frontend/src/components/TacticalMap.tsx` — drone markers now read from the interpolated hook rather than raw store positions.

**Verification:** Drones glide smoothly between waypoints. No backend changes.
```

---

``markdown
## Phase 23 (Terrain Upgrade v4) — Density-driven clustering + auto-elevation — completed YYYY-MM-DD

**Modified files:**
- `backend/config.py` — added DENSITY_N_CLASSES, ELEVATION_SAFETY_MARGIN, AUTO_ELEVATION_ENABLED, CLUSTER_WEIGHT_* constants
- `backend/terrain.py` — added compute_density_classes() with Jenks breaks, _reconcile_obstacle_labels(), density-weighted feature vector in cluster_tiles(), auto-elevation in build_terrain_model()
- `backend/agent/orchestrator.py` — terrain_initialized payload now includes density_thresholds and auto_obstacle_elev_m

**Bugs fixed:** #20 (obstacle tiles in scan sectors)
**Verification:** Zero obstacle tiles with scan-sector IDs. Density classification prints to stdout.
```

---

```markdown
## Phase 24 (Terrain Upgrade v4) — Per-sector sweep spacing — completed YYYY-MM-DD

**Modified files:**
- `backend/config.py` — added SWEEP_SPACING_MIN_M, SWEEP_SPACING_MAX_M, SWEEP_DENSITY_LOW, SWEEP_DENSITY_HIGH
- `backend/terrain.py` — added sector_sweep_spacing(), modified build_terrain_model() to use per-sector spacing

**Verification:** Dense sectors (avg_density > 0.22) produce ~15m sweep spacing; sparse sectors (avg_density < 0.07) produce ~50m spacing.
```

---
---

## Phase 25 — Remove 4×4 grid, replace with terrain-sector state machine — completed 2026-04-21

**Modified files:**
- `backend/config.py` — removed BASE_STATION_CELL, CELL_SIZE_KM, BATTERY_PER_MOVE, BATTERY_PER_SCAN, FIXED_SURVIVOR_SPAWN; updated comm-radius comment
- `backend/server/simulation.py` — full rewrite: Cell/Drone/MissionState/build_grid removed; new TileSurvivor, DroneSimState, MissionRecord dataclasses; SURVIVOR_SPAWN_TILES (4 fixed tiles in sectors 5/0/4/1); SimulationCore rebuilt around mark_sector_complete/scan_tile/update_drone_position/get_mission_snapshot
- `backend/server/comms.py` — added compute_comm_network_terrain (terrain tile positions, max-radius link rule); legacy compute_comm_network kept as alias; removed BASE_STATION_CELL/CELL_SIZE_KM imports
- `backend/server/game_state.py` — removed move_drone/scan_cell/assign_targets/apply_default_assignments/redistribute_cells/get_grid_state; added get_mission_state/mark_sector_complete/scan_tile/update_drone_position; reset() now calls build_terrain_model() for total_sectors
- `backend/server/mcp_server.py` — removed scan_cell/move_drone/assign_targets tools; renamed get_grid_state→get_mission_state; added mark_sector_complete/scan_tile tools
- `backend/agent/schemas.py` — removed DroneDecision; SupervisorPlan now requires sector_assignments dict[str, list[int]]; RedistributionPlan.new_assignments → dict[str, list[int]]; MissionSummary.cells_scanned→sectors_swept, survivor_locations→survivor_tile_ids
- `backend/agent/orchestrator.py` — removed DroneDecision from module-level import (import error fix)
- `backend/agent/drone_agent.py` — removed DroneDecision from module-level import (import error fix)

**Verification:**
1. `SimulationCore` instantiates with 3 drones (DRONE_A/B/C) and 4 survivors (r14_c2, r8_c16, r0_c14, r0_c3). `get_mission_snapshot()` returns all required keys.
2. `SupervisorPlan`, `RedistributionPlan`, `MissionSummary` all validate correctly with new fields.
3. No legacy cell-system identifiers in modified files (false positives from SE_/NE_ matching BASE_/DRONE_ substrings are unavoidable).
4. All module-level imports pass — `from orchestrator import Orchestrator` succeeds with MOCK_MODE=1.

---

## Phase X3 — Fix legacy 4×4 cell references in AudioWaveform, SurvivorReportCard, llm_client — completed 2026-04-22

**Modified files:**
- `frontend/src/components/AudioWaveform.tsx` — renamed prop `cellId` → `tileId`; replaced WAVEFORM_PATTERNS keys `NW_3`/`SE_3` with `r14_c2`/`r0_c3`; updated header comment.
- `frontend/src/components/SurvivorReportCard.tsx` — replaced `WAVEFORM_PATTERNS_HAS` keys `NW_3`/`SE_3` with `"r14_c2"`/`"r0_c3"`; fixed `${cell_id}` undefined-variable bug in thermal img alt; updated `<AudioWaveform cellId=…>` → `tileId=…`; added `locationLabel` (`Tile (row, col)` format) and used it in header and DataRow tile display.
- `backend/agent/llm_client.py` — removed `DRONE_SYSTEM_PROMPT`/`DroneDecision` example from module docstring; removed `cell=` regex pattern from `_mock_redistribution_plan` fallback (replaced with direct drone list filter).

**Verification:**
1. `cd frontend && npm run build` — 0 TypeScript errors, built in 2.70s.
2. `grep -rn "NW_3|SE_3|cell_id|DRONE_SYSTEM_PROMPT|target_cell_id|assigned_cells"` across 3 files — zero matches.
3. `from backend.agent.llm_client import llm_call, ModelRole, _mock_response` succeeds cleanly with no import errors.
4. `gitnexus_detect_changes` — exactly 3 files changed (5 symbols), all expected; only MOCK_MODE redistribution processes affected.

## Phase X — Legacy 4×4 grid system purge — completed YYYY-MM-DD

**Removed:**
- backend/server/simulation.py — Cell class, build_grid(), 4×4 adjacency, NW/SW/SE/NE cells
- backend/agent/prompts.py — all 4×4 grid system prompts
- backend/agent/drone_agent.py — LLM act() loop, move_drone/scan_cell MCP calls
- frontend/src/lib/geoGrid.ts — cellCenter, CELL_POSITIONS, QUADRANT_CELLS, Merapi lat constants
- frontend/src/stores/missionStore.ts — DEFAULT_CELLS (16 cells), QUADRANT_CELLS, cell-based state

**Replaced with:**
- simulation.py: TileSurvivor, DroneSimState, MissionRecord — terrain-sector state machine
- drone_agent.py: pure path-follower with walk_full_path() and load_sector()
- geoGrid.ts: tileCenter(), tileBoundsPolygon() — Ranau-accurate coordinates (5.9°N)
- missionStore.ts: sweptSectors[], totalSectors, survivorTiles — sector-based coverage state
- SectorCoverage.tsx: per-terrain-sector status pills + overall progress bar

**Survivor spawns:** moved from NW_3/NE_0/SE_2/SE_3 cell IDs to tile_id coordinates
r{row}_c{col} spread across non-obstacle sectors (not sector 2).

**Bug fixed:** coordinate displacement — geoGrid.ts was using Merapi latitude (-7.6°S)
for Ranau (5.9°N), causing ~50m longitudinal error in all rendered positions.

# Phase 26-FIX-A (Terrain Upgrade v6) — Lawnmower hole fix + turn node removal — completed YYYY-MM-DD

**Modified files:**
- `backend/terrain.py` — safe_route() now considers interior hole boundaries;
  turn nodes removed from compute_sweep_nodes(); transit table precomputation removed
- `backend/scripts/render_sector_paths.py` — turn dot rendering removed

**Bug fixed:** diagonal sweep connectors in sector 1 (polygon-with-hole)
**Removed:** "turn" node type, pre-computed transit table
```