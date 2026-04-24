# ARCHITECTURE — BACKEND
> Read this file for backend tasks. For file structure and how to run, see `docs/arch/OVERVIEW.md`.

---

## Key Backend Classes and Functions

### `SimulationCore` (`backend/server/simulation.py`) — Phase 25

Pure Python, no async. Instantiated once per mission via `GameState.reset()`. No 4×4 cell grid — all state is tile-based and sector-based.

**Key dataclasses:**
- **`DroneSimState`**: `id, battery, status, tile_row, tile_col, lat, lng, sector_id, sectors_swept: list[int], survivors_found`
- **`TileSurvivor`**: `tile_row, tile_col, tile_id, description, num_people, medical_priority, time_to_collapse_hours, extraction_notes, thermal_reading, thermal_img_url, audio_transcript, lat, lng, found, found_by`
- **`MissionRecord`**: `phase, round_number, total_sectors, sectors_swept, survivors_found, failed_drones, failure_injected, completed`

**Constructor** `__init__(total_sectors=0, seed=None)`:
- Creates 3 `DroneSimState` instances at `BASE_TILE_ROW/COL` with `BATTERY_MAX_TERRAIN`
- Builds `self.survivors` dict from `SURVIVOR_SPAWN_TILES` (4 fixed tiles, sectors 5/0/4/1)
- Creates `MissionRecord(total_sectors=total_sectors)`

**`SURVIVOR_SPAWN_TILES`** (4 fixed spawns — sectors 5, 0, 4, 1):

| Tile | Sector area | Priority | Audio |
|------|-------------|----------|-------|
| r14_c2 | NW | CRITICAL | "Aduh...sakit....sakit!" |
| r8_c16 | NE | LOW | — |
| r0_c14 | SE | HIGH | — |
| r0_c3 | SW | MODERATE | "Tolong...Tolong" |

**`mark_sector_complete(drone_id, sector_id) → dict`**: Adds to `swept_sectors`; checks mission completion.

**`scan_tile(drone_id, tile_row, tile_col) → dict`**: Checks `self.survivors` for a match; marks found and returns survivor dict if present.

**`update_drone_position(drone_id, tile_row, tile_col, lat, lng, battery, status, sector_id=-1) → None`**: Direct setter for all DroneSimState position fields.

**`move_drone_to_tile(drone_id, row, col, battery_cost) → dict`**: Validates bounds/battery, computes lat/lng, calls `update_drone_position`. Returns `{success, drone_id, row, col, lat, lng, battery, status}`.

**`inject_failure(drone_id) → dict`**: Sets `drone.status = "offline"`. Returns `{success, drone_id, orphaned_sectors: []}`.

**`get_mission_snapshot() → dict`**: Returns full terrain snapshot — `swept_sectors, total_sectors, drone_positions, drones, survivors, communication_network, explored_count, coverage_pct`. Called by `GameState.get_mission_state()` and emitted as `grid_update` payload.

---

### `comms.py` (`backend/server/comms.py`)

Pure computation — no I/O, no MCP calls. Called from `SimulationCore.get_mission_snapshot()`.

**`compute_comm_network_terrain(drones: dict) → dict`** (primary):
- **Args:** `drones` = dict of `drone_id → DroneSimState` (`.tile_row`, `.tile_col`, `.status`)
- **Positions:** `pos_km = (tile_col * 0.1, tile_row * 0.1)`; BASE at `(BASE_TILE_COL * 0.1, BASE_TILE_ROW * 0.1)`
- **Link rule:** Two entities linked iff euclidean distance (km) ≤ `max(radius_A, radius_B)`. Worker = 2.5 km, base = 3.0 km.
- **Reachability:** BFS from `BASE`. Returns `{links, reachable_from_base, isolated, entities}`.

**`compute_comm_network(drones, grid=None) → dict`** (legacy alias): Delegates to `compute_comm_network_terrain(drones)`. `grid` is ignored.

---

### `GameState` (`backend/server/game_state.py`)

Async wrapper around `SimulationCore`. Single instance shared by the FastMCP server. Every public method acquires `self._lock = asyncio.Lock()` before delegating to `self._sim`.

**`reset(seed=None) → dict`**: Calls `build_terrain_model()` to get `total_sectors`, creates fresh `SimulationCore(total_sectors, seed)`.
**`get_drone_status(drone_id) → dict`**: Returns `drone.to_dict()` (DroneSimState).
**`get_all_drone_statuses() → dict`**: Returns `{drones: {did: d.to_dict()}, round, phase, active_count, failed_drones}`.
**`get_mission_state() → dict`**: Returns `sim.get_mission_snapshot()` — the full terrain snapshot.
**`mark_sector_complete(drone_id, sector_id) → dict`**: Delegates to `sim.mark_sector_complete()`.
**`scan_tile(drone_id, tile_row, tile_col) → dict`**: Delegates to `sim.scan_tile()`.
**`update_drone_position(drone_id, tile_row, tile_col, lat, lng, battery, status, sector_id) → dict`**: Delegates to `sim.update_drone_position()`.
**`advance_round() → dict`**: Increments `sim.mission.round_number`.
**`set_phase(phase) → dict`**: Validates against `{"init", "planning", "executing", "recovery", "complete"}`.

