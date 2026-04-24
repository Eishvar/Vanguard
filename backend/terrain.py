"""
backend/terrain.py
Terrain analysis, sector clustering, and lawnmower path generation.
100% offline, deterministic, CPU-only after one-time data acquisition.
"""
import json, math, hashlib, time, heapq
import numpy as np
import jenkspy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from scipy.ndimage import label as cc_label, binary_closing
from sklearn.cluster import AgglomerativeClustering
from sklearn.feature_extraction.image import grid_to_graph
from shapely.geometry import Polygon, LineString, MultiLineString, Point, box
from shapely.ops import unary_union

from backend.config import (
    GRID_N, TILE_M, AREA_M,
    OBSTACLE_ELEV_M, SWEEP_SPACING_M,
    BASE_TILE_ROW, BASE_TILE_COL,
    ANCHOR_LAT, ANCHOR_LNG,
    BATTERY_MAX_TERRAIN, BATTERY_PER_100M, BATTERY_RTB_RESERVE,
    DENSITY_N_CLASSES, ELEVATION_SAFETY_MARGIN, AUTO_ELEVATION_ENABLED,
    CLUSTER_WEIGHT_DENSITY, CLUSTER_WEIGHT_SPATIAL, CLUSTER_WEIGHT_ELEV,
    SWEEP_SPACING_MIN_M, SWEEP_SPACING_MAX_M, SWEEP_DENSITY_LOW, SWEEP_DENSITY_HIGH,
)

LAT_PER_M = 1 / 110_574.0
LNG_PER_M = 1 / (111_320.0 * math.cos(math.radians(ANCHOR_LAT + AREA_M * LAT_PER_M / 2)))

DATA_DIR   = Path(__file__).parent / "data"
CACHE_FILE = DATA_DIR / "sectors_cache.json"


# ═══ Data classes ═══════════════════════════════════════════════════════════

@dataclass
class Tile:
    row: int                    # 0 = south, 19 = north
    col: int                    # 0 = west,  19 = east
    elevation_m: float
    density: float              # 0.0–1.0
    is_obstacle: bool
    sector_id: int = -1

    @property
    def x_m(self) -> float:     # metres east of SW corner (left edge of tile)
        return self.col * TILE_M

    @property
    def y_m(self) -> float:     # metres north of SW corner (bottom edge of tile)
        return self.row * TILE_M

    @property
    def centroid_xy(self) -> tuple[float, float]:
        return (self.x_m + TILE_M / 2, self.y_m + TILE_M / 2)


