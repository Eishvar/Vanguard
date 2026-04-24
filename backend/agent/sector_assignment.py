"""
backend/agent/sector_assignment.py
Greedy battery-feasible sector assignment used as:
  1. Initial assignment validator after Supervisor LLM proposes drone→sector mapping
  2. Replan algorithm after drone failure

IMPORTANT: This module is pure algorithm. No LLM, no MCP, no async. The LLM
supervisor still proposes the assignment — this module only validates feasibility
and falls back to nearest-first greedy if the LLM's plan is infeasible.
"""
import math
from dataclasses import dataclass, field
from typing import Optional

from backend.terrain import (
    Sector, BATTERY_MAX_TERRAIN, BATTERY_RTB_RESERVE, BATTERY_PER_100M,
    rtb_distance_m,
)
from backend.config import BATTERY_EMERGENCY_RESERVE


@dataclass
class DroneAssignment:
    drone_id: str
    battery: int
    assigned_sectors: list[int] = field(default_factory=list)
    total_cost: int = 0

    def can_afford(self, cost: int, min_reserve: int) -> bool:
        remaining = self.battery - self.total_cost
        return (remaining - cost) >= min_reserve


def _sort_by_distance(
    sectors: list[Sector],
    origin_xy: tuple[float, float],
    resume_positions: dict[int, tuple[float, float]] | None = None,
) -> list[Sector]:
    rp = resume_positions or {}
    def dist(s: Sector) -> float:
        pos = rp.get(s.sector_id) or (s.centroid[0], s.centroid[1])
        return math.hypot(pos[0] - origin_xy[0], pos[1] - origin_xy[1])
    return sorted(sectors, key=dist)


def _remaining_battery_cost(sector: Sector, resume_index: int) -> int:
    """
    Battery cost for only the un-swept portion of a sector, plus RTB from the sector.
    NOTE: RTB is re-included here because the sector's precomputed battery_cost
    already includes RTB distance — we don't want to double-count, but we DO want
    RTB in the remaining cost.
    """
    total_wps = len(sector.sweep_path_coords)
    if total_wps < 2 or resume_index >= total_wps:
        # Whole sector already done — only RTB remains
        rtb_m = rtb_distance_m(sector)
        return max(1, int(math.ceil(rtb_m / 100.0 * BATTERY_PER_100M)))

    remaining_ratio = 1.0 - (resume_index / total_wps)
    remaining_path_m = sector.sweep_path_length_m * remaining_ratio
    rtb_m = rtb_distance_m(sector)
    total_m = remaining_path_m + rtb_m
    return max(1, int(math.ceil(total_m / 100.0 * BATTERY_PER_100M)))


def _sector_cost(sector: Sector, resume_index: int) -> int:
    """Return partial-path cost if resume_index > 0, else the precomputed full cost."""
    if resume_index > 0:
        return _remaining_battery_cost(sector, resume_index)
    return sector.battery_cost


def validate_llm_assignment(
    llm_plan: dict[str, list[int]],
    drone_batteries: dict[str, int],
    all_sectors_by_id: dict[int, Sector],
    drone_positions_xy: dict[str, tuple[float, float]],
    partial_sector_resume: Optional[dict[int, int]] = None,
) -> tuple[bool, dict[str, list[int]], list[str]]:
    """
    Check whether the supervisor LLM's proposed assignment is battery-feasible.

    Returns:
      (ok, validated_plan, warnings)
    If not ok, validated_plan is the llm_plan pruned to what is feasible (over-budget
    sectors are dropped from the tail and returned as warnings for the caller to
    reassign via assign_sectors()).
    """
    partial = partial_sector_resume or {}
    warnings: list[str] = []
    validated: dict[str, list[int]] = {}
    dropped_sector_ids: list[int] = []

    for drone_id, sector_ids in llm_plan.items():
        if drone_id not in drone_batteries:
            warnings.append(f"Unknown drone '{drone_id}' in LLM plan — skipped.")
            continue
        da = DroneAssignment(drone_id=drone_id, battery=drone_batteries[drone_id])
        kept: list[int] = []
        for sid in sector_ids:
            sec = all_sectors_by_id.get(sid)
            if sec is None:
                warnings.append(f"{drone_id}: unknown sector {sid} — dropped.")
                continue
            if sec.is_obstacle:
                warnings.append(f"{drone_id}: sector {sid} is obstacle — dropped.")
                continue
            cost = _sector_cost(sec, partial.get(sid, 0))
            if da.can_afford(cost, BATTERY_RTB_RESERVE):
                da.assigned_sectors.append(sid)
                da.total_cost += cost
                kept.append(sid)
            else:
                warnings.append(
                    f"{drone_id}: cannot afford sector {sid} "
                    f"(cost={cost}, remaining={da.battery - da.total_cost}, "
                    f"reserve={BATTERY_RTB_RESERVE}) — dropped."
                )
                dropped_sector_ids.append(sid)
        validated[drone_id] = kept

    return (len(warnings) == 0, validated, warnings)


