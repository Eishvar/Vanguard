#!/usr/bin/env python3
"""
One-shot terrain data rebuild. Use this after changing ANCHOR_LAT/ANCHOR_LNG,
TILE_M, GRID_N, or OBSTACLE_ELEV_M in backend/config.py.

What it does:
  1. Runs fetch_elevation.py (regenerates merapi_elevation_20x20.json with new anchor)
  2. Runs fetch_buildings.py (regenerates kaliurang_density_20x20.json with new anchor)
  3. Clears sectors_cache.json
  4. Cold-builds the terrain model to force sector regeneration
  5. Prints base station elevation and recommended OBSTACLE_ELEV_M value
     (= base elev + 120m, or whatever the --ceiling arg is)

Workflow:
  First run:
    # set placeholder OBSTACLE_ELEV_M = 9999 in config.py, then:
    python backend/scripts/rebuild_terrain.py
    # Note the recommended OBSTACLE_ELEV_M value printed at the end
    # Manually edit backend/config.py to set OBSTACLE_ELEV_M = <recommended>
    python backend/scripts/rebuild_terrain.py
    # Sectors now reflect the correct obstacle threshold
"""
import argparse, subprocess, sys, json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--ceiling", type=float, default=120.0,
                    help="Flight ceiling in metres above base station ASL. Default 120m (civilian drone limit).")
parser.add_argument("--skip-fetch", action="store_true",
                    help="Skip elevation + building fetches, only rebuild sectors. Use when only OBSTACLE_ELEV_M changed.")
args = parser.parse_args()

repo_root = Path(__file__).parent.parent.parent

def run(cmd: list[str]):
    print(f"→ {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=repo_root)
    if r.returncode != 0:
        print(f"FAILED: {cmd}", file=sys.stderr)
        sys.exit(r.returncode)

if not args.skip_fetch:
    # Step 1: elevation
    run([sys.executable, "backend/scripts/fetch_elevation.py"])
    # Step 2: building density
    run([sys.executable, "backend/scripts/fetch_buildings.py"])

# Step 3: clear sector cache
cache = repo_root / "backend" / "data" / "sectors_cache.json"
if cache.exists():
    cache.unlink()
    print(f"→ Cleared {cache}")

# Step 4: cold-build terrain
sys.path.insert(0, str(repo_root))
from backend.terrain import build_terrain_model, BASE_TILE_ROW, BASE_TILE_COL
from backend.config import OBSTACLE_ELEV_M, ANCHOR_LAT, ANCHOR_LNG, TILE_M, GRID_N
tiles, sectors, _ = build_terrain_model()

# Step 5: print recommendations
base_tile = tiles[BASE_TILE_ROW][BASE_TILE_COL]
base_elev = base_tile.elevation_m
recommended = round(base_elev + args.ceiling, 1)

all_elevs = [t.elevation_m for row in tiles for t in row]
elev_min  = min(all_elevs)
elev_max  = max(all_elevs)
elev_mean = sum(all_elevs) / len(all_elevs)

print()
print("=" * 64)
print(f"Terrain rebuild complete.")
print(f"  Anchor (SW corner):       ({ANCHOR_LAT}, {ANCHOR_LNG})")
print(f"  Grid:                     {GRID_N}×{GRID_N} @ {TILE_M}m tiles")
print(f"  Coverage:                 {GRID_N * TILE_M / 1000:.2f}km × {GRID_N * TILE_M / 1000:.2f}km")
print(f"  Elevation range:          {elev_min:.0f}m – {elev_max:.0f}m ASL (mean {elev_mean:.0f}m)")
print(f"  Base station elevation:   {base_elev:.0f}m ASL  [tile ({BASE_TILE_ROW},{BASE_TILE_COL})]")
print(f"  Current OBSTACLE_ELEV_M:  {OBSTACLE_ELEV_M}m  ({'⚠ PLACEHOLDER' if OBSTACLE_ELEV_M > 9000 else 'active'})")
print()
print(f"  Recommended OBSTACLE_ELEV_M (ceiling +{args.ceiling:.0f}m above base): {recommended}m")
print()

scan_ct = sum(1 for s in sectors if not s.is_obstacle)
obs_ct  = sum(1 for s in sectors if s.is_obstacle)
print(f"  Sectors generated:        {scan_ct} scan + {obs_ct} obstacle")

if OBSTACLE_ELEV_M > 9000 or OBSTACLE_ELEV_M >= elev_max:
    print()
    print("  → Next step:")
    print(f"    Edit backend/config.py and set OBSTACLE_ELEV_M = {recommended}")
    print(f"    Then re-run: python backend/scripts/rebuild_terrain.py --skip-fetch")
print("=" * 64)
