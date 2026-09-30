"""Road-following routes over the OSM road polylines (normalised u east / v south coords).

Roads share exact vertices where ways connect, so consecutive polyline points become graph edges.
Only the largest connected component is used, so a landmark never snaps onto an isolated track.
"""
import heapq
import itertools
import math
from collections import defaultdict, deque

Node = tuple[float, float]


def build_graph(polylines, size_m: tuple[float, float]) -> dict[Node, list[tuple[Node, float]]]:
    """Adjacency of the largest connected component. Edge weight = metres (size_m = region w, h)."""
    w, h = size_m
    adj: dict[Node, list] = defaultdict(list)
    for line in polylines:
        for a, b in zip(line, line[1:]):
            a, b = tuple(a), tuple(b)
            if a == b:
                continue
            d = math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h)
            adj[a].append((b, d))
            adj[b].append((a, d))
    seen, best = set(), []
    for start in adj:
        if start in seen:
            continue
        comp, q = [], deque([start])
        seen.add(start)
        while q:
            n = q.popleft()
            comp.append(n)
            for m, _ in adj[n]:
                if m not in seen:
                    seen.add(m)
                    q.append(m)
        if len(comp) > len(best):
            best = comp
    keep = set(best)
    return {n: adj[n] for n in keep}


def nearest_node(graph, p: Node, size_m) -> Node:
    w, h = size_m
    return min(graph, key=lambda n: ((n[0] - p[0]) * w) ** 2 + ((n[1] - p[1]) * h) ** 2)


def snap_distance_m(graph, p: Node, size_m) -> float:
    """Metres from p to the nearest vertex of the (largest-component) road graph; inf if there is no graph."""
    if not graph:
        return math.inf
    n = nearest_node(graph, p, size_m)
    return math.hypot((n[0] - p[0]) * size_m[0], (n[1] - p[1]) * size_m[1])


def shortest_path(graph, src: Node, dst: Node) -> list[Node]:
    """Dijkstra. Returns [] if dst is unreachable."""
    dist, prev, pq = {src: 0.0}, {}, [(0.0, src)]
    while pq:
        d, n = heapq.heappop(pq)
        if n == dst:
            break
        if d > dist.get(n, math.inf):
            continue
        for m, wgt in graph[n]:
            nd = d + wgt
            if nd < dist.get(m, math.inf):
                dist[m], prev[m] = nd, n
                heapq.heappush(pq, (nd, m))
    if dst not in dist:
        return []
    path = [dst]
    while path[-1] != src:
        path.append(prev[path[-1]])
    return path[::-1]


def route_through(points, polylines, size_m, min_step: float = 0.0015) -> list[list[float]]:
    """Polyline (list of [u, v]) that visits `points` in order along roads.
    Each stop snaps to the nearest road vertex; unreachable legs fall back to a straight segment.
    Points closer than `min_step` (normalised) are dropped to keep the result light."""
    graph = build_graph(polylines, size_m)
    if not graph or len(points) < 2:
        return [list(p) for p in points]
    snapped = [nearest_node(graph, tuple(p), size_m) for p in points]
    out: list[Node] = []
    for a, b in zip(snapped, snapped[1:]):
        leg = shortest_path(graph, a, b) or [a, b]
        out.extend(leg if not out else leg[1:])
    slim = [out[0]]
    for p in out[1:-1]:
        if math.hypot(p[0] - slim[-1][0], p[1] - slim[-1][1]) >= min_step:
            slim.append(p)
    slim.append(out[-1])
    return [list(p) for p in slim]


def path_length(path, size_m) -> float:
    w, h = size_m
    return sum(math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h) for a, b in zip(path, path[1:]))


def best_order(points, polylines, size_m, start: int = 0) -> list[int]:
    """Indices of `points` in the visiting order (starting at `start`) with the shortest total road
    distance. Exhaustive for up to 8 stops; larger sets keep nearest-neighbour order. Legs that cannot be
    routed count as straight-line distance."""
    n = len(points)
    graph = build_graph(polylines, size_m)
    if not graph or n > 8:
        return _nearest_neighbour(points, start, size_m)
    snapped = [nearest_node(graph, tuple(p), size_m) for p in points]
    d = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            leg = shortest_path(graph, snapped[i], snapped[j])
            d[i][j] = d[j][i] = path_length(leg, size_m) if leg else math.hypot(
                (points[i][0] - points[j][0]) * size_m[0], (points[i][1] - points[j][1]) * size_m[1]) * 3
    rest = [i for i in range(n) if i != start]
    best = min(itertools.permutations(rest), key=lambda perm: sum(d[a][b] for a, b in zip((start, *perm), perm)))
    return [start, *best]


def _nearest_neighbour(points, start, size_m) -> list[int]:
    left, order = set(range(len(points))) - {start}, [start]
    while left:
        a = points[order[-1]]
        nxt = min(left, key=lambda i: ((points[i][0] - a[0]) * size_m[0]) ** 2 + ((points[i][1] - a[1]) * size_m[1]) ** 2)
        left.remove(nxt)
        order.append(nxt)
    return order


def leg_lengths(points, polylines, size_m) -> list[float]:
    """Road distance in metres of each leg between consecutive points (inf when there is no connection)."""
    graph = build_graph(polylines, size_m)
    if not graph:
        return [math.inf] * max(len(points) - 1, 0)
    snapped = [nearest_node(graph, tuple(p), size_m) for p in points]
    out = []
    for a, b in zip(snapped, snapped[1:]):
        leg = shortest_path(graph, a, b)
        out.append(path_length(leg, size_m) if leg else math.inf)
    return out


def detour_legs(legs, straights, ratio: float = 4.0, min_m: float = 30000.0) -> list[int]:
    """Indices of legs that are absurdly long compared with the straight line: the network is clipped or broken
    between those stops, so the path leaves the map and comes back."""
    return [i for i, (l, s) in enumerate(zip(legs, straights)) if l > max(min_m, ratio * s)]
