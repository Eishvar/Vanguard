"""
config.py — Shared configuration constants.

Import from here; do not duplicate constants across files.
"""

import os

# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------

MCP_URL: str = "http://localhost:8001/mcp"

# ---------------------------------------------------------------------------
# Mesh communication radii (km)
# On the 20×20 terrain grid (tile = 100m, total = 2km × 2km):
#   Worker range 2.5km → covers the entire grid from any position
#   Base range  3.0km → direct base contact from anywhere in the grid
# ---------------------------------------------------------------------------

COMM_RADIUS_KM: dict[str, float] = {
    "worker": 2.0,
    "base": 2.5,
}

# ---------------------------------------------------------------------------
# Battery
# ---------------------------------------------------------------------------

LOW_BATTERY_THRESHOLD: int = 20

# ---------------------------------------------------------------------------
# Test mode — set MOCK_MODE=1 before importing to bypass real LLM calls
# ---------------------------------------------------------------------------

MOCK_MODE: bool = os.getenv("MOCK_MODE", "0") == "1"

# ── Terrain / sector system (new 20×20 grid) ────────────────────────
GRID_N              = 20
TILE_M              = 100.0           # metres per tile side (was 200)
AREA_M              = GRID_N * TILE_M # now 2000m (was 4000m)
OBSTACLE_ELEV_M     = 580.0          # placeholder — will be updated manually
SWEEP_SPACING_M     = 25.0            # was 50 — proportional to tile size change; kept for cache hash

# ── Per-sector sweep spacing ─────────────────────────────────────
SWEEP_SPACING_MIN_M     = 15.0    # tightest spacing (high density sectors)
SWEEP_SPACING_MAX_M     = 50.0    # loosest spacing (low density sectors)
# These are the density range endpoints for linear interpolation.
# Sectors with avg_density >= SWEEP_DENSITY_HIGH get MIN spacing.
# Sectors with avg_density <= SWEEP_DENSITY_LOW get MAX spacing.
# Values are auto-set from Jenks thresholds at runtime if density classification is available.
SWEEP_DENSITY_LOW       = 0.07    # fallback; overridden at runtime
SWEEP_DENSITY_HIGH      = 0.22    # fallback; overridden at runtime

# ── Drone speed constants ─────────────────────────────────────────────────
  # DRONE_SPEED_MPS: real-world physical drone cruise speed (metres/second).
  # Use this ONLY for mission duration estimation, planning, or any future
  # time-based calculations. It is NOT used for frontend animation timing.
DRONE_SPEED_MPS     = 8.0         # cruise speed

BASE_TILE_ROW       = 0           # SW corner row (math convention: 0 = south)
BASE_TILE_COL       = 0           # SW corner col (math convention: 0 = west)

# Anchor = SW corner of the 4km × 4km search box
ANCHOR_LAT          = 5.93574238      # SW corner latitude (Ranau, Sabah; 50m SW of base station)
ANCHOR_LNG          = 116.65771582    # SW corner longitude

# Battery for terrain system. Sized so a single drone failure is recoverable.
BATTERY_MAX_TERRAIN       = 100     # Adjusted for clean 0-100% frontend gauge
BATTERY_PER_100M          = 0.14    # Tuned so 52km sector uses exactly ~73% battery
BATTERY_RTB_RESERVE       = 25      # Standard launch reserve
BATTERY_EMERGENCY_RESERVE = 10      # Relaxed reserve for post-failure self-healing

# ── Density classification ───────────────────────────────────────
# Auto-computed via Jenks natural breaks at terrain build time.
# These are defaults; the actual thresholds come from the data.
DENSITY_N_CLASSES       = 3           # Jenks breaks: high, medium, low
ELEVATION_SAFETY_MARGIN = 10.0        # metres above max high/medium density tile
AUTO_ELEVATION_ENABLED  = True        # True = auto-compute, False = use OBSTACLE_ELEV_M

# ── Density-weighted clustering ──────────────────────────────────
CLUSTER_WEIGHT_DENSITY  = 3.0         # weight for density in feature vector
CLUSTER_WEIGHT_SPATIAL  = 1.0         # weight for spatial position (row, col)
CLUSTER_WEIGHT_ELEV     = 0.5         # weight for elevation (demoted from 2.0)

# ── Parallel execution pacing ─────────────────────────────────────────────
# Delay (seconds) between node ticks when WAYPOINT_EMIT_DELAY_S > 0.
# 0.0 = emit at CPU speed; frontend queue handles visual pacing.
WAYPOINT_EMIT_DELAY_S   = 0.0

# How many node ticks between grid_update + stats_update SSE emissions.
# Lower = more frequent frontend map refreshes. Recommended: 10-20.
GRID_UPDATE_INTERVAL    = 15
# VISUAL_DRONE_SPEED_MPS: frontend animation drain speed ONLY.
# The per-drone heading queue in missionStore.ts drains one event per:
# durationMs = Math.max(50, dist_m / VISUAL_DRONE_SPEED_MPS * 1000)
# MUST match the TypeScript constant in frontend/src/stores/missionStore.ts:
# const VISUAL_DRONE_SPEED_MPS = 333
# To slow animation: decrease this value (e.g. 50.0 ≈ real-time at 8 m/s).
# These two constants serve different purposes and do NOT conflict.
VISUAL_DRONE_SPEED_MPS  = 600.0

