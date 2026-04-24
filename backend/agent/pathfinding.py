"""
backend/agent/pathfinding.py
Node-graph shortest-path utilities for inter-sector drone transit.
"""
import math
import heapq

from backend.config import TILE_M


def _node_key(x: float, y: float) -> str:
    return f"x{x:.1f}_y{y:.1f}"


def _tile_border_nodes_on_line(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
    """Return list of (x, y) for tile-border crossings between (x0,y0)→(x1,y1)."""
    pts = [(x0, y0)]
    dx, dy = x1 - x0, y1 - y0
    if abs(dx) > 1e-9:
        for k in range(int(math.ceil(min(x0, x1) / TILE_M)),
                       int(math.floor(max(x0, x1) / TILE_M)) + 1):
            xb = k * TILE_M
            t = (xb - x0) / dx
            if 0 < t < 1:
                pts.append((xb, y0 + t * dy))
    if abs(dy) > 1e-9:
        for k in range(int(math.ceil(min(y0, y1) / TILE_M)),
                       int(math.floor(max(y0, y1) / TILE_M)) + 1):
            yb = k * TILE_M
            t = (yb - y0) / dy
            if 0 < t < 1:
                pts.append((x0 + t * dx, yb))
    pts.append((x1, y1))
    pts.sort(key=lambda p: math.hypot(p[0] - x0, p[1] - y0))
    deduped = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0] - deduped[-1][0], p[1] - deduped[-1][1]) > 0.5:
            deduped.append(p)
    return deduped


def build_node_graph(sectors: list) -> dict:
    """
    Build an undirected adjacency graph from all sweep nodes across all
    non-obstacle sectors plus synthetic tile-border crossing nodes on
    straight lines between sectors.

    Graph structure:
        {
          node_key: {
            "x_m": float,
            "y_m": float,
            "type": str,        # "anchor" | "turn" | "tile_border" | "synthetic"
            "sector_id": int,   # -1 for synthetic inter-sector nodes
            "neighbors": {node_key → dist_m}
          }
        }
    """
    graph: dict = {}

    def add_node(x: float, y: float, ntype: str, sector_id: int) -> str:
        k = _node_key(x, y)
        if k not in graph:
            graph[k] = {"x_m": x, "y_m": y, "type": ntype,
                        "sector_id": sector_id, "neighbors": {}}
        return k

    def add_edge(k1: str, k2: str) -> None:
        x1, y1 = graph[k1]["x_m"], graph[k1]["y_m"]
        x2, y2 = graph[k2]["x_m"], graph[k2]["y_m"]
        d = math.hypot(x2 - x1, y2 - y1)
        graph[k1]["neighbors"][k2] = d
        graph[k2]["neighbors"][k1] = d

    scan_sectors = [s for s in sectors if not s.is_obstacle]

    # (a) Intra-sector edges from sweep_nodes
    for s in scan_sectors:
        if not s.sweep_nodes:
            continue
        prev_k = None
        for n in s.sweep_nodes:
            k = add_node(n["x_m"], n["y_m"], n["type"], s.sector_id)
            if prev_k is not None:
                add_edge(prev_k, k)
            prev_k = k

    # (b) Inter-sector edges between anchor nodes
    anchors_by_sector: dict[int, list] = {}
    for s in scan_sectors:
        anchors = [n for n in s.sweep_nodes if n["type"] == "anchor"]
        if len(anchors) >= 2:
            anchors_by_sector[s.sector_id] = anchors

    for i, si in enumerate(scan_sectors):
        ai = anchors_by_sector.get(si.sector_id, [])
        if not ai:
            continue
        for sj in scan_sectors[i + 1:]:
            aj = anchors_by_sector.get(sj.sector_id, [])
            if not aj:
                continue
            from_anc = ai[-1]
            to_anc = min(aj,
                         key=lambda n: math.hypot(n["x_m"] - from_anc["x_m"],
                                                  n["y_m"] - from_anc["y_m"]))
            pts = _tile_border_nodes_on_line(
                from_anc["x_m"], from_anc["y_m"],
                to_anc["x_m"],   to_anc["y_m"],
            )
            prev_k = None
            for px, py in pts:
                sid = si.sector_id if prev_k is None else -1
                k = add_node(px, py, "synthetic", sid)
                if prev_k is not None:
                    add_edge(prev_k, k)
                prev_k = k

    return graph


def shortest_path_xy(
    graph: dict,
    from_xy: tuple[float, float],
    to_xy: tuple[float, float],
) -> list[dict]:
    """
    A* shortest path through the node graph from from_xy to to_xy.

    If from_xy or to_xy are not exact graph nodes, the nearest graph node
    to each is used as start/goal.

    Returns a list of node dicts in travel order:
        [{"x_m", "y_m", "type", "sector_id", "dist_m"}, ...]
    where dist_m is the distance from the previous node (0.0 for first node).
    Returns empty list if no path is found.
    """
    if not graph:
        return []

    def nearest_key(xy: tuple[float, float]) -> str:
        x, y = xy
        return min(graph.keys(),
                   key=lambda k: math.hypot(graph[k]["x_m"] - x, graph[k]["y_m"] - y))

    start_k = nearest_key(from_xy)
    goal_k  = nearest_key(to_xy)

    if start_k == goal_k:
        n = graph[start_k]
        return [{"x_m": n["x_m"], "y_m": n["y_m"], "type": n["type"],
                 "sector_id": n["sector_id"], "dist_m": 0.0}]

    gx, gy = graph[goal_k]["x_m"], graph[goal_k]["y_m"]

    def h(k: str) -> float:
        return math.hypot(graph[k]["x_m"] - gx, graph[k]["y_m"] - gy)

    dist: dict[str, float] = {start_k: 0.0}
    prev: dict[str, str] = {}
    heap = [(h(start_k), 0.0, start_k)]

    while heap:
        _, d, cur = heapq.heappop(heap)
        if d > dist.get(cur, float("inf")):
            continue
        if cur == goal_k:
            break
        for nb_k, edge_d in graph[cur]["neighbors"].items():
            nd = d + edge_d
            if nd < dist.get(nb_k, float("inf")):
                dist[nb_k] = nd
                prev[nb_k] = cur
                heapq.heappush(heap, (nd + h(nb_k), nd, nb_k))

    if goal_k not in prev and goal_k != start_k:
        return []

    path: list[str] = []
    cur = goal_k
    while cur in prev:
        path.append(cur)
        cur = prev[cur]
    path.append(start_k)
    path.reverse()

    result: list[dict] = []
    for i, k in enumerate(path):
        n = graph[k]
        d = 0.0 if i == 0 else math.hypot(
            n["x_m"] - graph[path[i - 1]]["x_m"],
            n["y_m"] - graph[path[i - 1]]["y_m"],
        )
        result.append({
            "x_m": n["x_m"],
            "y_m": n["y_m"],
            "type": n.get("type", "synthetic"),
            "sector_id": n.get("sector_id", -1),
            "dist_m": d,
        })
    return result


def closest_anchor(sector, from_xy: tuple[float, float]) -> dict:
    """
    Return the anchor node of the sector closest to from_xy.
    Used for bidirectional sweep selection.
    """
    anchors = [n for n in sector.sweep_nodes if n["type"] == "anchor"]
    if not anchors:
        return sector.sweep_nodes[0] if sector.sweep_nodes else {"x_m": 0, "y_m": 0, "type": "anchor"}
    return min(anchors,
               key=lambda n: math.hypot(n["x_m"] - from_xy[0], n["y_m"] - from_xy[1]))
