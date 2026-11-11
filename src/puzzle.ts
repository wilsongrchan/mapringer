/** Day #1 of MapRinger. Puzzles roll over at the player's local midnight. */
export const LAUNCH_DATE = { year: 2026, month: 11, day: 9 };

export interface Puzzle {
  /** The day (1 = launch day); each day has three rings. */
  number: number;
  /** Which of the day's rings: 0 easy, 1 medium, 2 hard. */
  stage: Stage;
  radiusKm: number;
  target: number;
  /** Set on occasional "twist" puzzles that flip the usual size/crowd pairing. */
  twist?: Twist;
}

/**
 * Each day is three rings, easy to hard. Each has its own map and is worth
 * more points; rings 2 and 3 come with a side quest (see quests.ts).
 */
export type Stage = 0 | 1 | 2;
export type Twist = "empty-giant" | "packed-tiny" | "void" | "mega-crowd";
export const STAGES = [
  { map: "easy", max: 80 },
  { map: "standard", max: 100 },
  { map: "hard", max: 150 },
] as const;
export const DAY_MAX = STAGES.reduce((n, s) => n + s.max, 0); // 330

/**
 * Densest real rings in the GHSL data (Surat for 3 km, Dhaka for 5 km).
 * Packed-tiny targets are 25–60% of these so they stay reachable.
 */
const TINY_RING_MAX: Record<number, number> = { 3: 3_980_000, 5: 6_930_000 };

const logUniform = (rand: () => number, lo: number, hi: number) =>
  Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)));

/**
 * The fullest rings in the GHSL data (all around northern India and the Ganges
 * plain; measured on a 0.5° grid). Mega-crowd targets are 35–85% of these.
 */
const MEGA_RING_MAX: Record<number, number> = { 750: 894_000_000, 1000: 1_305_000_000, 1500: 1_875_000_000, 2000: 2_216_000_000 };
/**
 * Void rings: thousands of km wide, a few hundred to 20,000 people, so only
 * remote ocean islands fit (Pitcairn, Tristan da Cunha, the Falklands…). The
 * target ranges are ones the data can hit with islands alone (checked on a 2°
 * grid of ring centres); 3,000 km rings need a bigger crowd.
 */
const VOID_TARGETS: Record<number, [number, number]> = { 2000: [300, 20_000], 2500: [300, 20_000], 3000: [8_000, 20_000] };

function twistPuzzle(number: number, rand: () => number): Puzzle {
  const kind = rand();
  if (kind < 0.25) {
    // A vast ring with almost nobody in it: out in the emptiest oceans.
    const radiusKm = pick(rand, [2000, 2500, 3000]);
    const [lo, hi] = VOID_TARGETS[radiusKm];
    return { number, stage: 2, radiusKm, target: niceRound(logUniform(rand, lo, hi)), twist: "void" };
  }
  if (kind < 0.5) {
    // A colossal crowd: hundreds of millions of people in one ring.
    const radiusKm = pick(rand, [750, 1000, 1500, 2000]);
    return { number, stage: 2, radiusKm, target: niceRound(MEGA_RING_MAX[radiusKm] * (0.35 + rand() * 0.5)), twist: "mega-crowd" };
  }
  if (kind < 0.75) {
    // A huge ring with hardly anyone in it: remote islands, deserts, the far north.
    const radiusKm = [500, 750, 1000][Math.floor(rand() * 3)];
    return { number, stage: 2, radiusKm, target: niceRound(logUniform(rand, 500, 20_000)), twist: "empty-giant" };
  }
  // A tiny ring packed with people: the densest city centres on Earth.
  const radiusKm = rand() < 0.5 ? 3 : 5;
  const target = niceRound(TINY_RING_MAX[radiusKm] * (0.25 + rand() * 0.35));
  return { number, stage: 2, radiusKm, target, twist: "packed-tiny" };
}

const RADII_KM = [3, 5, 8, 10, 15, 20, 25, 30, 40, 50];
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

/** A ring of the given radius whose average density is drawn log-uniformly in [lo, hi] people/km². */
function ringOf(number: number, stage: Stage, radiusKm: number, rand: () => number, lo = MIN_DENSITY, hi = maxDensity(radiusKm)): Puzzle {
  const density = logUniform(rand, lo, Math.min(hi, maxDensity(radiusKm)));
  return { number, stage, radiusKm, target: niceRound(Math.PI * radiusKm ** 2 * density) };
}

/**
 * The three rings get only a little harder (the map and the side quest do most
 * of the work): ring 1 is an everyday city-scale ring with a typical crowd,
 * ring 2 a slightly wider mix, ring 3 the full range with the occasional big
 * ring or twist.
 */
