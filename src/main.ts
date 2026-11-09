import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 renders tiles in a separate module worker; let Vite bundle it and
// hand MapLibre the URL, otherwise dep pre-bundling breaks the worker path.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./style.css";
import { findClosestAnswer, MATCH_ACCURACY, type AnswerResult } from "./answer";
import { applyMapStyle, DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from "./difficulty";
import { circleRing, type LngLat } from "./geo";
import { coords, placeName } from "./places";
import { populationInRing, preloadPopulation, readBlock } from "./population";
import { accuracy, emojiBar, ratioForScore, SCORE_BANDS, fmt, msUntilNextPuzzle, puzzleFor, score, shareText, todaysPuzzle, type Puzzle } from "./puzzle";
import { loadResult, saveResult, type Result } from "./storage";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

maplibregl.setWorkerUrl(maplibreWorkerUrl);

// Test options: ?day=N plays puzzle #N; ?unlimited (on by default in dev,
// ?unlimited=0 to turn off) allows unlimited attempts, endless random
// puzzles, and saves nothing.
const params = new URLSearchParams(location.search);
const dayParam = Number(params.get("day"));
const UNLIMITED = params.has("unlimited") ? params.get("unlimited") !== "0" : import.meta.env.DEV;
let puzzle: Puzzle = dayParam > 0 ? puzzleFor(dayParam) : todaysPuzzle();
let practice = false; // true once we've moved on to random puzzles

const COLOR = { ring: "#e4572e", good: "#2a9d8f" };

preloadPopulation();

let locked: Result | null = UNLIMITED ? null : loadResult(puzzle.number);
let attempt = 0; // bumps on every reset so stale async work is ignored
// Always open on Hard, so nobody can study the labelled map and then switch to Hard.
let difficulty: Difficulty = locked?.difficulty ?? "hard";

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [10, 25],
  zoom: 1.6,
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map; // for debugging
applyMapStyle(map, difficulty);

function renderPuzzle() {
  $("puzzle-num").textContent = practice ? "· practice" : `#${puzzle.number}${UNLIMITED ? " · test" : ""}`;
  $("target").textContent = fmt(puzzle.target);
  $("radius").textContent = `a ${fmt(puzzle.radiusKm)} km ring`;
}
renderPuzzle();

if (UNLIMITED) {
  $("play-hint").textContent = "Test mode: unlimited attempts and puzzles, nothing is saved.";
  $("test-actions").hidden = false;
  $("next-info").hidden = true;
}

// ---- map layers ----
type Feature = { type: "Feature"; properties: object; geometry: { type: "Polygon"; coordinates: [number, number][][] } };
const EMPTY = { type: "FeatureCollection" as const, features: [] };

function circleFeature(center: LngLat, radiusKm: number): Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [circleRing(center, Math.max(radiusKm, 0.001))] },
  };
}

function setData(source: string, data: Feature | typeof EMPTY) {
  if (source === "answer") answerData = data;
  (map.getSource(source) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

function updateRing() {
  const center = locked ? { lng: locked.lng, lat: locked.lat } : map.getCenter();
  setData("ring", circleFeature(center, puzzle.radiusKm));
}

let answerData: Feature | typeof EMPTY = EMPTY;
type PointFC = { type: "FeatureCollection"; features: { type: "Feature"; properties: { kind: string }; geometry: { type: "Point"; coordinates: [number, number] } }[] };
let centerData: PointFC = { type: "FeatureCollection", features: [] };

/** Centre dots for the locked-in ring and the answer ring. */
function setCenters(points: { kind: "mine" | "answer"; at: LngLat }[]) {
  centerData = {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      properties: { kind: p.kind },
      geometry: { type: "Point", coordinates: [p.at.lng, p.at.lat] },
    })),
  };
  (map.getSource("centers") as maplibregl.GeoJSONSource | undefined)?.setData(centerData);
}

