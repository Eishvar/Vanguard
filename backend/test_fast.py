"""
Fast backend test — runs full mission with mock LLM responses.

Validates the entire orchestrator → MCP → simulation pipeline without any real
API calls. The mock LLM in llm_client.py (activated by MOCK_MODE=1) returns
deterministic DroneDecision/SupervisorPlan/RedistributionPlan/MissionSummary
objects based on the structured user_prompt strings.

Requirements:
  - MCP server must be running: python server/mcp_server.py
  - No API keys needed (MOCK_MODE bypasses all LLM calls)

Usage:
    cd backend
    python test_fast.py
"""

import os

# Must be set before any backend imports so llm_client.py's early-return fires.
os.environ["MOCK_MODE"] = "1"

import asyncio
import logging
import sys
import time
from pathlib import Path

# Mirror test_run.py's sys.path setup so direct imports work.
_ROOT = Path(__file__).parent
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(_ROOT / "server"))
sys.path.insert(0, str(_ROOT / "agent"))

from orchestrator import Orchestrator  # noqa: E402 — sys.path set above

logging.basicConfig(
    level=logging.WARNING,  # suppress debug noise; errors still surface
    format="%(levelname)s %(name)s: %(message)s",
)


async def run_fast_test() -> None:
    print("=" * 60)
    print("FAST TEST — Mock LLM, Real Pipeline")
    print("  MCP:  http://localhost:8001/mcp")
    print("  MOCK_MODE: ON (no API calls)")
    print("=" * 60)

    start = time.time()
    event_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

    orch = Orchestrator(
        mcp_url="http://localhost:8001/mcp",
        failure_round=3,   # injects DRONE_C offline at round 3
        max_rounds=30,
    )

    # Aggregate events by type — used by Phase 7.1 terrain assertions
    # and legacy mesh-network assertions alike.
    recorded_events: dict[str, list] = {}

    async def drain() -> None:
        tick = 0
        latest_sectors = 0
        latest_survivors = 0
        while True:
            event = await event_queue.get()
            recorded_events.setdefault(event["type"], []).append(event)
            if event["type"] == "grid_update":
                data = event.get("data", {})
                latest_sectors = data.get("sectors_swept", latest_sectors)
                latest_survivors = data.get("survivors_found", latest_survivors)
            tick += 1
            if tick % 500 == 0 and tick > 0:
                print(f"  [test] tick {tick}, sectors_swept={latest_sectors}, survivors={latest_survivors}")
            if event.get("type") == "stream_end":
                break

    drain_task = asyncio.create_task(drain())

    try:
        summary = await orch.run_mission(event_queue)
        await event_queue.put({"type": "stream_end"})
        await drain_task

        elapsed = time.time() - start

        print(f"\nMission completed in {elapsed:.1f}s")
        print(f"  Rounds:          {summary.rounds_completed}")
        print(f"  Sectors swept:   {summary.sectors_swept}")
        print(f"  Survivors found: {summary.survivors_found}")
        print(f"  Self-healing:    {summary.self_healing_triggered}")
        # Calculate total events from all categories in the dictionary
        total_events = sum(len(evs) for evs in recorded_events.values())
        print(f"  Events emitted:  {total_events}")

        # ── Terrain Upgrade Assertions (Phase 7.1) ────────────────────────
                # ── Terrain Upgrade Assertions (Phase 7.1) ────────────────────────
        ti_events = recorded_events.get("terrain_initialized", [])
        assert len(ti_events) == 1, \
            f"terrain_initialized must fire exactly once, got {len(ti_events)}"

        ti = ti_events[0]["data"]

        # Verify terrain_initialized payload contains the config-driven fields
        assert "anchor_latlng" in ti,        "terrain_initialized must include anchor_latlng"
        assert "grid_n" in ti,               "terrain_initialized must include grid_n"
        assert "obstacle_elev_threshold" in ti, "terrain_initialized must include obstacle_elev_threshold"
        assert "base_station_latlng" in ti,  "terrain_initialized must include base_station_latlng"

        # Verify anchor_latlng = SW corner = raw config values
        from backend.config import ANCHOR_LAT, ANCHOR_LNG, GRID_N, OBSTACLE_ELEV_M
        assert abs(ti["anchor_latlng"][0] - ANCHOR_LAT) < 1e-6, \
            f"anchor_latlng lat mismatch: payload={ti['anchor_latlng'][0]}, config={ANCHOR_LAT}"
        assert abs(ti["anchor_latlng"][1] - ANCHOR_LNG) < 1e-6, \
            f"anchor_latlng lng mismatch: payload={ti['anchor_latlng'][1]}, config={ANCHOR_LNG}"
        assert ti["grid_n"] == GRID_N, \
            f"grid_n mismatch: payload={ti['grid_n']}, config={GRID_N}"
        assert abs(ti["obstacle_elev_threshold"] - OBSTACLE_ELEV_M) < 1e-6, \
            f"obstacle_elev_threshold mismatch: payload={ti['obstacle_elev_threshold']}, config={OBSTACLE_ELEV_M}"

        # Verify base_station_latlng = centre of tile (0,0) = slightly NE of SW corner
        base = ti["base_station_latlng"]
        assert base[0] > ANCHOR_LAT, \
            f"base station lat should be north of anchor, got {base[0]} vs {ANCHOR_LAT}"
        assert base[1] > ANCHOR_LNG, \
            f"base station lng should be east of anchor, got {base[1]} vs {ANCHOR_LNG}"
        print(f"[test_fast] terrain_initialized config-propagation OK: "
              f"SW anchor=({ANCHOR_LAT}, {ANCHOR_LNG}), "
              f"base station=({base[0]:.6f}, {base[1]:.6f}), "
              f"grid={ti['grid_n']}×{ti['grid_n']}, "
              f"obstacle>{ti['obstacle_elev_threshold']}m")

        # ── Legacy Assertions ─────────────────────────────────────────────
        total_scan_sectors = len([s for s in orch._sectors if not s.is_obstacle])
        assert summary.sectors_swept == total_scan_sectors, \
            f"Not all sectors swept: {summary.sectors_swept}/{total_scan_sectors}"
        assert summary.self_healing_triggered, (
            "Self-healing should have triggered (DRONE_C injected at round 3)"
        )
        assert elapsed < 600, (
            f"Fast test took {elapsed:.1f}s — must complete in <600s"
        )

        # ── Mesh network assertions ───────────────────────────────────────
        grid_events = recorded_events.get("grid_update", [])
        assert grid_events, "Expected at least one grid_update event"

        first_comms = grid_events[0]["data"].get("communication_network")
        assert first_comms is not None, (
            "grid_update events must include 'communication_network' field"
        )
        assert "links" in first_comms, "communication_network must have 'links'"
        assert "reachable_from_base" in first_comms, (
            "communication_network must have 'reachable_from_base'"
        )
        assert "isolated" in first_comms, "communication_network must have 'isolated'"
        print(f"  Mesh (round 1):   reachable={first_comms['reachable_from_base']}, "
              f"isolated={first_comms['isolated']}, links={len(first_comms['links'])}")

        comms_lost_events = recorded_events.get("comms_lost", [])
        drone_c_lost = any(
            e["data"].get("drone_id") == "DRONE_C" for e in comms_lost_events
        )
        assert drone_c_lost, (
            "Expected comms_lost for DRONE_C after failure injection at round 3"
        )
        print(f"  comms_lost:       {[e['data']['drone_id'] for e in comms_lost_events]}")

        print("\n✓ All assertions passed")

    except Exception as exc:
        elapsed = time.time() - start
        print(f"\n✗ Test failed after {elapsed:.1f}s: {exc}")
        raise


if __name__ == "__main__":
    asyncio.run(run_fast_test())