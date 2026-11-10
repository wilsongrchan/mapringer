"""Build a land / island / continent mask for side quests.

Output: a uint8 Cloud-Optimized GeoTIFF on a 1 arc-minute (~1.8 km) grid:
    0                   sea
    16 | continent      mainland  (Afro-Eurasia, the Americas, Australia, Antarctica)
    16 | 8 | continent   island    (any landmass smaller than Australia, incl. Greenland)
continent: 1 Africa, 2 Asia, 3 Europe, 4 North America, 5 South America,
           6 Oceania, 7 Antarctica, 0 unknown

Sources (public domain): Natural Earth ne_10m_land, ne_10m_minor_islands,
ne_50m_admin_0_countries (for continents).

Usage:
    .venv/bin/python scripts/build_landmask.py data/raw/ne public/data/land.tif
"""

import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.shutil import copy as rio_copy
from rasterio.transform import from_origin
from scipy.ndimage import distance_transform_edt

RES = 1 / 60
W, H = 360 * 60, 180 * 60
TRANSFORM = from_origin(-180, 90, RES, RES)
CONTINENTS = {"Africa": 1, "Asia": 2, "Europe": 3, "North America": 4, "South America": 5, "Oceania": 6, "Antarctica": 7}
R = 6371.0088
ISLAND_MAX_KM2 = 7_000_000  # Australia is ~7.7M km²; everything smaller is an island


def ring_area_km2(ring):
    """Spherical polygon area (km²) of a lon/lat ring."""
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(total) * R * R / 2


def polygons(geom):
    if geom["type"] == "Polygon":
        yield geom["coordinates"]
    elif geom["type"] == "MultiPolygon":
        yield from geom["coordinates"]


def main(src_dir: str, dst_path: str) -> None:
    src = Path(src_dir)
    land = json.load(open(src / "ne_10m_land.geojson"))
    minor = json.load(open(src / "ne_10m_minor_islands.geojson"))
    countries = json.load(open(src / "ne_50m_admin_0_countries.geojson"))

    shapes = []
    big = []
    for f in land["features"]:
        for poly in polygons(f["geometry"]):
            area = ring_area_km2(poly[0])
            island = area < ISLAND_MAX_KM2
            if not island:
                big.append(round(area / 1e6, 1))
            shapes.append(({"type": "Polygon", "coordinates": poly}, 24 if island else 16))
    for f in minor["features"]:
        for poly in polygons(f["geometry"]):
            shapes.append(({"type": "Polygon", "coordinates": poly}, 24))
    print(f"mainland masses (M km²): {sorted(big, reverse=True)}")

    # mainland first, then islands on top so small islands aren't lost
    shapes.sort(key=lambda s: s[1])
    flags = rasterize(shapes, out_shape=(H, W), transform=TRANSFORM, fill=0, dtype="uint8")

    cont_shapes = [
        (poly_geom, CONTINENTS[f["properties"]["CONTINENT"]])
        for f in countries["features"]
        if f["properties"]["CONTINENT"] in CONTINENTS
        for poly_geom in [f["geometry"]]
    ]
    cont = rasterize(cont_shapes, out_shape=(H, W), transform=TRANSFORM, fill=0, dtype="uint8")

    # land cells the (coarser) country layer missed take the nearest continent
    missing = (flags > 0) & (cont == 0)
    _, (ri, ci) = distance_transform_edt(cont == 0, return_indices=True)
    cont[missing] = cont[ri[missing], ci[missing]]

    # Natural Earth tags whole countries with one continent; split the
    # transcontinental ones along the usual geographic lines.
    def region(west, east, south, north):
        c0, c1 = int((west + 180) * 60), int((east + 180) * 60)
        r0, r1 = int((90 - north) * 60), int((90 - south) * 60)
        return slice(r0, r1), slice(c0, c1)

    rs, cs = region(60, 180, 40, 90)  # Russia east of the Urals → Asia
    sub = cont[rs, cs]
    sub[sub == CONTINENTS["Europe"]] = CONTINENTS["Asia"]
    rs, cs = region(25.6, 29.03, 40.0, 42.2)  # Turkish Thrace (west of the Bosphorus) → Europe
    sub = cont[rs, cs]
    sub[sub == CONTINENTS["Asia"]] = CONTINENTS["Europe"]
    rs, cs = region(32.35, 35, 27.7, 31.4)  # Sinai → Asia
    sub = cont[rs, cs]
    sub[sub == CONTINENTS["Africa"]] = CONTINENTS["Asia"]

    out = np.where(flags > 0, flags | cont, 0).astype("uint8")
    land_cells = (out > 0).sum()
    print(f"land cells: {land_cells:,} ({100 * land_cells / out.size:.1f}%), island cells: {((out & 8) > 0).sum():,}")

    dst = Path(dst_path)
    with tempfile.TemporaryDirectory(dir=dst.parent) as tmp:
        tmp_path = Path(tmp) / "land.tif"
        with rasterio.open(
            tmp_path, "w", driver="GTiff", width=W, height=H, count=1, dtype="uint8",
            crs="EPSG:4326", transform=TRANSFORM, tiled=True, blockxsize=256, blockysize=256, compress="DEFLATE",
        ) as f:
            f.write(out, 1)
        rio_copy(tmp_path, dst, driver="COG", BLOCKSIZE=256, COMPRESS="DEFLATE", OVERVIEWS="NONE")
    print(f"wrote {dst} ({dst.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
