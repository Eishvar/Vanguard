"""
game_state.py — Async-safe wrapper around SimulationCore.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from simulation import (
    SimulationCore,
    get_default_assignments,
)


class GameState:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._sim: Optional[SimulationCore] = None

    async def reset(self, seed: int = None) -> dict:
        from backend.terrain import build_terrain_model
        _, sectors, _ = build_terrain_model()
        total_sectors = sum(1 for s in sectors if not s.is_obstacle)
        async with self._lock:
            self._sim = SimulationCore(total_sectors=total_sectors, seed=seed)
            return {
                "status": "initialised",
                "mission": self._sim.mission.to_dict(),
                "drones": {did: d.to_dict() for did, d in self._sim.drones.items()},
            }

    def _require_sim(self) -> SimulationCore:
        if self._sim is None:
            raise RuntimeError("GameState not initialised. Call reset() first.")
        return self._sim

    async def discover_drones(self) -> dict:
        async with self._lock:
            sim = self._require_sim()
            return {
                "drones": [
                    {
                        "drone_id": d.id,
                        "status": d.status,
                        "battery": d.battery,
                        "tile_row": d.tile_row,
                        "tile_col": d.tile_col,
                    }
                    for d in sim.drones.values()
                ],
                "total_drones": len(sim.drones),
            }

    async def get_drone_status(self, drone_id: str) -> dict:
        async with self._lock:
            sim = self._require_sim()
            drone = sim.drones.get(drone_id)
            if drone is None:
                return {"error": f"Unknown drone: {drone_id}"}
            return drone.to_dict()

    async def get_all_drone_statuses(self) -> dict:
        async with self._lock:
            sim = self._require_sim()
            return {
                "drones": {did: d.to_dict() for did, d in sim.drones.items()},
                "round": sim.mission.round_number,
                "phase": sim.mission.phase,
                "active_count": len(sim.active_drones()),
                "failed_drones": sim.mission.failed_drones,
            }

    async def get_mission_state(self) -> dict:
        async with self._lock:
            sim = self._require_sim()
            return sim.get_mission_snapshot()

    async def get_mission_status(self) -> dict:
        async with self._lock:
            sim = self._require_sim()
            return sim.mission.to_dict()

    async def move_drone_to_tile(self, drone_id: str, row: int, col: int,
                                  battery_cost: int) -> dict:
        async with self._lock:
            return self._require_sim().move_drone_to_tile(drone_id, row, col, battery_cost)

    async def mark_sector_complete(self, drone_id: str, sector_id: int) -> dict:
        async with self._lock:
            return self._require_sim().mark_sector_complete(drone_id, sector_id)

    async def scan_tile(self, drone_id: str, tile_row: int, tile_col: int) -> dict:
        async with self._lock:
            return self._require_sim().scan_tile(drone_id, tile_row, tile_col)

    async def update_drone_position(self, drone_id: str, tile_row: int, tile_col: int,
                                     lat: float, lng: float, battery: int,
                                     status: str, sector_id: int = -1) -> dict:
        async with self._lock:
            self._require_sim().update_drone_position(
                drone_id, tile_row, tile_col, lat, lng, battery, status, sector_id
            )
            return {"success": True, "drone_id": drone_id}

    async def inject_failure(self, drone_id: str) -> dict:
        async with self._lock:
            sim = self._require_sim()
            return sim.inject_failure(drone_id)

    async def advance_round(self) -> dict:
        async with self._lock:
            sim = self._require_sim()
            sim.mission.round_number += 1
            return {"round": sim.mission.round_number, "phase": sim.mission.phase}

    async def set_phase(self, phase: str) -> dict:
        valid_phases = {"init", "planning", "executing", "recovery", "complete"}
        if phase not in valid_phases:
            raise ValueError(f"Invalid phase '{phase}'")
        async with self._lock:
            sim = self._require_sim()
            sim.mission.phase = phase
            return {"phase": sim.mission.phase, "round": sim.mission.round_number}

    async def full_dump(self) -> dict:
        async with self._lock:
            sim = self._require_sim()
            return sim.to_dict()
