import { destination, haversineKm, KM_PER_DEG, sumCircleBlock, type Block, type LngLat } from "./geo";
import { accuracy, PERFECT_RATIO } from "./puzzle";

export interface Answer {
  center: LngLat;
  population: number;
  accuracy: number;
  distanceKm: number;
}

export interface AnswerResult {
  /** Closest ring within ~2% of the target, if one exists in the search area. */
  answer: Answer | null;
  /** When there's no match: the ring that came closest to the target (that passes `accept`, if given). */
  best: Answer | null;
  searchedKm: number;
}

/** An answer counts as "correct" when within 5% of the target (a perfect score). */
export const MATCH_ACCURACY = 100 / PERFECT_RATIO;
const SEARCH_STEPS_KM = [150, 400, 800];
/** Big rings search proportionally further (capped so the block stays manageable). */
const searchSteps = (radiusKm: number) =>
  SEARCH_STEPS_KM.map((s) => Math.min(5000, s * Math.max(1, radiusKm / 100)));
const MAX_CANDIDATES = 300_000; // approximate evaluations per block
const MAX_EXACT = 150; // exact evaluations per block
const MAX_CHECKED = 12; // matches per block offered to an `accept` check

/**
 * Find the ring closest to `player` whose population is within ~2% of `target`.
 * Searches progressively wider areas around the player's ring.
 */
