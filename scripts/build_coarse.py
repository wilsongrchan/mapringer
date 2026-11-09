"""Aggregate the 30 arc-second population COG into a coarser COG for big rings.

Each output cell is the SUM of FACTOR x FACTOR input cells (so totals are
preserved), with the same origin. Rings of 100 km+ read this file instead of
the full-resolution one.

Usage:
    .venv/bin/python scripts/build_coarse.py public/data/population.tif public/data/population_10x.tif 10
"""

import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.shutil import copy as rio_copy
from rasterio.transform import Affine
from rasterio.windows import Window


def main(src_path: str, dst_path: str, factor: int) -> None:
    dst = Path(dst_path)
    with rasterio.open(src_path) as src:
        out_w = -(-src.width // factor)
        out_h = -(-src.height // factor)
        t = src.transform
        transform = Affine(t.a * factor, t.b, t.c, t.d, t.e * factor, t.f)
        profile = dict(
            driver="GTiff", dtype="float32", count=1, width=out_w, height=out_h,
            crs=src.crs, transform=transform, tiled=True, blockxsize=256, blockysize=256,
            compress="DEFLATE", predictor=3,
        )
        out = np.zeros((out_h, out_w), dtype=np.float64)
        chunk_rows = factor * 256
        for row in range(0, src.height, chunk_rows):
            h = min(chunk_rows, src.height - row)
            arr = src.read(1, window=Window(0, row, src.width, h)).astype(np.float64)
            # pad to a whole number of blocks, then sum each factor x factor block
            ph = -(-h // factor) * factor
            pw = out_w * factor
            padded = np.zeros((ph, pw))
            padded[:h, : src.width] = arr
            sums = padded.reshape(ph // factor, factor, out_w, factor).sum(axis=(1, 3))
            out[row // factor : row // factor + sums.shape[0]] = sums
            print(f"  rows {row}-{row + h} / {src.height}", end="\r")
        print(f"\ntotal: {out.sum():,.0f}")

        with tempfile.TemporaryDirectory(dir=dst.parent) as tmp:
            tmp_path = Path(tmp) / "coarse.tif"
            with rasterio.open(tmp_path, "w", **profile) as f:
                f.write(out.astype(np.float32), 1)
            rio_copy(tmp_path, dst, driver="COG", BLOCKSIZE=256, COMPRESS="DEFLATE",
                     PREDICTOR="FLOATING_POINT", OVERVIEWS="NONE")
    print(f"wrote {dst} ({dst.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 10)
