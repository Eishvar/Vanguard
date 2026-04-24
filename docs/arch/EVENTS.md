# ARCHITECTURE — SSE EVENTS
> Read this file when touching SSE events, MissionControls SSE listeners, or event payloads.

---

## All SSE Event Types

The SSE stream uses named events (`event: {type}` + `data: {json}`). The frontend `EventSource` registers separate `addEventListener` calls for each.

| Event | Emitted by | Payload fields | Frontend action |
|-------|-----------|----------------|-----------------|
| `phase_change` | Orchestrator | `phase: str`, `round: int` | `setPhase(phase, round)`; if "executing" → `setActiveTab(2)` (only if tab was 1) |
| `supervisor_cot` | Orchestrator._phase_plan, ._phase_monitor, ._handle_failure | `phase, round, reasoning, assignments? (plan/redistribute only), failed_drones? (monitor only)` | Always Tab 2. Logs reasoning with source:"SUPERVISOR". If assignments present, logs formatted assignment table. phase="redistribute" emitted instantly on drone failure. |
| `drone_cot` | Orchestrator._execute_round | `drone_id, round, action: "sector_start"\|"sector_complete"\|"survivor_report"\|"low_battery", sector_id: int, tile_row: int, tile_col: int, battery: int, status: str` | Tab 2 log with source=drone_id; calls `setLastReasoning(drone_id, ...)` → LiveCotPanel updates |
| `grid_update` | Orchestrator (after each round + RTB) | `swept_sectors: [int], total_sectors: int, drone_positions: {drone_id: {id, battery, status, tile_row, tile_col, lat, lng, sector_id, sectors_swept, survivors_found, pos_km}}, drones: {drone_id: DroneSimState}, survivors: {tile_id: TileSurvivorDict}, communication_network: {links, reachable_from_base, isolated, entities}, explored_count, coverage_pct` | `updateDronesFromSnapshot(data.drones)`, `updateCommsNetwork(communication_network)` → TacticalMap re-renders |
| `stats_update` | Orchestrator (after each round, not RTB) | `round_number, phase, total_sectors, sectors_swept, survivors_found, failed_drones, completed, coverage_pct` | `updateStats()` → updates round/phase/survivorsFound; SectorCoverage + MissionIntel re-render |
| `failure_event` | Orchestrator._maybe_inject_failure | `round, drone_id, orphaned_cells: [str], trigger: "api"\|"scheduled"` | `setDroneOffline(drone_id)`; addLog(2, "⚠ DRONE FAILURE...") as type:"error" |
| `terrain_initialized` | Orchestrator.run_mission | `tiles_grid: {"{r}_{c}": {row, col, elevation_m, density, is_obstacle, sector_id}}, sectors_geojson: GeoJSON FeatureCollection, obstacle_elev_threshold: float (legacy OBSTACLE_ELEV_M), anchor_latlng: [lat, lng], grid_n: int, tile_m: float, density_thresholds: [low_upper, med_upper], auto_obstacle_elev_m: float` | Not yet handled — Phase 5 frontend |
| `sector_assignments` | Orchestrator._phase_plan | `assignments: {drone_id: [sector_id, ...]}, reasoning: str` | Not yet handled — Phase 5 frontend |
| `drone_heading` | Orchestrator._execute_round | `drone_id, lat, lng, heading_deg, sector_id, path_index, path_total` | Not yet handled — activates in Phase 4 when DroneAgent returns MOVE dicts |
| `recovery_event` | Orchestrator._handle_failure | `failed_drone_id, partial_sector_id: int\|null, resume_index: int, total_waypoints: int, pct_done_by_failed_drone: float, pct_remaining: float, new_assignments: {drone_id: [sector_ids]}, reasoning: str` | addLog(2, "🔄 SELF-HEALING...") as type:"warning" |
| `mission_complete` | Orchestrator._phase_complete | `rounds_completed, sectors_swept, survivors_found, survivor_tile_ids: [str], failed_drones: [str], self_healing_triggered: bool, narrative: str, reasoning: str` | addLog; `buildReport(data)` → `setCommanderReport()`; `setActiveTab(3)`; `setSystemStatus("COMPLETE")`; `setMissionStarted(false)`; `source.close()` |
| `survivor_alert` | Orchestrator._emit_diffs | `cell_id, survivor_profile: {description, num_people, medical_priority, time_to_collapse_hours, extraction_notes}, drone_id, round, timestamp, thermal_reading, thermal_img_url, audio_transcript` | (Phase D Step 9) Toast notification + add to SurvivorsList |
| `comms_lost` | Orchestrator._emit_diffs | `drone_id, round, tile_row: int, tile_col: int` | (Phase D Step 10) Badge on drone icon; addLog warning |
| `comms_restored` | Orchestrator._emit_diffs | `drone_id, round, tile_row: int, tile_col: int` | (Phase D Step 10) Clear badge; addLog info |
| `token_usage` | Orchestrator (after mission_complete) | `total_calls: int, total_input_tokens: int, total_output_tokens: int, by_role: {role: {calls, input_tokens, output_tokens, model}}` | Not handled by frontend — logged to `mission_log.json` only |
| `stream_end` | api_server.py (finally block) | `mission_id: int` | `source.close()`; if `missionStarted`: `setMissionStarted(false)`, `setSystemStatus("STANDBY")` |
| `error` | Orchestrator (on exceptions) | `message: str, phase: str` | Falls through to `source.onerror` behavior |

**`source.onerror`**: closes EventSource, sets `missionStarted=false`, `systemStatus="ERROR"`, addLog(2, "✗ Stream connection lost").

---

## How Events Are Emitted

`Orchestrator._emit(event_type, data)` is the sole emission path:
1. `self._mission_logger.log(event_type, data)` — always logged to `mission_log.json`
2. `await self._event_queue.put({"type": event_type, "data": data})` — SSE queue
3. `api_server.generate()` drains the queue and yields `"event: {type}\ndata: {json}\n\n"`

`_emit_diffs(grid_snap, round_num)` is called after every `grid_update` and emits `survivor_alert`, `comms_lost`, `comms_restored` as derived events by comparing the new grid state against `_last_grid_state`.

---

## `communication_network` Shape

```json
{
  "links": [["DRONE_A", "DRONE_B"], ["DRONE_B", "BASE"], ["DRONE_A", "BASE"]],
  "reachable_from_base": ["DRONE_A", "DRONE_B"],
  "isolated": ["DRONE_C"],
  "entities": [
    {"id": "BASE",    "pos_km": [0.5, 0.5], "radius_km": 3.0},
    {"id": "DRONE_A", "pos_km": [1.5, 2.5], "radius_km": 2.5},
    {"id": "DRONE_B", "pos_km": [2.5, 1.5], "radius_km": 2.5},
    {"id": "DRONE_C", "pos_km": [3.5, 3.5], "radius_km": 2.5}
  ]
}
```

Link rule: two entities are linked if distance between cell centers (km) ≤ radius_A + radius_B (sum, not max). Worker radius = 2.5km, base radius = 3.0km.