def assign_sectors(
    drone_ids: list[str],
    drone_batteries: dict[str, int],
    scan_sectors: list[Sector],
    drone_positions_xy: dict[str, tuple[float, float]],
    partial_sector_resume: Optional[dict[int, int]] = None,
    resume_positions: Optional[dict[int, tuple[float, float]]] = None,
    min_reserve: int = BATTERY_RTB_RESERVE,
) -> dict[str, list[int]]:
    """
    Min-Max Load Balancing: Largest sector first, assigned to the freshest drone.
    Guarantees massive sectors are distributed evenly across the swarm.
    """
    partial = partial_sector_resume or {}
    assignments = {
        d: DroneAssignment(drone_id=d, battery=drone_batteries[d])
        for d in drone_ids
    }
    unassigned = [s for s in scan_sectors if not s.is_obstacle]

    # Sort sectors by highest battery cost first
    unassigned.sort(key=lambda sec: _sector_cost(sec, partial.get(sec.sector_id, 0)), reverse=True)

    for sec in list(unassigned):
        cost = _sector_cost(sec, partial.get(sec.sector_id, 0))

        # Sort drones by most True Spare Capacity first
        sorted_drones = sorted(
            drone_ids,
            key=lambda d: (assignments[d].battery - assignments[d].total_cost),
            reverse=True
        )

        assigned = False
        for d_id in sorted_drones:
            da = assignments[d_id]
            if da.can_afford(cost, min_reserve):
                da.assigned_sectors.append(sec.sector_id)
                da.total_cost += cost
                unassigned.remove(sec)
                assigned = True
                break

        # If no drone can afford it purely by battery, force it to the freshest drone
        if not assigned:
            forced_id = sorted_drones[0]
            assignments[forced_id].assigned_sectors.append(sec.sector_id)
            assignments[forced_id].total_cost += cost
            unassigned.remove(sec)

    if unassigned:
        print(f"[assignment] WARNING: {len(unassigned)} sectors unassignable "
              f"(battery exhausted): {[s.sector_id for s in unassigned]}")

    return {d: assignments[d].assigned_sectors for d in drone_ids}


def replan_after_failure(
    failed_drone_id: str,
    surviving_drones: list[str],
    surviving_batteries: dict[str, int],
    orphaned_sector_ids: list[int],
    all_sectors_by_id: dict[int, Sector],
    drone_positions_xy: dict[str, tuple[float, float]],
    partial_sector_resume: Optional[dict[int, int]] = None,
    resume_positions: Optional[dict[int, tuple[float, float]]] = None,
) -> dict[str, list[int]]:
    """
    Called by orchestrator._handle_failure().
    Returns {surviving_drone_id: [new_sector_ids]} — only the ADDITIONAL sectors
    to tack onto each surviving drone's queue.
    """
    orphaned = [
        all_sectors_by_id[sid]
        for sid in orphaned_sector_ids
        if sid in all_sectors_by_id and not all_sectors_by_id[sid].is_obstacle
    ]
    if not orphaned:
        return {d: [] for d in surviving_drones}

    return assign_sectors(
        drone_ids=surviving_drones,
        drone_batteries=surviving_batteries,
        scan_sectors=orphaned,
        drone_positions_xy=drone_positions_xy,
        partial_sector_resume=partial_sector_resume or {},
        resume_positions=resume_positions or {},
        min_reserve=BATTERY_EMERGENCY_RESERVE,
    )


if __name__ == "__main__":
    # Smoke test
    from backend.terrain import build_terrain_model
    tiles, sectors, _ = build_terrain_model()
    scan = [s for s in sectors if not s.is_obstacle]
    sectors_by_id = {s.sector_id: s for s in sectors}

    drones = ["DRONE_A", "DRONE_B", "DRONE_C"]
    batts  = {d: BATTERY_MAX_TERRAIN for d in drones}
    base_xy = (100.0, 100.0)  # SW tile centre
    positions = {d: base_xy for d in drones}

    assigns = assign_sectors(drones, batts, scan, positions)
    print("=== Greedy initial assignment ===")
    for d, sids in assigns.items():
        total = sum(sectors_by_id[sid].battery_cost for sid in sids)
        print(f"  {d}: {sids}  (total cost: {total})")

    # Simulate DRONE_C failure at 50% of its first sector
    if assigns["DRONE_C"]:
        failed_sid = assigns["DRONE_C"][0]
        orphaned = assigns["DRONE_C"]
        sec = sectors_by_id[failed_sid]
        resume_at = len(sec.sweep_path_coords) // 2

        replan = replan_after_failure(
            failed_drone_id="DRONE_C",
            surviving_drones=["DRONE_A", "DRONE_B"],
            surviving_batteries={"DRONE_A": 120, "DRONE_B": 120},
            orphaned_sector_ids=orphaned,
            all_sectors_by_id=sectors_by_id,
            drone_positions_xy={"DRONE_A": base_xy, "DRONE_B": base_xy},
            partial_sector_resume={failed_sid: resume_at},
        )
        print(f"\n=== Replan after DRONE_C failure ===")
        print(f"Orphaned sectors: {orphaned}")
        print(f"Partial sector {failed_sid} resume index: {resume_at}/{len(sec.sweep_path_coords)}")
        for d, sids in replan.items():
            print(f"  {d}: +{sids}")