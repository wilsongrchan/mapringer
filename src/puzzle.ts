/** Day #1 of MapRinger. Puzzles roll over at the player's local midnight. */
export const LAUNCH_DATE = { year: 2026, month: 11, day: 9 };

export interface Puzzle {
  number: number;
  radiusKm: number;
  target: number;
  /** Set on occasional "twist" puzzles that flip the usual size/crowd pairing. */
  twist?: "empty-giant" | "packed-tiny";
}

/** About 1 in 8 puzzles is a twist. */
const TWIST_CHANCE = 0.125;
/**
 * Densest real rings in the GHSL data (Surat for 3 km, Dhaka for 5 km).
 * Packed-tiny targets are 25–60% of these so they stay reachable.
 */
const TINY_RING_MAX: Record<number, number> = { 3: 3_980_000, 5: 6_930_000 };

const logUniform = (rand: () => number, lo: number, hi: number) =>
  Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)));

function twistPuzzle(number: number, rand: () => number): Puzzle {
  if (rand() < 0.5) {
    // A huge ring with hardly anyone in it: remote islands, deserts, the far north.
    const radiusKm = [500, 750, 1000][Math.floor(rand() * 3)];
    return { number, radiusKm, target: niceRound(logUniform(rand, 500, 20_000)), twist: "empty-giant" };
  }
  // A tiny ring packed with people: the densest city centres on Earth.
  const radiusKm = rand() < 0.5 ? 3 : 5;
  const target = niceRound(TINY_RING_MAX[radiusKm] * (0.25 + rand() * 0.35));
  return { number, radiusKm, target, twist: "packed-tiny" };
}

const RADII_KM = [3, 5, 8, 10, 15, 20, 25, 30, 40, 50];
/** Occasional big rings, counted on the coarse 10 km grid. */
const BIG_RADII_KM = [100, 200, 300, 500, 750, 1000];
const BIG_RING_CHANCE = 0.2;
// Average density inside the ring (people / km²) is drawn log-uniformly between
// these. The max falls for bigger rings, fitted to the densest real rings in the
// GHSL data (100 km: ~2,240/km², 300 km: ~1,140, 1000 km: ~420, all around the
// Ganges delta) with a 15% margin so every target is reachable.
const MIN_DENSITY = 10;
const maxDensity = (radiusKm: number) => Math.min(5000, 0.85 * 2236 * (100 / radiusKm) ** 0.73);

const MS_PER_DAY = 86_400_000;

/** Puzzle number for a given local date (1 = launch day). */
export function puzzleNumber(date: Date = new Date()): number {
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const launch = Date.UTC(LAUNCH_DATE.year, LAUNCH_DATE.month - 1, LAUNCH_DATE.day);
  return Math.floor((today - launch) / MS_PER_DAY) + 1;
}

/** Small deterministic PRNG so everyone gets the same puzzle for a given day. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to two significant figures, e.g. 48_213 -> 48_000. */
export function niceRound(n: number): number {
  if (n <= 0) return 0;
  const mag = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

export function puzzleFor(number: number): Puzzle {
  const rand = mulberry32(number * 2654435761);
  rand(); // discard first value: it correlates with nearby seeds
  if (rand() < TWIST_CHANCE) return twistPuzzle(number, rand);
  const radii = rand() < BIG_RING_CHANCE ? BIG_RADII_KM : RADII_KM;
  const radiusKm = radii[Math.floor(rand() * radii.length)];
  const maxD = maxDensity(radiusKm);
  const density = Math.exp(Math.log(MIN_DENSITY) + rand() * (Math.log(maxD) - Math.log(MIN_DENSITY)));
  const target = niceRound(Math.PI * radiusKm ** 2 * density);
  return { number, radiusKm, target };
}

export function todaysPuzzle(date: Date = new Date()): Puzzle {
  return puzzleFor(puzzleNumber(date));
}

/**
 * Plain closeness in percent (min/max ratio): 2x over or under = 50.
 * Used for "is this a correct ring?" checks, not for the player's score.
 */
export function accuracy(population: number, target: number): number {
  if (population <= 0 || target <= 0) return 0;
  return (100 * Math.min(population, target)) / Math.max(population, target);
}

// Score curve knobs. SCORE_SCALE: how many orders of magnitude off halves your
// score (0.5 → about 3.3x off scores 50). SCORE_SHAPE: >1 flattens the top so
// near-misses barely cost anything.
const SCORE_SCALE = 0.5;
const SCORE_SHAPE = 1.5;

/** Within this factor of the target (5%) counts as a perfect 100. */
export const PERFECT_RATIO = 1.05;
const PERFECT_DECADES = Math.log10(PERFECT_RATIO);

/**
 * Player score 0–100 on a log scale. Anything within 5% of the target scores
 * 100; beyond that it plateaus near the top and tails off slowly for big
 * misses (2x → 70, 10x → 27, 100x → 11).
 */
export function score(population: number, target: number): number {
  if (target <= 0) return 0;
  if (population <= 0) return 0;
  const x = Math.max(0, Math.abs(Math.log10(population / target)) - PERFECT_DECADES);
  return 100 / (1 + (x / SCORE_SCALE) ** SCORE_SHAPE);
}

/** How many times off (≥1) you can be and still score at least `s` (inverse of score). */
export function ratioForScore(s: number): number {
  if (s >= 100) return PERFECT_RATIO;
  return 10 ** (PERFECT_DECADES + SCORE_SCALE * (100 / s - 1) ** (1 / SCORE_SHAPE));
}

/** The five score bands shown as circles and on the gauge, best first. */
export const SCORE_BANDS = [
  { min: 80, color: "#e4572e" },
  { min: 60, color: "#f08a5d" },
  { min: 40, color: "#f6c343" },
  { min: 20, color: "#fae29f" },
  { min: 0, color: "#ffffff" },
];

export function emojiBar(acc: number): string {
  const filled = Math.round(acc / 20);
  // score bands, best to worst: 80+ and 60+ orange, 40+ and 20+ yellow, below 20 white
  const colour = acc >= 60 ? "🟠" : acc >= 20 ? "🟡" : "⚪";
  return colour.repeat(filled) + "⚪".repeat(5 - filled);
}

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function shareText(
  p: Puzzle,
  r: { population: number; score: number; points: number; difficulty: string },
  url: string,
  title: (v: { n: number; radius: string; level: string }) => string,
  difficultyLabel: string,
  ptsUnit: string,
): string {
  const level = r.difficulty === "standard" ? "" : ` · ${difficultyLabel}`;
  return [
    title({ n: p.number, radius: fmt(p.radiusKm), level }),
    `🎯 ${fmt(p.target)} → ${fmt(r.population)}`,
    `${emojiBar(r.score)} ${r.points.toFixed(1)} ${ptsUnit}`,
    url,
  ].join("\n");
}

/** Milliseconds until the next local midnight. */
export function msUntilNextPuzzle(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
