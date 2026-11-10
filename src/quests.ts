import { haversineKm, KM_PER_DEG, type Block, type LngLat } from "./geo";
import type { Puzzle } from "./puzzle";
import COUNTRIES from "./countries.json";

/** Countries a quest can ask for, in mask order (value i + 1). */
export type Country = (typeof COUNTRIES)[number];
export { COUNTRIES };

/**
 * Side quests: an optional extra condition on the day's ring, worth a few
 * bonus points. Checked against the land mask (public/data/land.tif):
 *   0 = sea, 16 | continent = mainland, 16 | 8 | continent = island.
 */
export type Continent = "africa" | "asia" | "europe" | "northAmerica" | "southAmerica" | "oceania";
export type Quest =
  | { kind: "continent"; continent: Continent; bonus: number }
  | { kind: "country"; country: string; bonus: number }
  | { kind: "landlocked"; bonus: number }
  | { kind: "islandsOnly"; bonus: number }
  | { kind: "twoContinents"; bonus: number }
  | { kind: "equator"; bonus: number }
  | { kind: "west" | "east" | "northOfCancer" | "southOfCapricorn" | "tropics"; bonus: number };

/** Latitude of the tropics (Cancer north, Capricorn south). */
export const TROPIC_LAT = 23.436;
/** Quests added after launch only appear from this puzzle on, so earlier days keep theirs. */
export const LINE_QUESTS_FROM = 2;
export const COUNTRY_QUESTS_FROM = 3;

const CONTINENT_CODES: Record<number, Continent> = {
  1: "africa",
  2: "asia",
  3: "europe",
  4: "northAmerica",
  5: "southAmerica",
  6: "oceania",
};
const CONTINENT_LIST = Object.values(CONTINENT_CODES);

/** Quest bonuses only count when the ring itself scores at least this. */
export const BONUS_MIN_SCORE = 20;

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

/** The day's side quest (deterministic; independent of the puzzle's own random draws). */
export function questFor(p: Puzzle): Quest {
  const rand = rng(p.number * 7919 + 17);
  rand();
  const pool: Quest[] = [
    { kind: "continent", continent: CONTINENT_LIST[Math.floor(rand() * CONTINENT_LIST.length)], bonus: 5 },
    { kind: "landlocked", bonus: 5 },
    { kind: "islandsOnly", bonus: 10 },
    { kind: "twoContinents", bonus: 10 },
  ];
  // A ring needs to be big enough to reach the equator from a populated place.
  if (p.radiusKm >= 25 && p.twist !== "packed-tiny") pool.push({ kind: "equator", bonus: 5 });
  // whole-ring-on-one-side-of-a-line quests (always possible for a populated ring)
  if (p.number >= LINE_QUESTS_FROM)
    pool.push(
      { kind: "west", bonus: 5 },
      { kind: "east", bonus: 5 },
      { kind: "northOfCancer", bonus: 5 },
      { kind: "southOfCapricorn", bonus: 10 },
      { kind: "tropics", bonus: 5 },
    );
  if (p.number >= COUNTRY_QUESTS_FROM)
    pool.push({ kind: "country", country: COUNTRIES[Math.floor(rand() * COUNTRIES.length)].id, bonus: 10 });
  return pool[Math.floor(rand() * pool.length)];
}

/** What the land mask says about the area inside a ring. */
export interface RingSurface {
  center: number; // mask value at the ring centre
  touchesSea: boolean;
  touchesMainland: boolean;
  touchesIsland: boolean;
  continents: Set<Continent>;
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
  };
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
      if (v === 0) {
        s.touchesSea = true;
        continue;
      }
      if (v & 8) s.touchesIsland = true;
      else s.touchesMainland = true;
      const cont = CONTINENT_CODES[v & 7];
      if (cont) s.continents.add(cont);
    }
  }
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

/** Bonus actually earned: the quest must be done and the ring must score decently. */
export function questBonus(q: Quest, done: boolean, score: number): number {
  return done && score >= BONUS_MIN_SCORE ? q.bonus : 0;
}
