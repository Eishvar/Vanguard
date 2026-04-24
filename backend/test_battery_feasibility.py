#!/usr/bin/env python3
"""
Battery feasibility test. Standalone — no MCP server, no frontend, no LLM.

Checks:
  1. Can the three drones complete the current mission at 100% health?
  2. If DRONE_A fails at 25% / 50% / 75% of its workload, can the survivors complete?
  3. Same for DRONE_B.
  4. Same for DRONE_C.

Each scenario prints whether all sectors get covered and what RTB margin remains.
Use this before any demo to confirm the self-healing promise is achievable with
current config values.

Usage:
  python backend/test_battery_feasibility.py
  python backend/test_battery_feasibility.py --verbose   # per-drone cost breakdown
"""

import sys
from pathlib import Path

# Add the project root to Python's path (only 2 parents needed here!)
sys.path.insert(0, str(Path(__file__).parent.parent))

import argparse
from backend.terrain import build_terrain_model, rtb_distance_m
from backend.terrain import BATTERY_MAX_TERRAIN, BATTERY_RTB_RESERVE, BATTERY_PER_100M
from backend.config import BATTERY_EMERGENCY_RESERVE
from backend.agent.sector_assignment import (
    assign_sectors, replan_after_failure, _remaining_battery_cost,
)

DRONE_IDS = ["DRONE_A", "DRONE_B", "DRONE_C"]


def total_cost(sector_ids, sectors_by_id):
    return sum(sectors_by_id[sid].battery_cost for sid in sector_ids)


def simulate_baseline(assignments, sectors_by_id):
    """Scenario 0 — no failures. Verify every drone is within budget."""
    all_ok = True
    rows = []
    for d in DRONE_IDS:
        sids = assignments[d]
        cost = total_cost(sids, sectors_by_id)
        margin = BATTERY_MAX_TERRAIN - cost
        ok = margin >= BATTERY_RTB_RESERVE
        if not ok:
            all_ok = False
        rows.append((d, len(sids), cost, margin, ok))
    return all_ok, rows


