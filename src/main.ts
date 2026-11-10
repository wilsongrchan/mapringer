import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 renders tiles in a separate module worker; let Vite bundle it and
// hand MapLibre the URL, otherwise dep pre-bundling breaks the worker path.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./style.css";
import { applyStaticText, LANG, people, switchLanguage, t } from "./i18n";
import { findClosestAnswer, MATCH_ACCURACY, type AnswerResult } from "./answer";
import {
  applyMapStyle,
  applyRevealStyle,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  GLOBE,
  loadPuzzleDifficulty,
  prefetchStyles,
  savePuzzleDifficulty,
  type Difficulty,
  type GameLayers,
} from "./difficulty";
import { circleRing, type LngLat } from "./geo";
import { coords, placeName } from "./places";
import { BONUS_MIN_SCORE, COUNTRIES, countryAt, questBonus, questDone, questFor, surveyRing, TROPIC_LAT, type Quest } from "./quests";
import { populationInRing, preloadPopulation, readBlock, readCountryBlock, readLandBlock } from "./population";
import { accuracy, emojiBar, ratioForScore, SCORE_BANDS, fmt, msUntilNextPuzzle, puzzleFor, score, shareText, todaysPuzzle, type Puzzle } from "./puzzle";
import { loadResult, saveResult, type Result } from "./storage";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

maplibregl.setWorkerUrl(maplibreWorkerUrl);
applyStaticText();

// Test options: ?day=N plays puzzle #N; ?unlimited (on by default in dev,
// ?unlimited=0 to turn off) allows unlimited attempts, endless random
// puzzles, and saves nothing.
const params = new URLSearchParams(location.search);
const dayParam = Number(params.get("day"));
const UNLIMITED = params.has("unlimited") ? params.get("unlimited") !== "0" : import.meta.env.DEV;
let puzzle: Puzzle = dayParam > 0 ? puzzleFor(dayParam) : todaysPuzzle();
let practice = false; // true once we've moved on to random puzzles

const COLOR = { ring: "#e4572e", good: "#2a9d8f" };
/** Side-quest hint colours, one per continent (so where two meet is easy to see). */
const CONTINENT_COLOR = [
  "match",
  ["get", "continent"],
  "africa", "#d98e04",
  "asia", "#c8414b",
  "europe", "#3d7cc9",
  "northAmerica", "#8a5cc2",
  "southAmerica", "#2f9e44",
  "oceania", "#0f9e99",
  "country", "#e07a00",
  "#888888",
] as unknown as maplibregl.ExpressionSpecification;

preloadPopulation();

let locked: Result | null = UNLIMITED ? null : loadResult(puzzle.number);
let attempt = 0; // bumps on every reset so stale async work is ignored
// Always open on Hard, so nobody can study the labelled map and then switch to Hard.
// (or the easier map already chosen for today's puzzle, so a reload can't reset it)
let difficulty: Difficulty = locked?.difficulty ?? (UNLIMITED ? null : loadPuzzleDifficulty(puzzle.number)) ?? "hard";

/**
 * Start zoomed out far enough to see the whole globe between the panels. On a
 * globe, zoom z draws Earth about 512·2^z/π px across.
 */
function wholeGlobeZoom(): number {
  // (never below 160 px: on very short screens, e.g. a phone in landscape, the
  // panels would otherwise leave no room at all and the zoom would be invalid)
  const room = Math.max(160, Math.min(innerWidth, innerHeight - 260)) * 0.92;
  return Math.max(0.6, Math.min(2.2, Math.log2((room * Math.PI) / 512)));
}

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [], projection: GLOBE },
  center: [10, 25],
  zoom: wholeGlobeZoom(),
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
  // play map motion (the globe's spin glide, short camera moves) even with
  // Reduce Motion on: it's how the game is played, and iPhones often have it on
  reduceMotion: false,
});
// a longer, softer glide after a flick, so spinning the globe feels smooth
map.dragPan.enable({ linearity: 0.22, deceleration: 1300, maxSpeed: 2400, easing: (t) => 1 - (1 - t) ** 3 });
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map; // for debugging
prefetchStyles();
// (the first style is a full load; gameLayers is defined below)
queueMicrotask(() => applyMapStyle(map, difficulty, LANG, gameLayers, false));

/** "an 8 km ring", "an 80 km ring", "an 11 km ring", otherwise "a …". */
const article = (n: number) => (String(n).startsWith("8") || n === 11 || n === 18 ? "an" : "a");

