# MapRinger

A daily map game. Each day you get a ring of a fixed radius and a target population. Pan the map to place the ring anywhere on Earth, lock it in (one try per day), and see how close you got.

## Run locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test
```

## Population data (one-time setup)

The game reads the [GHSL GHS-POP R2023A](https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php) 2025 grid (30 arc-second, ~1 km). It comes from a Cloud-Optimized GeoTIFF that the browser reads with HTTP range requests, so there's no backend. The file isn't in git.

```sh
mkdir -p data/raw && cd data/raw
curl -LO https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip
unzip GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip && cd ../..
python3 -m venv .venv && .venv/bin/pip install rasterio numpy
.venv/bin/python scripts/build_cog.py data/raw/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif public/data/population.tif
.venv/bin/python scripts/build_coarse.py public/data/population.tif public/data/population_10x.tif 10
```

`population_10x.tif` (~10 km cells, summed) is used for rings of 100 km or more.

In dev, test mode is on by default: unlimited attempts, endless random puzzles (**New puzzle**), nothing saved. Use `?unlimited=0` for the real one-try-per-day rules and `?day=N` to play puzzle #N.

In production, host both `.tif` files on storage that supports range requests and CORS (e.g. Cloudflare R2), then build with `VITE_POPULATION_BASE_URL=https://…/` (the folder holding them).

## Layout

- `src/geo.ts`: geodesic circle maths and the circle-population sum (edge cells weighted by the fraction of each cell inside the ring)
- `src/population.ts`: reads only the grid cells under the ring from the GeoTIFF
- `src/puzzle.ts`: daily puzzle (seeded by date), scoring, share text
- `src/main.ts`: map UI (MapLibre + OpenFreeMap)
