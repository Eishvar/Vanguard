"""
supervisor.py — SupervisorAgent class.

The supervisor makes LLM calls for four mission phases:

  plan()      — discover fleet, assess sectors, assign sector IDs to drones
  monitor()   — per-round review after drone execution
  summarise() — generate final mission report at completion

redistribute() is kept as a stub; the orchestrator handles actual sector
redistribution algorithmically via replan_after_failure().
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastmcp import Client

from drone_agent import _extract_tool_result
from llm_client import ModelRole, llm_call
from prompts import (
    SUPERVISOR_SYSTEM_PROMPT,
    SUPERVISOR_MONITOR_PROMPT_TEMPLATE,
    SUPERVISOR_SUMMARY_PROMPT_TEMPLATE,
)
from schemas import MissionSummary, RedistributionPlan, SupervisorPlan

logger = logging.getLogger(__name__)

# CC-2: import from shared config instead of duplicating the constant
import sys as _sys, os as _os
_BACKEND_DIR = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
if _BACKEND_DIR not in _sys.path:
    _sys.path.insert(0, _BACKEND_DIR)

from config import MCP_URL, BATTERY_MAX_TERRAIN, BATTERY_RTB_RESERVE


# ---------------------------------------------------------------------------
# SupervisorAgent
# ---------------------------------------------------------------------------

class SupervisorAgent:
    """
    Mission supervisor. One instance per mission run, reused across all phases.
    Uses a fresh async with Client(...) per method call.
    """

    def __init__(
        self,
        mcp_url: str = MCP_URL,
        role: ModelRole = ModelRole.SUPERVISOR,
    ) -> None:
        self.mcp_url = mcp_url
        self.role = role

        self.last_plan: Optional[SupervisorPlan] = None
        self.last_redistribution: Optional[RedistributionPlan] = None
        self.last_summary: Optional[MissionSummary] = None

        # Populated by orchestrator after build_terrain_model()
        self._sectors: list = []

    # ------------------------------------------------------------------
    # Phase 1+2: Discovery + Planning
    # ------------------------------------------------------------------

    async def plan(self) -> SupervisorPlan:
        """
        Discover the fleet and assign terrain sector IDs to each drone.

        MCP reads:  discover_drones
        LLM call:   SupervisorPlan (phase='plan', sector_assignments=...)
        MCP writes: none (orchestrator handles queue loading)
        """
        async with Client(self.mcp_url) as mcp:
            discovery_result = await mcp.call_tool("discover_drones", {})
            discovery = _extract_tool_result(discovery_result)

            logger.info(
                "Supervisor planning | drones=%s",
                [d["drone_id"] for d in discovery.get("drones", [])],
            )

            # Build sector summary from self._sectors (populated by orchestrator)
            budget = BATTERY_MAX_TERRAIN - BATTERY_RTB_RESERVE
            from backend.terrain import local_m_to_latlng
            sectors_summary = []
            scan_ids = []
            for s in self._sectors:
                if s.is_obstacle:
                    continue
                scan_ids.append(s.sector_id)
                clat, clng = local_m_to_latlng(s.centroid[0], s.centroid[1])
                sectors_summary.append({
                    "sector_id":    s.sector_id,
                    "n_tiles":      len(s.tiles),
                    "area_km2":     round(s.area_km2, 3),
                    "avg_elev_m":   s.avg_elevation_m,
                    "avg_density":  s.avg_density,
                    "battery_cost": s.battery_cost,
                    "centroid_lat": round(clat, 4),
                    "centroid_lng": round(clng, 4),
                })

            sectors_lines = "\n".join(
                "  {:<9} | {:<5} | {:<8.3f} | {:<8.0f}m | {:<11.4f} | {:<12} | ({:.4f}, {:.4f})".format(
                    s["sector_id"], s["n_tiles"], s["area_km2"],
                    s["avg_elev_m"], s["avg_density"], s["battery_cost"],
                    s["centroid_lat"], s["centroid_lng"],
                )
                for s in sectors_summary
            )
            drone_ids = [d["drone_id"] for d in discovery.get("drones", [])]

            user_prompt = (
                "MISSION START — Sector Assignment\n\n"
                f"Drones discovered: {drone_ids}\n"
                "All drones start at base station tile (row=0, col=0).\n\n"
                f"Scan sector IDs available: {sorted(scan_ids)}\n\n"
                "AVAILABLE SCAN SECTORS:\n"
                "  sector_id | tiles | area_km² | avg_elev  | avg_density | battery_cost | centroid(lat,lng)\n"
                "  ----------+-------+----------+-----------+-------------+--------------+------------------\n"
                f"{sectors_lines}\n\n"
                f"Battery budget per drone: {budget} units "
                f"(BATTERY_MAX={BATTERY_MAX_TERRAIN}, RTB_reserve={BATTERY_RTB_RESERVE})\n\n"
                "Assign sector_assignments: a dict mapping each drone_id to a list of sector IDs. "
                "Every scan sector must appear in exactly one drone's list. "
                "Prefer geographically contiguous sectors per drone. "
                "Keep each drone's total battery_cost under the budget."
            )

            plan: SupervisorPlan = await llm_call(
                role=self.role,
                system_prompt=SUPERVISOR_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                schema=SupervisorPlan,
            )

            logger.info(
                "Supervisor plan complete | sector_assignments=%s",
                plan.sector_assignments,
            )

        self.last_plan = plan
        return plan

    # ------------------------------------------------------------------
    # Phase 3: Per-round monitoring
    # ------------------------------------------------------------------

    async def monitor(self, already_redistributed: list[str] | None = None) -> SupervisorPlan:
        """
        Review round results and decide whether intervention is needed.

        MCP reads:  get_all_drone_statuses, get_mission_state
        LLM call:   SupervisorPlan (phase='monitor' | 'redistribute' | 'complete')
        MCP writes: none
        """
        async with Client(self.mcp_url) as mcp:
            statuses_result, snap_result = await asyncio.gather(
                mcp.call_tool("get_all_drone_statuses", {}),
                mcp.call_tool("get_mission_state", {}),
            )
            all_statuses = _extract_tool_result(statuses_result)
            mission_snap = _extract_tool_result(snap_result)

            # Build sectors_status string
            swept = mission_snap.get("swept_sectors", [])
            total = mission_snap.get("total_sectors", 0)
            coverage = mission_snap.get("coverage_pct", 0.0)
            remaining = [sid for sid in range(total) if sid not in swept]
            sectors_status = (
                f"Swept: {swept} ({mission_snap.get('explored_count', 0)}/{total}, "
                f"{coverage:.1f}%). Remaining: {remaining}."
            )

            # Build drone_statuses string
            drones_snap = mission_snap.get("drones", {})
            comm_net = mission_snap.get("communication_network", {})
            drone_lines = []
            for did, d in drones_snap.items():
                drone_lines.append(
                    f"  {did}: battery={d.get('battery', 0)}, "
                    f"status={d.get('status', 'unknown')}, "
                    f"sector={d.get('sector_id', -1)}, "
                    f"tile=({d.get('tile_row', 0)}, {d.get('tile_col', 0)})"
                )
            if already_redistributed:
                drone_lines.append(
                    f"  Already redistributed (no further action): {already_redistributed}"
                )
            drone_lines.append(
                f"  Mesh — connected: {comm_net.get('reachable_from_base', [])}, "
                f"isolated: {comm_net.get('isolated', [])}"
            )
            drone_statuses = "\n".join(drone_lines)

            logger.debug(
                "Supervisor monitoring | coverage=%d/%d | failed=%s",
                mission_snap.get("explored_count", 0),
                total,
                all_statuses.get("failed_drones", []),
            )

            user_prompt = SUPERVISOR_MONITOR_PROMPT_TEMPLATE(sectors_status, drone_statuses)

            plan: SupervisorPlan = await llm_call(
                role=self.role,
                system_prompt=SUPERVISOR_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                schema=SupervisorPlan,
            )

            logger.info(
                "Supervisor monitor | phase=%s | reasoning=%s",
                plan.phase,
                plan.reasoning[:120],
            )

        self.last_plan = plan
        return plan

    # ------------------------------------------------------------------
    # Phase 5: Self-healing redistribution (stub — orchestrator handles algorithmically)
    # ------------------------------------------------------------------

    async def redistribute(
        self,
        failed_drone_id: str,
        orphaned_cells: list[str],
    ) -> RedistributionPlan:
        """
        No longer called — sector redistribution is handled algorithmically
        by replan_after_failure() in the orchestrator's _handle_failure().
        Kept as a stub for API compatibility.
        """
        logger.info(
            "supervisor.redistribute() called for %s (stub — no-op)",
            failed_drone_id,
        )
        # model_construct skips Pydantic validators — needed here since new_assignments is empty
        plan = RedistributionPlan.model_construct(
            reasoning=(
                "Redistribution delegated to algorithmic planner. "
                f"Drone {failed_drone_id} orphaned cells handled by replan_after_failure()."
            ),
            failed_drone_id=failed_drone_id,
            new_assignments={},
        )
        self.last_redistribution = plan
        return plan

    # ------------------------------------------------------------------
    # Phase 6: Mission summary
    # ------------------------------------------------------------------

    async def summarise(self) -> MissionSummary:
        """
        Generate the final mission report once all sectors are swept.

        MCP reads:  get_mission_status, get_all_drone_statuses, get_mission_state
        LLM call:   MissionSummary
        MCP writes: none
        """
        async with Client(self.mcp_url) as mcp:
            mission_result, statuses_result, snap_result = await asyncio.gather(
                mcp.call_tool("get_mission_status", {}),
                mcp.call_tool("get_all_drone_statuses", {}),
                mcp.call_tool("get_mission_state", {}),
            )
            mission_status = _extract_tool_result(mission_result)
            all_statuses   = _extract_tool_result(statuses_result)
            mission_snap   = _extract_tool_result(snap_result)

            survivors_snap = mission_snap.get("survivors", {})
            survivor_tile_ids = [
                tid for tid, s in survivors_snap.items() if s.get("found")
            ]

            logger.info(
                "Supervisor generating summary | rounds=%s | sectors=%d/%d | survivors=%d",
                mission_status.get("round_number"),
                mission_snap.get("explored_count", 0),
                mission_snap.get("total_sectors", 0),
                len(survivor_tile_ids),
            )

            user_prompt = SUPERVISOR_SUMMARY_PROMPT_TEMPLATE(
                sectors_swept=mission_snap.get("explored_count", 0),
                total_sectors=mission_snap.get("total_sectors", 0),
                survivors=survivor_tile_ids,
                rounds=mission_status.get("round_number", 0),
                failed_drones=all_statuses.get("failed_drones", []),
            )

            summary: MissionSummary = await llm_call(
                role=self.role,
                system_prompt=SUPERVISOR_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                schema=MissionSummary,
            )

            logger.info("Mission summary | narrative=%s", summary.narrative)

        self.last_summary = summary
        return summary
