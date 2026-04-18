#!/usr/bin/env python3
"""
Run once: queries Overpass API for OSM buildings, saves raw JSON + density grid.
Output JSON uses project convention: row 0 = southernmost.
"""
import json, math, numpy as np, requests
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import Polygon, box
from shapely.strtree import STRtree

ANCHOR_LAT = -7.6650 
ANCHOR_LNG = 110.4195
AREA_KM    = 4.0
GRID_N     = 20
TILE_M     = (AREA_KM * 1000) / GRID_N

LAT_PER_KM = 1 / 110.574
LNG_PER_KM = 1 / (111.320 * math.cos(math.radians(ANCHOR_LAT + AREA_KM * LAT_PER_KM / 2)))
S = ANCHOR_LAT
N = ANCHOR_LAT + AREA_KM * LAT_PER_KM
W = ANCHOR_LNG
E = ANCHOR_LNG + AREA_KM * LNG_PER_KM

cache = Path("backend/data/kaliurang_buildings_raw.json")

if not cache.exists():
    print("Fetching buildings from Overpass API (internet required once)...")
    query = f"""
[out:json][timeout:90];
(
  way["building"]({S},{W},{N},{E});
  relation["building"]({S},{W},{N},{E});
);
out geom;
"""
    resp = requests.post(
        "https://overpass.kumi.systems/api/interpreter",
        data={"data": query},
        headers={"User-Agent": "VANGUARD-SAR/1.0"},
        timeout=180,
    )
    resp.raise_for_status()
    cache.write_text(resp.text)
    print(f"Cached raw OSM: {len(resp.content)//1024} KB")
else:
    print(f"Using cached OSM: {cache}")

data = json.loads(cache.read_text())

# Project to UTM 49S (correct zone for central Java, ~0.05% distortion)
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32749", always_xy=True).transform

def latlon_to_utm(lat, lon):
    x, y = to_utm(lon, lat)
    return (x, y)

buildings = []
for el in data.get("elements", []):
    if el["type"] == "way" and "geometry" in el:
        ring = [latlon_to_utm(p["lat"], p["lon"]) for p in el["geometry"]]
        if len(ring) >= 3:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            poly = Polygon(ring)
            if poly.is_valid and poly.area > 1.0:
                buildings.append(poly)

print(f"Parsed {len(buildings)} building polygons")

# Anchor in UTM — SW corner
x0, y0 = to_utm(ANCHOR_LNG, ANCHOR_LAT)

tree = STRtree(buildings) if buildings else None
count_grid = np.zeros((GRID_N, GRID_N), dtype=np.int32)
cover_grid = np.zeros((GRID_N, GRID_N), dtype=np.float32)

# row 0 = southernmost. Tile (row, col) occupies:
#   x: [x0 + col*TILE_M, x0 + (col+1)*TILE_M]
#   y: [y0 + row*TILE_M, y0 + (row+1)*TILE_M]
for row in range(GRID_N):
    for col in range(GRID_N):
        tile = box(
            x0 + col * TILE_M,
            y0 + row * TILE_M,
            x0 + (col + 1) * TILE_M,
            y0 + (row + 1) * TILE_M,
        )
        if tree is None:
            continue
        idxs = tree.query(tile)
        for idx in idxs:
            b = buildings[int(idx)]
            inter = tile.intersection(b)
            if not inter.is_empty:
                cover_grid[row, col] += inter.area
                if tile.contains(b.centroid):
                    count_grid[row, col] += 1
        cover_grid[row, col] = min(1.0, cover_grid[row, col] / (TILE_M * TILE_M))

max_count = max(int(count_grid.max()), 1)
density = np.clip(0.5 * (count_grid / max_count) + 0.5 * cover_grid, 0.0, 1.0)

out = {
    "meta": {
        "source": "OpenStreetMap via Overpass API",
        "anchor_sw_corner": {"lat": ANCHOR_LAT, "lng": ANCHOR_LNG},
        "bbox": {"south": S, "north": N, "west": W, "east": E},
        "grid_n": GRID_N,
        "tile_m": TILE_M,
        "n_buildings": len(buildings),
        "projection": "EPSG:32749 (UTM 49S)",
        "row_convention": "row 0 = southernmost, col 0 = westernmost (math convention)",
    },
    "count_grid": count_grid.tolist(),
    "coverage_grid": cover_grid.round(4).tolist(),
    "density_grid":  density.round(4).tolist(),
}

Path("backend/data/kaliurang_density_20x20.json").write_text(json.dumps(out))
print(f"Density range: {density.min():.3f} – {density.max():.3f}")
print("Saved: backend/data/kaliurang_density_20x20.json")
