/**
 * Stats from the rings saved on this device: days played, streaks, averages,
 * how the rings went, and the last 30 days. Pure functions (see storage.ts
 * for loading), so they're easy to test.
 */
import type { Difficulty } from "./difficulty";
import type { Result } from "./storage";

/** One day's saved rings (null = not played) and the map picked for it. */
export interface DayRecord {
  day: number;
  rings: (Result | null)[];
  map: Difficulty | null;
}

export type GradeBucket = "bullseye" | "good" | "meh" | "pass" | "miss";

export interface Stats {
  /** Days with all three rings played. */
  played: number;
  /** Finished days in a row up to today (today not finished yet doesn't break it). */
  currentStreak: number;
  bestStreak: number;
  /** Average day total over finished days. */
  average: number | null;
  best: { day: number; total: number } | null;
  byMap: Record<Difficulty, { played: number; average: number | null }>;
  /** Every ring played, by how it went. */
  grades: Record<GradeBucket, number>;
  /** The last `window` days, oldest first: the total if finished, else null. */
  recent: { day: number; total: number | null; map: Difficulty | null }[];
}

const isDone = (d: DayRecord) => d.rings.length === 3 && d.rings.every(Boolean);
const totalOf = (d: DayRecord) => d.rings.reduce((n, r) => n + (r?.points ?? 0), 0);
/** The day's map: the pick, else what its rings were played on (older days: mixed, so none). */
const mapOf = (d: DayRecord): Difficulty | null => {
  if (d.map) return d.map;
  const maps = new Set(d.rings.map((r) => r?.map));
  const [only] = maps;
  return maps.size === 1 && only ? only : null;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeStats(days: DayRecord[], today: number, window = 30): Stats {
  const done = days.filter(isDone).sort((a, b) => a.day - b.day);
  const doneSet = new Set(done.map((d) => d.day));

  // streaks: finished days in a row
  let currentStreak = 0;
  for (let d = doneSet.has(today) ? today : today - 1; doneSet.has(d); d--) currentStreak++;
  let bestStreak = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of done) {
    run = d.day === prev + 1 ? run + 1 : 1;
    prev = d.day;
    bestStreak = Math.max(bestStreak, run);
  }

  let best: Stats["best"] = null;
  for (const d of done) {
    const total = totalOf(d);
    if (!best || total > best.total) best = { day: d.day, total };
  }

  const byMap = {} as Stats["byMap"];
  for (const m of ["easy", "standard", "hard"] as const) {
    const totals = done.filter((d) => mapOf(d) === m).map(totalOf);
    byMap[m] = { played: totals.length, average: avg(totals) };
  }

  const grades: Stats["grades"] = { bullseye: 0, good: 0, meh: 0, pass: 0, miss: 0 };
  for (const d of days)
    for (const r of d.rings) {
      if (!r) continue;
      const g = r.grade === "bad" || r.grade === "fail" ? "miss" : r.grade;
      grades[g]++;
    }

  const byDay = new Map(days.map((d) => [d.day, d]));
  const recent: Stats["recent"] = [];
  for (let day = Math.max(1, today - window + 1); day <= today; day++) {
    const d = byDay.get(day);
    recent.push({ day, total: d && isDone(d) ? totalOf(d) : null, map: d ? mapOf(d) : null });
  }

  return { played: done.length, currentStreak, bestStreak, average: avg(done.map(totalOf)), best, byMap, grades, recent };
}
