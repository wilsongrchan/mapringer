"""Build the lines where two continents meet on land, for continent quests.

Traced from the land mask the quests are scored against (public/data/land.tif,
1 arc-minute, value & 7 = continent), so a line is exactly where the quest
switches continent (including the custom splits, e.g. Europe / Asia along the
Urals). Only land-to-land borders are kept: coastlines are on the map anyway.

Output: GeoJSON LineStrings with properties {"a": "<continent>", "b": "<continent>"}.

Usage:
    .venv/bin/python scripts/build_continent_borders.py public/data/land.tif public/hints/continent-borders.geojson
"""

import json
import sys
from collections import defaultdict

import numpy as np
import rasterio

NAMES = {1: "africa", 2: "asia", 3: "europe", 4: "northAmerica", 5: "southAmerica", 6: "oceania"}
SIMPLIFY_DEG = 0.02
MIN_LEN_DEG = 0.15  # drop tiny specks (single odd cells)


def simplify(pts, tol):
    """Douglas-Peucker on a list of (x, y)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    a = np.asarray(pts)
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = a[i], a[j]
        seg = a[i + 1 : j]
        d = q - p
        n = np.hypot(*d)
        dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / n if n else np.hypot(*(seg - p).T)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return [pt for pt, k in zip(pts, keep) if k]


def main(src, dst):
    with rasterio.open(src) as f:
        v = f.read(1)
        t = f.transform
    cont = np.where(v > 0, v & 7, 0).astype(np.uint8)
    rows, cols = cont.shape
    # edges between cells of different continents, keyed by continent pair;
    # each edge is a unit segment between grid nodes (col, row)
    edges = defaultdict(list)
    # vertical edges: between (r, c) and (r, c+1); horizontal: (r, c) and (r+1, c)
    for axis in (1, 0):
        a = cont[:, :-1] if axis == 1 else cont[:-1, :]
        b = cont[:, 1:] if axis == 1 else cont[1:, :]
        rr, cc = np.nonzero((a > 0) & (b > 0) & (a != b))
        for r, c in zip(rr.tolist(), cc.tolist()):
            x, y = int(a[r, c]), int(b[r, c])
            key = (min(x, y), max(x, y))
            if axis == 1:  # border on the line col = c + 1, from row r to r + 1
                edges[key].append(((c + 1, r), (c + 1, r + 1)))
            else:  # border on the line row = r + 1, from col c to c + 1
                edges[key].append(((c, r + 1), (c + 1, r + 1)))
    features = []
    for (x, y), segs in edges.items():
        adj = defaultdict(list)
        for p, q in segs:
            adj[p].append(q)
            adj[q].append(p)
        used = set()

        def walk(start, nxt):
            line = [start, nxt]
            used.add(frozenset((start, nxt)))
            while True:
                cur = line[-1]
                cand = [n for n in adj[cur] if frozenset((cur, n)) not in used]
                if len(adj[cur]) != 2 or not cand:
                    return line
                used.add(frozenset((cur, cand[0])))
                line.append(cand[0])

        # start at line ends / junctions first, then closed loops
        starts = [p for p in adj if len(adj[p]) != 2] + list(adj)
        for s in starts:
            for n in adj[s]:
                if frozenset((s, n)) in used:
                    continue
                nodes = walk(s, n)
                pts = [(t.c + cx * t.a, t.f + ry * t.e) for cx, ry in nodes]
                pts = simplify(pts, SIMPLIFY_DEG)
                length = sum(np.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
                if length < MIN_LEN_DEG:
                    continue
                features.append({
                    "type": "Feature",
                    "properties": {"a": NAMES[x], "b": NAMES[y]},
                    "geometry": {"type": "LineString", "coordinates": [[round(px, 3), round(py, 3)] for px, py in pts]},
                })
    with open(dst, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
    pairs = defaultdict(int)
    for ft in features:
        pairs[(ft["properties"]["a"], ft["properties"]["b"])] += 1
    print(len(features), "lines", dict(pairs))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
