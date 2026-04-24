#!/usr/bin/env python3
import sys
from pathlib import Path

# Add the project root to Python's path so it can find the 'backend' module
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
import numpy as np
import json

# NOW the import will work perfectly
from backend.config import ANCHOR_LAT, ANCHOR_LNG, TILE_M, GRID_N, AREA_M

# Use the config values for the SW corner
west = ANCHOR_LNG
south = ANCHOR_LAT

# Calculate the NE corner based on the 2km (AREA_M) search area
# Using the standard degree conversion formulas from your guide
east = west + (AREA_M / (111320 * np.cos(np.deg2rad(south))))
north = south + (AREA_M / 110574)

print(f"DEBUG: Calculated Ranau Bounds: W={west}, S={south}, E={east}, N={north}")

SRC_TIF = "backend/data/srtm_60_11.tif"

with rasterio.open(SRC_TIF) as src:
    # 1. Print the bounds to see what the script is actually calculating
    print(f"DEBUG: Requested Bounds: W={west}, S={south}, E={east}, N={north}")
    print(f"DEBUG: SRTM Tile Bounds: {src.bounds}")

    # 2. Create the window
    window = from_bounds(west, south, east, north, src.transform)
    
    # 3. CLAMP the window to the tile size (fixes the 'Requested 6000' error)
    # This ensures the window is intersectioned with the actual image dimensions
    window = window.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
    
    print(f"DEBUG: Clamped Window: {window}")

    # 4. Perform the read
    arr_image = src.read(
        1, window=window,
        out_shape=(GRID_N, GRID_N),
        resampling=Resampling.average,
    ).astype("float32")

# FLIP to project convention: row 0 = SOUTH
arr = np.flipud(arr_image)

# SRTM NODATA is -32768 — replace with interpolated mean
arr = np.where(arr < -500, np.nan, arr)
if np.any(np.isnan(arr)):
    mean_elev = np.nanmean(arr)
    arr = np.where(np.isnan(arr), mean_elev, arr)

print(f"Elevation range: {arr.min():.0f}m – {arr.max():.0f}m ASL")
print(f"Shape: {arr.shape} (row 0 = southernmost)")
print(f"SW corner tile (0,0) elev:  {arr[0, 0]:.0f}m")
print(f"NE corner tile (19,19) elev: {arr[-1, -1]:.0f}m")

out = {
    "meta": {
        "source": "SRTM CGIAR-CSI 90m",
        "anchor_sw_corner": {"lat": ANCHOR_LAT, "lng": ANCHOR_LNG},
        "bbox": {"south": south, "north": north, "west": west, "east": east},
        "grid_n": GRID_N,
        "tile_m": TILE_M,
        "units": "meters_asl",
        "row_convention": "row 0 = southernmost, col 0 = westernmost (math convention)",
    },
    "elevations": [[round(float(v), 1) for v in row] for row in arr],
}

import pathlib
pathlib.Path("backend/data/merapi_elevation_20x20.json").write_text(json.dumps(out))
print("Saved: backend/data/merapi_elevation_20x20.json")
