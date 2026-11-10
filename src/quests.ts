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
  | { kind: "landlocked" }
  | { kind: "islandsOnly" }
  | { kind: "twoContinents" }
  | { kind: "equator" }
  | { kind: "west" | "east" | "northOfCancer" | "southOfCapricorn" | "tropics" };

/** "Keep your ring's centre within this many km of <city>". */
export const NEAR_CITY_KM = 200;

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
    ]);
  }
  if (p.twist === "packed-tiny") return { kind: "nearCity", city: city(true), km: NEAR_CITY_KM };
  if (p.twist === "empty-giant") return pick<Quest>([{ kind: "islandsOnly" }, { kind: "southOfCapricorn" }, { kind: "equator" }]);
  const pool: Quest[] = [
    { kind: "nearCity", city: city(false), km: NEAR_CITY_KM },
    { kind: "country", country },
    { kind: "twoContinents" },
    { kind: "southOfCapricorn" },
  ];
  // only small rings can sit on islands alone; the equator needs some reach from a city
  if (p.radiusKm <= 50) pool.push({ kind: "islandsOnly" });
  if (p.radiusKm >= 25) pool.push({ kind: "equator" });
  return pick(pool);
}

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

/** `country` is the ring's centre country (countryAt), needed only for country quests. */
export function questDone(q: Quest, s: RingSurface, center: LngLat, radiusKm: number, country: string | null = null): boolean {
  switch (q.kind) {
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