---

### MCP Server (`backend/server/mcp_server.py`)

FastMCP instance on Streamable HTTP at `localhost:8001`. 12 tools (Phase 25: cell-based tools removed, sector tools added):

| # | Tool name | Args | Reads/Writes | Who calls it |
|---|-----------|------|--------------|-------------|
| 1 | `discover_drones` | none | R: sim.drones | Supervisor (plan) |
| 2 | `get_drone_status` | `drone_id` | R: DroneSimState | DroneAgent (each round) |
| 3 | `get_all_drone_statuses` | none | R: drones, mission | Supervisor (monitor, redistribute, summarise) |
| 4 | `get_mission_state` | none | R: terrain snapshot | DroneAgent, Supervisor, Orchestrator |
| 5 | `get_mission_status` | none | R: MissionRecord | Orchestrator (after each round) |
| 6 | `move_drone_to_tile` | `drone_id, row, col, battery_cost` | W: DroneSimState position fields | DroneAgent (MOVE action) |
| 7 | `mark_sector_complete` | `drone_id, sector_id` | W: swept_sectors, mission.sectors_swept | DroneAgent/Orchestrator (sector done) |
| 8 | `scan_tile` | `drone_id, tile_row, tile_col` | W: TileSurvivor.found, mission.survivors_found | DroneAgent (at each waypoint) |
| 9 | `inject_drone_failure` | `drone_id` | W: drone.status, mission.failed_drones | Orchestrator |
| 10 | `reset_mission` | `seed: int = 42` | W: entire SimulationCore | Orchestrator (mission start) |
| 11 | `set_mission_phase` | `phase: str` | W: mission.phase | Orchestrator (phase transitions) |
| 12 | `advance_mission_round` | none | W: round_number += 1 | Orchestrator (top of each round) |

---

### `Orchestrator` (`backend/agent/orchestrator.py`)

One instance per mission. Created fresh on each `POST /api/mission/start`.

**State fields:**
- `self._offline: set[str]` — drone IDs known to be offline
- `self._redistributed: set[str]` — prevents double-redistribution
- `self.pending_failure: Optional[str]` — set by API inject-failure endpoint
- `self._last_grid_state: Optional[dict]` — previous round's grid snapshot for diff computation
- `self._last_comms_reachable: set[str]` — previous round's reachable drone set for comms diff
- `self._mission_logger: MissionLogger` — writes every emitted event to `mission_log.json`
- `self._tiles_grid: list[list[Tile]]` — 20×20 terrain grid built by `build_terrain_model()`
- `self._sectors: list[Sector]` — all sectors (scan + obstacle)
- `self._sectors_by_id: dict[int, Sector]` — fast sector lookup
- `self._drone_sector_queue: dict[str, deque]` — remaining sector IDs per drone (queue order = visit order)
- `self._drone_current_sector: dict[str, int]` — active sector ID per drone (-1 = idle)
- `self._drone_xy: dict[str, tuple[float,float]]` — last known drone position in local metres (x=east, y=north)
- `self._sector_progress: dict[int, int]` — last completed waypoint index per sector; survives drone death for exact-resume self-healing
- `self._drone_ids: list[str]` — active fleet; initialised from `self.drones.keys()`, updated after fleet rebuild

**`run_mission(event_queue)` flow:**
1. reset_mission → build_terrain_model → emit terrain_initialized → emit phase_change {init}
2. set_mission_phase("planning") → _phase_plan() → supervisor assigns sectors → emit sector_assignments
3. set_mission_phase("executing") → loop up to MAX_ROUNDS:
   - advance_mission_round()
   - _maybe_inject_failure()
   - _execute_round() — each active drone walks full sector path (sequential for-loop, deterministic)
     - per node: emit drone_heading → scan_tile MCP → update_drone_position MCP
     - on survivor found: emit survivor_alert + drone_cot {action: "survivor_report"}
     - on sector complete: mark_sector_complete MCP → emit drone_cot {action: "sector_complete"} → load next sector
   - asyncio.gather(get_mission_state(), get_mission_status()) → emit grid_update + stats_update
   - _emit_diffs() — emits comms_lost, comms_restored
   - break if mission completed
   - _phase_monitor()
