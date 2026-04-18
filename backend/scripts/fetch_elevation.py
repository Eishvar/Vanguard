#!/usr/bin/env python3
"""
Run once: generates backend/data/merapi_elevation_20x20.json
SRTM source array has row 0 = north (image convention). We flip it on ingestion
so the output JSON follows project convention: row 0 = south, row 19 = north.
"""
import json, numpy as np, rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

# Grid config — must match terrain.py and config.py constants
# Anchor = southwest corner of the 4km × 4km search box
ANCHOR_LAT = -7.6650       # SW corner latitude
ANCHOR_LNG = 110.4195        # SW corner longitude
AREA_KM    = 4.0
GRID_N     = 20
TILE_M     = (AREA_KM * 1000) / GRID_N   # 200m

LAT_PER_KM = 1 / 110.574
LNG_PER_KM = 1 / (111.320 * np.cos(np.deg2rad(ANCHOR_LAT + AREA_KM * LAT_PER_KM / 2)))

south = ANCHOR_LAT
north = ANCHOR_LAT + AREA_KM * LAT_PER_KM
west  = ANCHOR_LNG
east  = ANCHOR_LNG + AREA_KM * LNG_PER_KM

SRC_TIF = "backend/data/srtm_59_14.tif"

with rasterio.open(SRC_TIF) as src:
    window = from_bounds(west, south, east, north, src.transform)
    # resample to exactly 20x20, averaging contributing pixels
    # rasterio output: row 0 = NORTH (image convention)
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
