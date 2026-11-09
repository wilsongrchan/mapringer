"""Convert the GHSL GHS-POP 30 arc-second GeoTIFF into a web-friendly
Cloud-Optimized GeoTIFF that the browser can read with HTTP range requests.

- Float32, 256x256 internal tiles, DEFLATE + floating-point predictor
- nodata / negative values replaced by 0 so the client can just sum cells
- no overviews (the client always reads full-resolution cells)

Usage:
    .venv/bin/python scripts/build_cog.py data/raw/<input>.tif public/data/population.tif
"""

import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.shutil import copy as rio_copy
from rasterio.windows import Window

BLOCK = 256 * 8  # rows processed per chunk


def main(src_path: str, dst_path: str) -> None:
    dst = Path(dst_path)
    dst.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(src_path) as src:
        profile = src.profile.copy()
        nodata = src.nodata
        print(f"input: {src.width}x{src.height}, crs={src.crs}, bounds={src.bounds}, nodata={nodata}")
        profile.update(
            driver="GTiff",
            dtype="float32",
            nodata=None,
            tiled=True,
            blockxsize=256,
            blockysize=256,
            compress="DEFLATE",
            predictor=3,
            BIGTIFF="IF_SAFER",
        )

        total = 0.0
        with tempfile.TemporaryDirectory(dir=dst.parent) as tmp:
            tmp_path = Path(tmp) / "tiled.tif"
            with rasterio.open(tmp_path, "w", **profile) as out:
                for row in range(0, src.height, BLOCK):
                    h = min(BLOCK, src.height - row)
                    win = Window(0, row, src.width, h)
                    arr = src.read(1, window=win).astype(np.float32)
                    if nodata is not None:
                        arr[arr == nodata] = 0
                    arr[~np.isfinite(arr) | (arr < 0)] = 0
                    total += float(arr.sum(dtype=np.float64))
                    out.write(arr, 1, window=win)
                    print(f"  rows {row}-{row + h} / {src.height}", end="\r")
            print(f"\nworld population in grid: {total:,.0f}")

            rio_copy(
                tmp_path,
                dst,
                driver="COG",
                BLOCKSIZE=256,
                COMPRESS="DEFLATE",
                PREDICTOR="FLOATING_POINT",
                OVERVIEWS="NONE",
                BIGTIFF="IF_SAFER",
            )
    print(f"wrote {dst} ({dst.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