4. _return_to_base() — emit phase_change {returning}
5. set_mission_phase("complete") → _phase_complete() → supervisor summarise → emit mission_complete
6. token_usage event emitted; mission_logger.close()

**`_emit_diffs(grid_snap, round_num)`**: Compares new_grid_state against `_last_grid_state`. Emits `survivor_alert` on new survivor_found cells, `comms_lost`/`comms_restored` on reachability changes.

**`_emit(event_type, data)`**: Dual-write — logs to `mission_log.json` AND puts on SSE queue. Never raises.

---

### `MissionLogger` (`backend/agent/orchestrator.py`)

`log(event_type, data)` accumulates events in memory. `close()` dumps as JSON array to `mission_log.json`. Called after `mission_complete`.

---

### `SupervisorAgent` (`backend/agent/supervisor.py`)

One instance per mission. All methods open a fresh MCP client session.

- **`plan()`**: `discover_drones` → builds sector summary from `self._sectors` (populated by orchestrator) → LLM → `SupervisorPlan` (sector_assignments)
- **`monitor()`**: `asyncio.gather(get_all_drone_statuses, get_mission_state)` → builds sectors_status + drone_statuses strings → `SUPERVISOR_MONITOR_PROMPT_TEMPLATE` → LLM → `SupervisorPlan`
- **`redistribute()`**: Stub — returns `RedistributionPlan.model_construct(new_assignments={})`. Algorithmic redistribution is done by `Orchestrator.replan_after_failure()`.
- **`summarise()`**: `asyncio.gather(get_mission_status, get_all_drone_statuses, get_mission_state)` → `SUPERVISOR_SUMMARY_PROMPT_TEMPLATE` → LLM → `MissionSummary`

---

### `DroneAgent` (`backend/agent/drone_agent.py`)

One instance per drone. **No LLM, no MCP, no async.** Pure deterministic state machine.

**`load_sector(sector, resume_index=0, reverse=False)`**: Converts `sector.sweep_path_coords` `[[x,y],...]` to node dicts; slices from `resume_index`; optionally reverses for proximity optimisation.

**`walk_full_path() → list[dict]`**: Steps through all remaining nodes in the loaded sector path. Each step drains battery (`cost = ceil(dist_m/100 * BATTERY_PER_100M)`), updates `current_xy`, computes heading and tile coordinates, returns a list of step dicts for the orchestrator to emit and MCP-call.

**`choose_reverse(sector, current_xy) → bool`**: Compares distance from `current_xy` to first vs last waypoint of the sector path; returns True if starting from the end is closer.

**`is_sector_complete() → bool`**: Returns True when `_node_index >= len(_current_nodes)`.

**`_sector_resume_index`**: Original `resume_index` passed to `load_sector()`. Used to compute global path progress: `global_index = _sector_resume_index + _node_index`.

---

---

### `llm_client.py` (`backend/agent/llm_client.py`)

- **`llm_call(role, system_prompt, user_prompt, schema, max_retries=3, timeout=30.0)`**: Selects model from env vars, calls LiteLLM via `asyncio.to_thread`, validates response with Pydantic. Exponential backoff: 1s, 2s. Records tokens via `_token_tracker`.
- **`get_model(role)`**: Reads `SUPERVISOR_MODEL` or `WORKER_MODEL` from env. Falls back to `openrouter/x-ai/grok-4.1-fast`.
- **Anthropic cache:** For `anthropic/*` models, wraps system prompt in `cache_control: ephemeral` block.
- **`TokenTracker`**: Singleton `_token_tracker`. `reset()` at mission start. `record(role, model, input, output)` per call. `get_token_summary() → dict`.
- LiteLLM params: `temperature=0.2`, `max_tokens=1024`, `timeout=30.0`.

---

### Pydantic Schemas (`backend/agent/schemas.py`)

`reasoning: str` (min 20 chars) is mandatory on all schemas — enforces chain-of-thought.

- **`SupervisorPlan`** (Phase 25): `reasoning`, `sector_assignments: dict[str, list[int]]` (required — maps drone_id to sector IDs), `failed_drones: list[str]`, `phase: Literal["plan","monitor","redistribute","complete"]`
- **`RedistributionPlan`** (Phase 25): `reasoning`, `failed_drone_id`, `new_assignments: dict[str, list[int]]` (sector IDs, non-empty, enforced by validator)
- **`MissionSummary`** (Phase 25): `reasoning`, `rounds_completed`, `sectors_swept: int`, `survivors_found`, `survivor_tile_ids: list[str]` (e.g. `['r14_c2', 'r8_c16']`), `failed_drones`, `self_healing_triggered`, `narrative: str` (min 30 chars)

---

### Prompts (`backend/agent/prompts.py`)

