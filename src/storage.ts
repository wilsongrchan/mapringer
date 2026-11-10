import type { Difficulty } from "./difficulty";

export interface Result {
  puzzle: number;
  lng: number;
  lat: number;
  population: number;
  accuracy: number; // plain closeness (min/max ratio)
  score: number; // player-facing log score (0–100)
  difficulty: Difficulty;
  points: number; // (score + side-quest bonus) × difficulty multiplier (older saves: score × multiplier + bonus)
  questDone?: boolean; // side quest condition met
  bonus?: number; // side-quest points actually earned
}

const key = (n: number) => `mapringer:result:${n}`;

export function loadResult(puzzle: number): Result | null {
  try {
    const raw = localStorage.getItem(key(puzzle));
    return raw ? (JSON.parse(raw) as Result) : null;
  } catch {
    return null;
  }
}

export function saveResult(r: Result): void {
  try {
    localStorage.setItem(key(r.puzzle), JSON.stringify(r));
  } catch {
    // storage unavailable (private mode etc.): the game still works this session
  }
}
