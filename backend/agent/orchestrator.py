"""
orchestrator.py — Mission orchestrator.

Top-level coordinator for a single mission run. Owns the full lifecycle:

  Phase 1+2: _phase_plan()     — supervisor assigns terrain sectors to drones
  Phase 3–5: execution loop    — drones sweep their sectors as path-followers;
                                  supervisor monitors each round
  Phase 6:   _return_to_base() — minimal phase transition (no LLM RTB)
  Phase 7:   _phase_complete() — supervisor generates final report

Drones are pure path-followers: no per-drone LLM call. The orchestrator
calls drone.walk_full_path() and emits drone_heading + scan_tile events.

SSE event types emitted:
  phase_change, supervisor_cot, drone_cot, grid_update, stats_update,
  drone_heading, sector_assignments, terrain_initialized,
  failure_event, recovery_event, survivor_alert,
  comms_lost, comms_restored, mission_complete, token_usage

Usage (called by api_server.py):
    from agent.orchestrator import Orchestrator

    orchestrator = Orchestrator()
    await orchestrator.run_mission(event_queue=queue)
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections import deque
from pathlib import Path
from typing import Optional

from drone_agent import DroneAgent
from llm_client import ModelRole, get_token_summary, reset_token_tracker
from schemas import MissionSummary, SupervisorPlan
from supervisor import SupervisorAgent

logger = logging.getLogger(__name__)

# CC-2: import from shared config instead of duplicating the constant
import sys as _sys, os as _os
_BACKEND_DIR  = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
_AGENT_DIR    = _os.path.dirname(_os.path.abspath(__file__))
_PROJECT_ROOT = _os.path.dirname(_BACKEND_DIR)
for _d in [_PROJECT_ROOT, _BACKEND_DIR, _AGENT_DIR]:
    if _d not in _sys.path:
        _sys.path.insert(0, _d)

from config import MCP_URL

from backend.terrain import (
    build_terrain_model, sectors_to_geojson, get_density_classification,
    a_star_transit, compute_transit_nodes, local_m_to_latlng,
    GRID_N, TILE_M, BASE_TILE_ROW, BASE_TILE_COL,
    ANCHOR_LAT, ANCHOR_LNG,
    base_station_latlng,
    BATTERY_MAX_TERRAIN,
    OBSTACLE_ELEV_M,
)
from backend.config import VISUAL_DRONE_SPEED_MPS
from backend.agent.sector_assignment import (
    validate_llm_assignment, assign_sectors, replan_after_failure,
    _remaining_battery_cost,
)


# ---------------------------------------------------------------------------
# MissionLogger
# ---------------------------------------------------------------------------

class MissionLogger:
    """
    Writes every SSE event emitted during a mission to mission_log.json.
    """

    def __init__(self, path: str = "mission_log.json") -> None:
        self.path = Path(path)
        self._entries: list[dict] = []
        self._start_time = time.time()
        logger.info("MissionLogger writing to %s", self.path.resolve())

    def log(self, event_type: str, data: dict) -> None:
        entry = {
            "ts":   round(time.time() - self._start_time, 3),
            "type": event_type,
            "data": data,
        }
        self._entries.append(entry)

    def close(self) -> None:
        try:
            with self.path.open("w", encoding="utf-8") as f:
                json.dump(self._entries, f, indent=2, default=str)
            logger.info(
                "MissionLogger: wrote %d events to %s",
                len(self._entries), self.path.resolve(),
            )
        except Exception as e:
            logger.warning("MissionLogger.close() failed: %s", e)


MAX_ROUNDS = 30
FAILURE_ROUND = 0
MISSION_LOG_PATH = "mission_log.json"


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class Orchestrator:
    """
    Drives a complete mission from initialisation to completion.

    One instance per mission run. Created fresh on each POST /api/mission/start.
    """

    def __init__(
        self,
        game_state=None,  # unused — kept for API compatibility
        mcp_url: str = MCP_URL,
        failure_round: int = FAILURE_ROUND,
        max_rounds: int = MAX_ROUNDS,
    ) -> None:
        self.mcp_url = mcp_url
        self.failure_round = failure_round
        self.max_rounds = max_rounds

        self.supervisor = SupervisorAgent(mcp_url=mcp_url, role=ModelRole.SUPERVISOR)
        self.drones: dict[str, DroneAgent] = {
            drone_id: DroneAgent(drone_id=drone_id)
            for drone_id in ["DRONE_A", "DRONE_B", "DRONE_C"]
        }

        self._offline: set[str] = set()
        self._redistributed: set[str] = set()

        self.pending_failure: Optional[str] = None
        self._event_queue: Optional[asyncio.Queue] = None

        self._last_grid_state: Optional[dict] = None
        self._last_comms_reachable: set[str] = set()

        self._mission_logger = MissionLogger(MISSION_LOG_PATH)

        # ── Terrain / sector state ───────────────────────────────────────────
        self._tiles_grid: list[list] = []
        self._sectors: list = []
        self._transit_table: dict = {}
        self._sectors_by_id: dict[int, object] = {}
        self._drone_sector_queue: dict[str, deque] = {}
        self._drone_current_sector: dict[str, int] = {}

        # Global waypoint progress per sector — used for exact failure resume
        self._sector_progress: dict[int, int] = {}

        self._tile_m: float = TILE_M

        self._drone_ids: list[str] = list(self.drones.keys())
        self._drone_completed_sectors: dict[str, list[int]] = {}

        self._sector_reverse: dict[int, bool] = {}
        self._sector_resume_xy: dict[int, tuple[float, float]] = {}

    # ------------------------------------------------------------------
    # Position helper
    # ------------------------------------------------------------------

    def _get_drone_xy(self, drone_id: str) -> tuple[float, float]:
        """Current (x, y) in local metres from drone's own state."""
        drone = self.drones.get(drone_id)
        if drone is not None:
            return drone.current_xy
        bx = BASE_TILE_COL * TILE_M + TILE_M / 2
        by = BASE_TILE_ROW * TILE_M + TILE_M / 2
        return (bx, by)

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def run_mission(self, event_queue: asyncio.Queue) -> Optional[MissionSummary]:
        """
        Run a complete mission from start to finish.
        Puts events on event_queue throughout. Returns MissionSummary on completion.
        """
        self._event_queue = event_queue
        reset_token_tracker()

        # ── Initialise game state ────────────────────────────────────────
        await self._mcp_call("reset_mission", {"seed": random.randint(1, 999999)})
        await self._emit("phase_change", {"phase": "init", "round": 0})

        # ── Planning phase setup ─────────────────────────────────────────
        await self._mcp_call("set_mission_phase", {"phase": "planning"})
        await self._emit("phase_change", {"phase": "planning", "round": 0})

        # ── Terrain initialisation ───────────────────────────────────────
        self._tiles_grid, self._sectors, self._transit_table = build_terrain_model()
        self._sectors_by_id = {s.sector_id: s for s in self._sectors}
        self.supervisor._sectors = self._sectors

        density_info = get_density_classification()

        # Initialise per-drone state
        for d_id in self._drone_ids:
            self._drone_current_sector[d_id] = -1
            self._drone_sector_queue[d_id] = deque()
            self._drone_completed_sectors[d_id] = []

        await self._emit("terrain_initialized", {
            "tiles_grid": {
                f"{r}_{c}": {
                    "row":        r,
                    "col":        c,
                    "elevation_m": self._tiles_grid[r][c].elevation_m,
                    "density":    self._tiles_grid[r][c].density,
                    "is_obstacle": self._tiles_grid[r][c].is_obstacle,
                    "sector_id":  self._tiles_grid[r][c].sector_id,
                }
                for r in range(GRID_N) for c in range(GRID_N)
            },
            "sectors_geojson":       sectors_to_geojson(self._sectors),
            "obstacle_elev_threshold": OBSTACLE_ELEV_M,
            "anchor_latlng":         [ANCHOR_LAT, ANCHOR_LNG],
            "base_station_latlng":   list(base_station_latlng()),
            "grid_n":                GRID_N,
            "tile_m":                TILE_M,
            "density_thresholds":    density_info["thresholds"],
            "auto_obstacle_elev_m":  density_info["auto_obstacle_elev_m"],
            "visual_drone_speed_mps": VISUAL_DRONE_SPEED_MPS,
        })

        # ── Phase 1+2: Plan ──────────────────────────────────────────────
        plan = await self._phase_plan()
        if plan is None:
            logger.error("Planning failed — aborting mission")
            return None

        # ── Rebuild drone agents from discovered fleet ────────────────────
        if plan.sector_assignments:
            discovered_ids = list(plan.sector_assignments.keys())
            self.drones = {
                drone_id: DroneAgent(drone_id=drone_id)
                for drone_id in discovered_ids
            }
            self._drone_ids = list(self.drones.keys())
            logger.info("Fleet rebuilt from discovery: %s", discovered_ids)

        # ── Load first sector into each drone + emit base-to-sector transit ──
        import math

        # Stagger drones 8m apart at base so icons don't overlap before launch.
        _base_offsets_m: dict[str, tuple[float, float]] = {
            "DRONE_A": ( 0.0,  0.0),
            "DRONE_B": ( 8.0,  0.0),
            "DRONE_C": (-8.0,  0.0),
        }

        for d_id in self._drone_ids:
            queue = self._drone_sector_queue.get(d_id)
            if not queue:
                continue

            # Set drone's initial position at the staggered base location
            bx = BASE_TILE_COL * TILE_M + TILE_M / 2
            by = BASE_TILE_ROW * TILE_M + TILE_M / 2
            off = _base_offsets_m.get(d_id, (0.0, 0.0))
            start_xy = (bx + off[0], by + off[1])
            self.drones[d_id].current_xy = start_xy

            # Sort initial queue so drones fly to the closest assigned sector first.
            best_sid = None
            best_dist = float('inf')
            for sid in list(queue):
                sec = self._sectors_by_id[sid]
                anchors = [n for n in sec.sweep_nodes if n["type"] == "anchor"]
                if not anchors:
                    anchors = sec.sweep_nodes[:1]
                if not anchors:
                    continue
                nearest_anchor = min(anchors, key=lambda n: math.hypot(n["x_m"] - start_xy[0], n["y_m"] - start_xy[1]))
                dist = math.hypot(nearest_anchor["x_m"] - start_xy[0], nearest_anchor["y_m"] - start_xy[1])
                if dist < best_dist:
                    best_dist = dist
                    best_sid = sid

            if best_sid is not None and best_sid != queue[0]:
                queue.remove(best_sid)
                queue.appendleft(best_sid)

            first_sid = queue[0]
            sector = self._sectors_by_id[first_sid]
            anchors = [n for n in sector.sweep_nodes if n["type"] == "anchor"]

            if anchors:
                nearest_anchor = min(
                    anchors,
                    key=lambda n: math.hypot(
                        n["x_m"] - start_xy[0],
                        n["y_m"] - start_xy[1]
                    )
                )
                to_xy = (nearest_anchor["x_m"], nearest_anchor["y_m"])
                await self._emit_transit_nodes(
                    d_id, self.drones[d_id],
                    from_xy=start_xy,
                    to_xy=to_xy,
                    node_type="initial_transit",
                )
                # _emit_transit_nodes sets drone.current_xy = to_xy
                reverse = len(anchors) >= 2 and nearest_anchor == anchors[-1]
            else:
                reverse = False

            self._sector_reverse[first_sid] = reverse
            self.drones[d_id].load_sector(sector, resume_index=0, reverse=reverse)
            self._drone_current_sector[d_id] = first_sid

        # THE FIX: Broadcast the dynamically sorted queues so the frontend
        # visual timeline perfectly matches the backend tactical decisions.
        await self._emit("sector_assignments", {
            "assignments": self._full_assignments,
            "reasoning": "Synchronized queue order after dynamic distance-based sorting."
        })

        # ── Phase 3–5: Execution loop ────────────────────────────────────
        await self._mcp_call("set_mission_phase", {"phase": "executing"})
        await self._emit("phase_change", {"phase": "executing", "round": 1})

        await self._run_sweep_loop()

        # ── Phase 6: Return to base ──────────────────────────────────────
        await self._return_to_base()

        # ── Phase 7: Summary ─────────────────────────────────────────────
        await self._mcp_call("set_mission_phase", {"phase": "complete"})
        summary = await self._phase_complete()

        token_summary = get_token_summary()
        await self._emit("token_usage", token_summary)
        self._mission_logger.close()

        return summary

    @property
    def _full_assignments(self) -> dict[str, list[int]]:
        """Combine historical completed sectors with the current pending queue."""
        return {
            d: self._drone_completed_sectors.get(d, []) + list(self._drone_sector_queue.get(d, []))
            for d in self._drone_ids
        }

    # ------------------------------------------------------------------
    # Phase helpers
    # ------------------------------------------------------------------

    async def _return_to_base(self) -> None:
        """Minimal RTB phase — drones are path-followers with no active navigation."""
        await self._emit("phase_change", {"phase": "returning", "round": 0})
        logger.info("RTB phase: drones standing by at final sweep positions.")

    async def _phase_plan(self) -> Optional[SupervisorPlan]:
        """
        Supervisor discovers fleet and assigns sectors.
        Loads self._drone_sector_queue from the validated plan.
        Does NOT load drone objects (fleet rebuild happens in run_mission after return).
        """
        try:
            plan = await self.supervisor.plan()
            await self._emit("supervisor_cot", {
                "phase":       "plan",
                "round":       0,
                "reasoning":   plan.reasoning,
                "assignments": {d: list(ids) for d, ids in plan.sector_assignments.items()},
            })
            logger.info("Plan complete | sector_assignments=%s", plan.sector_assignments)

            # ── Validate / fallback to greedy ────────────────────────────
            llm_sector_plan = plan.sector_assignments
            drone_batts = {d: BATTERY_MAX_TERRAIN for d in self._drone_ids}
            scan_sectors = [s for s in self._sectors if not s.is_obstacle]
            drone_positions = {d: self._get_drone_xy(d) for d in self._drone_ids}

            if llm_sector_plan:
                ok, validated, warnings = validate_llm_assignment(
                    llm_plan=llm_sector_plan,
                    drone_batteries=drone_batts,
                    all_sectors_by_id=self._sectors_by_id,
                    drone_positions_xy=drone_positions,
                )
                if warnings:
                    for w in warnings:
                        self._mission_logger.log("assignment_warning", {"message": w})
                final_plan = validated
                assigned_ids = {sid for sids in validated.values() for sid in sids}
                leftover = [s for s in scan_sectors if s.sector_id not in assigned_ids]
                if leftover:
                    fallback = assign_sectors(
                        drone_ids=self._drone_ids,
                        drone_batteries={
                            d: drone_batts[d] - sum(
                                self._sectors_by_id[sid].battery_cost
                                for sid in final_plan.get(d, [])
                            )
                            for d in self._drone_ids
                        },
                        scan_sectors=leftover,
                        drone_positions_xy=drone_positions,
                    )
                    for d, sids in fallback.items():
                        final_plan.setdefault(d, []).extend(sids)
            else:
                final_plan = assign_sectors(
                    drone_ids=self._drone_ids,
                    drone_batteries=drone_batts,
                    scan_sectors=scan_sectors,
                    drone_positions_xy=drone_positions,
                )

            # Load sector queues
            for d_id, sector_ids in final_plan.items():
                self._drone_sector_queue[d_id] = deque(sector_ids)

            await self._emit("sector_assignments", {
                "assignments": final_plan,
                "reasoning":   getattr(plan, "reasoning", "Greedy nearest-first fallback."),
            })

            return plan

        except Exception as e:
            logger.error("supervisor.plan() failed: %s", e)
            await self._emit("error", {"phase": "plan", "error": str(e)})
            return None

    async def _phase_monitor(self, round_num: int) -> Optional[SupervisorPlan]:
        """Supervisor reviews round results. Emits supervisor_cot."""
        try:
            monitor = await self.supervisor.monitor(
                already_redistributed=list(self._redistributed) if self._redistributed else None
            )
            await self._emit("supervisor_cot", {
                "phase":        monitor.phase,
                "round":        round_num,
                "reasoning":    monitor.reasoning,
                "failed_drones": monitor.failed_drones,
            })
            return monitor
        except Exception as e:
            logger.error("supervisor.monitor() round %d failed: %s", round_num, e)
            return None

    async def _phase_complete(self) -> Optional[MissionSummary]:
        """Supervisor generates final mission report. Emits mission_complete."""
        try:
            summary = await self.supervisor.summarise()
            await self._emit("mission_complete", {
                "rounds_completed":    summary.rounds_completed,
                "sectors_swept":       summary.sectors_swept,
                "survivors_found":     summary.survivors_found,
                "survivor_tile_ids":   summary.survivor_tile_ids,
                "failed_drones":       summary.failed_drones,
                "self_healing_triggered": summary.self_healing_triggered,
                "narrative":           summary.narrative,
                "reasoning":           summary.reasoning,
            })
            logger.info("Mission complete | narrative=%s", summary.narrative)
            return summary
        except Exception as e:
            logger.error("supervisor.summarise() failed: %s", e)
            await self._emit("error", {"phase": "complete", "error": str(e)})
            return None

    # ------------------------------------------------------------------
    # Sweep loop (node-tick-based, replaces round-based _execute_round)
    # ------------------------------------------------------------------

    async def _run_sweep_loop(self) -> None:
        """
        Node-tick-based sweep loop. Every tick, all active drones advance
        one node simultaneously via asyncio.gather. Runs until every drone
        has no remaining sector assignments.
        """
        from backend.config import WAYPOINT_EMIT_DELAY_S, GRID_UPDATE_INTERVAL

        tick = 0

        while True:
            active = [
                (did, drone)
                for did, drone in self.drones.items()
                if did not in self._offline
            ]
            if not active:
                break

            all_idle = all(
                drone.is_sector_complete()
                and not self._drone_sector_queue.get(did)
                for did, drone in active
            )
            if all_idle:
                break

            # ── Advance all drones by one node (parallel) ─────────────────
            async def _tick_drone(did: str, drone) -> None:
                if drone.is_sector_complete():
                    await self._advance_to_next_sector(did, drone, tick)
                    return

                prev_status = drone.status
                step = drone.walk_one_node()
                if step is None:
                    return

                # Track exact node progress for failure resume
                if step is not None:
                    sid = self._drone_current_sector.get(did, -1)
                    if sid >= 0:
                        self._sector_progress[sid] = step["path_index"]

                tile_result = await self._mcp_call("scan_tile", {
                    "drone_id": did,
                    "tile_row": step["tile_row"],
                    "tile_col": step["tile_col"],
                })

                if tile_result.get("survivor_found"):
                    # Attach survivor data directly to the visual step payload
                    _s = tile_result.get("survivor", {})
                    step["survivor_data"] = {
                        "tile_id":        tile_result["tile_id"],
                        "drone_id":       did,
                        "round":          tick,
                        "timestamp":      __import__("datetime").datetime.utcnow().isoformat(),
                        "thermal_reading": _s.get("thermal_reading"),
                        "survivor_profile": {
                            "description":      _s.get("description", ""),
                            "num_people":       _s.get("num_people", 1),
                            "medical_priority": _s.get("medical_priority", "UNKNOWN"),
                            "extraction_notes": _s.get("extraction_notes", ""),
                        },
                    }

                await self._emit("drone_heading", step)

                if (
                    step.get("node_type") == "sweep"
                    and step.get("path_index", 0) % 10 == 0
                    and step.get("path_index", 0) > 0
                ):
                    hdg = step.get("heading_deg", 0)
                    if 45 <= hdg <= 135:
                        wind_note = " | ▶ EASTWARD: +5% speed, +5% battery efficiency"
                    elif 225 <= hdg <= 315:
                        wind_note = " | ◀ WESTWARD: -5% speed, -5% battery efficiency"
                    else:
                        wind_note = ""
                    await self._emit("drone_cot", {
                        "drone_id":  did,
                        "round":     tick,
                        "reasoning": (
                            f"Sweeping Sector {step['sector_id']} — "
                            f"node {step['path_index']}/{step['path_total']} "
                            f"| tile ({step['tile_row']}, {step['tile_col']}) "
                            f"| battery {step['battery']} "
                            f"| heading {hdg:.0f}°"
                            f"{wind_note}"
                        ),
                        "action":    "sweep_progress",
                        "sector_id": step["sector_id"],
                        "status":    "active",
                    })

                if tile_result.get("survivor_found"):
                    await self._emit("drone_cot", {
                        "drone_id":  did,
                        "round":     tick,
                        "reasoning": (
                            f"SURVIVOR DETECTED at tile ({step['tile_row']}, {step['tile_col']}). "
                            f"Thermal: {tile_result.get('survivor', {}).get('thermal_reading', 'N/A')}. "
                            f"Priority: {tile_result.get('survivor', {}).get('medical_priority', 'UNKNOWN')}. "
                            f"Reporting to base. Continuing sweep."
                        ),
                        "action":    "survivor_report",
                        "sector_id": step["sector_id"],
                        "status":    drone.status,
                    })

                if step.get("path_index", 0) % 5 == 0:
                    await self._mcp_call("update_drone_position", {
                        "drone_id":  did,
                        "tile_row":  step["tile_row"],
                        "tile_col":  step["tile_col"],
                        "lat":       step["lat"],
                        "lng":       step["lng"],
                        "battery":   step["battery"],
                        "status":    drone.status,
                        "sector_id": step["sector_id"],
                    })

                if prev_status != "low_battery" and drone.status == "low_battery":
                    await self._emit("drone_cot", {
                        "drone_id":  did,
                        "round":     tick,
                        "reasoning": (
                            f"Battery below threshold ({drone.battery}). "
                            f"Status: LOW BATTERY. Will complete sector {drone._current_sector_id} "
                            f"if feasible, then return to base."
                        ),
                        "action":    "low_battery_flag",
                        "sector_id": step["sector_id"],
                        "status":    "low_battery",
                    })

            await asyncio.gather(*[_tick_drone(did, drone) for did, drone in active])

            # ── Failure injection + redistribution ────────────────────────
            await self._maybe_inject_failure(tick)
            unhandled = self._offline - self._redistributed
            for failed_id in unhandled:
                await self._handle_failure(failed_id, tick)

            # ── Periodic grid_update + stats_update ───────────────────────
            if tick % GRID_UPDATE_INTERVAL == 0:
                await self._mcp_call("advance_mission_round", {})
                snap = await self._mcp_call("get_mission_state", {})
                await self._emit("grid_update", snap)
                survivors_val = snap.get("survivors_found", 0)
                survivors_count = (
                    survivors_val if isinstance(survivors_val, int)
                    else len([s for s in snap.get("survivors", {}).values() if s.get("found")])
                )
                await self._emit("stats_update", {
                    "round_number":    tick,
                    "phase":           "executing",
                    "total_sectors":   snap.get("total_sectors", 0),
                    "sectors_swept":   snap.get("explored_count", 0),
                    "survivors_found": survivors_count,
                    "failed_drones":   list(self._offline),
                    "completed":       snap.get("mission", {}).get("completed", False),
                    "coverage_pct":    snap.get("coverage_pct", 0.0),
                })
                await self._emit_diffs(snap, tick)

            # ── Supervisor monitor every 50 ticks ─────────────────────────
            if tick > 0 and tick % 50 == 0:
                await self._phase_monitor(tick)

            if WAYPOINT_EMIT_DELAY_S > 0:
                await asyncio.sleep(WAYPOINT_EMIT_DELAY_S)

            tick += 1

    async def _emit_transit_nodes(
        self,
        drone_id: str,
        drone,
        from_xy: tuple[float, float],
        to_xy: tuple[float, float],
        node_type: str = "transit",
    ) -> None:
        """
        Compute tile-border-crossing transit nodes from from_xy to to_xy,
        emit one drone_heading per node (skipping from_xy), then update
        drone.current_xy to to_xy.
        """
        import math

        waypoints = compute_transit_nodes(from_xy, to_xy, self._tiles_grid)
        prev_xy = from_xy
        total = len(waypoints) - 1

        for i, (wx, wy) in enumerate(waypoints):
            if i == 0:
                continue
            dist_m = math.hypot(wx - prev_xy[0], wy - prev_xy[1])
            dx = wx - prev_xy[0]
            dy = wy - prev_xy[1]
            heading = (
                (90 - math.degrees(math.atan2(dy, dx))) % 360
                if dist_m > 1e-6 else 0.0
            )
            lat, lng = local_m_to_latlng(wx, wy)
            await self._emit("drone_heading", {
                "drone_id":    drone_id,
                "lat":         lat,
                "lng":         lng,
                "heading_deg": heading,
                "sector_id":   -1,
                "path_index":  i,
                "path_total":  total,
                "dist_m":      dist_m,
                "node_type":   node_type,
                "battery":     drone.battery,
                "tile_row":    int(wy // self._tile_m),
                "tile_col":    int(wx // self._tile_m),
            })
            prev_xy = (wx, wy)

        drone.current_xy = to_xy

    async def _advance_to_next_sector(self, drone_id: str, drone, tick: int) -> None:
        """Handle sector completion and load the next sector for a drone."""

        completed_sid = drone._current_sector_id
        if completed_sid >= 0:
            self._drone_completed_sectors[drone_id].append(completed_sid)
            await self._mcp_call("mark_sector_complete", {
                "drone_id": drone_id, "sector_id": completed_sid,
            })
            queue = self._drone_sector_queue.get(drone_id)
            has_next = bool(queue and len(queue) > 1)
            await self._emit("drone_cot", {
                "drone_id":  drone_id,
                "round":     tick,
                "reasoning": (
                    f"Sector {completed_sid} fully swept. "
                    f"Battery: {drone.battery}. "
                    + (
                        "Proceeding to next sector in queue."
                        if has_next
                        else "All assigned sectors complete. Standing by for RTB."
                    )
                ),
                "action":    "sector_complete",
                "sector_id": completed_sid,
                "status":    drone.status,
            })

        queue = self._drone_sector_queue.get(drone_id)
        if not queue:
            drone._current_sector_id = -1
            return

        # Only pop the completed sector when it is at the front of the queue.
        if queue and queue[0] == completed_sid:
            queue.popleft()

        if not queue:
            # ── DYNAMIC WORK STEALING ──
            stolen_sid = None
            stolen_from = None
            from backend.config import BATTERY_EMERGENCY_RESERVE

            # Sort other drones by busiest (most sectors pending)
            other_drones = [d for d in self._drone_ids if d != drone_id and d not in self._offline]
            other_drones.sort(key=lambda d: len(self._drone_sector_queue.get(d, [])), reverse=True)

            for other_d in other_drones:
                other_q = self._drone_sector_queue.get(other_d, deque())
                if len(other_q) > 1:
                    # Stealable sectors: anything not currently being swept (index 1+)
                    stealable = list(other_q)[1:]
                    # Sort by most expensive first to relieve the most burden
                    stealable.sort(key=lambda sid: self._sectors_by_id[sid].battery_cost, reverse=True)

                    for sid in stealable:
                        cost = self._sectors_by_id[sid].battery_cost
                        if drone.battery - cost >= BATTERY_EMERGENCY_RESERVE:
                            stolen_sid = sid
                            stolen_from = other_d
                            break
                if stolen_sid is not None:
                    break

            if stolen_sid is not None:
                # Execute Steal
                self._drone_sector_queue[stolen_from].remove(stolen_sid)
                self._drone_sector_queue[drone_id].append(stolen_sid)
                queue = self._drone_sector_queue[drone_id]

                stolen_cost = self._sectors_by_id[stolen_sid].battery_cost
                await self._emit("drone_cot", {
                    "drone_id":  drone_id,
                    "round":     tick,
                    "reasoning": (
                        f"Work-steal initiated: {drone_id} is idle with {drone.battery} battery remaining. "
                        f"Scanned {len([d for d in self._drone_ids if d != drone_id and d not in self._offline])} active peers. "
                        f"Stealing Sector {stolen_sid} (cost: {stolen_cost}) from {stolen_from} "
                        f"which had {len(list(self._drone_sector_queue.get(stolen_from, [])))} sectors queued. "
                        f"Battery after steal: ~{drone.battery - stolen_cost}."
                    ),
                    "action":    "work_steal",
                    "sector_id": stolen_sid,
                    "status":    "active",
                })

                await self._emit("supervisor_cot", {
                    "phase": "executing",
                    "round": tick,
                    "reasoning": f"WORK STEALING: {drone_id} is idle. Stealing Sector {stolen_sid} from {stolen_from} to balance the load.",
                })

                # Broadcast the new ownership to the frontend so the UI updates
                # the sector color and correctly tracks the new drone for the sweep animation.
                await self._emit("sector_assignments", {
                    "assignments": self._full_assignments,
                    "reasoning": f"Dynamic Work Stealing: {drone_id} took over Sector {stolen_sid} from {stolen_from}."
                })
            else:
                # ── RTB PROTOCOL (No work to steal) ──
                if drone.status in ("rtb", "idle"):
                    return
                drone._current_sector_id = -1

                bx = BASE_TILE_COL * TILE_M + TILE_M / 2
                by = BASE_TILE_ROW * TILE_M + TILE_M / 2
                off = {"DRONE_A": (0.0, 0.0), "DRONE_B": (8.0, 0.0), "DRONE_C": (-8.0, 0.0)}.get(drone_id, (0.0, 0.0))
                base_xy = (bx + off[0], by + off[1])

                import math
                dist = math.hypot(drone.current_xy[0] - base_xy[0], drone.current_xy[1] - base_xy[1])
                if dist > 1.0:
                    drone.status = "rtb"
                    await self._emit_transit_nodes(
                        drone_id, drone,
                        from_xy=drone.current_xy,
                        to_xy=base_xy,
                        node_type="transit"
                    )

                    base_lat, base_lng = local_m_to_latlng(*base_xy)
                    await self._emit("drone_heading", {
                        "drone_id":    drone_id,
                        "lat":         base_lat,
                        "lng":         base_lng,
                        "heading_deg": 0.0,
                        "sector_id":   -1,
                        "path_index":  0,
                        "path_total":  0,
                        "dist_m":      0.0,
                        "node_type":   "parking",
                        "battery":     drone.battery,
                        "tile_row":    int(base_xy[1] // self._tile_m),
                        "tile_col":    int(base_xy[0] // self._tile_m),
                    })

                    await self._emit("drone_cot", {
                        "drone_id": drone_id,
                        "round": tick,
                        "reasoning": "All assigned sectors complete. Initiating Return To Base (RTB) protocol.",
                        "action": "rtb",
                        "sector_id": -1,
                        "status": "rtb"
                    })
                else:
                    drone.status = "idle"
                return

        import math
        current_xy = drone.current_xy

        # DYNAMIC CLOSEST-SECTOR SELECTION
        # Evaluate all pending sectors in the queue and pick the physically closest one
        best_sid = None
        best_dist = float('inf')

        for sid in list(queue):
            resume_idx = self._sector_progress.get(sid, 0)
            sec = self._sectors_by_id[sid]

            if resume_idx > 0 and sid in self._sector_resume_xy:
                # Orphaned Sector: Evaluate distance to the failure node OR the final node
                fn_idx = min(resume_idx, len(sec.sweep_nodes) - 1)
                fn = sec.sweep_nodes[fn_idx]
                ln = sec.sweep_nodes[-1]
                d1 = math.hypot(fn["x_m"] - current_xy[0], fn["y_m"] - current_xy[1])
                d2 = math.hypot(ln["x_m"] - current_xy[0], ln["y_m"] - current_xy[1])
                dist = min(d1, d2)
            else:
                # Fresh Sector: Evaluate distance to nearest anchor
                anchors = [n for n in sec.sweep_nodes if n["type"] == "anchor"]
                if not anchors:
                    anchors = sec.sweep_nodes[:1]
                dist = min(math.hypot(n["x_m"] - current_xy[0], n["y_m"] - current_xy[1]) for n in anchors)

            if dist < best_dist:
                best_dist = dist
                best_sid = sid

        # Move the dynamically chosen closest sector to the front of the queue
        if best_sid is not None and best_sid != queue[0]:
            queue.remove(best_sid)
            queue.appendleft(best_sid)

            # THE FIX: Inform frontend of the queue change to prevent visual flashing
            await self._emit("sector_assignments", {
                "assignments": self._full_assignments,
                "reasoning": f"Dynamically re-routed {drone_id} to closest sector {best_sid}."
            })

        if best_sid is not None and len(list(queue)) > 1:
            candidates = []
            for sid in list(queue):
                sec = self._sectors_by_id[sid]
                anchors = [n for n in sec.sweep_nodes if n["type"] == "anchor"] or sec.sweep_nodes[:1]
                import math as _math
                d = min(_math.hypot(n["x_m"] - current_xy[0], n["y_m"] - current_xy[1]) for n in anchors) if anchors else 0
                candidates.append(f"S{sid}:{d:.0f}m")

            await self._emit("drone_cot", {
                "drone_id":  drone_id,
                "round":     tick,
                "reasoning": (
                    f"Closest-sector algorithm evaluated {len(candidates)} candidates: [{', '.join(candidates)}]. "
                    f"Selected Sector {best_sid} as nearest entry point ({best_dist:.0f}m away). "
                    f"Initiating transit."
                ),
                "action":    "sector_routing",
                "sector_id": best_sid if best_sid is not None else -1,
                "status":    "active",
            })

        next_sid = queue[0]
        sector = self._sectors_by_id[next_sid]

        # ── Dynamic transit: tile-border-crossing nodes to nearest anchor ─────
        current_xy = drone.current_xy

        resume_idx = self._sector_progress.get(next_sid, 0)

        # ── ORPHANED SECTOR ROUTING ──
        if resume_idx > 0 and next_sid in self._sector_resume_xy:
            # Only valid entry points are the failure node or the very end of the path
            fn_idx = min(resume_idx, len(sector.sweep_nodes) - 1)
            fn = sector.sweep_nodes[fn_idx]
            ln = sector.sweep_nodes[-1]

            d1 = math.hypot(fn["x_m"] - current_xy[0], fn["y_m"] - current_xy[1])
            d2 = math.hypot(ln["x_m"] - current_xy[0], ln["y_m"] - current_xy[1])

            if d2 < d1:
                # The end of the sector is closer! Fly to the end and sweep in reverse down to the failure point.
                to_xy = (ln["x_m"], ln["y_m"])
                await self._emit_transit_nodes(drone_id, drone, from_xy=current_xy, to_xy=to_xy, node_type="transit")
                drone.load_sector(sector, resume_index=resume_idx, reverse=True)
                self._sector_reverse[next_sid] = True
                reverse = True
            else:
                # The failure point is closer! Fly there and sweep forward.
                to_xy = (fn["x_m"], fn["y_m"])
                await self._emit_transit_nodes(drone_id, drone, from_xy=current_xy, to_xy=to_xy, node_type="transit")
                drone.load_sector(sector, resume_index=resume_idx, reverse=False)
                self._sector_reverse[next_sid] = False
                reverse = False

            import math as _math
            chosen_approach = "end-first (reverse sweep)" if d2 < d1 else "failure-point-first (forward sweep)"
            await self._emit("drone_cot", {
                "drone_id":  drone_id,
                "round":     tick,
                "reasoning": (
                    f"Orphaned sector {next_sid} routing: "
                    f"failure node at {d1:.0f}m, sector end at {d2:.0f}m. "
                    f"Chosen approach: {chosen_approach}. "
                    f"Resuming from waypoint {resume_idx}/{len(sector.sweep_nodes)} "
                    f"({round(resume_idx / max(len(sector.sweep_nodes), 1) * 100, 1)}% already scanned)."
                ),
                "action":    "orphan_routing",
                "sector_id": next_sid,
                "status":    "active",
            })

            self._drone_current_sector[drone_id] = next_sid
            del self._sector_resume_xy[next_sid]
            _did_load = True

        else:
            # ── FRESH SECTOR ROUTING ──
            anchors = [n for n in sector.sweep_nodes if n["type"] == "anchor"]
            if not anchors:
                anchors = sector.sweep_nodes[:1]

            if anchors:
                nearest_anchor = min(
                    anchors,
                    key=lambda n: math.hypot(
                        n["x_m"] - current_xy[0],
                        n["y_m"] - current_xy[1]
                    )
                )
                to_xy = (nearest_anchor["x_m"], nearest_anchor["y_m"])
                await self._emit_transit_nodes(
                    drone_id, drone,
                    from_xy=current_xy,
                    to_xy=to_xy,
                    node_type="transit",
                )
                reverse = len(anchors) >= 2 and nearest_anchor == anchors[-1]
                self._sector_reverse[next_sid] = reverse
                _did_load = False
            else:
                reverse = False
                self._sector_reverse[next_sid] = reverse
                _did_load = False

        if not _did_load:
            drone.load_sector(sector, reverse=reverse)
            self._drone_current_sector[drone_id] = next_sid

        await self._emit("drone_cot", {
            "drone_id":  drone_id,
            "round":     tick,
            "reasoning": (
                f"Beginning sweep of Sector {next_sid}. "
                f"Path: {sector.sweep_path_length_m:.0f}m, "
                f"{len(drone._current_nodes)} nodes. "
                f"Battery: {drone.battery}. "
                f"Entry: {'reversed (end-first)' if reverse else 'forward (start-first)'}."
            ),
            "action":    "sweep_start",
            "sector_id": next_sid,
            "status":    drone.status,
        })

    # ------------------------------------------------------------------
    # Failure injection
    # ------------------------------------------------------------------

    async def _maybe_inject_failure(self, round_num: int) -> None:
        """Inject a drone failure if scheduled or API-triggered."""
        target: Optional[str] = None
        trigger = "api"

        if self.pending_failure and self.pending_failure not in self._offline:
            target = self.pending_failure
            self.pending_failure = None
            logger.info("Round %d: API-triggered failure for %s", round_num, target)
        elif (
            self.failure_round > 0
            and round_num == self.failure_round
            and "DRONE_C" not in self._offline
        ):
            target = "DRONE_C"
            trigger = "scheduled"
            logger.info("Round %d: Scheduled failure for DRONE_C", round_num)

        if target:
            result = await self._mcp_call("inject_drone_failure", {"drone_id": target})
            self._offline.add(target)
            await self._emit("failure_event", {
                "round":         round_num,
                "drone_id":      target,
                "orphaned_cells": result.get("orphaned_cells", []),
                "trigger":       trigger,
                "failure_xy":    list(self.drones[target].current_xy) if target in self.drones else None,
            })

    # ------------------------------------------------------------------
    # Self-healing
    # ------------------------------------------------------------------

    async def _handle_failure(self, failed_drone_id: str, tick: int) -> None:
        """
        Terrain-aware self-healing: redistribute orphaned sectors to surviving
        drones, resuming partial sweeps from the exact failure waypoint.
        """
        if failed_drone_id not in self._offline:
            self._offline.add(failed_drone_id)

        failed_drone_obj = self.drones.get(failed_drone_id)
        if failed_drone_obj:
            _last_col = min(int(failed_drone_obj.current_xy[0] / self._tile_m), GRID_N - 1)
            _last_row = min(int(failed_drone_obj.current_xy[1] / self._tile_m), GRID_N - 1)
            _last_batt = failed_drone_obj.battery
        else:
            _last_row, _last_col, _last_batt = "?", "?", "?"

        await self._emit("drone_cot", {
            "drone_id":  failed_drone_id,
            "round":     tick,
            "reasoning": (
                f"{failed_drone_id} OFFLINE. "
                f"Last known position: tile ({_last_row}, {_last_col}). "
                f"Battery at failure: {_last_batt}. "
                f"Telemetry lost. Self-healing protocol initiated."
            ),
            "action":    "drone_offline",
            "sector_id": self._drone_current_sector.get(failed_drone_id, -1),
            "status":    "offline",
        })

        current_sector_id = self._drone_current_sector.get(failed_drone_id, -1)

        orphaned: list[int] = []
        partial_resume: dict[int, int] = {}

        if 0 <= current_sector_id < 1000:
            resume_index = self._sector_progress.get(current_sector_id, 0)
            orphaned.append(current_sector_id)
            partial_resume[current_sector_id] = resume_index
            sec = self._sectors_by_id[current_sector_id]
            total_wps = len(sec.sweep_nodes)
            pct_done  = round(resume_index / max(total_wps, 1) * 100, 1)

            # Store resume node xy so _advance_to_next_sector can transit directly
            # to the failure point rather than the nearest anchor.
            if resume_index < len(sec.sweep_nodes):
                rn = sec.sweep_nodes[resume_index]
                self._sector_resume_xy[current_sector_id] = (rn["x_m"], rn["y_m"])
            elif sec.sweep_nodes:
                rn = sec.sweep_nodes[-1]
                self._sector_resume_xy[current_sector_id] = (rn["x_m"], rn["y_m"])
        else:
            resume_index = 0
            total_wps    = 0
            pct_done     = 0.0

        # Skip queue[0] if it equals current_sector_id to avoid adding it twice.
        # (queue[0] is still the in-progress sector since it hasn't been popped yet.)
        _queue_list = list(self._drone_sector_queue.get(failed_drone_id, []))
        if _queue_list and 0 <= current_sector_id < 1000 and _queue_list[0] == current_sector_id:
            _queue_list = _queue_list[1:]
        orphaned.extend(_queue_list)

        if not orphaned:
            logger.info(
                "%s failed but had no orphaned sectors (all already completed)",
                failed_drone_id,
            )
            self._redistributed.add(failed_drone_id)
            return

        logger.info(
            "Self-healing: %s offline, orphaned sectors: %s",
            failed_drone_id, orphaned,
        )

        surviving = [
            d for d in self._drone_ids
            if d != failed_drone_id and d not in self._offline
        ]

        # Calculate True Spare Capacity: Raw battery minus committed queue costs
        surv_batts = {}
        for d in surviving:
            batt = self.drones[d].battery
            for sid in self._drone_sector_queue.get(d, []):
                if sid == self._drone_current_sector.get(d, -1):
                    idx = self._sector_progress.get(sid, 0)
                    batt -= _remaining_battery_cost(self._sectors_by_id[sid], idx)
                else:
                    batt -= self._sectors_by_id[sid].battery_cost
            surv_batts[d] = batt

        surv_positions = {d: self._get_drone_xy(d)  for d in surviving}

        new_assignments = replan_after_failure(
            failed_drone_id=failed_drone_id,
            surviving_drones=surviving,
            surviving_batteries=surv_batts,
            orphaned_sector_ids=orphaned,
            all_sectors_by_id=self._sectors_by_id,
            drone_positions_xy=surv_positions,
            partial_sector_resume=partial_resume,
            resume_positions=self._sector_resume_xy,
        )

        # Apply new sector assignments to survivor queues
        for drone_id, new_sector_ids in new_assignments.items():
            existing = list(self._drone_sector_queue.get(drone_id, []))
            # Just append the new sectors! The survivor will finish its current sector naturally,
            # then _advance_to_next_sector will smoothly transition to the next closest sector.
            self._drone_sector_queue[drone_id] = deque(existing + new_sector_ids)

        # Clean up failed drone state
        self._drone_sector_queue[failed_drone_id] = deque()
        self._drone_current_sector[failed_drone_id] = -1

        pct_remain = round(100 - pct_done, 1)
        self._redistributed.add(failed_drone_id)

        redist_lines = []
        for d, sids in new_assignments.items():
            spare = surv_batts.get(d, 0)
            total_cost = sum(self._sectors_by_id[s].battery_cost for s in sids)
            redist_lines.append(
                f"{d}: assigned orphaned sectors {sids} "
                f"(cost {total_cost}, spare capacity {spare})"
            )

        await self._emit("supervisor_cot", {
            "phase": "redistribute",
            "round": tick,
            "reasoning": (
                f"SELF-HEALING ALGORITHM — {failed_drone_id} lost.\n"
                f"Orphaned sectors: {orphaned}\n"
                f"Surviving drones: {surviving}\n"
                f"Spare battery capacities: { {d: surv_batts[d] for d in surviving} }\n"
                f"Redistribution (nearest-first, battery-feasible):\n"
                + "\n".join(f"  {line}" for line in redist_lines) +
                f"\nPartial sector {current_sector_id} resume point: waypoint {resume_index}/{total_wps} ({pct_done}% complete)."
                if current_sector_id >= 0 else ""
            ),
        })

        await self._emit("supervisor_cot", {
            "phase": "redistribute",
            "round": tick,
            "reasoning": f"CRITICAL FAULT: Lost telemetry for {failed_drone_id}. Triggering instantaneous local redistribution. Orphaned sectors {orphaned} assigned to {surviving} to maintain continuous sweep operations.",
            "assignments": new_assignments
        })

        await self._emit("recovery_event", {
            "failed_drone_id":          failed_drone_id,
            "partial_sector_id":        current_sector_id if current_sector_id >= 0 else None,
            "resume_index":             resume_index,
            "total_waypoints":          total_wps,
            "pct_done_by_failed_drone": pct_done,
            "pct_remaining":            pct_remain,
            "new_assignments":          new_assignments,
            "reasoning": (
                f"Drone {failed_drone_id} failed"
                + (f" mid-sweep of Sector {current_sector_id} "
                   f"({resume_index}/{total_wps} waypoints = {pct_done}% done, "
                   f"{pct_remain}% remaining)" if current_sector_id >= 0 else "")
                + ". Resuming from exact failure point — zero rescan."
            ),
        })
        logger.info("Self-healing complete | new_assignments=%s", new_assignments)

    # ------------------------------------------------------------------
    # Derived event diffing
    # ------------------------------------------------------------------

    async def _emit_diffs(self, new_snap: dict, round_num: int) -> None:
        """
        Compare new mission snapshot against the previous round's snapshot.
        Emits comms_lost / comms_restored derived events.
        survivor_alert is emitted directly in _execute_round, not here.
        """
        new_comms    = new_snap.get("communication_network", {})
        new_reachable = set(new_comms.get("reachable_from_base", []))
        drones_snap  = new_snap.get("drones", {})

        if self._last_grid_state is not None:
            for drone_id in self._last_comms_reachable - new_reachable:
                d = drones_snap.get(drone_id, {})
                await self._emit("comms_lost", {
                    "drone_id": drone_id,
                    "round":    round_num,
                    "tile_row": d.get("tile_row"),
                    "tile_col": d.get("tile_col"),
                })
            for drone_id in new_reachable - self._last_comms_reachable:
                d = drones_snap.get(drone_id, {})
                await self._emit("comms_restored", {
                    "drone_id": drone_id,
                    "round":    round_num,
                    "tile_row": d.get("tile_row"),
                    "tile_col": d.get("tile_col"),
                })

        self._last_comms_reachable = new_reachable
        self._last_grid_state = new_snap

    # ------------------------------------------------------------------
    # Event emission and MCP calls
    # ------------------------------------------------------------------

    async def _mcp_call(self, tool: str, args: dict) -> dict:
        """Open a short-lived MCP client, call one tool, return the result dict."""
        from fastmcp import Client
        from drone_agent import _extract_tool_result
        async with Client(self.mcp_url) as mcp:
            result = await mcp.call_tool(tool, args)
            return _extract_tool_result(result)

    async def _emit(self, event_type: str, data: dict) -> None:
        """Put an event on the SSE queue and log it. Never raises."""
        self._mission_logger.log(event_type, data)
        if self._event_queue is None:
            return
        try:
            await self._event_queue.put({"type": event_type, "data": data})
        except Exception as e:
            logger.warning("Failed to emit event %s: %s", event_type, e)