// Our ring layers live on top of whichever base style is active, so they are
// (re-)added every time the style loads (i.e. on difficulty changes).
map.on("style.load", () => {
  map.addSource("ring", { type: "geojson", data: circleFeature(map.getCenter(), puzzle.radiusKm) });
  map.addSource("answer", { type: "geojson", data: answerData });

  map.addLayer({ id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": COLOR.ring, "fill-opacity": 0.12 } });
  map.addLayer({ id: "answer-fill", type: "fill", source: "answer", paint: { "fill-color": COLOR.good, "fill-opacity": 0.15 } });
  map.addLayer({
    id: "answer-line",
    type: "line",
    source: "answer",
    paint: { "line-color": COLOR.good, "line-width": 3, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({ id: "ring-line", type: "line", source: "ring", paint: { "line-color": COLOR.ring, "line-width": 3 } });
  map.addSource("centers", { type: "geojson", data: centerData });
  map.addLayer({
    id: "centers",
    type: "circle",
    source: "centers",
    paint: {
      "circle-radius": 6,
      "circle-color": ["match", ["get", "kind"], "answer", COLOR.good, COLOR.ring],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
  updateRing();
});

map.once("load", () => {
  if (locked) showResult(locked, false);
});

map.on("move", () => {
  if (!locked) updateRing();
});

// ---- difficulty ----
// Outside test mode the choice locks once you start exploring, so you can't
// scout on Easy and then lock in on Hard.
let difficultyLocked = false;

function renderDifficulty() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#difficulty button")) {
    const d = btn.dataset.d as Difficulty;
    btn.setAttribute("aria-pressed", String(d === difficulty));
    // Within an attempt you can make the map easier (for fewer points) but never
    // harder again. Outside test mode the choice also locks once you move the map.
    const harder = DIFFICULTY_ORDER.indexOf(d) > DIFFICULTY_ORDER.indexOf(difficulty);
    btn.disabled = d !== difficulty && (difficultyLocked || harder);
  }
  const info = DIFFICULTIES[difficulty];
  $("difficulty-info").textContent = `${info.blurb} · ×${info.multiplier} points${difficultyLocked ? " · locked for today" : ""}`;
}

$("difficulty").addEventListener("click", (e) => {
  const d = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.d as Difficulty | undefined;
  if (!d || d === difficulty || difficultyLocked) return;
  if (DIFFICULTY_ORDER.indexOf(d) > DIFFICULTY_ORDER.indexOf(difficulty)) return; // no going back up
  difficulty = d;
  applyMapStyle(map, d);
  renderDifficulty();
});

map.on("movestart", (e) => {
  if (!UNLIMITED && !locked && !difficultyLocked && (e as { originalEvent?: Event }).originalEvent) {
    difficultyLocked = true;
    renderDifficulty();
  }
});
renderDifficulty();

// ---- locking in ----
const lockBtn = $<HTMLButtonElement>("lock-btn");

lockBtn.addEventListener("click", async () => {
  const c = map.getCenter().wrap();
  const center = { lng: c.lng, lat: c.lat };
  const myAttempt = attempt;
  lockBtn.disabled = true;
  lockBtn.textContent = "Counting people…";
  try {
    const population = await populationInRing(center, puzzle.radiusKm);
    if (myAttempt !== attempt) return;
    const result: Result = { puzzle: puzzle.number, ...center, population, accuracy: accuracy(population, puzzle.target), score: score(population, puzzle.target), difficulty, points: score(population, puzzle.target) * DIFFICULTIES[difficulty].multiplier };
    if (!UNLIMITED) saveResult(result);
    locked = result;
    showResult(result, true);
  } catch (e) {
    console.error(e);
    toast("Couldn't load population data. Check your connection and try again.");
    lockBtn.disabled = false;
    lockBtn.textContent = "Lock in ring";
  }
});

// ---- results ----
function verdict(r: Result): string {
  const a = r.score;
  if (r.accuracy >= MATCH_ACCURACY) return "Bullseye! 🎯";
  if (a >= 90) return "So close. Great ring.";
  if (a >= 75) return "Solid placement.";
  if (a >= 50) return `In the ballpark, but ${r.population > puzzle.target ? "too crowded" : "too empty"}.`;
  return r.population > puzzle.target ? "Way too many people!" : "Way too few people!";
}

function boundsOf(rings: { center: LngLat; radiusKm: number }[]) {
  const b = new maplibregl.LngLatBounds();
  for (const { center, radiusKm } of rings) for (const p of circleRing(center, radiusKm, 32)) b.extend(p);
  return b;
}

const padding = () => ({ top: 150, bottom: ($("result-panel").offsetHeight || 220) + 40, left: 30, right: 30 });

// Gauge: log scale from 100x too few (left) to 100x too many (right), target in
// the middle, coloured with the five score bands.
const GAUGE_DECADES = 2.1;

/** Paint the score bands onto the gauge track (symmetric around the target). */
function renderGaugeBands() {
  const stops: string[] = [];
  const pct = (decades: number) => 50 + (50 * decades) / GAUGE_DECADES;
  // edges of each band, in decades from the target
  const edges = SCORE_BANDS.slice(0, -1).map((b) => Math.min(GAUGE_DECADES, Math.log10(ratioForScore(b.min))));
  const bands = SCORE_BANDS.map((b, i) => ({ color: b.color, inner: i === 0 ? 0 : edges[i - 1], outer: edges[i] ?? GAUGE_DECADES }));
  for (const b of [...bands].reverse()) stops.push(`${b.color} ${pct(-b.outer)}%`, `${b.color} ${pct(-b.inner)}%`);
  for (const b of bands) stops.push(`${b.color} ${pct(b.inner)}%`, `${b.color} ${pct(b.outer)}%`);
  $("gauge-track").style.background = `linear-gradient(to right, ${stops.join(", ")})`;
  // label the band edges with how many times off they are
  const labels = $("gauge-labels");
  labels.innerHTML = "";
  const add = (decades: number, text: string) => {
    const span = document.createElement("span");
    span.style.left = `${pct(decades)}%`;
    span.textContent = text;
    labels.append(span);
  };
  add(0, "target");
  for (const e of edges.slice(1)) {
    const x = ratioForScore(SCORE_BANDS[edges.indexOf(e)].min);
    const t = x >= 10 ? fmt(x) : x.toFixed(0);
    add(-Math.log10(x), `÷${t}`);
    add(Math.log10(x), `×${t}`);
  }
}
renderGaugeBands();
const gaugePos = (ratio: number) =>
  ratio <= 0 ? 0 : 50 + 50 * Math.max(-1, Math.min(1, Math.log10(ratio) / GAUGE_DECADES));

function gaugeCaption(r: Result): string {
  if (r.population <= 0) return "Nobody lives there!";
  if (r.accuracy >= MATCH_ACCURACY) return "Right on target";
  const ratio = r.population / puzzle.target;
  const over = ratio > 1;
  const factor = over ? ratio : 1 / ratio;
  const amount = factor < 2 ? `${Math.round((factor - 1) * 100)}%` : `${factor < 10 ? factor.toFixed(1) : fmt(factor)}×`;
  return `${amount} too ${over ? "many" : "few"} people`;
}

function renderGauge(r: Result, animate: boolean) {
  const marker = $("gauge-marker");
  const ratio = r.population / puzzle.target;
  const pos = gaugePos(ratio);
  const offScale = r.population <= 0 || Math.abs(Math.log10(ratio)) > GAUGE_DECADES;
  marker.classList.toggle("good", r.accuracy >= MATCH_ACCURACY);
  marker.classList.toggle("off-left", offScale && ratio < 1);
  marker.classList.toggle("off-right", offScale && ratio > 1);
  $("gauge-caption").textContent = gaugeCaption(r);
  const gauge = $("gauge");
  gauge.classList.remove("animate");
  gauge.style.setProperty("--pos", "50%");
  gauge.style.setProperty("--fill", "0");
  void gauge.offsetWidth; // restart the transition
  if (animate) gauge.classList.add("animate");
  gauge.style.setProperty("--pos", `${pos}%`);
  gauge.style.setProperty("--fill", "1");
}

function showResult(r: Result, animate: boolean) {
  const myAttempt = attempt;
  const center = { lng: r.lng, lat: r.lat };
  $("play-panel").hidden = true;
  $("result-panel").hidden = false;
  $("crosshair").classList.add("hidden");
  $("result-target").textContent = fmt(puzzle.target);
  r.score ??= score(r.population, puzzle.target); // results saved before scoring changed
  r.difficulty ??= "standard";
  r.points ??= r.score * DIFFICULTIES[r.difficulty].multiplier;
  const mult = DIFFICULTIES[r.difficulty].multiplier;
  $("result-bar").textContent = emojiBar(r.score);
  $("result-acc").textContent = `${r.score.toFixed(1)}`;
  $("result-points").innerHTML =
    mult === 1 ? "" : `×${mult} = <strong>${r.points.toFixed(1)}</strong> pts`;
  $("result-verdict").textContent = verdict(r);
  updateRing();
  setCenters([{ kind: "mine", at: center }]);
  showPlace($("result-place"), center, myAttempt);
  renderGauge(r, animate);
  countUp($("result-pop"), r.population, animate ? 1000 : 0);
  startCountdown();

  map.fitBounds(boundsOf([{ center, radiusKm: puzzle.radiusKm * 1.3 }]), {
    padding: padding(),
    duration: animate ? 800 : 0,
    maxZoom: 13,
  });

  if (r.accuracy >= MATCH_ACCURACY) {
    setAnswerLine("found");
    return;
  }
  setAnswerLine("searching");
  findClosestAnswer(center, puzzle.radiusKm, puzzle.target, readBlock)
    .then((res) => myAttempt === attempt && showAnswer(r, res, animate))
    .catch((e) => {
      console.error(e);
      if (myAttempt === attempt) setAnswerLine("error");
    });
}

function countUp(el: HTMLElement, value: number, ms: number) {
  if (ms <= 0) {
    el.textContent = fmt(value);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = fmt(value * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setAnswerLine(state: "searching" | "found" | "error" | "hide", html = "") {
  const el = $("answer-line");
  el.hidden = state === "hide";
  el.classList.toggle("searching", state === "searching");
  if (state === "searching") el.textContent = "Finding the closest correct ring…";
  else if (state === "found") el.innerHTML = html || "You found a correct ring yourself!";
  else if (state === "error") el.textContent = "Couldn't search for the closest correct ring.";
}

/** Fill `el` with "📍 Town, Country" for a point (coordinates until the name arrives). */
function showPlace(el: HTMLElement, at: LngLat, myAttempt: number, prefix = "📍 ") {
  el.textContent = `${prefix}${coords(at)}`;
  el.title = coords(at);
  placeName(at)
    .then((name) => {
      if (myAttempt === attempt && el.isConnected) el.textContent = `${prefix}${name}`;
    })
    .catch(() => {}); // keep showing coordinates
}

function showAnswer(r: Result, res: AnswerResult, animate: boolean) {
  const a = res.answer ?? res.best;
  if (!a) {
    setAnswerLine("found", `No ring within ${fmt(res.searchedKm)} km comes close to this target.`);
    return;
  }
  const where = `${fmt(a.distanceKm)} km away`;
  setAnswerLine(
    "found",
    res.answer
      ? `Closest correct ring: <strong>${fmt(a.population)}</strong> people, ${where}.<span class="place" id="answer-place"></span>`
      : `No ring within ${fmt(res.searchedKm)} km hits the target. Best nearby: <strong>${fmt(a.population)}</strong> (${a.accuracy.toFixed(1)}%), ${where}.<span class="place" id="answer-place"></span>`,
  );
  showPlace($("answer-place"), a.center, attempt, "Centred near ");
  setData("answer", circleFeature(a.center, puzzle.radiusKm));
  setCenters([
    { kind: "mine", at: { lng: r.lng, lat: r.lat } },
    { kind: "answer", at: a.center },
  ]);
  const rings = [
    { center: { lng: r.lng, lat: r.lat }, radiusKm: puzzle.radiusKm },
    { center: a.center, radiusKm: puzzle.radiusKm },
  ];
  map.fitBounds(boundsOf(rings), { padding: padding(), duration: animate ? 1200 : 0, maxZoom: 13 });
}

let countdownTimer: number | undefined;
function startCountdown() {
  if (UNLIMITED) return;
  const el = $("countdown");
  const tick = () => {
    const ms = msUntilNextPuzzle();
    if (ms < 1000) {
      location.reload();
      return;
    }
    const s = Math.floor(ms / 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    el.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  tick();
  clearInterval(countdownTimer);
  countdownTimer = window.setInterval(tick, 1000);
}

// ---- test mode: retry / new puzzle ----
function resetPlay() {
  attempt++;
  locked = null;
  $("result-panel").hidden = true;
  $("play-panel").hidden = false;
  $("crosshair").classList.remove("hidden");
  lockBtn.disabled = false;
  lockBtn.textContent = "Lock in ring";
  setData("answer", EMPTY);
  setAnswerLine("hide");
  setCenters([]);
  // every new attempt starts back on Hard
  difficultyLocked = false;
  if (difficulty !== "hard") {
    difficulty = "hard";
    applyMapStyle(map, difficulty);
  }
  renderDifficulty();
  updateRing();
}

$("again-btn").addEventListener("click", resetPlay);
$("new-btn").addEventListener("click", () => {
  practice = true;
  puzzle = puzzleFor(1000 + Math.floor(Math.random() * 1e9));
  renderPuzzle();
  resetPlay();
});

// ---- sharing ----
$("share-btn").addEventListener("click", async () => {
  if (!locked) return;
  const text = shareText(puzzle, locked, location.origin + location.pathname);
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast("Result copied to clipboard");
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast("Couldn't share. Try again.");
  }
});

// ---- help ----
const helpDialog = $<HTMLDialogElement>("help-dialog");
$("help-btn").addEventListener("click", () => helpDialog.showModal());
$("help-close").addEventListener("click", () => helpDialog.close());
try {
  if (!localStorage.getItem("mapringer:seen-help")) {
    helpDialog.showModal();
    localStorage.setItem("mapringer:seen-help", "1");
  }
} catch {
  /* storage unavailable */
}

let toastTimer: number | undefined;
function toast(msg: string) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2500);
}