/** Shrink an element's font until its text fits on one line (down to `minPx`). */
function fitOneLine(el: HTMLElement, maxPx: number, minPx = 11) {
  el.style.fontSize = `${maxPx}px`;
  for (let px = maxPx; px > minPx && el.scrollWidth > el.clientWidth; px -= 0.5) el.style.fontSize = `${px - 0.5}px`;
}

// the question line: 19px on wide screens, 16px on phones (shrinks further to fit)
const fitChallenge = () => fitOneLine($("challenge-line"), matchMedia("(min-width: 800px)").matches ? 19 : 16);

let quest: Quest = questFor(puzzle);

const QUEST_TEXT = {
  equator: "questEquator",
  landlocked: "questLandlocked",
  islandsOnly: "questIslands",
  twoContinents: "questTwoContinents",
  west: "questWest",
  east: "questEast",
  northOfCancer: "questNorthOfCancer",
  southOfCapricorn: "questSouthOfCapricorn",
  tropics: "questTropics",
} as const;

const countryName = (id: string) => {
  const c = COUNTRIES.find((c) => c.id === id);
  return c ? c[LANG] : id;
};

function questText(q: Quest): string {
  if (q.kind === "continent") return t("questContinent", { continent: t(q.continent) });
  if (q.kind === "country") return t("questCountry", { country: countryName(q.country) });
  return t(QUEST_TEXT[q.kind]);
}

/**
 * Side-quest hints on the map: the equator, the target continent, every
 * continent (to see where they meet), or the islands. Shown on Easy and
 * Standard; Hard gets no hints until the ring is locked in.
 */
const showHints = () => difficulty !== "hard" || !!locked;

/** A labelled line all the way round the globe: a parallel (lat) or a meridian (lng). */
function parallel(lat: number, name: string) {
  return { type: "Feature" as const, properties: { name }, geometry: { type: "LineString" as const, coordinates: [[-180, lat], [0, lat], [180, lat]] } };
}
function meridian(lng: number, name: string) {
  const coordinates: number[][] = [];
  for (let lat = -85; lat <= 85; lat += 5) coordinates.push([lng, lat]);
  return { type: "Feature" as const, properties: { name }, geometry: { type: "LineString" as const, coordinates } };
}

/** Map lines that go with the day's quest (equator, tropics, meridians). */
function questLines() {
  const lines = !showHints()
    ? []
    : quest.kind === "equator"
      ? [parallel(0, t("equator"))]
      : quest.kind === "northOfCancer"
        ? [parallel(TROPIC_LAT, t("tropicCancer"))]
        : quest.kind === "southOfCapricorn"
          ? [parallel(-TROPIC_LAT, t("tropicCapricorn"))]
          : quest.kind === "tropics"
            ? [parallel(TROPIC_LAT, t("tropicCancer")), parallel(-TROPIC_LAT, t("tropicCapricorn"))]
            : quest.kind === "west" || quest.kind === "east"
              ? [meridian(0, t("primeMeridian")), meridian(180, t("antimeridian"))]
              : [];
  return { type: "FeatureCollection" as const, features: lines };
}

type AreaFC = { type: "FeatureCollection"; features: { type: "Feature"; properties: { continent: string; island: boolean }; geometry: object }[] };
const NO_AREAS: AreaFC = { type: "FeatureCollection", features: [] };
let areasData: AreaFC = NO_AREAS;
let continentsGeo: Promise<AreaFC> | null = null; // built from the land mask by scripts/build_hints.py

/** Which continent / island shapes the current quest's hint shows. */
function questAreaFilter(): ((f: AreaFC["features"][number]) => boolean) | null {
  if (!showHints()) return null;
  if (quest.kind === "continent") {
    const c: string = quest.continent;
    return (f) => f.properties.continent === c;
  }
  if (quest.kind === "twoContinents" || quest.kind === "country") return () => true;
  if (quest.kind === "islandsOnly") return (f) => f.properties.island;
  return null;
}

