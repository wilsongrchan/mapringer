import type { Grade, Stage } from "./puzzle";

/** One locked-in ring of a day (each day has three). */
export interface Result {
  puzzle: number; // the day
  stage: Stage; // which of the day's rings
  lng: number;
  lat: number;
  population: number;
  accuracy: number; // plain closeness (min/max ratio)
  score: number; // closeness score (0–100), which picks the level
  questDone?: boolean; // side quest condition met (rings 2 and 3)
  grade: Grade; // bullseye / good / meh / bad, or pass / fail without the quest
  emoji: string;
  points: number;
  seaShare?: number; // fraction of the ring that is sea (for the verdict)
}

// (a new key: results saved by the old one-ring-a-day game are simply ignored)
const key = (day: number, stage: Stage) => `mapringer:ring:${day}:${stage}`;

export function loadResult(day: number, stage: Stage): Result | null {
  try {
    const raw = localStorage.getItem(key(day, stage));
    return raw ? (JSON.parse(raw) as Result) : null;
  } catch {
    return null;
  }
}

export function saveResult(r: Result): void {
  try {
    localStorage.setItem(key(r.puzzle, r.stage), JSON.stringify(r));
  } catch {
    // storage unavailable (private mode etc.): the game still works this session
  }
}
