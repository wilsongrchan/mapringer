"""Build the country mask and map hints for "centre your ring in <country>" quests.

Only the countries listed in src/countries.json are drawn; cell value = the
country's 1-based position in that list, 0 = anywhere else (or sea). Same
1 arc-minute grid as land.tif.

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

RES = 1 / 60
W, H = 360 * 60, 180 * 60
TRANSFORM = from_origin(-180, 90, RES, RES)
SIMPLIFY_DEG = 0.02
MIN_AREA_DEG2 = 0.002


def main(src_dir: str, list_path: str, dst_tif: str, hints_dir: str) -> None:
    countries = json.load(open(Path(src_dir) / "ne_10m_admin_0_countries.geojson"))
    wanted = [c["id"] for c in json.load(open(list_path))]
    index = {iso: i + 1 for i, iso in enumerate(wanted)}
    assert len(wanted) < 256

    shapes = []
    hints = Path(hints_dir)
    hints.mkdir(parents=True, exist_ok=True)
    for f in countries["features"]:
        iso = f["properties"]["ADM0_A3"]
        if iso not in index:
            continue
        shapes.append((f["geometry"], index[iso]))
        g = shape(f["geometry"]).simplify(SIMPLIFY_DEG, preserve_topology=True)
        parts = [p for p in getattr(g, "geoms", [g]) if p.area >= MIN_AREA_DEG2] or list(getattr(g, "geoms", [g]))
        g = parts[0] if len(parts) == 1 else type(g)(parts) if hasattr(g, "geoms") else g
        geo = json.loads(json.dumps(mapping(g)), parse_float=lambda x: round(float(x), 3))
        out = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"continent": "country"}, "geometry": geo}]}
        (hints / f"{iso}.geojson").write_text(json.dumps(out, separators=(",", ":")))

    found = {iso for _, v in shapes for iso, i in index.items() if i == v}
    missing = [iso for iso in wanted if iso not in found]
    assert not missing, f"not in Natural Earth: {missing}"

    mask = rasterize(shapes, out_shape=(H, W), transform=TRANSFORM, fill=0, dtype="uint8")
    for iso, i in index.items():
        print(f"{i:3d} {iso} cells={(mask == i).sum():,}")

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