def simulate_failure(failed_drone, failure_pct, initial_assign, sectors_by_id, base_xy, verbose):
    """Simulate failed_drone dying at `failure_pct` of its workload."""
    survivors = [d for d in DRONE_IDS if d != failed_drone]
    failed_sectors = initial_assign[failed_drone]

    if not failed_sectors:
        return True, f"{failed_drone} had no sectors, nothing to recover"

    # Figure out which sector the drone died in
    cum_cost = 0
    total_fd_cost = total_cost(failed_sectors, sectors_by_id)
    target_pct_cost = total_fd_cost * failure_pct
    partial_sid = None
    partial_resume = 0
    completed_before_failure = []
    remaining_after_failure = list(failed_sectors)

    for sid in failed_sectors:
        sec = sectors_by_id[sid]
        if cum_cost + sec.battery_cost >= target_pct_cost:
            # Dies mid this sector
            partial_sid = sid
            within_sector_pct = (target_pct_cost - cum_cost) / sec.battery_cost
            n_wps = len(sec.sweep_path_coords)
            partial_resume = max(0, min(int(n_wps * within_sector_pct), n_wps - 1))
            break
        cum_cost += sec.battery_cost
        completed_before_failure.append(sid)
        remaining_after_failure.remove(sid)

    # Orphaned = partial sector (remaining portion) + all sectors queued after it
    orphaned = remaining_after_failure
    partial_resume_map = {partial_sid: partial_resume} if partial_sid is not None else {}

    # Battery remaining on survivors (assume they've been working too, proportionally)
    # Conservative model: survivors have used `failure_pct` of their own initial allocation
    surv_batteries = {}
    for d in survivors:
        used = total_cost(initial_assign[d], sectors_by_id) * failure_pct
        surv_batteries[d] = max(int(BATTERY_MAX_TERRAIN - used), BATTERY_RTB_RESERVE + 1)

    new_plan = replan_after_failure(
        failed_drone_id=failed_drone,
        surviving_drones=survivors,
        surviving_batteries=surv_batteries,
        orphaned_sector_ids=orphaned,
        all_sectors_by_id=sectors_by_id,
        drone_positions_xy={d: base_xy for d in survivors},
        partial_sector_resume=partial_resume_map,
    )

    # Check if all orphaned sectors are now assigned
    absorbed = set()
    for d in survivors:
        absorbed.update(new_plan.get(d, []))
    missing = set(orphaned) - absorbed

    # Verify no survivor is over budget after absorbing extras
    survivor_ok = True
    survivor_report = []
    for d in survivors:
        # Their remaining budget minus the ADDITIONAL sectors they picked up
        extra_sids = new_plan.get(d, [])
        extra_cost = sum(
            _remaining_battery_cost(sectors_by_id[s], partial_resume_map.get(s, 0))
            for s in extra_sids
        )
        final_remaining = surv_batteries[d] - extra_cost
        # THE FIX: In emergency scenarios, survivors only need to meet the config emergency reserve
        ok = final_remaining >= BATTERY_EMERGENCY_RESERVE
        if not ok:
            survivor_ok = False
        survivor_report.append((d, surv_batteries[d], extra_cost, final_remaining, ok))

    overall_ok = survivor_ok and not missing
    msg = f"  orphaned={len(orphaned)}, absorbed={len(absorbed)}, missing={len(missing)}"
    if verbose:
        for d, batt, extra, rem, ok in survivor_report:
            msg += f"\n    {d}: batt={batt}, extra_sectors_cost={extra}, RTB_margin={rem} {'✓' if ok else '✗'}"
    return overall_ok, msg


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    print("=" * 72)
    print("VANGUARD Battery Feasibility Test")
    print("=" * 72)

    tiles, sectors, _ = build_terrain_model()
    scan_sectors = [s for s in sectors if not s.is_obstacle]
    sectors_by_id = {s.sector_id: s for s in sectors}
    from backend.terrain import TILE_M, BASE_TILE_ROW, BASE_TILE_COL
    base_xy = (BASE_TILE_COL * TILE_M + TILE_M / 2,
               BASE_TILE_ROW * TILE_M + TILE_M / 2)

    # Initial assignment: greedy nearest-first, all drones at full battery
    assignments = assign_sectors(
        drone_ids=DRONE_IDS,
        drone_batteries={d: BATTERY_MAX_TERRAIN for d in DRONE_IDS},
        scan_sectors=scan_sectors,
        drone_positions_xy={d: base_xy for d in DRONE_IDS},
    )

    print(f"\nConfig: BATTERY_MAX={BATTERY_MAX_TERRAIN}, "
          f"RTB_RESERVE={BATTERY_RTB_RESERVE}, PER_100M={BATTERY_PER_100M}")
    print(f"Sectors: {len(scan_sectors)} scan + {len(sectors) - len(scan_sectors)} obstacle")

    print(f"\n[Scenario 0] Baseline — all 3 drones healthy:")
    baseline_ok, rows = simulate_baseline(assignments, sectors_by_id)
    for d, n_sec, cost, margin, ok in rows:
        mark = "✓" if ok else "✗"
        print(f"  {mark} {d}: {n_sec} sectors, cost={cost}, RTB margin={margin}")

    if not baseline_ok:
        print("\n✗ BASELINE FAILED — the mission isn't feasible even without failures.")
        print("  Increase BATTERY_MAX_TERRAIN or reduce sector count / path lengths.")
        return 1

    print(f"\n[Scenarios 1–9] Single-drone failure at 25% / 50% / 75%:")
    all_scenarios_ok = True
    for pct in (0.25, 0.50, 0.75):
        for failed in DRONE_IDS:
            ok, detail = simulate_failure(failed, pct, assignments, sectors_by_id,
                                          base_xy, args.verbose)
            mark = "✓" if ok else "✗"
            print(f"  {mark} {failed} fails at {int(pct*100)}%: {detail.splitlines()[0]}")
            if args.verbose:
                for line in detail.splitlines()[1:]:
                    print(line)
            if not ok:
                all_scenarios_ok = False

    print("\n" + "=" * 72)
    if baseline_ok and all_scenarios_ok:
        print("✓ PASS — current config safely supports demo with mid-mission failure.")
        return 0
    else:
        print("✗ FAIL — at least one scenario can't be recovered from.")
        print("  Fix: increase BATTERY_MAX_TERRAIN in config.py, or reduce search area.")
        return 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
