import { haversineKm, KM_PER_DEG, type Block, type LngLat } from "./geo";
import type { Puzzle } from "./puzzle";
import COUNTRIES from "./countries.json";
import { CITIES } from "./cities";

/** Countries a quest can ask for, in mask order (value i + 1). */
export type Country = (typeof COUNTRIES)[number];
export { COUNTRIES };

/**
 * Side quests: rings 2 and 3 each come with an extra condition. Done, the ring
 * is graded on the four levels; not done, it's pass / fail for half the
 * points (see gradeRing in puzzle.ts). Checked against the land mask
 * (public/data/land.tif): 0 = sea, 16 | continent = mainland, 16 | 8 | continent = island.
 */
export type Continent = "africa" | "asia" | "europe" | "northAmerica" | "southAmerica" | "oceania";
export type Quest =
  | { kind: "continent"; continent: Continent }
  | { kind: "country"; country: string }
  | { kind: "nearCity"; city: string; km: number }
  | { kind: "high"; m: number }
  | { kind: "landlocked" }
  | { kind: "islandsOnly" }
  | { kind: "twoContinents" }
  | { kind: "equator" }
  | { kind: "west" | "east" | "northOfCancer" | "southOfCapricorn" | "tropics" };

/** "Keep your ring's centre within this many km of <city>". */
export const NEAR_CITY_KM = 200;

/** "Make your ring reach ground above N m": ring 2 asks for 1,000 m, ring 3 for 2,000 m. */
export const HIGH_EASY_M = 1000;
export const HIGH_HARD_M = 2000;

/** Latitude of the tropics (Cancer north, Capricorn south). */
export const TROPIC_LAT = 23.436;

const CONTINENT_CODES: Record<number, Continent> = {
  1: "africa",
  2: "asia",
  3: "europe",
  4: "northAmerica",
  5: "southAmerica",
  6: "oceania",
};
const CONTINENT_LIST = Object.values(CONTINENT_CODES);


