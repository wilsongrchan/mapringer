# MapRinger

A daily map game (Chinese: 圈地家). Each day has three rings, easy to hard, played one after another: each has a fixed radius and a target population, and rings 2 and 3 come with a quest ("touch the Persian Gulf", "centre your ring in Mexico"…). Place the ring anywhere on Earth, lock it in (one try per ring), and see how close you got.

Live at https://www.gamerabbit.io/mapringer/ (test site: https://wilsongrchan.github.io/mapringer/?unlimited).

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

Side quests use a land / island / continent mask built from [Natural Earth](https://www.naturalearthdata.com/) (public domain):

```sh
mkdir -p data/raw/ne && cd data/raw/ne
for f in ne_10m_land ne_10m_minor_islands ne_50m_admin_0_countries; do
  curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson
done
cd ../../..
.venv/bin/pip install scipy
.venv/bin/python scripts/build_landmask.py data/raw/ne public/data/land.tif
```

The quest data below is small and committed; rebuild it whenever `land.tif` (or its inputs) changes:

```sh
# the lines where continents meet (continent quests), using the splits in src/continent-fixes.json
.venv/bin/python scripts/build_continent_borders.py public/data/land.tif public/hints/continent-borders.geojson

# sea quests and quest feasibility: public/hints/seas.png + src/quest-zones.json
# (needs Natural Earth's ne_10m_geography_marine_polys shapefile)
.venv/bin/pip install pyshp pillow
.venv/bin/python scripts/build_quest_zones.py <path>/ne_10m_geography_marine_polys.shp public/data
```

Country quests ("centre your ring in France") use a country mask of the countries listed in `src/countries.json` (their order is the mask's cell values, so append new ones at the end and rebuild). It writes `countries.tif` (host it with the other `.tif` files) and a small outline per country for the hint:

```sh
cd data/raw/ne && curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson && cd ../../..
.venv/bin/python scripts/build_countries.py data/raw/ne src/countries.json public/data/countries.tif public/hints/countries
```

In dev, test mode is on by default: unlimited attempts, endless random puzzles (**New puzzle**), nothing saved. Use `?unlimited=0` for the real one-try-per-day rules and `?day=N` to play puzzle #N.

In production the `.tif` files are hosted on the `data-v1` GitHub release (downloaded by the Pages workflow) and on Vercel Blob (gamerabbit.io, via the rewrite in `vercel.json`); update both when one changes. Any host with range requests and CORS works: build with `VITE_POPULATION_BASE_URL=https://…/` (the folder holding them).

## Layout

- `src/geo.ts`: geodesic circle maths and the circle-population sum (edge cells weighted by the fraction of each cell inside the ring)
- `src/population.ts`: reads only the grid cells under the ring from the GeoTIFF
- `src/puzzle.ts`: the day's three rings (seeded by date), scoring, share text
- `src/quests.ts`: quests, how they're judged, which ones a ring can do
- `src/answer.ts`: the closest-ring search shown after locking in
- `src/main.ts`: map UI (MapLibre + OpenFreeMap)

See `CLAUDE.md` for a fuller tour.