/** Redraw the quest hints for the current quest, difficulty and lock state. */
function refreshHints() {
  (map.getSource("quest-lines") as maplibregl.GeoJSONSource | undefined)?.setData(questLines());
  const keep = questAreaFilter();
  const myQuest = quest;
  const apply = (fc: AreaFC) => {
    areasData = fc;
    (map.getSource("quest-areas") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  };
  if (!keep) return apply(NO_AREAS);
  if (quest.kind === "country") {
    fetch(`${import.meta.env.BASE_URL}hints/countries/${quest.country}.geojson`)
      .then((r) => r.json() as Promise<AreaFC>)
      .then((fc) => {
        if (quest === myQuest && questAreaFilter()) apply(fc);
      })
      .catch(() => {}); // a hint is optional
    return;
  }
  continentsGeo ??= fetch(`${import.meta.env.BASE_URL}hints/continents.geojson`).then((r) => r.json() as Promise<AreaFC>);
  continentsGeo
    .then((all) => {
      // still the same quest and still allowed to hint?
      if (quest === myQuest && questAreaFilter()) apply({ type: "FeatureCollection", features: all.features.filter(keep) });
    })
    .catch(() => {
      continentsGeo = null; // a hint is optional; try again next time
    });
}

function renderQuest() {
  refreshHints();
  $("quest-bonus").textContent = `+${quest.bonus}`;
  $("quest-text").textContent = `${questText(quest)} ${t("questRule", { min: BONUS_MIN_SCORE })}`;
}

function renderPuzzle() {
  $("puzzle-num").textContent = practice ? t("practiceTag") : `#${puzzle.number}${UNLIMITED ? t("testTag") : ""}`;
  $("challenge-label").textContent =
    puzzle.twist === "empty-giant"
      ? t("twistGiant")
      : puzzle.twist === "packed-tiny"
        ? t("twistTiny")
        : practice
          ? t("practiceRing")
          : t("todaysRing");
  // phones hide the plain "Today's ring" label but keep twist labels
  $("challenge-label").classList.toggle("twist", puzzle.twist === "empty-giant" || puzzle.twist === "packed-tiny");
  $("challenge-line").innerHTML = t("challengeLine", {
    target: people(puzzle.target),
    radius: fmt(puzzle.radiusKm),
    article: article(puzzle.radiusKm),
  });
  fitChallenge();
  renderQuest();
}
renderPuzzle();
addEventListener("resize", fitChallenge);
document.fonts?.ready.then(fitChallenge);

if (UNLIMITED) {
  $("play-hint").textContent = t("testHint");
  $("again-btn").hidden = false;
  $("new-btn").hidden = false;
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
  if (source === "ring") ringData = data;
  (map.getSource(source) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

/**
 * While placing, the ring is an SVG overlay redrawn synchronously on every
 * camera move (a GeoJSON layer updates a frame or two late, so it visibly
 * trails the centre dot when panning on a phone). Once locked in, the ring
 * becomes a normal map layer.
 */
const overlay = document.getElementById("ring-overlay") as unknown as SVGSVGElement;
const overlayPath = document.getElementById("ring-overlay-path") as unknown as SVGPathElement;

function drawOverlay() {
  const c = map.getCenter();
  const pts = circleRing({ lng: c.lng, lat: c.lat }, puzzle.radiusKm, 96).map(([lng, lat]) => map.project([lng, lat]));
  overlayPath.setAttribute("d", `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}Z`);
}

function updateRing() {
  overlay.style.display = locked && !holdOverlay ? "none" : "";
  if (locked) {
    setData("ring", circleFeature({ lng: locked.lng, lat: locked.lat }, puzzle.radiusKm));
  } else {
    setData("ring", EMPTY);
    drawOverlay();
  }
}

let answerData: Feature | typeof EMPTY = EMPTY;
let ringData: Feature | typeof EMPTY = EMPTY;
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

// Our ring layers live on top of whichever base style is active. Every style
// switch carries them across (see swapStyle in difficulty.ts) with their
// current data; style.load adds them if a full reload dropped them.
const gameLayers: GameLayers = () => ({
  sources: {
    ring: { type: "geojson", data: ringData },
    answer: { type: "geojson", data: answerData },
    "quest-lines": { type: "geojson", data: questLines() },
    "quest-areas": { type: "geojson", data: areasData },
    centers: { type: "geojson", data: centerData },
  },
  layers: [
    {
      id: "quest-area-fill",
      type: "fill",
      source: "quest-areas",
      paint: { "fill-color": CONTINENT_COLOR, "fill-opacity": 0.2 },
    },
    {
      id: "quest-area-line",
      type: "line",
      source: "quest-areas",
      paint: { "line-color": CONTINENT_COLOR, "line-width": 1.2, "line-opacity": 0.8 },
    },
    { id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": COLOR.ring, "fill-opacity": 0.12 } },
    { id: "answer-fill", type: "fill", source: "answer", paint: { "fill-color": COLOR.good, "fill-opacity": 0.15 } },
    {
      id: "answer-line",
      type: "line",
      source: "answer",
      paint: { "line-color": COLOR.good, "line-width": 3, "line-dasharray": [2, 1.5] },
    },
    { id: "ring-line", type: "line", source: "ring", paint: { "line-color": COLOR.ring, "line-width": 3 } },
    // the equator, drawn when today's side quest is to cross it
    {
      id: "quest-line",
      type: "line",
      source: "quest-lines",
      paint: { "line-color": "#c48a00", "line-width": 2, "line-dasharray": [4, 3], "line-opacity": 0.85 },
    },
    {
      id: "quest-line-label",
      type: "symbol",
      source: "quest-lines",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 400,
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-offset": [0, -0.8],
      },
      paint: { "text-color": "#8a6100", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.5 },
    },
    {
      id: "centers",
      type: "circle",
      source: "centers",
      paint: {
        "circle-radius": 6,
        "circle-color": ["match", ["get", "kind"], "answer", COLOR.good, COLOR.ring],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
      },
    },
  ],
});

map.on("style.load", () => {
  if (!map.getSource("ring")) {
    const { sources, layers } = gameLayers();
    for (const [id, src] of Object.entries(sources)) map.addSource(id, src);
    for (const l of layers) map.addLayer(l);
  }
  updateRing();
});

map.once("load", () => {
  if (locked) showResult(locked, false);
});

map.on("move", () => {
  if (!locked) drawOverlay();
});
map.on("resize", () => {
  if (!locked) drawOverlay();
});

// ---- difficulty ----
// You start on Hard and can switch to an easier map at any point before
// locking in (for fewer points), but never back to a harder one.
function renderDifficulty() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#difficulty button")) {
    const d = btn.dataset.d as Difficulty;
    btn.setAttribute("aria-pressed", String(d === difficulty));
    const harder = DIFFICULTY_ORDER.indexOf(d) > DIFFICULTY_ORDER.indexOf(difficulty);
    btn.disabled = d !== difficulty && harder;
  }
  const info = DIFFICULTIES[difficulty];
  // "Land, lakes and rivers only · ×1.2 points"
  $("difficulty-info").textContent = t("diffInfo", { blurb: info.blurb, mult: info.multiplier, locked: "" });
}

const SKIP_CONFIRM_KEY = "mapringer:skip-easier-confirm";

/** Switching to an easier map can't be undone for this ring, so ask first (unless told not to). */
function confirmEasier(to: Difficulty): Promise<boolean> {
  try {
    if (localStorage.getItem(SKIP_CONFIRM_KEY)) return Promise.resolve(true);
  } catch {
    /* storage unavailable: just ask */
  }
  const dlg = $<HTMLDialogElement>("confirm-dialog");
  const skip = $<HTMLInputElement>("confirm-skip");
  skip.checked = false;
  const target = DIFFICULTIES[to];
  $("confirm-title").textContent = t("confirmEasierTitle", { to: target.label });
  $("confirm-body").textContent = t("confirmEasierBody", { blurb: target.blurb, mult: target.multiplier, from: DIFFICULTIES[difficulty].label });
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) =>
    dlg.addEventListener(
      "close",
      () => {
        const ok = dlg.returnValue === "ok";
        // "don't ask again" only sticks when they actually switch
        if (ok && skip.checked) {
          try {
            localStorage.setItem(SKIP_CONFIRM_KEY, "1");
          } catch {
            /* storage unavailable */
          }
        }
        resolve(ok);
      },
      { once: true },
    ),
  );
}