export async function findClosestAnswer(
  player: LngLat,
  radiusKm: number,
  target: number,
  readBlock: (center: LngLat, radiusKm: number, ringKm: number) => Promise<Block>,
  /** Only accept rings that also pass this check (e.g. the quest); tried on a few matches per area. */
  accept?: (center: LngLat) => Promise<boolean>,
  /** Search only the first this-many (widening) areas. */
  maxSteps = 3,
): Promise<AnswerResult> {
  let searchedKm = 0;
  let best: Answer | null = null;
  for (const searchKm of searchSteps(radiusKm).slice(0, maxSteps)) {
    const block = await readBlock(player, searchKm + radiusKm, radiusKm);
    searchedKm = searchKm;
    const found = searchBlock(block, player, radiusKm, target, searchKm, accept ? MAX_CHECKED : 1);
    if (accept) {
      for (const m of found.matches) if (await accept(m.center)) return { answer: m, best: null, searchedKm };
      // no match does it: remember the closest ring that does, as a fallback
      for (const m of [...found.near, found.best]) {
        if (m && (!best || m.accuracy > best.accuracy) && (await accept(m.center))) best = m;
      }
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    if (found.match) return { answer: found.match, best: null, searchedKm };
    if (found.best && (!best || found.best.accuracy > best.accuracy)) best = found.best;
    await new Promise((r) => setTimeout(r, 0)); // let the UI breathe between steps
  }
  return { answer: null, best, searchedKm };
}

/**
 * Screen every candidate centre in the block with a fast approximate count
 * (whole cells, via per-row prefix sums), then check the nearest promising
 * ones exactly and fine-tune the first good one.
 */
export function searchBlock(
  block: Block,
  player: LngLat,
  radiusKm: number,
  target: number,
  searchKm: number,
  /** Collect up to this many separate matches (nearest first) instead of stopping at the first. */
  maxMatches = 1,
): { match: Answer | null; best: Answer | null; matches: Answer[]; near: Answer[] } {
  const { grid, rows, cols, values } = block;
  if (!rows || !cols) return { match: null, best: null, matches: [], near: [] };
  const res = grid.res;
  const dyKm = res * KM_PER_DEG;

  // prefix[r * (cols + 1) + c] = sum of values[r, 0..c-1]
  const prefix = new Float64Array(rows * (cols + 1));
  for (let r = 0; r < rows; r++) {
    let s = 0;
    const base = r * (cols + 1);
    for (let c = 0; c < cols; c++) {
      s += values[r * cols + c];
      prefix[base + c + 1] = s;
    }
  }
  const rowLat = (r: number) => grid.originLat - (block.row0 + r + 0.5) * res;
  const dxKm = new Float64Array(rows);
  for (let r = 0; r < rows; r++) dxKm[r] = Math.max(1e-6, dyKm * Math.cos((rowLat(r) * Math.PI) / 180));

  const k = Math.floor(radiusKm / dyKm);
  const step = Math.max(1, Math.ceil(Math.sqrt((rows * cols) / MAX_CANDIDATES)));
  const candidates: { d: number; lat: number; lng: number }[] = [];
  let bestApprox = { acc: -1, lat: 0, lng: 0 };

  for (let i = 0; i < rows; i += step) {
    const lat = rowLat(i);
    for (let j = 0; j < cols; j += step) {
      const lng = grid.originLng + (block.col0 + j + 0.5) * res;
      const d = haversineKm(player, { lat, lng });
      if (d > searchKm) continue;
      let sum = 0;
      for (let dr = -k; dr <= k; dr++) {
        const r = i + dr;
        if (r < 0 || r >= rows) continue;
        const yKm = dr * dyKm;
        const h = Math.floor(Math.sqrt(Math.max(0, radiusKm * radiusKm - yKm * yKm)) / dxKm[r]);
        const a = Math.max(0, j - h);
        const b = Math.min(cols - 1, j + h);
        const base = r * (cols + 1);
        sum += prefix[base + b + 1] - prefix[base + a];
      }
      const acc = accuracy(sum, target);
      if (acc >= 85) candidates.push({ d, lat, lng });
      if (acc > bestApprox.acc) bestApprox = { acc, lat, lng };
    }
  }
  candidates.sort((a, b) => a.d - b.d);

  let exactChecks = 0;
  const matches: Answer[] = [];
  const near: Answer[] = []; // good but not within 5%: fallbacks when a check rules out every match
  for (const cand of candidates) {
    if (exactChecks++ >= MAX_EXACT) break;
    const start = { lat: cand.lat, lng: cand.lng };
    // spread the matches out: skip candidates right next to one already found
    if (matches.some((m) => haversineKm(m.center, start) < radiusKm)) continue;
    const pop = sumCircleBlock(block, start, radiusKm);
    if (accuracy(pop, target) < 90) continue;
    const best = refine(block, start, pop, radiusKm, target);
    const a = { ...best, distanceKm: haversineKm(player, best.center) };
    if (best.accuracy >= MATCH_ACCURACY) {
      matches.push(a);
      if (matches.length >= maxMatches) break;
    } else if (maxMatches > 1 && near.length < maxMatches) near.push(a);
  }
  if (matches.length && maxMatches === 1) return { match: matches[0], best: null, matches, near };

  // No match (or a check may rule them all out): the ring that got closest to the target.
  if (bestApprox.acc <= 0) return { match: matches[0] ?? null, best: null, matches, near };
  const start = { lat: bestApprox.lat, lng: bestApprox.lng };
  const b = refine(block, start, sumCircleBlock(block, start, radiusKm), radiusKm, target);
  return { match: matches[0] ?? null, best: { ...b, distanceKm: haversineKm(player, b.center) }, matches, near };
}

/** Hill-climb the ring centre to get as close to the target as possible. */
function refine(block: Block, start: LngLat, startPop: number, radiusKm: number, target: number) {
  let center = start;
  let population = startPop;
  let acc = accuracy(population, target);
  const cellKm = block.grid.res * KM_PER_DEG;
  let stepKm = Math.max(1, cellKm);
  for (let iter = 0; iter < 40 && stepKm > cellKm / 20 && acc < 99.9; iter++) {
    let moved = false;
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const c = destination(center, stepKm, bearing);
      const p = sumCircleBlock(block, c, radiusKm);
      const a = accuracy(p, target);
      if (a > acc) {
        center = c;
        population = p;
        acc = a;
        moved = true;
      }
    }
    if (!moved) stepKm /= 2;
  }
  if (center.lng > 180) center = { ...center, lng: center.lng - 360 };
  if (center.lng < -180) center = { ...center, lng: center.lng + 360 };
  return { center, population, accuracy: acc };
}
