"""
comms.py — Mesh network computation for the drone swarm.

Computes an undirected communication graph over the active drone fleet plus
the fixed ground-station at BASE tile, then determines which drones have an
uninterrupted path back to base.

Link rule: two entities are directly linked iff the euclidean distance between
their positions (in km) is ≤ max(radius_A, radius_B).

Design note: this module is pure computation — no I/O, no MCP calls.
Called from SimulationCore.get_mission_snapshot() so every grid_update SSE
event carries live mesh topology.
"""

from __future__ import annotations

import math
import os
import sys

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from config import COMM_RADIUS_KM, BASE_TILE_ROW, BASE_TILE_COL


def compute_comm_network_terrain(drones: dict) -> dict:
    """
    Compute mesh network from terrain-positioned drones.

    Args:
        drones: dict[drone_id → DroneSimState] with .tile_row, .tile_col, .status

    Returns:
        {
            "links":               [[id_a, id_b], ...],
            "reachable_from_base": [drone_id, ...],
            "isolated":            [drone_id, ...],
            "entities": [
                {"id": str, "pos_km": [float, float], "radius_km": float},
                ...
            ],
        }
    """
    entities: list[tuple[str, tuple[float, float], float]] = []

    base_pos_km = (BASE_TILE_COL * 0.1, BASE_TILE_ROW * 0.1)
    entities.append(("BASE", base_pos_km, COMM_RADIUS_KM["base"]))

    for drone in drones.values():
        if drone.status == "offline":
            continue
        pos_km = (drone.tile_col * 0.1, drone.tile_row * 0.1)
        entities.append((drone.id, pos_km, COMM_RADIUS_KM["worker"]))

    links: list[list[str]] = []
    for i in range(len(entities)):
        ai, api, ari = entities[i]
        for j in range(i + 1, len(entities)):
            bi, bpi, bri = entities[j]
            dist = math.hypot(api[0] - bpi[0], api[1] - bpi[1])
            if dist <= max(ari, bri):
                links.append([ai, bi])

    adj: dict[str, list[str]] = {}
    for a, b in links:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    reachable: set[str] = set()
    frontier = ["BASE"]
    while frontier:
        n = frontier.pop()
        if n in reachable:
            continue
        reachable.add(n)
        frontier.extend(adj.get(n, []))

    all_ids = {e[0] for e in entities}
    drone_ids = all_ids - {"BASE"}

    return {
        "links": links,
        "reachable_from_base": sorted(reachable & drone_ids),
        "isolated": sorted(drone_ids - reachable),
        "entities": [
            {"id": e[0], "pos_km": list(e[1]), "radius_km": e[2]}
            for e in entities
        ],
    }


def compute_comm_network(drones: dict, grid: dict = None) -> dict:
    """Legacy alias — delegates to compute_comm_network_terrain. grid is ignored."""
    return compute_comm_network_terrain(drones)