function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The ring's side quest: none for ring 1, an easy one for ring 2, a harder one
 * for ring 3 (picked to suit the ring, so it's always possible). Deterministic,
 * and independent of the ring's own random draws.
 */
export function questFor(p: Puzzle): Quest | null {
  if (p.stage === 0) return null;
  const rand = rng(p.number * 7919 + p.stage * 104729 + 17);
  rand();
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const continent = pick(CONTINENT_LIST);
  const country = pick(COUNTRIES).id;
  const city = (dense: boolean) => pick(CITIES.filter((c) => !dense || c.dense)).id;

  if (p.stage === 1) {
    return pick<Quest>([
      { kind: "landlocked" },
      { kind: "continent", continent },
      { kind: "west" },
      { kind: "east" },
      { kind: "northOfCancer" },
      { kind: "tropics" },
      { kind: "high", m: HIGH_EASY_M },
    ]);
  }
  if (p.twist === "packed-tiny") return { kind: "nearCity", city: city(true), km: NEAR_CITY_KM };
  if (p.twist === "empty-giant") return pick<Quest>([{ kind: "islandsOnly" }, { kind: "southOfCapricorn" }, { kind: "equator" }, { kind: "high", m: HIGH_HARD_M }]);
  const pool: Quest[] = [
    { kind: "nearCity", city: city(false), km: NEAR_CITY_KM },
    { kind: "country", country },
    { kind: "twoContinents" },
    { kind: "southOfCapricorn" },
    { kind: "high", m: HIGH_HARD_M },
  ];
  // only small rings can sit on islands alone; the equator needs some reach from a city
  if (p.radiusKm <= 50) pool.push({ kind: "islandsOnly" });
  if (p.radiusKm >= 25) pool.push({ kind: "equator" });
  return pick(pool);
}

/** [lat, lng] shorthand for the anchor lists below. */
type At = [number, number];
const at = ([lat, lng]: At): LngLat => ({ lat, lng });

/** A big city in each quest country, to start a search for a ring there. */
const COUNTRY_ANCHOR: Record<string, At> = {
  USA: [41.88, -87.63], CAN: [43.65, -79.38], MEX: [19.43, -99.13], BRA: [-23.55, -46.63], ARG: [-34.6, -58.38],
  COL: [4.71, -74.07], PER: [-12.05, -77.04], CHL: [-33.45, -70.67], GBR: [51.51, -0.13], FRA: [48.86, 2.35],
  DEU: [52.52, 13.4], ITA: [41.9, 12.5], ESP: [40.42, -3.7], NLD: [52.37, 4.9], POL: [52.23, 21.01],
  UKR: [50.45, 30.52], RUS: [55.76, 37.62], TUR: [39.93, 32.86], EGY: [30.04, 31.24], MAR: [33.57, -7.59],
  NGA: [6.52, 3.38], ETH: [9.03, 38.74], KEN: [-1.29, 36.82], COD: [-4.32, 15.31], ZAF: [-26.2, 28.05],
  SAU: [24.71, 46.68], IRN: [35.69, 51.39], PAK: [31.55, 74.34], IND: [28.61, 77.21], BGD: [23.81, 90.41],
  CHN: [39.9, 116.41], JPN: [35.68, 139.65], KOR: [37.57, 126.98], PHL: [14.6, 120.98], VNM: [21.03, 105.85],
  THA: [13.76, 100.5], MYS: [3.14, 101.69], IDN: [-6.21, 106.85], AUS: [-33.87, 151.21],
};
const CONTINENT_ANCHORS: Record<Continent, At[]> = {
  africa: [[6.52, 3.38], [30.04, 31.24], [-1.29, 36.82], [-26.2, 28.05]],
  asia: [[28.61, 77.21], [31.23, 121.47], [23.81, 90.41], [35.68, 139.65]],
  europe: [[48.86, 2.35], [52.52, 13.4], [41.9, 12.5], [55.76, 37.62]],
  northAmerica: [[40.71, -74.01], [19.43, -99.13], [34.05, -118.24], [41.88, -87.63]],
  southAmerica: [[-23.55, -46.63], [4.71, -74.07], [-34.6, -58.38], [-12.05, -77.04]],
  oceania: [[-33.87, 151.21], [-37.81, 144.96], [-27.47, 153.03], [-36.85, 174.76]],
};
const KIND_ANCHORS: Partial<Record<Quest["kind"], At[]>> = {
  landlocked: [[40.42, -3.7], [28.61, 77.21], [55.76, 37.62], [19.43, -99.13], [-1.29, 36.82], [4.71, -74.07]],
  islandsOnly: [[-6.21, 106.85], [35.68, 139.65], [14.6, 120.98], [25.03, 121.56], [6.93, 79.86], [23.11, -82.37], [-36.85, 174.76]],
  twoContinents: [[41.01, 28.98], [30.6, 32.3], [36.0, -5.6], [12.6, 43.4], [8.0, -77.5]],
  equator: [[0.35, 32.58], [-0.18, -78.47], [-0.03, 109.33], [0.39, 9.45], [0.03, -51.07]],
  southOfCapricorn: [[-26.2, 28.05], [-25.43, -49.27], [-34.6, -58.38], [-33.45, -70.67], [-33.87, 151.21], [-33.92, 18.42]],
  northOfCancer: [[51.51, -0.13], [48.86, 2.35], [39.9, 116.41], [35.68, 139.65], [40.71, -74.01], [28.61, 77.21]],
  tropics: [[6.52, 3.38], [19.08, 72.88], [-6.21, 106.85], [14.6, 120.98], [13.76, 100.5], [4.71, -74.07], [-4.32, 15.31]],
  west: [[40.71, -74.01], [19.43, -99.13], [4.71, -74.07], [-23.55, -46.63], [41.88, -87.63], [33.57, -7.59]],
  east: [[28.61, 77.21], [31.23, 121.47], [6.52, 3.38], [52.52, 13.4], [30.04, 31.24], [-6.21, 106.85]],
  high: [[45.07, 7.69], [47.27, 11.39], [4.71, -74.07], [19.43, -99.13], [9.03, 38.74], [-0.18, -78.47], [-16.5, -68.15], [27.7, 85.32], [35.69, 51.39], [15.37, 44.19], [-1.29, 36.82], [39.74, -104.99]],
};

/** Rough view of each continent, [west, south, east, north], for "show on map". */
export const CONTINENT_VIEW: Record<Continent, [number, number, number, number]> = {
  africa: [-18, -35, 52, 37],
  asia: [60, 5, 145, 55],
  europe: [-10, 36, 45, 71],
  northAmerica: [-128, 12, -62, 58],
  southAmerica: [-82, -55, -34, 12],
  oceania: [112, -45, 179, -8],
};

/**
 * Places that suit a quest, to search from for a sample ring that does it
 * (when the player's ring didn't). Nearest to `near` first.
 */
export function questAnchors(q: Quest, near: LngLat): LngLat[] {
  let list: At[];
  if (q.kind === "nearCity") {
    const c = CITIES.find((c) => c.id === q.city);
    list = c ? [[c.lat, c.lng]] : [];
  } else if (q.kind === "country") list = COUNTRY_ANCHOR[q.country] ? [COUNTRY_ANCHOR[q.country]] : [];
  else if (q.kind === "continent") list = CONTINENT_ANCHORS[q.continent];
  else list = KIND_ANCHORS[q.kind] ?? [];
  return list.map(at).sort((a, b) => haversineKm(near, a) - haversineKm(near, b));
}

/** Quests judged from the ring's position alone (no map data needed). */
export const GEOMETRY_ONLY = new Set<Quest["kind"]>(["nearCity", "equator", "west", "east", "northOfCancer", "southOfCapricorn", "tropics"]);

/** What the land mask says about the area inside a ring. */
export interface RingSurface {
  center: number; // mask value at the ring centre
  touchesSea: boolean;
  touchesMainland: boolean;
  touchesIsland: boolean;
  continents: Set<Continent>;
  seaShare: number; // fraction of the ring's cells that are sea (0–1)
}

/** Summarise the land-mask cells whose centres lie inside the ring. */
export function surveyRing(block: Block, center: LngLat, radiusKm: number): RingSurface {
  const { grid, rows, cols, values } = block;
  const res = grid.res;
  const s: RingSurface = {
    center: 0,
    touchesSea: false,
    touchesMainland: false,
    touchesIsland: false,
    continents: new Set(),
    seaShare: 0,
  };
  let cells = 0;
  let sea = 0;
  let nearest = Infinity;
  const latR = radiusKm / KM_PER_DEG;
  for (let r = 0; r < rows; r++) {
    const lat = grid.originLat - (block.row0 + r + 0.5) * res;
    if (Math.abs(lat - center.lat) > latR + res) continue;
    for (let c = 0; c < cols; c++) {
      const lng = grid.originLng + (block.col0 + c + 0.5) * res;
      const d = haversineKm(center, { lat, lng });
      const v = values[r * cols + c];
      if (d < nearest) {
        nearest = d;
        s.center = v;
      }
      if (d > radiusKm) continue;
      cells++;
      if (v === 0) {
        s.touchesSea = true;
        sea++;
        continue;
      }
      if (v & 8) s.touchesIsland = true;
      else s.touchesMainland = true;
      const cont = CONTINENT_CODES[v & 7];
      if (cont) s.continents.add(cont);
    }
  }
  s.seaShare = cells ? sea / cells : 0;
  return s;
}

/**
 * Which listed country the ring is centred in (its id), or null. Uses the
 * centre cell, or the nearest country cell within 2 km, so a ring on a
 * coastline isn't failed by a sea cell.
 */
export function countryAt(block: Block, center: LngLat): string | null {
  const { grid, rows, cols, values } = block;
  let best: number | null = null;
  let bestD = 2;
  for (let r = 0; r < rows; r++) {
    const lat = grid.originLat - (block.row0 + r + 0.5) * grid.res;
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c];
      if (!v) continue;
      const d = haversineKm(center, { lat, lng: grid.originLng + (block.col0 + c + 0.5) * grid.res });
      if (d <= bestD) {
        bestD = d;
        best = v;
      }
    }
  }
  return best ? (COUNTRIES[best - 1]?.id ?? null) : null;
}

