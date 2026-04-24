"""
simulation.py — Terrain-sector-based simulation state for drone swarm SAR.

20×20 terrain grid, sector-sweep state machine.
Survivors are at 4 fixed tile positions spread across the search area.
Terrain sectors replace the legacy grid; survivors are tracked by tile ID.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from typing import Optional

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SERVER_DIR  = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_BACKEND_DIR)
for _d in [_PROJECT_ROOT, _BACKEND_DIR, _SERVER_DIR]:
    if _d not in sys.path:
        sys.path.insert(0, _d)


# ─── TileSurvivor ─────────────────────────────────────────────────────────────

@dataclass
class TileSurvivor:
    tile_row: int
    tile_col: int
    tile_id: str
    description: str
    num_people: int
    medical_priority: str       # "CRITICAL" | "HIGH" | "MODERATE" | "LOW"
    extraction_notes: str
    thermal_reading: float      # 0.0–1.0
    lat: float = 0.0
    lng: float = 0.0
    found: bool = False
    found_by: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "tile_row": self.tile_row,
            "tile_col": self.tile_col,
            "tile_id": self.tile_id,
            "description": self.description,
            "num_people": self.num_people,
            "medical_priority": self.medical_priority,
            "extraction_notes": self.extraction_notes,
            "thermal_reading": self.thermal_reading,
            "lat": self.lat,
            "lng": self.lng,
            "found": self.found,
            "found_by": self.found_by,
        }


# ─── DroneSimState ────────────────────────────────────────────────────────────

@dataclass
class DroneSimState:
    id: str
    battery: int
    status: str                 # "active" | "offline" | "low_battery" | "rtb"
    tile_row: int = 0
    tile_col: int = 0
    lat: float = 0.0
    lng: float = 0.0
    sector_id: int = -1
    sectors_swept: list[int] = field(default_factory=list)
    survivors_found: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "battery": self.battery,
            "status": self.status,
            "tile_row": self.tile_row,
            "tile_col": self.tile_col,
            "lat": self.lat,
            "lng": self.lng,
            "sector_id": self.sector_id,
            "sectors_swept": self.sectors_swept,
            "survivors_found": self.survivors_found,
        }


# ─── MissionRecord ────────────────────────────────────────────────────────────

@dataclass
class MissionRecord:
    phase: str = "init"
    round_number: int = 0
    total_sectors: int = 0
    sectors_swept: int = 0
    survivors_found: int = 0
    failed_drones: list[str] = field(default_factory=list)
    failure_injected: bool = False
    completed: bool = False

    def to_dict(self) -> dict:
        return {
            "phase": self.phase,
            "round_number": self.round_number,
            "total_sectors": self.total_sectors,
            "sectors_swept": self.sectors_swept,
            "survivors_found": self.survivors_found,
            "failed_drones": self.failed_drones,
            "failure_injected": self.failure_injected,
            "completed": self.completed,
            "coverage_pct": round(
                self.sectors_swept / max(1, self.total_sectors) * 100, 1
            ),
        }


# ─── SURVIVOR_SPAWN_TILES ─────────────────────────────────────────────────────

SURVIVOR_SPAWN_TILES: list[dict] = [
    {
        "tile_row": 3, "tile_col": 7,
        "description": "Small-stature heat signature detected in deep void. Weak but consistent acoustic 'tapping' detected via vibration sensors.",
        "num_people": 1, "medical_priority": "CRITICAL",
        "extraction_notes": "Confined space. Heat signature is dissipating, suggesting rapid core temperature drop or restricted blood flow.",
        "thermal_reading": 0.88,
    },
    {
        "tile_row": 5, "tile_col": 12,
        "description": "Adult-sized heat signature on exposed ledge. Subject appears non-responsive with irregular respiratory movement.",
        "num_people": 1, "medical_priority": "CRITICAL",
        "extraction_notes": "High exposure risk. Significant thermal leakage indicates potential open wound or lack of insulation.",
        "thermal_reading": 0.65,
    },
    {
        "tile_row": 11, "tile_col": 14,
        "description": "Mid-sized heat signature partially obscured by high-density debris. Subject is active and attempting to move.",
        "num_people": 1, "medical_priority": "HIGH",
        "extraction_notes": "Lower body thermal signature is blocked by structural mass. High risk of entrapment-related trauma.",
        "thermal_reading": 0.72,
    },
    {
        "tile_row": 11, "tile_col": 2,
        "description": "Clear, stable heat signature in sheltered crevice. Subject is conscious and maintaining vocal communication with drone.",
        "num_people": 1, "medical_priority": "MODERATE",
        "extraction_notes": "Strong thermal profile. Limb entrapment detected, but vital signatures remain within normal shock-response parameters.",
        "thermal_reading": 0.78,
    },
]


# ─── SimulationCore ───────────────────────────────────────────────────────────

class SimulationCore:
    """Pure Python simulation state. Wrapped by GameState with asyncio.Lock."""

    def __init__(self, total_sectors: int = 0, seed: int = None):
        from backend.config import BATTERY_MAX_TERRAIN, BASE_TILE_ROW, BASE_TILE_COL
        from backend.terrain import local_m_to_latlng, TILE_M
        import random
        if seed is not None:
            random.seed(seed)

        base_x = BASE_TILE_COL * TILE_M + TILE_M / 2
        base_y = BASE_TILE_ROW * TILE_M + TILE_M / 2
        base_lat, base_lng = local_m_to_latlng(base_x, base_y)

        self.drones: dict[str, DroneSimState] = {
            did: DroneSimState(
                id=did,
                battery=BATTERY_MAX_TERRAIN,
                status="active",
                tile_row=BASE_TILE_ROW,
                tile_col=BASE_TILE_COL,
                lat=base_lat,
                lng=base_lng,
            )
            for did in ["DRONE_A", "DRONE_B", "DRONE_C"]
        }

        self.survivors: dict[str, TileSurvivor] = {}
        for sp in SURVIVOR_SPAWN_TILES:
            x = sp["tile_col"] * TILE_M + TILE_M / 2
            y = sp["tile_row"] * TILE_M + TILE_M / 2
            lat, lng = local_m_to_latlng(x, y)
            tile_id = f"r{sp['tile_row']}_c{sp['tile_col']}"
            self.survivors[tile_id] = TileSurvivor(
                tile_row=sp["tile_row"], tile_col=sp["tile_col"],
                tile_id=tile_id,
                lat=lat, lng=lng,
                **{k: sp[k] for k in sp if k not in ("tile_row", "tile_col")},
            )

        self.swept_sectors: set[int] = set()
        self.mission = MissionRecord(total_sectors=total_sectors)

    def active_drones(self) -> list[DroneSimState]:
        return [d for d in self.drones.values() if d.status != "offline"]

    def mark_sector_complete(self, drone_id: str, sector_id: int) -> dict:
        drone = self.drones.get(drone_id)
        if not drone or drone.status == "offline":
            return {"success": False, "error": f"{drone_id} offline or unknown"}
        self.swept_sectors.add(sector_id)
        if sector_id not in drone.sectors_swept:
            drone.sectors_swept.append(sector_id)
        self.mission.sectors_swept = len(self.swept_sectors)
        if self.mission.sectors_swept >= self.mission.total_sectors:
            self.mission.completed = True
            self.mission.phase = "complete"
        return {
            "success": True, "drone_id": drone_id, "sector_id": sector_id,
            "sectors_swept": self.mission.sectors_swept,
            "total_sectors": self.mission.total_sectors,
        }

    def scan_tile(self, drone_id: str, tile_row: int, tile_col: int) -> dict:
        tile_id = f"r{tile_row}_c{tile_col}"
        survivor = self.survivors.get(tile_id)
        if not survivor or survivor.found:
            return {"survivor_found": False, "tile_id": tile_id}
        drone = self.drones.get(drone_id)
        if drone:
            drone.survivors_found += 1
            survivor.found = True
            survivor.found_by = drone_id
            self.mission.survivors_found += 1
        return {
            "survivor_found": True, "tile_id": tile_id,
            "survivor": survivor.to_dict(),
        }

    def update_drone_position(self, drone_id: str, tile_row: int, tile_col: int,
                               lat: float, lng: float, battery: int,
                               status: str, sector_id: int = -1) -> None:
        drone = self.drones.get(drone_id)
        if drone:
            drone.tile_row = tile_row
            drone.tile_col = tile_col
            drone.lat = lat
            drone.lng = lng
            drone.battery = battery
            drone.status = status
            drone.sector_id = sector_id

    def move_drone_to_tile(self, drone_id: str, row: int, col: int,
                            battery_cost: int) -> dict:
        from backend.config import GRID_N
        from backend.terrain import local_m_to_latlng, TILE_M
        if drone_id not in self.drones:
            return {"success": False, "error": f"Unknown drone {drone_id}"}
        drone = self.drones[drone_id]
        if drone.status == "offline":
            return {"success": False, "error": f"{drone_id} is offline"}
        if not (0 <= row < GRID_N and 0 <= col < GRID_N):
            return {"success": False, "error": f"Tile out of bounds: ({row},{col})"}
        if drone.battery < battery_cost:
            return {"success": False, "error": f"Insufficient battery ({drone.battery} < {battery_cost})"}

        x_m = col * TILE_M + TILE_M / 2
        y_m = row * TILE_M + TILE_M / 2
        lat, lng = local_m_to_latlng(x_m, y_m)

        new_battery = max(0, drone.battery - battery_cost)
        new_status = drone.status
        if new_battery <= 20 and new_status not in ("offline", "rtb"):
            new_status = "low_battery"

        self.update_drone_position(drone_id, row, col, lat, lng, new_battery, new_status)

        return {
            "success": True,
            "drone_id": drone_id,
            "row": row, "col": col,
            "lat": lat, "lng": lng,
            "battery": new_battery,
            "status": new_status,
        }

    def inject_failure(self, drone_id: str) -> dict:
        drone = self.drones.get(drone_id)
        if not drone or drone.status == "offline":
            return {"success": False, "reason": f"{drone_id} already offline"}
        drone.status = "offline"
        self.mission.failed_drones.append(drone_id)
        self.mission.failure_injected = True
        return {
            "success": True, "drone_id": drone_id,
            "orphaned_sectors": [],
        }

    def get_mission_snapshot(self) -> dict:
        from comms import compute_comm_network_terrain
        drone_positions = {
            did: {**d.to_dict(), "pos_km": [d.tile_col * 0.1, d.tile_row * 0.1]}
            for did, d in self.drones.items()
        }
        comm_network = compute_comm_network_terrain(self.drones)
        return {
            "swept_sectors": sorted(self.swept_sectors),
            "total_sectors": self.mission.total_sectors,
            "drone_positions": drone_positions,
            "drones": {did: d.to_dict() for did, d in self.drones.items()},
            "survivors": {sid: s.to_dict() for sid, s in self.survivors.items()},
            "communication_network": comm_network,
            "explored_count": len(self.swept_sectors),
            "coverage_pct": (
                len(self.swept_sectors) / max(1, self.mission.total_sectors) * 100
            ),
        }

    def to_dict(self) -> dict:
        return {
            "mission": self.mission.to_dict(),
            "drones": {did: d.to_dict() for did, d in self.drones.items()},
            "survivors": {sid: s.to_dict() for sid, s in self.survivors.items()},
            "swept_sectors": sorted(self.swept_sectors),
        }


def get_default_assignments() -> dict:
    """Legacy stub — sector assignments are now handled by the supervisor."""
    return {}