$("difficulty").addEventListener("click", async (e) => {
  const d = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.d as Difficulty | undefined;
  if (!d || d === difficulty) return;
  if (DIFFICULTY_ORDER.indexOf(d) > DIFFICULTY_ORDER.indexOf(difficulty)) return; // no going back up
  if (!(await confirmEasier(d)) || locked) return;
  difficulty = d;
  if (!UNLIMITED) savePuzzleDifficulty(puzzle.number, d);
  applyMapStyle(map, d, LANG, gameLayers);
  renderDifficulty();
  refreshHints();
});

map.on("movestart", (e) => {
  if (locked || !(e as { originalEvent?: Event }).originalEvent) return;
  document.body.classList.add("explored");
});
renderDifficulty();

// ---- locking in ----
const lockBtn = $<HTMLButtonElement>("lock-btn");

lockBtn.addEventListener("click", async () => {
  const c = map.getCenter().wrap();
  const center = { lng: c.lng, lat: c.lat };
  const myAttempt = attempt;
  lockBtn.disabled = true;
  lockBtn.textContent = t("counting");
  try {
    let seaShare: number | undefined;
    const [population, done] = await Promise.all([
      populationInRing(center, puzzle.radiusKm),
      // the side quest is a bonus: if the land data can't load, it just doesn't count
      Promise.all([
        readLandBlock(center, puzzle.radiusKm),
        // country quests only need the cells right around the centre
        quest.kind === "country" ? readCountryBlock(center, 3).then((block) => countryAt(block, center)) : null,
      ])
        .then(([block, country]) => {
          const surface = surveyRing(block, center, puzzle.radiusKm);
          seaShare = surface.seaShare;
          return questDone(quest, surface, center, puzzle.radiusKm, country);
        })
        .catch(() => false),
    ]);
    if (myAttempt !== attempt) return;
    const s = score(population, puzzle.target);
    const bonus = questBonus(quest, done, s);
    const result: Result = {
      puzzle: puzzle.number,
      ...center,
      population,
      accuracy: accuracy(population, puzzle.target),
      score: s,
      difficulty,
      questDone: done,
      seaShare,
      bonus,
      // the side-quest bonus is added first, so the map multiplier applies to it too
      points: (s + bonus) * DIFFICULTIES[difficulty].multiplier,
    };
    if (!UNLIMITED) saveResult(result);
    locked = result;
    showResult(result, true);
  } catch (e) {
    console.error(e);
    toast(t("loadFailed"));
    lockBtn.disabled = false;
    lockBtn.textContent = t("lockIn");
  }
});

