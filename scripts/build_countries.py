"""Build the country mask and map hints for "centre your ring in <country>" quests.

Only the countries listed in src/countries.json are drawn; cell value = the
country's 1-based position in that list, 0 = anywhere else (or sea). An entry's
"also" list folds other Natural Earth areas into it (China includes Hong Kong
and Macao). Same 1 arc-minute grid as land.tif.

Outputs:
  <dst_tif>                       uint8 Cloud-Optimized GeoTIFF (host it with the other .tif files)
  <hints_dir>/<ADM0_A3>.geojson   simplified outline per country, for the Easy / Standard hint

Source (public domain): Natural Earth ne_10m_admin_0_countries, matched on
ADM0_A3. Natural Earth draws Hong Kong, Macao and Taiwan as their own areas.

Usage:
    .venv/bin/python scripts/build_countries.py data/raw/ne src/countries.json public/data/countries.tif public/hints/countries
"""

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.shutil import copy as rio_copy
from rasterio.transform import from_origin
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

RES = 1 / 60
W, H = 360 * 60, 180 * 60
TRANSFORM = from_origin(-180, 90, RES, RES)
SIMPLIFY_DEG = 0.02
MIN_AREA_DEG2 = 0.002


def main(src_dir: str, list_path: str, dst_tif: str, hints_dir: str) -> None:
    countries = json.load(open(Path(src_dir) / "ne_10m_admin_0_countries.geojson"))
    entries = json.load(open(list_path))
    assert len(entries) < 256
    index = {}  # Natural Earth ADM0_A3 -> (mask value, entry id)
    for i, c in enumerate(entries):
        for iso in [c["id"], *c.get("also", [])]:
            index[iso] = (i + 1, c["id"])

    shapes = []
    geoms = {c["id"]: [] for c in entries}
    for f in countries["features"]:
        iso = f["properties"]["ADM0_A3"]
        if iso not in index:
            continue
        value, entry = index[iso]
        shapes.append((f["geometry"], value))
        geoms[entry].append(shape(f["geometry"]))

    missing = [iso for iso in index if iso not in {f["properties"]["ADM0_A3"] for f in countries["features"]}]
    assert not missing, f"not in Natural Earth: {missing}"

    hints = Path(hints_dir)
    hints.mkdir(parents=True, exist_ok=True)
    for entry, gs in geoms.items():
        g = unary_union(gs).simplify(SIMPLIFY_DEG, preserve_topology=True)
        parts = [p for p in getattr(g, "geoms", [g]) if p.area >= MIN_AREA_DEG2] or list(getattr(g, "geoms", [g]))
        g = unary_union(parts)
        geo = json.loads(json.dumps(mapping(g)), parse_float=lambda x: round(float(x), 3))
        out = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"continent": "country"}, "geometry": geo}]}
        (hints / f"{entry}.geojson").write_text(json.dumps(out, separators=(",", ":")))

    mask = rasterize(shapes, out_shape=(H, W), transform=TRANSFORM, fill=0, dtype="uint8")
    for i, c in enumerate(entries):
        print(f"{i + 1:3d} {c['id']} cells={(mask == i + 1).sum():,}")

    dst = Path(dst_tif)
    with tempfile.TemporaryDirectory(dir=dst.parent) as tmp:
        tmp_path = Path(tmp) / "countries.tif"
        with rasterio.open(
            tmp_path, "w", driver="GTiff", width=W, height=H, count=1, dtype="uint8",
            crs="EPSG:4326", transform=TRANSFORM, tiled=True, blockxsize=256, blockysize=256, compress="DEFLATE",
        ) as out_ds:
            out_ds.write(mask, 1)
        rio_copy(tmp_path, dst, driver="COG", BLOCKSIZE=256, COMPRESS="DEFLATE", OVERVIEWS="NONE")
    print(f"wrote {dst} ({dst.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(*sys.argv[1:5])
