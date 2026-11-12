# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MapRinger (Traditional Chinese name 圈地家) is a daily map game: each day has three rings, played in order. Each ring has a fixed radius and a target population, and the player places it anywhere on Earth. It's a static Vite + TypeScript site with no backend. MapLibre GL draws a globe, and population is read straight from Cloud-Optimized GeoTIFFs with HTTP range requests (geotiff.js).

## Commands

```sh
npm run dev                      # http://localhost:5173 (test mode on: unlimited retries, "New puzzle")
npm test                         # vitest run (all tests live in tests/game.test.ts)
npx vitest run -t "quest"        # tests whose name matches
npx tsc --noEmit                 # typecheck (npm run build = tsc && vite build)
npm run build                    # dist/ (BASE_PATH=/mapringer/ for GitHub Pages; default base "./")
```

URL params: `?unlimited` (test mode on a live site; on by default in dev), `?unlimited=0` (real one-try rules in dev), `?day=N` (play day N; test mode otherwise starts on a random day), `?lang=zh|en`. In dev, `window.__map` is the MapLibre map and `window.__revealMs` slows the reveal ripple. These are useful for headless checks with puppeteer-core plus the system Chrome; there is no e2e suite.

Tests in `tests/game.test.ts` that need the big data files skip themselves (`describe.skipIf`) when `public/data/*.tif` is missing.

Python data scripts run from the repo's `.venv` (rasterio, numpy, scipy, pyshp, pillow): `.venv/bin/python scripts/<script>.py …`. Each script's docstring gives its usage.

## Data and where it lives

- **`public/data/*.tif` (not in git, too big):**
  - `population.tif` (GHSL 30″)
  - `population_10x.tif` (summed 10× coarser, used for rings ≥ 100 km, `COARSE_FROM_KM`)
  - `land.tif` (1′ mask: 0 sea, `16|continent` mainland, `16|8|continent` island)
  - `countries.tif` (value = index+1 into `src/countries.json`, so only append to that list)

  They're hosted twice:
  - The GitHub release `data-v1`. The Pages workflow downloads them at build time.
  - Vercel Blob for the real site. `vercel.json` rewrites `/data/:file` to Blob, and there is no Vercel CLI here, so the owner uploads to Blob.

  If a `.tif` changes, both places must be updated. Prefer code-side corrections (e.g. `src/continent-fixes.json`) over regenerating a hosted `.tif`.
- **Small generated data (committed, ships with the site):**

  | File | Built by | Used for |
  |---|---|---|
  | `public/hints/countries/*.geojson` | `build_countries.py` | Country outlines |
  | `public/hints/continent-borders.geojson` | `build_continent_borders.py` | Land borders between continents, plus side-label points |
  | `public/hints/seas.png` and `src/quest-zones.json` | `build_quest_zones.py` | A 5′ grid of named-sea labels (from Natural Earth marine polys), and per-quest feasibility caps |

  Rebuild the dependent file when its inputs change: `land.tif`, `continent-fixes.json`, `cities.ts`, `countries.json`, or the sea groups in `build_quest_zones.py`.
- **Elevation** comes from the AWS Terrarium tiles (`src/elevation.ts`). They're read at lock-in for height quests, and also used by the hillshade layer.

## Architecture

- **`puzzle.ts`: the rules.**
  - Each ring is seeded by `(day, stage)`: `ringFor`/`dayRings`.
  - `STAGES`: ring 1 Easy satellite map (max 80), ring 2 Standard (100), ring 3 Hard (150).
  - Ring-3 twists (`empty-giant`, `packed-tiny`, `void`, `mega-crowd`) have hand-measured target ranges.
  - Scoring: log-scale `score()`, giving points = max × score / 100. The emoji levels (`LEVELS`) are only cut-off labels.
  - `gradeRing`: if the quest isn't done, the ring is pass/fail for half the max.
- **`quests.ts`: quests and judging.**
  - `questFor` picks a quest *family*, then a variant, keeping only variants that pass `feasible()`. That compares the ring's target density with the caps in `quest-zones.json`. Twists get fixed quests.
  - `surveyRing` summarises the land-mask cells inside a ring. `continentAt` applies `continent-fixes.json`, which must stay in sync with `build_continent_borders.py`.
  - `questDone` judges a quest. `questAnchors` lists places that suit each quest, used to seed the "closest ring that does the quest" search.
  - Changing pools or the RNG order changes which quest past and current days get.
- **`answer.ts`: the closest-answer search.** `findClosestAnswer` widens the search area in steps, screens candidate centres with per-row prefix sums, then hill-climbs. An optional `accept` predicate keeps only quest-passing rings, and `best`/`near` give fallbacks. `main.ts` always shows a gold quest ring when the green ring doesn't do the quest; "none found" must not happen.
- **`population.ts` / `geo.ts`.** `geo.ts` computes the windows of a ring and the cell-fraction-weighted circle sums. `population.ts` loads blocks from each GeoTIFF.
- **`difficulty.ts`: map styles.** These are OpenFreeMap styles rewritten per map (Easy is satellite with labels, Standard drops roads, Hard keeps only land, water and rivers). They're swapped with a diff `setStyle`, with the game's own sources and layers (`gameLayers` in `main.ts`) appended to every style. After a style loads, hint data is pushed again, because updates made while a style is loading are lost.
- **`main.ts`: the whole UI and its state machine.** The ring being placed is an SVG overlay (`#ring-overlay`), redrawn on every camera move. On lock-in, `lockAnimation` runs while the counts load: frame the ring, trace it, a glow if still loading, then a "ding". The locked ring stays as that overlay (`.settled`), not a map layer. Other parts:
  - The answer reveal and the ring-to-ring switch share `rippleTo`, a snapshot canvas with a growing radial mask. `startRing` flies out to the globe, clears the old rings, then ripples in the next map.
  - Quest hints: gold `#f5b700` lines and outlines, side labels (`quest-sides`), hillshade for height quests, and tap-to-fly via `questFocus`.
  - Pending async work is cancelled by bumping `attempt`.
- **`i18n.ts`** holds every user-facing string in English and Traditional Chinese (`t(key, vars)`). The language is auto-detected, and switching reloads the page; `CarryOver` in sessionStorage keeps your place. Chinese uses 萬/億 only in the question panel. **`places.ts`** does reverse geocoding (Nominatim, rate-limited) with `seas.ts` sea or ocean names as a fallback. **`storage.ts`** keeps one localStorage entry per (day, ring); nothing is saved in test mode.

## Deploy

Pushing to `main` deploys both sites:
- **GitHub Pages:** `.github/workflows/pages.yml` downloads the data-v1 tifs, runs the tests, builds with `BASE_PATH`, and deploys to the test site https://wilsongrchan.github.io/mapringer/?unlimited.
- **Vercel:** builds https://www.gamerabbit.io/mapringer/.

If a Pages deploy gets stuck on `deploy-pages`, cancel and re-run it. Commits must use the GitHub noreply email (`302737298+wilsongrchan@users.noreply.github.com`, set in the repo's git config); pushes with a personal email are rejected.

The how-to-play clip is recorded from the real game with `scripts/record_demo.mjs` (puppeteer-core + Chrome + ffmpeg; usage in the file). Re-record it when the ring-1 UI changes.
