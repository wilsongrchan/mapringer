"""Build the lines where two continents meet on land, for continent quests.

Traced from the land mask the quests are scored against (public/data/land.tif,
1 arc-minute, value & 7 = continent) with the same corrections the game makes
(src/continent-fixes.json: the Suez Canal, the Bosporus and Dardanelles, the
Urals and Ural River), so a line is exactly where the quest switches continent. Only land-to-land borders are kept: coastlines are on the map anyway.

Output: GeoJSON LineStrings with properties {"a": "<continent>", "b": "<continent>"}.

Usage:
    .venv/bin/python scripts/build_continent_borders.py public/data/land.tif public/hints/continent-borders.geojson
"""

import json
import sys
from collections import defaultdict

from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import Affine

NAMES = {1: "africa", 2: "asia", 3: "europe", 4: "northAmerica", 5: "southAmerica", 6: "oceania"}
SIMPLIFY_DEG = 0.02
MIN_LEN_DEG = 0.15  # drop tiny specks (single odd cells)


CODES = {name: code for code, name in NAMES.items()}
FIXES = Path(__file__).resolve().parent.parent / "src" / "continent-fixes.json"


def apply_fixes(cont, t):
    """Redraw the transcontinental splits along the real lines (same polygons as quests.ts)."""
    for fix in json.load(open(FIXES))["fixes"]:
        w, s, e, n = fix["box"]
        c0, c1 = int((w - t.c) / t.a), int(np.ceil((e - t.c) / t.a))
        r0, r1 = int((t.f - n) / -t.e), int(np.ceil((t.f - s) / -t.e))
        sub = cont[r0:r1, c0:c1]
        win = Affine(t.a, 0, t.c + c0 * t.a, 0, t.e, t.f + r0 * t.e)
        inside = rasterize([({"type": "Polygon", "coordinates": [fix["poly"]]}, 1)], out_shape=sub.shape, transform=win, fill=0, dtype="uint8") > 0
        movable = np.isin(sub, [CODES[c] for c in fix["from"]])
        sub[movable & inside] = CODES[fix["inside"]]
        sub[movable & ~inside] = CODES[fix["outside"]]


def cont_at(cont, t, lng, lat):
    c = int((lng - t.c) / t.a)
    r = int((lat - t.f) / t.e)
    if 0 <= r < cont.shape[0] and 0 <= c < cont.shape[1]:
        return int(cont[r, c])
    return 0


def side_labels(pts, length, cont, t):
    """Points along a border saying which continent is on which side.

    Each point has `first` (the continent to the west, or north) and `second`
    (east, or south), and `orient`: "ns" for a line running north-south (so
    the names go left / right of it) or "ew" (above / below)."""
    out = []
    a = np.asarray(pts)
    seg = np.hypot(*np.diff(a, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    fracs = [0.5] if length < 8 else [0.2, 0.5, 0.8]
    for f in fracs:
        target = f * cum[-1]
        i = min(len(seg) - 1, int(np.searchsorted(cum, target) - 1))
        i = max(i, 0)
        p0, p1 = a[i], a[i + 1]
        u = (target - cum[i]) / seg[i] if seg[i] else 0
        mid = p0 + (p1 - p0) * u
        d = (p1 - p0) / (seg[i] or 1)
        ns = abs(d[1]) >= abs(d[0])
        for off in (0.15, 0.3, 0.5, 0.8):
            if ns:  # west / east of it
                west, east = cont_at(cont, t, mid[0] - off, mid[1]), cont_at(cont, t, mid[0] + off, mid[1])
            else:  # north / south of it
                west, east = cont_at(cont, t, mid[0], mid[1] + off), cont_at(cont, t, mid[0], mid[1] - off)
            if west and east and west != east:
                out.append({
                    "type": "Feature",
                    "properties": {"first": NAMES[west], "second": NAMES[east], "orient": "ns" if ns else "ew"},
                    "geometry": {"type": "Point", "coordinates": [round(float(mid[0]), 3), round(float(mid[1]), 3)]},
                })
                break
    return out


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
    apply_fixes(cont, t)
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
                features.extend(side_labels(pts, length, cont, t))
    with open(dst, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
    pairs = defaultdict(int)
    for ft in features:
        if ft["geometry"]["type"] == "LineString":
            pairs[(ft["properties"]["a"], ft["properties"]["b"])] += 1
        else:
            pairs["labels"] += 1
    print(len(features), "lines", dict(pairs))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