const EASY_RADII_KM = [10, 15, 20, 25, 30];
const MEDIUM_RADII_KM = [5, 8, 10, 15, 20, 25, 30, 40, 50];
const HARD_BIG_RADII_KM = [100, 200, 300];
const HARD_TWIST_CHANCE = 0.2; // split evenly between the four twists
const HARD_BIG_CHANCE = 0.15;
const pick = <T>(rand: () => number, xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

/** One of the day's three rings. Each ring has its own seed, so they're independent. */
export function ringFor(number: number, stage: Stage): Puzzle {
  const rand = mulberry32(number * 2654435761 + stage * 40503);
  rand(); // discard first value: it correlates with nearby seeds
  if (stage === 0) return ringOf(number, 0, pick(rand, EASY_RADII_KM), rand, 100, 3000);
  if (stage === 1) return ringOf(number, 1, pick(rand, MEDIUM_RADII_KM), rand, 40, 4000);
  const roll = rand();
  if (roll < HARD_TWIST_CHANCE) return twistPuzzle(number, rand);
  if (roll < HARD_TWIST_CHANCE + HARD_BIG_CHANCE) return ringOf(number, 2, pick(rand, HARD_BIG_RADII_KM), rand, 20);
  return ringOf(number, 2, pick(rand, RADII_KM), rand);
}

/** The day's three rings, easy to hard. */
export function dayRings(number: number): [Puzzle, Puzzle, Puzzle] {
  return [ringFor(number, 0), ringFor(number, 1), ringFor(number, 2)];
}

export function todaysNumber(date: Date = new Date()): number {
  return puzzleNumber(date);
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

/**
 * Every ring lands in one of four levels (its emoji), from its 0–100 closeness
 * score. The levels are just labels: points scale smoothly with the score.
 */
export type Level = "bullseye" | "good" | "meh" | "bad";
// The level cut-offs, as "how many times off the target": 🎯 within 15%,
// 🟠 up to double or half, 🟡 up to ~4.75× (a score of 40). Tweak here.
const BULLSEYE_WITHIN = 1.15;
const GOOD_WITHIN = 2;
const minScore = (timesOff: number) => score(timesOff, 1) - 1e-9; // (exactly on the line counts)
export const LEVELS: { level: Level; min: number; emoji: string; color: string }[] = [
  { level: "bullseye", min: minScore(BULLSEYE_WITHIN), emoji: "🎯", color: "#e4572e" },
  { level: "good", min: minScore(GOOD_WITHIN), emoji: "🟠", color: "#f08a5d" },
  { level: "meh", min: 40, emoji: "🟡", color: "#f6c343" },
  { level: "bad", min: 0, emoji: "⚪", color: "#ffffff" },
];
/** Score bands for the gauge, best first (one per level). */
export const SCORE_BANDS = LEVELS.map(({ min, color }) => ({ min, color }));

/**
 * Side quest not done: the ring turns pass / fail. Scoring at least this is a
 * pass (🌙), worth this share of the ring's max; otherwise it's a fail (⚪, 0).
 */
export const PASS_SCORE = 60;
export const PASS_SHARE = 0.5;
export const PASS_EMOJI = "🌙";

export function levelOf(score: number): (typeof LEVELS)[number] {
  return LEVELS.find((l) => score >= l.min) ?? LEVELS[LEVELS.length - 1];
}

/**
 * What a ring earns: its grade (a level, or pass / fail without the quest),
 * emoji and points. Points run smoothly from 0 to the ring's max with the
 * closeness score (whole numbers); a skipped quest is a flat pass / fail.
 */
export function gradeRing(stage: Stage, score: number, hasQuest: boolean, questDone: boolean) {
  const max = STAGES[stage].max;
  if (hasQuest && !questDone) {
    const pass = score >= PASS_SCORE;
    return { grade: pass ? ("pass" as const) : ("fail" as const), emoji: pass ? PASS_EMOJI : "⚪", points: pass ? max * PASS_SHARE : 0, max };
  }
  const l = levelOf(score);
  return { grade: l.level, emoji: l.emoji, points: Math.round((max * score) / 100), max };
}
export type Grade = ReturnType<typeof gradeRing>["grade"];

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The day's share text: "MapRinger #3 · 🎯🌙🟠 263/330" and the link. */
export function shareText(day: number, rings: { emoji: string; points: number }[], url: string, title: (n: number) => string, unit: string): string {
  const total = rings.reduce((n, r) => n + r.points, 0);
  return [title(day), `${rings.map((r) => r.emoji).join("")} ${fmtPoints(total)}/${DAY_MAX} ${unit}`.trim(), url].join("\n");
}

/** Points are whole numbers except for odd halves (e.g. 37.5). */
export const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Milliseconds until the next local midnight. */
export function msUntilNextPuzzle(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