// ---- results ----
/**
 * A fun one-liner for the result (the caption beside it already says how far
 * off it was). Picked from the tier's list, the same way every time for the
 * same result, so a reload doesn't change it.
 */
function verdict(r: Result): string {
  if (r.score < 40 && (r.seaShare ?? 0) >= 0.5) return t("verdictOcean");
  const bad = r.population > puzzle.target ? "verdictBadMany" : "verdictBadFew";
  const lines = t(r.score >= 75 ? "verdictGood" : r.score >= 40 ? "verdictMeh" : bad).split("|");
  const seed = Math.abs(Math.round(r.lng * 1000) * 31 + Math.round(r.lat * 1000) * 7 + r.puzzle);
  return lines[seed % lines.length];
}

let lastBounds: maplibregl.LngLatBounds | null = null;

/** Frame the given rings in the part of the map the panels don't cover. */
function fitRings(rings: { center: LngLat; radiusKm: number }[], duration: number) {
  lastBounds = boundsOf(rings);
  map.fitBounds(lastBounds, { padding: padding(), duration, maxZoom: 13 });
}

// ---- mobile: collapsible results panel ----
function setCollapsed(collapsed: boolean, refit = true) {
  $("result-panel").classList.toggle("collapsed", collapsed);
  $("result-toggle").setAttribute("aria-expanded", String(!collapsed));
  $("result-toggle-label").textContent = t(collapsed ? "showResults" : "hideResults");
  if (refit && lastBounds) map.fitBounds(lastBounds, { padding: padding(), duration: 400, maxZoom: 13 });
}
// Tap the handle to toggle, or swipe it: down collapses, up expands. The panel
// follows the finger while dragging and snaps on release.
{
  const toggle = $("result-toggle");
  const panel = $("result-panel");
  const SWIPE_PX = 40; // past this, a release counts as a swipe
  const TAP_PX = 6; // under this, it was a tap
  let startY: number | null = null;
  let dy = 0;

  const isCollapsed = () => panel.classList.contains("collapsed");

  toggle.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    dy = 0;
    toggle.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
  });

  toggle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    dy = e.clientY - startY;
    // expanded: follows the finger down (and resists going up);
    // collapsed: a little stretch upwards hints that it will open
    const shown = isCollapsed() ? Math.max(-60, Math.min(0, dy * 0.35)) : dy > 0 ? dy : dy * 0.2;
    panel.style.transform = `translateY(${shown}px)`;
  });

  const finish = () => {
    if (startY === null) return;
    startY = null;
    panel.classList.remove("dragging");
    panel.style.transform = "";
    if (Math.abs(dy) < TAP_PX) setCollapsed(!isCollapsed());
    else if (dy > SWIPE_PX && !isCollapsed()) setCollapsed(true);
    else if (dy < -SWIPE_PX && isCollapsed()) setCollapsed(false);
  };
  toggle.addEventListener("pointerup", finish);
  toggle.addEventListener("pointercancel", () => {
    dy = 0; // cancelled gestures don't toggle
    if (startY !== null) {
      startY = null;
      panel.classList.remove("dragging");
      panel.style.transform = "";
    }
  });

  // Keyboard (Enter / Space) arrives as a click with detail 0; pointer taps
  // were already handled on pointerup, so ignore their clicks.
  toggle.addEventListener("click", (e) => {
    if (e.detail === 0) setCollapsed(!isCollapsed());
  });
}

