"""
mcp_server.py — FastMCP server for the terrain-sector drone swarm SAR simulation.

Architecture: single server, clients are the supervisor + drone agents.
All locking lives in GameState — this file is a pure thin wrapper.

Tools:
  1.  discover_drones          — find active drones at runtime
  2.  get_drone_status         — read one drone's state
  3.  get_all_drone_statuses   — supervisor overview of all drones
  4.  get_mission_state        — full terrain snapshot (swept sectors, positions, survivors)
  5.  get_mission_status       — mission progress counters
  6.  move_drone_to_tile       — move drone to terrain tile (row, col)
  7.  mark_sector_complete     — record a sector as fully swept by a drone
  8.  scan_tile                — check a tile for survivors
  9.  inject_drone_failure     — mark a drone offline (demo / fault injection)
  10. reset_mission            — initialise / restart the simulation
  11. set_mission_phase        — set current phase string
  12. advance_mission_round    — increment round counter
  13. update_drone_position    — sync a drone's current position and battery to the game state

Transport: Streamable HTTP on localhost:8001
Run:  python server/mcp_server.py
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastmcp import FastMCP
from game_state import GameState

game_state = GameState()

mcp = FastMCP(
    name="DroneSwarmSAR",
    instructions=(
        "You are connected to a drone swarm search-and-rescue simulation on a "
        "20×20 terrain grid. Three drones (DRONE_A, DRONE_B, DRONE_C) sweep "
        "terrain sectors for survivors. "
        "Supervisor tools: discover_drones, get_all_drone_statuses, "
        "get_mission_status, get_mission_state, mark_sector_complete. "
        "Drone tools: get_drone_status, get_mission_state, move_drone_to_tile, "
        "scan_tile."
    ),
)


# ---------------------------------------------------------------------------
# Tool 1 — discover_drones
# ---------------------------------------------------------------------------

@mcp.tool()
async def discover_drones() -> dict:
    """
    Discover all drones in the fleet at runtime.

    Returns drone IDs, tile positions, statuses, and battery levels.
    Call at mission start before planning.

    Returns:
        drones: list of {drone_id, status, battery, tile_row, tile_col}
        total_drones: int
    """
    return await game_state.discover_drones()


# ---------------------------------------------------------------------------
# Tool 2 — get_drone_status
# ---------------------------------------------------------------------------

@mcp.tool()
async def get_drone_status(drone_id: str) -> dict:
    """
    Get full status of a single drone.

    Returns battery, status, tile position, lat/lng, sector_id,
    sectors_swept, and survivors_found.

    Args:
        drone_id: One of "DRONE_A", "DRONE_B", "DRONE_C"
    """
    return await game_state.get_drone_status(drone_id)


# ---------------------------------------------------------------------------
# Tool 3 — get_all_drone_statuses
# ---------------------------------------------------------------------------

@mcp.tool()
async def get_all_drone_statuses() -> dict:
    """
    Get a summary of all drones — supervisor overview tool.

    Returns status of all three drones, current round, mission phase,
    active drone count, and list of failed drones.

    Returns:
        drones: {drone_id: {...}}, round, phase, active_count, failed_drones
    """
    return await game_state.get_all_drone_statuses()


# ---------------------------------------------------------------------------
# Tool 4 — get_mission_state
# ---------------------------------------------------------------------------

@mcp.tool()
async def get_mission_state() -> dict:
    """
    Get the full terrain snapshot — swept sectors, drone positions, survivors.

    Returns swept_sectors, total_sectors, drone_positions, drones,
    survivors, communication_network, explored_count, coverage_pct.
    """
    return await game_state.get_mission_state()


# ---------------------------------------------------------------------------
# Tool 5 — get_mission_status
# ---------------------------------------------------------------------------

@mcp.tool()
async def get_mission_status() -> dict:
    """
    Get mission progress counters.

    Returns round_number, phase, total_sectors, sectors_swept,
    survivors_found, failed_drones, completed, coverage_pct.
    """
    return await game_state.get_mission_status()


# ---------------------------------------------------------------------------
# Tool 6 — move_drone_to_tile
# ---------------------------------------------------------------------------

@mcp.tool()
async def move_drone_to_tile(drone_id: str, row: int, col: int,
                              battery_cost: int) -> dict:
    """
    Move a drone to tile (row, col) on the 20×20 terrain grid.
    Row 0 = southernmost, col 0 = westernmost. Battery cost is computed
    by the drone agent based on distance and BATTERY_PER_100M.

    Args:
        drone_id:     "DRONE_A", "DRONE_B", or "DRONE_C"
        row:          Terrain grid row 0–19 (0 = south)
        col:          Terrain grid col 0–19 (0 = west)
        battery_cost: Battery units to deduct

    Returns:
        success, drone_id, row, col, lat, lng, battery, status
    """
    return await game_state.move_drone_to_tile(drone_id, row, col, battery_cost)


# ---------------------------------------------------------------------------
# Tool 7 — mark_sector_complete
# ---------------------------------------------------------------------------

@mcp.tool()
async def mark_sector_complete(drone_id: str, sector_id: int) -> dict:
    """
    Record that drone_id has finished sweeping sector_id.

    Updates swept_sectors set and checks mission completion.

    Args:
        drone_id:  "DRONE_A", "DRONE_B", or "DRONE_C"
        sector_id: Integer sector ID from the terrain model

    Returns:
        success, drone_id, sector_id, sectors_swept, total_sectors
    """
    return await game_state.mark_sector_complete(drone_id, sector_id)


# ---------------------------------------------------------------------------
# Tool 8 — scan_tile
# ---------------------------------------------------------------------------

@mcp.tool()
async def scan_tile(drone_id: str, tile_row: int, tile_col: int) -> dict:
    """
    Check if a tile contains a survivor.

    Called at each waypoint during sector sweep. If a survivor is present
    and not yet found, marks them as found and increments counters.

    Args:
        drone_id:  "DRONE_A", "DRONE_B", or "DRONE_C"
        tile_row:  Grid row 0–19
        tile_col:  Grid col 0–19

    Returns:
        survivor_found (bool), tile_id, survivor (dict if found)
    """
    return await game_state.scan_tile(drone_id, tile_row, tile_col)


# ---------------------------------------------------------------------------
# Tool 9 — inject_drone_failure
# ---------------------------------------------------------------------------

@mcp.tool()
async def inject_drone_failure(drone_id: str) -> dict:
    """
    Mark a drone as offline. Returns orphaned_sectors list (filled by orchestrator).

    Args:
        drone_id: The drone to mark offline, e.g. "DRONE_C"
    """
    return await game_state.inject_failure(drone_id)


# ---------------------------------------------------------------------------
# Tool 10 — reset_mission
# ---------------------------------------------------------------------------

@mcp.tool()
async def reset_mission(seed: int = 42) -> dict:
    """
    Reset the simulation for a new mission run.

    Must be called once before any other tool. Builds terrain model to
    determine total_sectors, places survivors, resets drone positions.

    Args:
        seed: Random seed (default 42)

    Returns:
        status, mission snapshot, drone starting positions
    """
    return await game_state.reset(seed=seed)


# ---------------------------------------------------------------------------
# Tool 11 — set_mission_phase
# ---------------------------------------------------------------------------

@mcp.tool()
async def set_mission_phase(phase: str) -> dict:
    """
    Set the current mission phase.
    Valid: init, planning, executing, recovery, complete.
    """
    return await game_state.set_phase(phase)


# ---------------------------------------------------------------------------
# Tool 12 — advance_mission_round
# ---------------------------------------------------------------------------

@mcp.tool()
async def advance_mission_round() -> dict:
    """Increment the mission round counter by 1."""
    return await game_state.advance_round()

# ---------------------------------------------------------------------------
# Tool 13 — update_drone_position
# ---------------------------------------------------------------------------

@mcp.tool()
async def update_drone_position(
    drone_id: str, 
    tile_row: int, 
    tile_col: int, 
    lat: float, 
    lng: float, 
    battery: int, 
    status: str, 
    sector_id: int = -1
) -> dict:
    """
    Syncs a drone's current terrain position and battery to the game state.
    """
    await game_state.update_drone_position(
        drone_id, tile_row, tile_col, lat, lng, battery, status, sector_id
    )
    return {"success": True}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Starting DroneSwarmSAR MCP server on http://localhost:8001/mcp")
    print("Tools: discover_drones, get_drone_status, get_all_drone_statuses,")
    print("       get_mission_state, get_mission_status, move_drone_to_tile,")
    print("       mark_sector_complete, scan_tile, inject_drone_failure,")
    print("       reset_mission, set_mission_phase, advance_mission_round")

    mcp.run(
        transport="streamable-http",
        host="0.0.0.0",
        port=8001,
    )