@dataclass
class Sector:
    sector_id: int
    is_obstacle: bool
    tiles: list                 # list of (row, col) tuples
    polygon_coords: list        # [[x, y], ...] in local metres
    centroid: list              # [x, y] in local metres
    area_m2: float
    avg_elevation_m: float
    avg_density: float
    sweep_path_coords: list     # [[x, y], ...] waypoints (empty for obstacles)
    sweep_path_length_m: float = 0.0
    battery_cost: int = 0
    sweep_nodes: list[dict] = field(default_factory=list)

    @property
    def area_km2(self) -> float:
        return self.area_m2 / 1_000_000

    def to_dict(self) -> dict:
        return {
            "sector_id": self.sector_id,
            "is_obstacle": self.is_obstacle,
            "tiles": self.tiles,
            "polygon_coords": self.polygon_coords,
            "centroid": self.centroid,
            "area_m2": self.area_m2,
            "avg_elevation_m": round(self.avg_elevation_m, 1),
            "avg_density": round(self.avg_density, 4),
            "sweep_path_coords": self.sweep_path_coords,
            "sweep_path_length_m": round(self.sweep_path_length_m, 1),
            "battery_cost": self.battery_cost,
            "sweep_nodes": self.sweep_nodes,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Sector":
        valid = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        valid.setdefault("sweep_nodes", [])
        return cls(**valid)


# ═══ Data loading ═══════════════════════════════════════════════════════════

_elevation_cache: Optional[np.ndarray] = None
_density_cache:   Optional[np.ndarray] = None

def load_elevation() -> np.ndarray:
    global _elevation_cache
    if _elevation_cache is None:
        data = json.loads((DATA_DIR / "merapi_elevation_20x20.json").read_text())
        _elevation_cache = np.array(data["elevations"], dtype=np.float32)
    return _elevation_cache

def load_density() -> np.ndarray:
    global _density_cache
    if _density_cache is None:
        data = json.loads((DATA_DIR / "kaliurang_density_20x20.json").read_text())
        _density_cache = np.array(data["density_grid"], dtype=np.float32)
    return _density_cache

def build_tiles() -> list[list[Tile]]:
    elev = load_elevation()
    dens = load_density()
    tiles = []
    for row in range(GRID_N):
        row_tiles = []
        for col in range(GRID_N):
            e = float(elev[row, col])
            d = float(dens[row, col])
            row_tiles.append(Tile(
                row=row, col=col,
                elevation_m=e,
                density=d,
                is_obstacle=False,  # set after density classification in build_terrain_model
            ))
        tiles.append(row_tiles)
    return tiles


# ═══ Density classification ══════════════════════════════════════════════════

_density_classification: dict = {}

def get_density_classification() -> dict:
    return _density_classification


def compute_density_classes(tiles: list[list["Tile"]]) -> dict:
    """
    Classify tiles into high/medium/low density using Jenks natural breaks.
    Returns dict with keys: 'thresholds' (list of 2 break values),
    'high_tiles', 'medium_tiles', 'low_tiles' (lists of (row, col)),
    'auto_obstacle_elev_m' (float — max elevation of high+medium tiles + safety margin).
    """
    densities = []
    for row in tiles:
        for t in row:
            if t.density > 0:
                densities.append(t.density)

    if len(densities) < DENSITY_N_CLASSES + 1:
        med = float(np.median(densities)) if densities else 0.1
        return {
            "thresholds": [med * 0.5, med],
            "high_tiles": [], "medium_tiles": [], "low_tiles": [],
            "auto_obstacle_elev_m": OBSTACLE_ELEV_M,
        }

    breaks = jenkspy.jenks_breaks(densities, n_classes=DENSITY_N_CLASSES)
    # breaks returns [min, break1, break2, max] for 3 classes
    low_upper = breaks[1]   # below this = low
    med_upper = breaks[2]   # below this = medium, above = high

    high_tiles   = []
    medium_tiles = []
    low_tiles    = []
    max_elev_hm  = 0.0  # max elevation among high + medium density tiles

    for row in tiles:
        for t in row:
            if t.density >= med_upper:
                high_tiles.append((t.row, t.col))
                max_elev_hm = max(max_elev_hm, t.elevation_m)
            elif t.density >= low_upper:
                medium_tiles.append((t.row, t.col))
                max_elev_hm = max(max_elev_hm, t.elevation_m)
            else:
                low_tiles.append((t.row, t.col))

    auto_elev = max_elev_hm + ELEVATION_SAFETY_MARGIN if max_elev_hm > 0 else OBSTACLE_ELEV_M

    return {
        "thresholds": [round(low_upper, 4), round(med_upper, 4)],
        "high_tiles": high_tiles,
        "medium_tiles": medium_tiles,
        "low_tiles": low_tiles,
        "auto_obstacle_elev_m": round(auto_elev, 1),
    }


# ═══ Clustering ══════════════════════════════════════════════════════════════

def _auto_n_clusters(X: np.ndarray, connectivity, min_k: int = 6, max_k: int = 16) -> int:
    n_free = X.shape[0]
    safe_max = min(max_k, max(min_k + 1, n_free // 4))
    if n_free < min_k + 3:
        return max(2, min(min_k, n_free - 1))
    model = AgglomerativeClustering(connectivity=connectivity, linkage="ward", compute_distances=True)
    model.fit(X)
    dists = model.distances_
    window = dists[-min(len(dists), safe_max + 2):]
    if len(window) < 3:
        return min_k
    accel = np.diff(window, 2)
    if accel.size == 0:
        return min_k
    k = int(accel.argmax()) + 2
    return int(np.clip(k, min_k, safe_max))

def cluster_tiles(tiles: list[list[Tile]]) -> tuple[np.ndarray, int]:
    elev = np.array([[t.elevation_m for t in row] for row in tiles], dtype=np.float32)
    dens = np.array([[t.density     for t in row] for row in tiles], dtype=np.float32)

    obstacle = np.array([[t.is_obstacle for t in row] for row in tiles], dtype=bool)
    struct   = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    obstacle = binary_closing(obstacle, structure=struct, iterations=1)
    free     = ~obstacle

    obs_cc, _ = cc_label(obstacle, structure=struct)

    e_norm = (elev - elev.mean()) / (elev.std() + 1e-9) * CLUSTER_WEIGHT_ELEV
    d_norm = (dens - dens.mean()) / (dens.std() + 1e-9) * CLUSTER_WEIGHT_DENSITY

    rows_grid = np.tile(np.arange(GRID_N).reshape(-1, 1), (1, GRID_N)).astype(np.float32)
    cols_grid = np.tile(np.arange(GRID_N).reshape(1, -1), (GRID_N, 1)).astype(np.float32)
    r_norm = (rows_grid - rows_grid.mean()) / (rows_grid.std() + 1e-9) * CLUSTER_WEIGHT_SPATIAL
    c_norm = (cols_grid - cols_grid.mean()) / (cols_grid.std() + 1e-9) * CLUSTER_WEIGHT_SPATIAL

    X      = np.column_stack([e_norm.ravel(), d_norm.ravel(), r_norm.ravel(), c_norm.ravel()])
    X_free = X[free.ravel()]

    conn   = grid_to_graph(n_x=GRID_N, n_y=GRID_N, mask=free)

    if X_free.shape[0] < 6:
        labels = np.full((GRID_N, GRID_N), -1, dtype=np.int32)
        labels[free]     = 0
        labels[obstacle] = 1000 + obs_cc[obstacle]
        return labels, 1

    n_scan = _auto_n_clusters(X_free, conn)
    ward   = AgglomerativeClustering(n_clusters=n_scan, linkage="ward", connectivity=conn)
    ward.fit(X_free)

    labels = np.full((GRID_N, GRID_N), -1, dtype=np.int32)
    labels[free]     = ward.labels_
    labels[obstacle] = 1000 + obs_cc[obstacle]
    return labels, n_scan


def _reconcile_obstacle_labels(tiles: list[list["Tile"]], labels: np.ndarray) -> np.ndarray:
    """Ensure every tile with is_obstacle=True has a label >= 1000."""
    from collections import deque
    for r in range(GRID_N):
        for c in range(GRID_N):
            if tiles[r][c].is_obstacle and labels[r, c] < 1000:
                visited = set()
                queue = deque([(r, c)])
                found_label = 1000  # fallback
                while queue:
                    cr, cc = queue.popleft()
                    if (cr, cc) in visited:
                        continue
                    visited.add((cr, cc))
                    if labels[cr, cc] >= 1000:
                        found_label = labels[cr, cc]
                        break
                    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        nr, nc = cr + dr, cc + dc
                        if 0 <= nr < GRID_N and 0 <= nc < GRID_N:
                            queue.append((nr, nc))
                labels[r, c] = found_label
    return labels


def labels_to_sectors(labels: np.ndarray, tiles: list[list[Tile]]) -> list[Sector]:
    elev = np.array([[t.elevation_m for t in row] for row in tiles])
    dens = np.array([[t.density     for t in row] for row in tiles])

    sectors = []
    for lab in sorted(np.unique(labels)):
        if lab < 0:
            continue
        is_obs = bool(lab >= 1000)
        rr, cc = np.where(labels == lab)

        tile_boxes = [
            box(c * TILE_M, r * TILE_M, (c + 1) * TILE_M, (r + 1) * TILE_M)
            for r, c in zip(rr, cc)
        ]
        poly = unary_union(tile_boxes)
        poly = poly.simplify(0, preserve_topology=True)

        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda p: p.area)

        coords = [[round(x, 2), round(y, 2)] for x, y in poly.exterior.coords]
        avg_e = float(np.mean(elev[rr, cc]))
        avg_d = float(np.mean(dens[rr, cc]))
        tile_list = [[int(r), int(c)] for r, c in zip(rr, cc)]

        sectors.append(Sector(
            sector_id=int(lab),
            is_obstacle=is_obs,
            tiles=tile_list,
            polygon_coords=coords,
            centroid=[round(poly.centroid.x, 2), round(poly.centroid.y, 2)],
            area_m2=float(poly.area),
            avg_elevation_m=round(avg_e, 1),
            avg_density=round(avg_d, 4),
            sweep_path_coords=[],
        ))
    return sectors


# ═══ Lawnmower Path (Intra-Sector Boundary Hugger) ══════════════════════════

def lawnmower_path(polygon: Polygon, spacing: float = SWEEP_SPACING_M) -> LineString:
    """
    Robust horizontal sweep that safely routes around concavities (U-shapes/L-shapes).
    Guarantees the drone never cuts across empty space or into adjacent sectors.
    """
    import math
    from shapely.geometry import Point
    from shapely.ops import substring
    
    if polygon.is_empty or polygon.area < spacing ** 2:
        return LineString()
        
    minx, miny, maxx, maxy = polygon.bounds
    pad = max(1.0, (maxx - minx) * 0.02)
    ys = []
    y = miny + spacing / 2
    
    while y < maxy:
        ys.append(y)
        y += spacing
        
    all_segments = []
    for yy in ys:
        line = LineString([(minx - pad, yy), (maxx + pad, yy)])
        clipped = polygon.intersection(line)
        if clipped.is_empty:
            continue
        parts = [clipped] if clipped.geom_type == "LineString" else list(clipped.geoms)
        all_segments.extend(parts)

    if not all_segments:
        return LineString()

    # Greedy segment chaining (fixes U-shape overlapping jumps)
    segments = []
    # Start at the lowest-Y, lowest-X segment
    all_segments.sort(key=lambda s: (s.coords[0][1], min(s.coords[0][0], s.coords[-1][0])))
    curr = all_segments.pop(0)

    # Ensure initial direction is left-to-right
    if curr.coords[0][0] > curr.coords[-1][0]:
        curr = LineString(list(curr.coords)[::-1])
    segments.append(curr)

    while all_segments:
        p_end = segments[-1].coords[-1]

        best_idx = 0
        best_dist = float('inf')
        reverse_best = False

        for i, seg in enumerate(all_segments):
            s_start = seg.coords[0]
            s_end = seg.coords[-1]
            d1 = math.hypot(p_end[0] - s_start[0], p_end[1] - s_start[1])
            d2 = math.hypot(p_end[0] - s_end[0], p_end[1] - s_end[1])

            if d1 < best_dist:
                best_dist = d1
                best_idx = i
                reverse_best = False
            if d2 < best_dist:
                best_dist = d2
                best_idx = i
                reverse_best = True

        nxt = all_segments.pop(best_idx)
        if reverse_best:
            nxt = LineString(list(nxt.coords)[::-1])
        segments.append(nxt)
        
    coords = list(segments[0].coords)
    
    def safe_route(p1: tuple, p2: tuple) -> list[tuple]:
        direct = LineString([p1, p2])

        # Fast path: direct segment is safely inside the polygon.
        if polygon.buffer(1.0, join_style=2).contains(direct):
            return [p1, p2]

        pt1, pt2 = Point(p1), Point(p2)

        candidate_rings = [LineString(polygon.exterior.coords)]
        for interior in polygon.interiors:
            candidate_rings.append(LineString(interior.coords))

        # ── L-shape candidates (try both orientations) ──────────────────────
        # For normal row-to-row connectors, one of these two will be fully
        # inside the polygon, producing a clean right-angle path.
        mid1 = (p2[0], p1[1])   # go horizontal first, then vertical
        mid2 = (p1[0], p2[1])   # go vertical first, then horizontal

        for mid in (mid1, mid2):
            l_shape = LineString([p1, mid, p2])
            # Buffer by 2.01 to counteract the -2.0 inset rounding on concave corners
            if polygon.buffer(2.01, join_style=2).contains(l_shape):
                return [p1, mid, p2]

        # ── Perimeter-hug fallback (only for genuinely complex gaps) ────────
        best_route: list[tuple] = [p1, p2]
        best_len   = float("inf")

        for ring in candidate_rings:
            d1 = ring.project(pt1)
            d2 = ring.project(pt2)
            start_d, end_d = min(d1, d2), max(d1, d2)

            path_a  = substring(ring, start_d, end_d)
            path_b1 = substring(ring, end_d, ring.length)
            path_b2 = substring(ring, 0.0, start_d)

            if path_a.length <= (path_b1.length + path_b2.length):
                route_coords = list(path_a.coords)
            else:
                route_coords = list(path_b1.coords) + list(path_b2.coords)

            if not route_coords:
                continue

            if pt1.distance(Point(route_coords[0])) > pt1.distance(Point(route_coords[-1])):
                route_coords.reverse()

            dist_to_ring   = pt1.distance(Point(route_coords[0]))
            dist_from_ring = pt2.distance(Point(route_coords[-1]))
            dist_on_ring   = (LineString(route_coords).length
                              if len(route_coords) >= 2 else float("inf"))
            jump_penalty   = (max(0, dist_to_ring - 1.0) +
                              max(0, dist_from_ring - 1.0)) * 1000
            total_cost = dist_to_ring + dist_on_ring + dist_from_ring + jump_penalty

            if total_cost < best_len:
                best_len  = total_cost
                best_route = [p1] + route_coords + [p2]

        return best_route

    # Connect the segments safely
    for prev, nxt in zip(segments[:-1], segments[1:]):
        p_end = prev.coords[-1]
        p_start = nxt.coords[0]
        
        if list(p_end) != list(p_start):
            route = safe_route(p_end, p_start)
            # Avoid duplicating the start/end coordinate
            coords.extend(route[1:-1])
            coords.append(p_start)

        coords.extend(list(nxt.coords)[1:])

    # Clean up coordinates to remove zero-length segments (duplicate points).
    # Duplicate points break MapLibre's line renderer and cause clustered nodes.
    cleaned_coords = [coords[0]]
    for p in coords[1:]:
        if math.hypot(p[0] - cleaned_coords[-1][0], p[1] - cleaned_coords[-1][1]) > 0.05: # > 5cm
            cleaned_coords.append(p)

    return LineString(cleaned_coords)


# ═══ Sweep Node Computation ══════════════════════════════════════════════════

def compute_sweep_nodes(path: LineString, tile_m: float) -> list[dict]:
    import math
    if path.is_empty or len(path.coords) < 2:
        return []

    coords = list(path.coords)
    nodes: list[dict] = []

    def _add(x: float, y: float, ntype: str) -> None:
        # Sequential dedup: check distance to the LAST added node
        if nodes:
            last = nodes[-1]
            if math.hypot(x - last["x_m"], y - last["y_m"]) < 0.2:
                # If the new node is an anchor, it overrides tile_border
                if ntype == "anchor" and last["type"] != "anchor":
                    nodes[-1]["type"] = "anchor"
                return
        nodes.append({"x_m": round(x, 3), "y_m": round(y, 3), "type": ntype})

    _add(coords[0][0], coords[0][1], "anchor")

    for i in range(len(coords) - 1):
        x0, y0 = coords[i]
        x1, y1 = coords[i + 1]

        # 1. Turn node at the start of this segment (if not the very first point)
        if i > 0:
            dx1 = x0 - coords[i - 1][0];  dy1 = y0 - coords[i - 1][1]
            dx2 = x1 - x0;                dy2 = y1 - y0
            cross = abs(dx1 * dy2 - dy1 * dx2)
            if cross > 1e-3:
                _add(x0, y0, "tile_border")

        # 2. Tile border crossings along this segment
        crossings = []
        if abs(x1 - x0) > 1e-6:
            k_min = int(math.ceil(min(x0, x1) / tile_m))
            k_max = int(math.floor(max(x0, x1) / tile_m))
            for k in range(k_min, k_max + 1):
                xb = k * tile_m
                t = (xb - x0) / (x1 - x0)
                if 0 < t < 1:
                    crossings.append((xb, y0 + t * (y1 - y0)))

        if abs(y1 - y0) > 1e-6:
            k_min = int(math.ceil(min(y0, y1) / tile_m))
            k_max = int(math.floor(max(y0, y1) / tile_m))
            for k in range(k_min, k_max + 1):
                yb = k * tile_m
                t = (yb - y0) / (y1 - y0)
                if 0 < t < 1:
                    crossings.append((x0 + t * (x1 - x0), yb))

        # Sort crossings purely by distance from the segment start (x0, y0)
        crossings.sort(key=lambda p: math.hypot(p[0] - x0, p[1] - y0))

        for cx, cy in crossings:
            _add(cx, cy, "tile_border")

    _add(coords[-1][0], coords[-1][1], "anchor")

    # Sanity enforcement
    if nodes:
        nodes[0]["type"] = "anchor"
        nodes[-1]["type"] = "anchor"

    return nodes


# ═══ Per-Sector Sweep Spacing ════════════════════════════════════════════════

def sector_sweep_spacing(avg_density: float) -> float:
    """
    Compute sweep spacing for a sector based on its average building density.
    High density → tight spacing (SWEEP_SPACING_MIN_M).
    Low density  → loose spacing (SWEEP_SPACING_MAX_M).
    Linear interpolation between.
    """
    from backend.config import SWEEP_SPACING_MIN_M, SWEEP_SPACING_MAX_M
    from backend.config import SWEEP_DENSITY_LOW, SWEEP_DENSITY_HIGH

    # Use density classification thresholds if available
    if _density_classification:
        low_t, high_t = _density_classification["thresholds"]
    else:
        low_t, high_t = SWEEP_DENSITY_LOW, SWEEP_DENSITY_HIGH

    d = max(low_t, min(high_t, avg_density))
    t = (d - low_t) / (high_t - low_t + 1e-9)
    return SWEEP_SPACING_MAX_M - t * (SWEEP_SPACING_MAX_M - SWEEP_SPACING_MIN_M)


# ═══ A* Pathfinding (Inter-Sector Transit) ═══════════════════════════════════

def a_star_transit(start_xy: tuple[float, float], end_xy: tuple[float, float], tiles: list[list[Tile]]) -> list[tuple[float, float]]:
    """
    Finds the shortest obstacle-free path between two coordinates on the map.
    Uses A* algorithm running on the tile grid. Returns a list of (x_m, y_m) waypoints.
    """
    def xy_to_rc(x, y):
        c = int(np.clip(x // TILE_M, 0, GRID_N - 1))
        r = int(np.clip(y // TILE_M, 0, GRID_N - 1))
        return r, c

    start_r, start_c = xy_to_rc(*start_xy)
    end_r, end_c = xy_to_rc(*end_xy)

    # If already in the same tile, just fly straight
    if (start_r, start_c) == (end_r, end_c):
        return [start_xy, end_xy]

    def heuristic(r, c):
        return math.hypot(end_r - r, end_c - c)

    # Priority queue for A* (f_score, r, c)
    open_set = []
    heapq.heappush(open_set, (0, start_r, start_c))
    
    came_from = {}
    g_score = { (r, c): float('inf') for r in range(GRID_N) for c in range(GRID_N) }
    g_score[(start_r, start_c)] = 0

    directions = [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)]

    while open_set:
        _, current_r, current_c = heapq.heappop(open_set)

        if (current_r, current_c) == (end_r, end_c):
            break

        for dr, dc in directions:
            nr, nc = current_r + dr, current_c + dc
            if 0 <= nr < GRID_N and 0 <= nc < GRID_N:
                # Do not path through obstacles
                if tiles[nr][nc].is_obstacle:
                    continue
                
                # Diagonal distance is slightly longer
                move_cost = 1.414 if dr != 0 and dc != 0 else 1.0
                tentative_g = g_score[(current_r, current_c)] + move_cost
                
                if tentative_g < g_score[(nr, nc)]:
                    came_from[(nr, nc)] = (current_r, current_c)
                    g_score[(nr, nc)] = tentative_g
                    f_score = tentative_g + heuristic(nr, nc)
                    heapq.heappush(open_set, (f_score, nr, nc))

    # Reconstruct path
    path_tiles = []
    curr = (end_r, end_c)
    if curr in came_from or curr == (start_r, start_c):
        while curr in came_from:
            path_tiles.append(curr)
            curr = came_from[curr]
        path_tiles.append((start_r, start_c))
        path_tiles.reverse()

    # Convert tile path back to meters (center of each tile)
    waypoints = [start_xy]
    # Skip the very first and very last tile centers to prefer exact start/end points
    for r, c in path_tiles[1:-1]:
        waypoints.append((c * TILE_M + TILE_M / 2, r * TILE_M + TILE_M / 2))
    waypoints.append(end_xy)

    # Basic path smoothing (remove collinear points)
    if len(waypoints) > 2:
        smoothed = [waypoints[0]]
        for i in range(1, len(waypoints) - 1):
            p1, p2, p3 = smoothed[-1], waypoints[i], waypoints[i+1]
            # If they don't form a straight line, keep the midpoint
            if abs((p2[1] - p1[1]) * (p3[0] - p2[0]) - (p2[0] - p1[0]) * (p3[1] - p2[1])) > 1e-6:
                smoothed.append(p2)
        smoothed.append(waypoints[-1])
        waypoints = smoothed

    return waypoints


# ═══ Transit: tile-border crossing helpers ═══════════════════════════════════

def _transit_tile_border_crossings(
    x0: float, y0: float,
    x1: float, y1: float,
) -> list[tuple[float, float]]:
    """
    Returns all tile grid border crossing points along the segment (x0,y0)→(x1,y1).
    Does NOT include the start or end points themselves.
    Results are sorted by distance from (x0, y0).
    """
    crossings: list[tuple[float, float]] = []
    dx = x1 - x0
    dy = y1 - y0

    if abs(dx) > 1e-9:
        k_min = int(math.ceil(min(x0, x1) / TILE_M))
        k_max = int(math.floor(max(x0, x1) / TILE_M))
        for k in range(k_min, k_max + 1):
            xb = k * TILE_M
            t = (xb - x0) / dx
            if 0.0 < t < 1.0:
                crossings.append((xb, y0 + t * dy))

    if abs(dy) > 1e-9:
        k_min = int(math.ceil(min(y0, y1) / TILE_M))
        k_max = int(math.floor(max(y0, y1) / TILE_M))
        for k in range(k_min, k_max + 1):
            yb = k * TILE_M
            t = (yb - y0) / dy
            if 0.0 < t < 1.0:
                crossings.append((x0 + t * dx, yb))

    crossings.sort(key=lambda p: math.hypot(p[0] - x0, p[1] - y0))
    return crossings


def compute_transit_nodes(
    from_xy: tuple[float, float],
    to_xy: tuple[float, float],
    tiles: list[list["Tile"]],
) -> list[tuple[float, float]]:
    """
    Compute transit waypoints (tile border crossings) from from_xy to to_xy.

    Tries a straight line first; falls back to A* if any tile along the line
    is an obstacle. Returns a list starting with from_xy and ending with to_xy;
    all intermediate points are tile grid border crossings only.
    """
    x0, y0 = from_xy
    x1, y1 = to_xy

    def _line_hits_obstacle(ax, ay, bx, by) -> bool:
        pts = [(ax, ay)] + _transit_tile_border_crossings(ax, ay, bx, by) + [(bx, by)]
        for i in range(len(pts) - 1):
            mx = (pts[i][0] + pts[i + 1][0]) / 2
            my = (pts[i][1] + pts[i + 1][1]) / 2
            col = int(np.clip(mx / TILE_M, 0, GRID_N - 1))
            row = int(np.clip(my / TILE_M, 0, GRID_N - 1))
            if tiles[row][col].is_obstacle:
                return True
        return False

    if not _line_hits_obstacle(x0, y0, x1, y1):
        crossings = _transit_tile_border_crossings(x0, y0, x1, y1)
        return [from_xy] + crossings + [to_xy]

    astar_wps = a_star_transit(from_xy, to_xy, tiles)
    result: list[tuple[float, float]] = [from_xy]
    for i in range(1, len(astar_wps)):
        ax, ay = astar_wps[i - 1]
        bx, by = astar_wps[i]
        crossings = _transit_tile_border_crossings(ax, ay, bx, by)
        result.extend(crossings)
        result.append(astar_wps[i])

    deduped = [result[0]]
    for p in result[1:]:
        if math.hypot(p[0] - deduped[-1][0], p[1] - deduped[-1][1]) > 0.1:
            deduped.append(p)
    return deduped


# ═══ Battery cost ════════════════════════════════════════════════════════════

def compute_battery_cost(path_length_m: float, rtb_distance_m: float = 0.0) -> int:
    total_m = path_length_m + rtb_distance_m
    return max(1, int(math.ceil(total_m / 100.0 * BATTERY_PER_100M)))

def rtb_distance_m(sector: "Sector") -> float:
    bx = BASE_TILE_COL * TILE_M + TILE_M / 2
    by = BASE_TILE_ROW * TILE_M + TILE_M / 2
    return math.hypot(sector.centroid[0] - bx, sector.centroid[1] - by)


# ═══ Local metres ↔ lat/lng ══════════════════════════════════════════════════

def local_m_to_latlng(x_m: float, y_m: float) -> tuple[float, float]:
    lat = ANCHOR_LAT + y_m * LAT_PER_M
    lng = ANCHOR_LNG + x_m * LNG_PER_M
    return (lat, lng)

def latlng_to_local_m(lat: float, lng: float) -> tuple[float, float]:
    return ((lng - ANCHOR_LNG) / LNG_PER_M, (lat - ANCHOR_LAT) / LAT_PER_M)

def latlng_to_tile(lat: float, lng: float) -> tuple[int, int]:
    x, y = latlng_to_local_m(lat, lng)
    col = int(np.clip(x // TILE_M, 0, GRID_N - 1))
    row = int(np.clip(y // TILE_M, 0, GRID_N - 1))
    return (row, col)

def base_station_latlng() -> tuple[float, float]:
    bx = BASE_TILE_COL * TILE_M + TILE_M / 2
    by = BASE_TILE_ROW * TILE_M + TILE_M / 2
    return local_m_to_latlng(bx, by)


# ═══ GeoJSON builder ═════════════════════════════════════════════════════════

def sectors_to_geojson(sectors: list[Sector]) -> dict:
    features = []
    for s in sectors:
        geojson_polygon = [
            [local_m_to_latlng(x, y)[1], local_m_to_latlng(x, y)[0]]
            for x, y in s.polygon_coords
        ]
        cx, cy = s.centroid
        c_lat, c_lng = local_m_to_latlng(cx, cy)

        sweep_ll = []
        for wx, wy in s.sweep_path_coords:
            lat, lng = local_m_to_latlng(wx, wy)
            sweep_ll.append([lng, lat])

        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [geojson_polygon]},
            "properties": {
                "sector_id": s.sector_id,
                "is_obstacle": s.is_obstacle,
                "area_km2": round(s.area_km2, 3),
                "avg_elevation_m": s.avg_elevation_m,
                "avg_density": s.avg_density,
                "battery_cost": s.battery_cost,
                "centroid_latlng": [c_lat, c_lng],
                "sweep_path_latlng": sweep_ll,
                "sweep_path_length_m": s.sweep_path_length_m,
                "sweep_spacing_m": round(sector_sweep_spacing(s.avg_density), 2),
                "sweep_nodes": [
                    {
                        "lat": local_m_to_latlng(n["x_m"], n["y_m"])[0],
                        "lng": local_m_to_latlng(n["x_m"], n["y_m"])[1],
                        "type": n["type"],
                        "x_m": n["x_m"],
                        "y_m": n["y_m"],
                    }
                    for n in s.sweep_nodes
                ],
                "anchor_nodes": [
                    {
                        "lat": local_m_to_latlng(n["x_m"], n["y_m"])[0],
                        "lng": local_m_to_latlng(n["x_m"], n["y_m"])[1],
                        "x_m": n["x_m"],
                        "y_m": n["y_m"],
                    }
                    for n in s.sweep_nodes if n["type"] == "anchor"
                ],
            },
        })
    return {"type": "FeatureCollection", "features": features}


# ═══ Main entry point ════════════════════════════════════════════════════════

def _data_hash() -> str:
    e = (DATA_DIR / "merapi_elevation_20x20.json").stat().st_mtime
    d = (DATA_DIR / "kaliurang_density_20x20.json").stat().st_mtime
    sig = f"{e}{d}{OBSTACLE_ELEV_M}{SWEEP_SPACING_M}{GRID_N}{TILE_M}" \
          f"{CLUSTER_WEIGHT_DENSITY}{CLUSTER_WEIGHT_SPATIAL}{CLUSTER_WEIGHT_ELEV}" \
          f"{AUTO_ELEVATION_ENABLED}{ELEVATION_SAFETY_MARGIN}" \
          f"{SWEEP_SPACING_MIN_M}{SWEEP_SPACING_MAX_M}{SWEEP_DENSITY_LOW}{SWEEP_DENSITY_HIGH}" \
          f"{BATTERY_PER_100M}"
    return hashlib.md5(sig.encode()).hexdigest()[:12]

def build_terrain_model(use_cache: bool = True) -> tuple[list[list[Tile]], list[Sector], dict]:
    global _density_classification
    t0 = time.perf_counter()
    current_hash = _data_hash()

    if use_cache and CACHE_FILE.exists():
        try:
            cached = json.loads(CACHE_FILE.read_text())
            if cached.get("hash") == current_hash:
                tiles = build_tiles()
                density_info = compute_density_classes(tiles)
                effective_elev = density_info["auto_obstacle_elev_m"] if AUTO_ELEVATION_ENABLED else OBSTACLE_ELEV_M
                for r in range(GRID_N):
                    for c in range(GRID_N):
                        tiles[r][c].is_obstacle = (tiles[r][c].elevation_m > effective_elev)
                _density_classification = density_info
                sectors = [Sector.from_dict(sd) for sd in cached["sectors"]]
                for s in sectors:
                    for r, c in s.tiles:
                        tiles[r][c].sector_id = s.sector_id
                print(f"[terrain] Loaded from cache in {(time.perf_counter()-t0)*1000:.1f}ms")
                return tiles, sectors, {}
        except Exception as exc:
            print(f"[terrain] Cache load failed ({exc}); rebuilding.")

    # a. Build raw tiles (is_obstacle=False initially)
    tiles = build_tiles()

    # b. Compute density classification and effective obstacle elevation
    density_info = compute_density_classes(tiles)
    effective_elev = density_info["auto_obstacle_elev_m"] if AUTO_ELEVATION_ENABLED else OBSTACLE_ELEV_M
    print(f"[terrain] Auto obstacle elevation: {effective_elev}m "
          f"(density breaks: {density_info['thresholds']})")

    # c+d. Apply obstacle flags using effective threshold
    for r in range(GRID_N):
        for c in range(GRID_N):
            tiles[r][c].is_obstacle = (tiles[r][c].elevation_m > effective_elev)

    _density_classification = density_info

    # e. Run clustering with updated obstacle mask
    labels, _ = cluster_tiles(tiles)

    # f. Reconcile: ensure no obstacle tile is assigned to a scan sector
    labels = _reconcile_obstacle_labels(tiles, labels)

    for r in range(GRID_N):
        for c in range(GRID_N):
            tiles[r][c].sector_id = int(labels[r, c])

    sectors = labels_to_sectors(labels, tiles)

    # Build all scan sector polygons once for isolation subtraction
    scan_polys = {
        s.sector_id: Polygon(s.polygon_coords)
        for s in sectors if not s.is_obstacle
    }

    for s in sectors:
        if s.is_obstacle:
            continue
        poly = Polygon(s.polygon_coords)

        # Subtract all other sectors' polygons so the lawnmower cannot
        # bleed into adjacent or enclosed sectors (fixes sector 1/5 hole bug)
        others = [p for sid, p in scan_polys.items() if sid != s.sector_id]
        if others:
            poly = poly.difference(unary_union(others))
            if poly.is_empty or poly.area < 100:
                poly = Polygon(s.polygon_coords)   # fallback: use original

        # Apply 2m inset. join_style=2 (mitre) keeps corners sharp 90-degrees.
        inset_poly = poly.buffer(-2.0, join_style=2)
        if inset_poly.is_empty or inset_poly.area < 100:
            inset_poly = poly    # fallback: too small to inset safely

        spacing = sector_sweep_spacing(s.avg_density)
        path = lawnmower_path(inset_poly, spacing)
        if not path.is_empty and len(list(path.coords)) >= 2:
            s.sweep_path_coords = [[round(x, 2), round(y, 2)] for x, y in path.coords]
            s.sweep_path_length_m = path.length
            s.sweep_nodes = compute_sweep_nodes(path, TILE_M)
        s.battery_cost = compute_battery_cost(s.sweep_path_length_m, rtb_distance_m(s))

    transit_table: dict = {}  # Transit computed dynamically in orchestrator.py

    CACHE_FILE.write_text(json.dumps({
        "hash": current_hash,
        "generated_at": time.time(),
        "sectors": [s.to_dict() for s in sectors],
    }))

    elapsed = (time.perf_counter() - t0) * 1000
    n_scan  = sum(1 for s in sectors if not s.is_obstacle)
    n_obs   = sum(1 for s in sectors if s.is_obstacle)
    print(f"[terrain] Built {n_scan} scan sectors + {n_obs} obstacle zones in {elapsed:.0f}ms")
    return tiles, sectors, transit_table


if __name__ == "__main__":
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()
    tiles, sectors, _ = build_terrain_model()
    scan = [s for s in sectors if not s.is_obstacle]
    obs  = [s for s in sectors if s.is_obstacle]
    print(f"\n=== Terrain smoke test ===")
    print(f"Tiles:    {GRID_N}×{GRID_N} = {GRID_N*GRID_N}")
    print(f"Sectors:  {len(scan)} scan + {len(obs)} obstacle")
    for s in scan:
        print(f"  sector {s.sector_id:>2}: "
              f"{len(s.tiles):>3} tiles, "
              f"{s.area_km2:.2f}km², "
              f"{s.sweep_path_length_m:>6.0f}m path, "
              f"battery {s.battery_cost}")
    print(f"Base station: {base_station_latlng()}")