function boundsOf(rings: { center: LngLat; radiusKm: number }[]) {
  const b = new maplibregl.LngLatBounds();
  for (const { center, radiusKm } of rings) for (const p of circleRing(center, radiusKm, 32)) b.extend(p);
  return b;
}

// While playing, the challenge sits top centre and the lock-in panel bottom
// centre. Once you lock in on a wide screen, the results move to a left column
// (body.showing-result, see CSS) and the map's centre shifts right of it.
const wide = matchMedia("(min-width: 800px)");
const SIDEBAR_PX = 16 + 380 + 16;
const sidebar = () => wide.matches && document.body.classList.contains("showing-result");

function setResultLayout(on: boolean) {
  document.body.classList.toggle("showing-result", on);
  // shifting the map's centre waits for any reveal wipe, which needs a still map
  revealDone.then(applyLayoutPadding);
}

/** Keep the rings in the middle of the part of the map the panels don't cover. */
function applyLayoutPadding() {
  map.setPadding({ left: sidebar() ? SIDEBAR_PX : 0, top: 0, right: 0, bottom: 0 });
}
applyLayoutPadding();
wide.addEventListener("change", applyLayoutPadding);

new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty("--bottom-h", `${Math.round(entry.borderBoxSize[0].blockSize)}px`);
}).observe(document.querySelector("footer.bottom")!);

// fitBounds padding is on top of the layout padding above
const padding = () =>
  sidebar()
    ? { top: 60, bottom: 60, left: 40, right: 60 }
    : { top: $("challenge").getBoundingClientRect().bottom + 20, bottom: ($("result-panel").offsetHeight || 220) + 40, left: 30, right: 30 };

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
  add(0, t("gaugeTarget"));
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
  if (r.population <= 0) return t("nobody");
  if (r.accuracy >= MATCH_ACCURACY) return t("onTarget");
  const ratio = r.population / puzzle.target;
  const over = ratio > 1;
  const factor = over ? ratio : 1 / ratio;
  const amount = factor < 2 ? `${Math.round((factor - 1) * 100)}%` : `${factor < 10 ? factor.toFixed(1) : fmt(factor)}×`;
  return t(over ? "tooMany" : "tooFew", { amount });
}

function renderGauge(r: Result, animate: boolean) {
  const marker = $("gauge-marker");
  const ratio = r.population / puzzle.target;
  const pos = gaugePos(ratio);
  const offScale = r.population <= 0 || Math.abs(Math.log10(ratio)) > GAUGE_DECADES;
  marker.classList.toggle("good", r.accuracy >= MATCH_ACCURACY);
  marker.classList.toggle("off-left", offScale && ratio < 1);
  marker.classList.toggle("off-right", offScale && ratio > 1);
  // "53% too many people · Solid placement." on one line
  const v = Object.assign(document.createElement("span"), { className: "verdict", textContent: ` · ${verdict(r)}` });
  $("gauge-caption").replaceChildren(gaugeCaption(r), v);
  const gauge = $("gauge");
  gauge.classList.remove("animate");
  gauge.style.setProperty("--pos", "50%");
  gauge.style.setProperty("--fill", "0");
  void gauge.offsetWidth; // restart the transition
  if (animate) gauge.classList.add("animate");
  gauge.style.setProperty("--pos", `${pos}%`);
  gauge.style.setProperty("--fill", "1");
}

let revealed = false;

/** Lift the fog: full-colour map with roads and labels once the ring is locked in. */
let holdOverlay = false; // keep the screen-space ring drawn during the reveal wipe
let revealDone: Promise<void> = Promise.resolve(); // camera moves wait for the wipe

/** Lift the fog: full-colour map with roads and labels once the ring is locked in. */
function revealMap(r: Result, animate: boolean) {
  if (revealed || r.difficulty === "easy") return;
  revealed = true;
  if (!animate) {
    applyRevealStyle(map, LANG, gameLayers);
    return;
  }
  revealDone = revealWipe(map.project([r.lng, r.lat])).catch((e) => {
    console.error(e);
    $("reveal-snap").hidden = true;
  });
}

/**
 * Circular reveal: snapshot the current map, load the colour map underneath,
 * then grow a soft-edged hole in the snapshot outward from the ring's centre.
 */
