#!/usr/bin/env python3
"""
Visual smoke test for lawnmower paths.
Dumps a PNG showing each sector's polygon + its lawnmower path overlay.
Run after modifying terrain.py / lawnmower algorithm to verify path quality.

Output: backend/data/sector_paths_debug.png
"""
import sys
from pathlib import Path

# Add the project root to Python's path so it can find 'backend'
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.collections import PatchCollection
import numpy as np

from backend.terrain import build_terrain_model, CACHE_FILE

# ... rest of your script remains exactly the same ...

# Force cold build so we test the current algorithm
if CACHE_FILE.exists():
    CACHE_FILE.unlink()

tiles, sectors, _ = build_terrain_model()
scan_sectors = [s for s in sectors if not s.is_obstacle]
obs_sectors  = [s for s in sectors if s.is_obstacle]

fig, ax = plt.subplots(figsize=(14, 14), dpi=110)

# Obstacle sectors (red hatched)
for s in obs_sectors:
    poly = MplPolygon(s.polygon_coords, closed=True,
                      facecolor="#ef4444", edgecolor="#7f1d1d",
                      alpha=0.35, hatch="///")
    ax.add_patch(poly)
    ax.text(s.centroid[0], s.centroid[1], "\u26d4",
            ha="center", va="center", fontsize=10)

# Scan sectors
cmap = plt.cm.tab20
for idx, s in enumerate(scan_sectors):
    color = cmap(idx % 20)
    poly = MplPolygon(s.polygon_coords, closed=True,
                      facecolor=color, edgecolor="#0f766e",
                      alpha=0.22, linewidth=1.5)
    ax.add_patch(poly)
    ax.text(s.centroid[0], s.centroid[1], str(s.sector_id),
            ha="center", va="center", fontsize=11, fontweight="bold")
    # Lawnmower path
    if s.sweep_path_coords and len(s.sweep_path_coords) >= 2:
        xs = [pt[0] for pt in s.sweep_path_coords]
        ys = [pt[1] for pt in s.sweep_path_coords]
        ax.plot(xs, ys, color=color, linewidth=1.2, alpha=0.9)
        # Mark start/end
        ax.plot(xs[0], ys[0], "o", color="white",
                markeredgecolor=color, markersize=6, zorder=5)
        ax.plot(xs[-1], ys[-1], "s", color=color, markersize=5, zorder=5)

    # Sweep nodes
    if s.sweep_nodes:
        for ntype, mk, sz, nc, ec in [
            ("anchor",      "s", 80,  color,      "black"),
            ("tile_border", "o", 20,  "#3B82F6",  "none"),
        ]:
            pts = [(n["x_m"], n["y_m"]) for n in s.sweep_nodes if n["type"] == ntype]
            if pts:
                nxs, nys = zip(*pts)
                ax.scatter(nxs, nys, marker=mk, s=sz, color=nc,
                           edgecolors=ec, linewidths=0.8, zorder=5)

# Node type legend
from matplotlib.lines import Line2D
legend_elements = [
    Line2D([0], [0], marker="s", color="w", label="anchor",
           markerfacecolor="grey", markeredgecolor="black", markersize=8),
    Line2D([0], [0], marker="o", color="w", label="tile_border",
           markerfacecolor="#3B82F6", markersize=6),
]
ax.legend(handles=legend_elements, loc="upper right", fontsize=9)

ax.set_aspect("equal")
ax.set_title(f"Sector Path Debug — {len(scan_sectors)} scan + {len(obs_sectors)} obstacle sectors",
             fontsize=13)
ax.set_xlabel("x (metres east of SW corner)")
ax.set_ylabel("y (metres north of SW corner)")
ax.grid(True, alpha=0.25)

out = Path("backend/data/sector_paths_debug.png")
plt.tight_layout()
plt.savefig(out, bbox_inches="tight", facecolor="white")
print(f"Saved: {out}")
print(f"Scan sectors: {len(scan_sectors)}, Obstacle sectors: {len(obs_sectors)}")
for s in scan_sectors:
    n_wps = len(s.sweep_path_coords)
    print(f"  sector {s.sector_id:>2}: {n_wps:>4} waypoints, "
          f"{s.sweep_path_length_m:>7.0f}m path, "
          f"{s.area_km2:.3f}km\u00b2 area")