- **`SUPERVISOR_SYSTEM_PROMPT`**: Single system prompt covering all supervisor roles (plan/monitor/summary).
- **`SUPERVISOR_MONITOR_PROMPT_TEMPLATE(sectors_status, drone_statuses) → str`**: Builds mid-mission status check user prompt.
- **`SUPERVISOR_SUMMARY_PROMPT_TEMPLATE(sectors_swept, total_sectors, survivors, rounds, failed_drones) → str`**: Builds after-action report user prompt.

---

### `api_server.py`

- **`POST /api/mission/start`**: Cancels existing task if running, creates fresh Orchestrator + Queue, launches `run_and_cleanup()` as background task.
- **`GET /api/mission/stream`**: SSE stream via `asyncio.wait_for(queue.get(), timeout=15.0)`. Keepalive on timeout.
- **`POST /api/mission/inject-failure`**: Sets `orchestrator.pending_failure = drone_id`. Validates drone_id in `{"DRONE_A","DRONE_B","DRONE_C"}`.
- **CORS origins**: `http://localhost:3000`, `http://localhost:3001`, `http://127.0.0.1:3000`, `http://localhost:8080`

---

## 6. Constants and Configuration

### `sector_sweep_spacing` (`backend/terrain.py`)

**`sector_sweep_spacing(avg_density: float) → float`**: Returns per-sector lawnmower spacing (15–50m) via linear interpolation between Jenks density thresholds. Dense sectors (`avg_density ≥ high_t`) get `SWEEP_SPACING_MIN_M=15m`; sparse sectors (`avg_density ≤ low_t`) get `SWEEP_SPACING_MAX_M=50m`. Called by `build_terrain_model` (sets path spacing per sector) and `sectors_to_geojson` (adds `sweep_spacing_m` to GeoJSON properties). Thresholds come from `_density_classification["thresholds"]` (set at build time) with `SWEEP_DENSITY_LOW`/`SWEEP_DENSITY_HIGH` as fallbacks.

---

### `backend/config.py`
```python
MCP_URL = "http://localhost:8001/mcp"
COMM_RADIUS_KM = {"worker": 2.5, "base": 3.0}  # km
LOW_BATTERY_THRESHOLD = 20
MOCK_MODE = False             # Override with env var MOCK_MODE=1 in tests
# Terrain constants (20×20 grid, 100m tiles, 2km×2km area):
GRID_N, TILE_M, AREA_M = 20, 100.0, 2000.0
BATTERY_MAX_TERRAIN = 400
BATTERY_PER_100M = 0.20
BATTERY_RTB_RESERVE = 15
BASE_TILE_ROW, BASE_TILE_COL = 0, 0
ANCHOR_LAT, ANCHOR_LNG = 5.93574238, 116.65771582
```

### `backend/agent/orchestrator.py`
```python
MAX_ROUNDS = 30
FAILURE_ROUND = 0            # 0 = auto-failure disabled; use API endpoint instead
MISSION_LOG_PATH = "mission_log.json"
# RTB_MAX_ROUNDS = 12  (defined inside _return_to_base())
```

### `backend/server/mcp_server.py`
```python
# Transport: "streamable-http", host="0.0.0.0", port=8001
# reset_mission default seed: 42
```

### `backend/api_server.py`
```python
# Port: 8000
# Event queue maxsize: 200
# SSE keepalive timeout: 15.0 seconds
```

---

## 7. Known Backend Inconsistencies

### Docstring Errors (do not fix unless explicitly asked)
- `simulation.py` line 13: says drones start at NW_0 — wrong, it's SW_2.
- `simulation.py` lines 92, 253: same NW_0 error in inline comments.
- `mcp_server.py` module docstring + tool docstrings: say "11 cells (L-tromino)" — should be 16 cells.
- `orchestrator.py` run_mission() docstring line 172: says "all 11 cells" — should be 16.
- `supervisor.py` summarise() docstring line 339: says "11 cells" — should be 16.
- `schemas.py` lines 20, 112-114, 217-219: L-tromino and Q1/Q2/Q3 quadrant references — outdated.

### Suboptimal Design (known, not bugs)
- Fleet rebuild on every mission start: `Orchestrator.__init__` creates hardcoded `["DRONE_A","DRONE_B","DRONE_C"]`, then `run_mission` immediately overwrites from `plan.assignments.keys()`. Harmless.
- `GameState.apply_default_assignments()`: Dead code — returns empty lists, never called in production flow.
- `_parse_response` fence stripping: Two branches of if/else are identical — logically redundant but works correctly.
- `_emit()` is defined twice in orchestrator.py (lines 289 and 293) — second definition overrides first. Harmless since second definition is the correct dual-write version.