async function revealWipe(at: { x: number; y: number }) {
  const snap = $<HTMLCanvasElement>("reveal-snap");
  const src = map.getCanvas();
  snap.width = src.width;
  snap.height = src.height;
  // Without preserveDrawingBuffer the WebGL canvas can only be copied inside
  // the frame that drew it, so grab it from a render event.
  await new Promise<void>((resolve) => {
    map.once("render", () => {
      snap.getContext("2d")!.drawImage(src, 0, 0);
      resolve();
    });
    map.triggerRepaint();
  });
  setMask(snap, "none");
  snap.hidden = false;
  holdOverlay = true;
  updateRing();
  drawOverlay();

  // wait for the colour map to draw, but not long: slow tiles can fill in as the wipe opens
  const timer = new Promise<void>((resolve) => setTimeout(resolve, 1200));
  await Promise.race([applyRevealStyle(map, LANG, gameLayers), timer]);
  await Promise.race([new Promise<void>((resolve) => map.once("idle", () => resolve())), timer]);

  const feather = 60;
  const maxR = Math.hypot(Math.max(at.x, innerWidth - at.x), Math.max(at.y, innerHeight - at.y)) + feather;
  // (in dev, window.__revealMs can slow the wipe down for inspection)
  const MS = (import.meta.env.DEV && (window as unknown as { __revealMs?: number }).__revealMs) || 1400;
  await new Promise<void>((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / MS);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // ease in-out
      const r = e * maxR;
      setMask(snap, `radial-gradient(circle at ${at.x}px ${at.y}px, transparent ${Math.max(0, r - feather)}px, #000 ${r}px)`);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });

  snap.hidden = true;
  holdOverlay = false;
  updateRing();
}

function setMask(el: HTMLElement, mask: string) {
  el.style.maskImage = mask;
  el.style.setProperty("-webkit-mask-image", mask);
}

