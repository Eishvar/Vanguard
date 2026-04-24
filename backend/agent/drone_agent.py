"""
drone_agent.py - DroneAgent: pure terrain path-follower.

One DroneAgent instance per drone (DRONE_A, DRONE_B, DRONE_C).
No LLM calls. No MCP calls. This class is a deterministic state machine:
load a sector path via load_sector(), then walk it via walk_full_path().
All event emission and MCP coordination lives in the orchestrator.
"""

from __future__ import annotations

import math
import logging

from backend.config import (
    BATTERY_MAX_TERRAIN,
    BATTERY_PER_100M,
    LOW_BATTERY_THRESHOLD,
    TILE_M,
    GRID_N,
)
from backend.terrain import local_m_to_latlng

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# DroneAgent
# ---------------------------------------------------------------------------

class DroneAgent:
    """
    Pure path-following drone. No LLM, no MCP, no async.

    The orchestrator calls load_sector() when assigning a new sector, then
    calls walk_full_path() each round to advance through all remaining nodes.
    """

    def __init__(self, drone_id: str, battery: int | None = None) -> None:
        self.drone_id = drone_id
        self.battery_float: float = float(battery if battery is not None else BATTERY_MAX_TERRAIN)
        self.battery: int = int(self.battery_float)
        self.status: str = "active"
        self.current_xy: tuple[float, float] = (0.0, 0.0)  # metres from SW corner

        self._current_nodes: list[dict] = []
        self._node_index: int = 0
        self._sector_resume_index: int = 0  # original resume_index passed to load_sector
        self._current_sector_id: int = -1

    # ------------------------------------------------------------------
    # Sector management
    # ------------------------------------------------------------------

    def load_sector(
        self,
        sector,
        resume_index: int = 0,
        reverse: bool = False,
    ) -> None:
        """
        Load a sector's sweep waypoints for walking.

        Converts sweep_path_coords [[x, y], ...] to node dicts.
        resume_index: skip the first N nodes (exact-resume after failure).
        reverse: start from the end of the path (proximity optimisation).
        """
        # FIX: Slice the un-swept portion FIRST, then reverse it if needed.
        nodes = list(sector.sweep_nodes)[resume_index:]
        if reverse:
            nodes = list(reversed(nodes))

        self._current_nodes = nodes
        self._node_index = 0
        self._sector_resume_index = resume_index
        self._current_sector_id = sector.sector_id

    def is_sector_complete(self) -> bool:
        return self._node_index >= len(self._current_nodes)

    def choose_reverse(
        self,
        sector,
        current_xy: tuple[float, float],
    ) -> bool:
        """Return True if the sector path should be reversed (end-first is closer)."""
        coords = sector.sweep_path_coords
        if len(coords) < 2:
            return False
        first, last = coords[0], coords[-1]
        d_first = (current_xy[0] - first[0]) ** 2 + (current_xy[1] - first[1]) ** 2
        d_last  = (current_xy[0] - last[0])  ** 2 + (current_xy[1] - last[1])  ** 2
        return d_last < d_first

    def should_reverse(self, sector) -> bool:
        """
        True if walking the sector path end-first is shorter from
        the drone's current position. Uses sweep_nodes anchors if
        available, falls back to sweep_path_coords endpoints.
        """
        from backend.agent.pathfinding import closest_anchor
        anchors = [n for n in getattr(sector, "sweep_nodes", [])
                   if n.get("type") == "anchor"]
        if len(anchors) >= 2:
            ca = closest_anchor(sector, self.current_xy)
            return ca == anchors[-1]
        # Fallback: use sweep_path_coords endpoints
        return self.choose_reverse(sector, self.current_xy)

    # ------------------------------------------------------------------
    # Walking
    # ------------------------------------------------------------------

    def walk_full_path(self) -> list[dict]:
        """
        Walk all remaining nodes in the current sector path.

        Returns a list of step dicts — one per node — suitable for
        drone_heading SSE events and scan_tile / update_drone_position MCP calls.
        Battery is drained and status may flip to 'low_battery'.
        Stops early if battery reaches 0.
        """
        steps: list[dict] = []

        while self._node_index < len(self._current_nodes):
            n = self._current_nodes[self._node_index]
            x, y = n["x_m"], n["y_m"]

            dx = x - self.current_xy[0]
            dy = y - self.current_xy[1]
            dist_m = math.hypot(dx, dy)
            heading = (
                (90 - math.degrees(math.atan2(dy, dx))) % 360
                if dist_m > 1e-6 else 0.0
            )

            # Drain exact float fraction, but expose integer
            cost = (dist_m / 100.0) * BATTERY_PER_100M
            self.battery_float = max(0.0, self.battery_float - cost)
            self.battery = int(self.battery_float)
            if self.battery <= LOW_BATTERY_THRESHOLD:
                self.status = "low_battery"

            self.current_xy = (x, y)
            lat, lng = local_m_to_latlng(x, y)

            tile_col = min(int(x / TILE_M), GRID_N - 1)
            tile_row = min(int(y / TILE_M), GRID_N - 1)

            steps.append({
                "drone_id":    self.drone_id,
                "lat":         lat,
                "lng":         lng,
                "heading_deg": heading,
                "sector_id":   self._current_sector_id,
                "path_index":  self._sector_resume_index + self._node_index,
                "path_total":  self._sector_resume_index + len(self._current_nodes),
                "dist_m":      dist_m,
                "node_type":   n.get("type", "sweep"),
                "battery":     self.battery,
                "tile_row":    tile_row,
                "tile_col":    tile_col,
            })

            self._node_index += 1
            if self.battery <= 0:
                break

        return steps

    def walk_one_node(self) -> dict | None:
        """
        Advance exactly ONE node along the current sector path.
        Returns a step dict suitable for drone_heading SSE emission,
        or None if the sector is already complete.
        Battery is drained; status may flip to 'low_battery'.
        """
        if self._node_index >= len(self._current_nodes):
            return None

        n = self._current_nodes[self._node_index]
        x, y = n["x_m"], n["y_m"]

        dx = x - self.current_xy[0]
        dy = y - self.current_xy[1]
        dist_m = math.hypot(dx, dy)
        heading = (
            (90 - math.degrees(math.atan2(dy, dx))) % 360
            if dist_m > 1e-6 else 0.0
        )

        # Drain exact float fraction, but expose integer
        cost = (dist_m / 100.0) * BATTERY_PER_100M
        self.battery_float = max(0.0, self.battery_float - cost)
        self.battery = int(self.battery_float)
        if self.battery <= LOW_BATTERY_THRESHOLD:
            self.status = "low_battery"

        self.current_xy = (x, y)
        lat, lng = local_m_to_latlng(x, y)

        tile_col = min(int(x / TILE_M), GRID_N - 1)
        tile_row = min(int(y / TILE_M), GRID_N - 1)

        step = {
            "drone_id":    self.drone_id,
            "lat":         lat,
            "lng":         lng,
            "heading_deg": heading,
            "sector_id":   self._current_sector_id,
            "path_index":  self._sector_resume_index + self._node_index,
            "path_total":  self._sector_resume_index + len(self._current_nodes),
            "dist_m":      dist_m,
            "node_type":   n.get("type", "sweep"),
            "battery":     self.battery,
            "tile_row":    tile_row,
            "tile_col":    tile_col,
        }
        self._node_index += 1
        return step


# ---------------------------------------------------------------------------
# FastMCP tool result extractor — shared by orchestrator and supervisor
# ---------------------------------------------------------------------------

def _extract_tool_result(raw) -> dict:
    """Handles all known FastMCP return formats."""
    import json

    if hasattr(raw, "content"):
        content = raw.content
        if content and hasattr(content[0], "text"):
            return json.loads(content[0].text)

    if isinstance(raw, dict):
        return raw

    if isinstance(raw, list) and raw:
        first = raw[0]
        if hasattr(first, "text"):
            return json.loads(first.text)
        if isinstance(first, dict):
            return first

    raise ValueError(
        "Unexpected tool result format: {} - {}".format(type(raw), repr(raw)[:200])
    )