/**
 * `country` is the ring's centre country (countryAt), needed only for country
 * quests; `highest` the highest ground in the ring in metres (highestInRing),
 * only for height quests.
 */
export function questDone(q: Quest, s: RingSurface, center: LngLat, radiusKm: number, country: string | null = null, highest: number | null = null): boolean {
  switch (q.kind) {
    case "high":
      return highest !== null && highest > q.m;
    case "nearCity": {
      const c = CITIES.find((c) => c.id === q.city);
      return !!c && haversineKm(center, c) <= q.km;
    }
    case "country":
      return country === q.country;
    case "continent":
      return s.center !== 0 && CONTINENT_CODES[s.center & 7] === q.continent;
    case "landlocked":
      return !s.touchesSea;
    case "islandsOnly":
      return s.touchesIsland && !s.touchesMainland;
    case "twoContinents":
      return s.continents.size >= 2;
    case "equator": {
      const latR = radiusKm / KM_PER_DEG;
      return center.lat - latR < 0 && center.lat + latR > 0;
    }
    case "northOfCancer":
      return center.lat - radiusKm / KM_PER_DEG > TROPIC_LAT;
    case "southOfCapricorn":
      return center.lat + radiusKm / KM_PER_DEG < -TROPIC_LAT;
    case "tropics": {
      const latR = radiusKm / KM_PER_DEG;
      return center.lat - latR > -TROPIC_LAT && center.lat + latR < TROPIC_LAT;
    }
    case "west":
    case "east": {
      // the ring's east-west reach in degrees of longitude at its widest latitude
      const latR = radiusKm / KM_PER_DEG;
      const widest = Math.min(89.9, Math.abs(center.lat) + latR);
      const lngR = radiusKm / (KM_PER_DEG * Math.cos((widest * Math.PI) / 180));
      const lng = ((((center.lng + 180) % 360) + 360) % 360) - 180;
      return q.kind === "west" ? lng - lngR >= -180 && lng + lngR <= 0 : lng - lngR >= 0 && lng + lngR <= 180;
    }
  }
}