function showResult(r: Result, animate: boolean) {
  const myAttempt = attempt;
  const center = { lng: r.lng, lat: r.lat };
  // start the reveal before the layout shifts the map, so the snapshot lines up
  revealMap(r, animate);
  refreshHints(); // locked in: the quest's hint shows on every difficulty
  $("play-panel").hidden = true;
  $("result-panel").hidden = false;
  setResultLayout(true);
  setCollapsed(false, false);
  $("crosshair").classList.add("hidden");
  $("result-target").textContent = fmt(puzzle.target);
  // long numbers (e.g. 1,310,000,000) get a smaller size so the two columns fit
  const longest = Math.max(fmt(r.population).length, fmt(puzzle.target).length);
  for (const id of ["result-pop", "result-target"]) {
    $(id).classList.toggle("long", longest > 9);
    $(id).classList.toggle("very-long", longest > 11);
  }
  r.score ??= score(r.population, puzzle.target); // results saved before scoring changed
  r.difficulty ??= "standard";
  r.points ??= r.score * DIFFICULTIES[r.difficulty].multiplier;
  const mult = DIFFICULTIES[r.difficulty].multiplier;
  const bonus = r.bonus ?? 0;
  const plain = mult === 1 && bonus === 0; // points equal the score
  $("result-bar").textContent = emojiBar(r.score);
  // a star after the score when the side-quest bonus was earned
  $("result-acc").textContent = `${r.score.toFixed(1)}${bonus ? " ⭐" : ""}`;
  // the final number is orange: the score itself, or the total after multiplier / bonus
  $("result-acc").classList.toggle("final", plain);
  $("result-summary").innerHTML = t("summary", {
    pop: fmt(r.population),
    bar: emojiBar(r.score),
    score: (plain ? r.score : r.points).toFixed(1),
    unit: plain ? "" : t("ptsUnit"),
  });
  $("result-points").innerHTML = plain
    ? ""
    : t("points", {
        parts: [bonus ? `+${bonus}★` : "", mult !== 1 ? `×${mult}` : ""].filter(Boolean).join(" "),
        points: r.points.toFixed(1),
      });
  updateRing();
  setCenters([{ kind: "mine", at: center }]);
  showPlace($("result-place"), center, myAttempt);
  renderGauge(r, animate);
  countUp($("result-pop"), r.population, animate ? 1000 : 0);
  startCountdown();

  revealDone.then(() => {
    if (myAttempt === attempt) fitRings([{ center, radiusKm: puzzle.radiusKm * 1.3 }], animate ? 800 : 0);
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

/** The line under the target: searching, found, or why there's no answer ring. */
function setAnswerLine(state: "searching" | "found" | "error" | "hide", text = "") {
  const el = $("answer-place");
  el.classList.toggle("searching", state === "searching");
  el.title = "";
  if (state === "searching") el.textContent = t("searching");
  else if (state === "found") el.textContent = text || t("foundSelf");
  else if (state === "error") el.textContent = t("searchError");
  else el.textContent = "";
}

/** Fill `el` with "📍 Town, Country" for a point (coordinates until the name arrives). */
function showPlace(el: HTMLElement, at: LngLat, myAttempt: number, prefix = "📍 ") {
  el.textContent = `${prefix}${coords(at)}`;
  el.title = coords(at);
  placeName(at)
    .then((name) => {
      if (myAttempt === attempt && el.isConnected) {
        el.textContent = `${prefix}${name}`;
        el.title = `${prefix}${name}`; // the line may be cut short on phones
      }
    })
    .catch(() => {}); // keep showing coordinates
}

function showAnswer(r: Result, res: AnswerResult, animate: boolean) {
  const a = res.answer ?? res.best;
  if (!a) {
    setAnswerLine("found", t("noneClose", { km: fmt(res.searchedKm) }));
    return;
  }
  const where = t("away", { km: fmt(a.distanceKm) });
  // under the target: "4 km away · Hong Kong", or the best miss "Best nearby (80%): 15 km away · …"
  setAnswerLine("found");
  showPlace($("answer-place"), a.center, attempt, res.answer ? `${where} · ` : t("noHit", { acc: a.accuracy.toFixed(1), where }));
  setData("answer", circleFeature(a.center, puzzle.radiusKm));
  setCenters([
    { kind: "mine", at: { lng: r.lng, lat: r.lat } },
    { kind: "answer", at: a.center },
  ]);
  const rings = [
    { center: { lng: r.lng, lat: r.lat }, radiusKm: puzzle.radiusKm },
    { center: a.center, radiusKm: puzzle.radiusKm },
  ];
  const myAttempt = attempt;
  revealDone.then(() => {
    if (myAttempt === attempt) fitRings(rings, animate ? 1200 : 0);
  });
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
  setResultLayout(false);
  setCollapsed(false, false);
  lastBounds = null;
  $("crosshair").classList.remove("hidden");
  lockBtn.disabled = false;
  lockBtn.textContent = t("lockIn");
  setData("answer", EMPTY);
  setAnswerLine("hide");
  setCenters([]);
  // every new attempt starts back on Hard
  document.body.classList.remove("explored");
  if (difficulty !== "hard" || revealed) {
    difficulty = "hard";
    applyMapStyle(map, difficulty, LANG, gameLayers);
  }
  revealed = false;
  holdOverlay = false;
  $("reveal-snap").hidden = true;
  renderDifficulty();
  refreshHints();
  updateRing();
}

$("again-btn").addEventListener("click", resetPlay);
$("new-btn").addEventListener("click", () => {
  practice = true;
  puzzle = puzzleFor(1000 + Math.floor(Math.random() * 1e9));
  quest = questFor(puzzle);
  renderPuzzle();
  resetPlay();
});

// ---- sharing ----
$("share-btn").addEventListener("click", async () => {
  if (!locked) return;
  const text = shareText(
    puzzle,
    locked,
    location.origin + location.pathname,
    (v) => t("shareTitle", v),
    DIFFICULTIES[locked.difficulty].label,
    `${t("ptsUnit")}${locked.bonus ? " ★" : ""}`,
  );
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast(t("copied"));
  } catch (e) {
    if ((e as Error).name !== "AbortError") toast(t("shareFailed"));
  }
});

// ---- help ----
const helpDialog = $<HTMLDialogElement>("help-dialog");
$("help-btn").addEventListener("click", () => helpDialog.showModal());

/**
 * How-to-play demo: a 7 s clip recorded from the real game (spin the globe,
 * zoom into Hong Kong, the ring turns green at 5.3 s). The lock button, the
 * result chip and the step highlights follow the video's own clock.
 */
{
  const video = $<HTMLVideoElement>("demo-video");
  const demo = $("demo");
  video.src = `${import.meta.env.BASE_URL}help/demo-${LANG}.mp4`;
  $("demo-challenge").innerHTML = t("challengeLine", { target: people(6_500_000), radius: 20, article: "a" });
  video.poster = `${import.meta.env.BASE_URL}help/demo-${LANG}.jpg`;
  const sync = () => {
    const s = video.currentTime;
    demo.dataset.phase = s < 0.4 ? "rules" : s < 4.9 ? "move" : s < 5.3 ? "lock" : s < 6.8 ? "result" : "end";
    if (helpDialog.open) requestAnimationFrame(sync);
  };
  const start = () => {
    video.currentTime = 0;
    video.play().catch(() => {}); // autoplay can be blocked (e.g. Low Power Mode): the poster shows
    requestAnimationFrame(sync);
  };
  new MutationObserver(() => (helpDialog.open ? start() : video.pause())).observe(helpDialog, { attributes: true, attributeFilter: ["open"] });
  if (helpDialog.open) start();
}
$("lang-btn").addEventListener("click", switchLanguage);
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
