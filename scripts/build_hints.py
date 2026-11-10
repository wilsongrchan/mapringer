"""Build the side-quest map hints (continents and islands) from the land mask.

The hints are drawn from the same mask the quests are scored against, so a
continent's tinted area on the map is exactly where the quest counts it
(including the custom splits, e.g. Europe / Asia along the Urals).

Output: a small GeoJSON, one MultiPolygon per (continent, island) pair, with
properties {"continent": "<name>", "island": true|false}. The mask is
downsampled to 0.1° and simplified, which is plenty for a hint.

Usage:
    .venv/bin/python scripts/build_hints.py public/data/land.tif public/hints/continents.geojson
"""

import json
import sys
from collections import defaultdict

import numpy as np
import rasterio
from rasterio.features import shapes
from rasterio.transform import Affine
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

FACTOR = 6  # 1 arc-minute → 0.1°
SIMPLIFY_DEG = 0.06
MIN_AREA_DEG2 = 0.02  # drop specks smaller than ~ 15 km × 15 km at the equator
NAMES = {1: "africa", 2: "asia", 3: "europe", 4: "northAmerica", 5: "southAmerica", 6: "oceania"}


def main(src: str, dst: str) -> None:
    with rasterio.open(src) as ds:
        a = ds.read(1)
        t = ds.transform
    h, w = (a.shape[0] // FACTOR) * FACTOR, (a.shape[1] // FACTOR) * FACTOR
    blocks = a[:h, :w].reshape(h // FACTOR, FACTOR, w // FACTOR, FACTOR).swapaxes(1, 2).reshape(h // FACTOR, w // FACTOR, -1)
    # each 0.1° cell takes its most common land value (sea only if mostly sea)
    small = np.zeros(blocks.shape[:2], dtype=np.uint8)
    for code in np.unique(a):
        if code == 0:
            continue
        count = (blocks == code).sum(axis=2)
        better = count > (blocks == small[..., None]).sum(axis=2)
        small[better] = code
    small[(blocks != 0).sum(axis=2) < FACTOR * FACTOR / 2] = 0
    small_t = t * Affine.scale(FACTOR)

    groups = defaultdict(list)
    for geom, value in shapes(small, mask=small != 0, transform=small_t):
        v = int(value)
        cont = NAMES.get(v & 7)
        if cont:
            groups[(cont, bool(v & 8))].append(shape(geom))

    features = []
    for (cont, island), polys in sorted(groups.items()):
        g = unary_union(polys).simplify(SIMPLIFY_DEG, preserve_topology=True)
        parts = [p for p in getattr(g, "geoms", [g]) if p.area >= MIN_AREA_DEG2]
        if not parts:
            continue
        g = unary_union(parts)
        geo = json.loads(json.dumps(mapping(g)), parse_float=lambda x: round(float(x), 3))
        features.append({"type": "Feature", "properties": {"continent": cont, "island": island}, "geometry": geo})
        print(f"{cont:13s} island={island!s:5s} parts={len(parts)}")

    with open(dst, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
