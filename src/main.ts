import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 renders tiles in a separate module worker; let Vite bundle it and
// hand MapLibre the URL, otherwise dep pre-bundling breaks the worker path.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./style.css";
import { applyStaticText, LANG, people, switchLanguage, t } from "./i18n";
import { findClosestAnswer, MATCH_ACCURACY, type AnswerResult } from "./answer";
import { applyMapStyle, applyRevealStyle, DIFFICULTIES, GLOBE, prefetchStyles, type Difficulty, type GameLayers } from "./difficulty";
import { circleRing, haversineKm, type LngLat } from "./geo";
import { coords, placeName } from "./places";
import { CITIES } from "./cities";
import { loadSeaLookup } from "./seagrid";
import { highestInRing, TILE_URL as ELEVATION_TILES } from "./elevation";
import { CONTINENT_VIEW, COUNTRIES, countryAt, GEOMETRY_ONLY, questAnchors, SEAS, questDone, questFor, surveyRing, TROPIC_LAT, type Continent, type Quest } from "./quests";
import { populationInRing, preloadPopulation, readBlock, readCountryBlock, readLandBlock } from "./population";
import {
  accuracy,
  dayRings,
  fmt,
  fmtPoints,
  gradeRing,
  levelOf,
  msUntilNextPuzzle,
  PASS_SCORE,
  PASS_SHARE,
  ratioForScore,
  SCORE_BANDS,
  score,
  shareText,
  STAGES,
  todaysNumber,
  type Puzzle,
  type Stage,
} from "./puzzle";
import { computeStats } from "./stats";
import { renderStats } from "./stats-view";
import { cloudEnabled, currentAccount, googleEnabled, onAccount, pushDayMap, pushResult, sendCode, signInWithGoogle, signOut, startCloud, verifyCode } from "./cloud";
import { loadAllDays, loadDayMap, loadResult, saveDayMap, saveResult, type Result } from "./storage";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

maplibregl.setWorkerUrl(maplibreWorkerUrl);
applyStaticText();

// Test options: ?day=N plays puzzle #N; ?unlimited (on by default in dev,
// ?unlimited=0 to turn off) allows unlimited attempts, endless random
// puzzles, and saves nothing.
const params = new URLSearchParams(location.search);
const dayParam = Number(params.get("day"));
// ?practice (the "Practice" button): random days on any map, retries, nothing saved
const PRACTICE = params.has("practice");
const UNLIMITED = PRACTICE || (params.has("unlimited") ? params.get("unlimited") !== "0" : import.meta.env.DEV);
// Each day is three rings, easy to hard, played one after another.
/**
 * Switching language reloads the page. Just before, the game stashes where you
 * are (for this tab only) and picks it back up here: the map view always, and
 * in test mode, where nothing else is saved, the day, ring and results too.
 */
interface CarryOver {
  camera: { center: [number, number]; zoom: number };
  test?: { day: number; practice: boolean; stage: Stage; results: (Result | null)[]; map: Difficulty | null };
}
const CARRY_KEY = "mapringer:carry-over";
const carried: CarryOver | null = (() => {
  try {
    const raw = sessionStorage.getItem(CARRY_KEY);
    sessionStorage.removeItem(CARRY_KEY);
    return raw ? (JSON.parse(raw) as CarryOver) : null;
  } catch {
    return null;
  }
})();
const carriedTest = UNLIMITED ? carried?.test : undefined;

// the test site starts on a random day each visit (?day=N picks one, e.g. today's)
const randomDay = () => 1000 + Math.floor(Math.random() * 1e9);
const startRandom = UNLIMITED && !(dayParam > 0);
let day = carriedTest?.day ?? (dayParam > 0 ? dayParam : startRandom ? randomDay() : todaysNumber());
let rings = dayRings(day);
let results: (Result | null)[] = carriedTest?.results ?? ([0, 1, 2] as Stage[]).map((st) => (UNLIMITED ? null : loadResult(day, st)));
/** The first ring not played yet (or the last ring once the day is done). */
function nextStage(): Stage {
  const i = results.findIndex((r) => !r);
  return (i < 0 ? 2 : i) as Stage;
}
// dev only (the preview's views, dev/preview-views.js): ?stage=0|1|2 opens that ring
// of the day, showing its saved result if it has one, instead of the first unplayed ring
const devStage = import.meta.env.DEV && ["0", "1", "2"].includes(params.get("stage") ?? "") ? (Number(params.get("stage")) as Stage) : null;
let stage: Stage = carriedTest?.stage ?? devStage ?? nextStage();
let puzzle: Puzzle = rings[stage];
let practice = carriedTest?.practice ?? startRandom; // true once we've moved on to random days
const dayDone = () => results.every(Boolean);

/** One bright gold for everything quest-related: hint lines, borders, the quest's sample ring. */
const QUEST_GOLD = "#f5b700";
const COLOR = { ring: "#e4572e", good: "#2a9d8f", quest: QUEST_GOLD };

preloadPopulation();

let locked: Result | null = results[stage];
let attempt = 0; // bumps on every reset so stale async work is ignored
// The player picks one map for the day (asked when the day starts) and plays
// all three rings on it. Days played before there was a pick keep each ring's
// old fixed map (ring 1 Easy, ring 2 Standard, ring 3 Hard).
let dayMap: Difficulty | null = UNLIMITED ? (carriedTest?.map ?? null) : loadDayMap(day);
const ringMap = (st: Stage): Difficulty => dayMap ?? results[st]?.map ?? (dayDone() ? STAGES[st].map : "standard");
let difficulty: Difficulty = ringMap(stage);

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
  center: carried?.camera.center ?? [10, 25],
  zoom: carried?.camera.zoom ?? wholeGlobeZoom(),
  // never smaller than the whole globe filling the screen (see the resize below)
  minZoom: wholeGlobeZoom(),
  attributionControl: false, // added bottom-left below, clear of the lock-in button
  dragRotate: false,
  pitchWithRotate: false,
  // play map motion (the globe's spin glide, short camera moves) even with
  // Reduce Motion on: it's how the game is played, and iPhones often have it on
  reduceMotion: false,
});
// a longer, softer glide after a flick, so spinning the globe feels smooth
map.dragPan.enable({ linearity: 0.22, deceleration: 1300, maxSpeed: 2400, easing: (t) => 1 - (1 - t) ** 3 });
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
// MapLibre opens the compact credits the first time any appear; start them
// collapsed to the ⓘ button instead (a tap still opens them)
{
  const collapseCredits = () => {
    const attrib = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
    if (!attrib) return;
    attrib.classList.remove("maplibregl-compact-show");
    map.off("styledata", collapseCredits);
    map.off("sourcedata", collapseCredits);
  };
  map.on("styledata", collapseCredits);
  map.on("sourcedata", collapseCredits);
}
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
addEventListener("resize", () => map.setMinZoom(wholeGlobeZoom()));

// Zooming out past the whole globe: the globe (and the ring on it) squeezes a
// little smaller, harder the further you push, then springs back with a small
// overshoot when you let go. Wheel / trackpad pinch and two-finger pinch.
{
  const stretched = () => [map.getCanvas(), $("ring-overlay")];
  const MAX_SQUEEZE = 0.14; // at most 14% smaller
  const SPRING = "transform 560ms cubic-bezier(0.34, 1.56, 0.64, 1)"; // (overshoots, then settles)
  let squeeze = 0; // 0 … 1 (asymptotic)
  let letGo = 0;
  const atMin = () => map.getZoom() <= map.getMinZoom() + 0.02;
  const paint = (spring: boolean) => {
    for (const el of stretched()) {
      el.style.transformOrigin = "50% 50%";
      el.style.transition = spring ? SPRING : "none";
      el.style.transform = squeeze ? `scale(${1 - MAX_SQUEEZE * squeeze})` : "";
    }
  };
  const springBack = () => {
    if (!squeeze) return;
    squeeze = 0;
    paint(true);
  };
  /** Push further by `x` (≥ 0): each push gives less, like a rubber band. */
  const push = (x: number) => {
    squeeze += (1 - squeeze) * Math.min(1, x);
    paint(false);
  };

  const box = map.getCanvasContainer();
  box.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY <= 0 || !atMin()) return;
      push((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) / (e.ctrlKey ? 120 : 700)); // (ctrl: a trackpad pinch, smaller deltas)
      clearTimeout(letGo);
      letGo = window.setTimeout(springBack, 160); // the wheel has no "let go": a pause is one
    },
    { passive: true },
  );

  // two fingers: from where the pinch hit the limit, how much closer they've come
  let pinchAtMin: number | null = null;
  const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  box.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 2) return;
      const d = spread(e.touches);
      if (!atMin()) {
        pinchAtMin = null;
        return;
      }
      if (pinchAtMin === null || d > pinchAtMin) pinchAtMin = d;
      const x = 1 - d / pinchAtMin; // 0 … 1, how far past the limit
      squeeze = x / (x + 0.35); // (resists more the further you go)
      paint(false);
    },
    { passive: true },
  );
  const fingersUp = (e: TouchEvent) => {
    if (e.touches.length < 2) {
      pinchAtMin = null;
      springBack();
    }
  };
  box.addEventListener("touchend", fingersUp);
  box.addEventListener("touchcancel", fingersUp);
}
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
const fitChallenge = () => fitOneLine($("challenge-line"), matchMedia("(min-width: 800px)").matches ? 17 : 15);

let quest: Quest | null = questFor(puzzle);
/** The rings' centre dots on the map (see setCenters): mine, the answer, the quest's gold ring. */
let centerPoints: { kind: CenterKind; at: LngLat }[] = [];

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
  centreAtSea: "questCentreAtSea",
  primeMeridian: "questPrimeMeridian",
} as const;

const countryName = (id: string) => {
  const c = COUNTRIES.find((c) => c.id === id);
  return c ? c[LANG] : id;
};

const cityOf = (id: string) => CITIES.find((c) => c.id === id);

/** A height in metres, and in feet for the English text ("1,000 m (3,281 ft)"). */
const heights = (m: number) => ({ m: fmt(m), ft: fmt(Math.round(m * 3.28084)) });

function questText(q: Quest): string {
  if (q.kind === "continent") return t("questContinent", { continent: t(q.continent) });
  if (q.kind === "country") return t("questCountry", { country: countryName(q.country) });
  if (q.kind === "nearCity") return t("questNearCity", { city: cityOf(q.city)?.[LANG] ?? q.city, km: q.km });
  if (q.kind === "high") return t("questHigh", heights(q.m));
  if (q.kind === "touchSea") return t("questTouchSea", { sea: SEAS.find((x) => x.id === q.sea)?.[LANG] ?? q.sea });
  if (q.kind === "northOf") return t("questNorthOf", { lat: q.lat });
  if (q.kind === "southOf") return t("questSouthOf", { lat: -q.lat });
  return t(QUEST_TEXT[q.kind]);
}

/**
 * Quest hints on the map, on every ring's map (quests count, so they're
 * shown): the equator / tropics / meridians, and continent or country
 * borders as outlines. No shading of where the continents or islands are.
 */
const showHints = () => true;

/** Quests about a line of latitude or longitude: their lines show on every map. */
const LINE_QUESTS = new Set<Quest["kind"]>(["equator", "northOfCancer", "southOfCapricorn", "tropics", "west", "east", "primeMeridian", "northOf", "southOf"]);

/**
 * Hints about *places* (continent borders, country outlines, the circle round
 * a city, flying to a sea): not on the Hard map until the ring is locked in.
 * Finding the place is part of Hard. Latitude / longitude lines always show.
 */
const showPlaceHints = () => difficulty !== "hard" || !!locked;

/** A labelled line all the way round the globe: a parallel (lat) or a meridian (lng). */
function parallel(lat: number, name: string) {
  return { type: "Feature" as const, properties: { name }, geometry: { type: "LineString" as const, coordinates: [[-180, lat], [0, lat], [180, lat]] } };
}
function meridian(lng: number, name: string) {
  const coordinates: number[][] = [];
  for (let lat = -85; lat <= 85; lat += 5) coordinates.push([lng, lat]);
  return { type: "Feature" as const, properties: { name }, geometry: { type: "LineString" as const, coordinates } };
}

/** Where two continents meet on land (scripts/build_continent_borders.py), for continent quests. */
type BorderFC = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { a?: string; b?: string; name?: string; first?: string; second?: string; orient?: string }; geometry: { type: string; coordinates: number[] | number[][] } }[];
};

/**
 * Labels beside the quest's lines saying which side is which: "← Western
 * Hemisphere | Eastern Hemisphere →" along the meridians, and the continent
 * on each side of a continent border.
 */
type SideFC = { type: "FeatureCollection"; features: { type: "Feature"; properties: { text: string; anchor: string; offset: [number, number] }; geometry: { type: "Point"; coordinates: [number, number] } }[] };
let sidesData: SideFC = { type: "FeatureCollection", features: [] };
function sidePair(at: [number, number], first: string, second: string, orient: "ns" | "ew"): SideFC["features"] {
  const pt = (text: string, anchor: string, offset: [number, number]) => ({ type: "Feature" as const, properties: { text, anchor, offset }, geometry: { type: "Point" as const, coordinates: at } });
  return orient === "ns"
    ? [pt(`← ${first}`, "right", [-0.6, 0]), pt(`${second} →`, "left", [0.6, 0])]
    : [pt(`↑ ${first}`, "bottom", [0, -0.5]), pt(`↓ ${second}`, "top", [0, 0.5])];
}
function hemisphereSides(): SideFC["features"] {
  const out: SideFC["features"] = [];
  for (const lat of [-45, -25, -5, 15, 35, 55]) {
    out.push(...sidePair([0, lat], t("hemiWest"), t("hemiEast"), "ns"));
    // at 180° the sides swap: the Eastern Hemisphere is to the west of it
    out.push(...sidePair([180, lat], t("hemiEast"), t("hemiWest"), "ns"));
  }
  return out;
}
function setSides(features: SideFC["features"]) {
  sidesData = { type: "FeatureCollection", features };
  (map.getSource("quest-sides") as maplibregl.GeoJSONSource | undefined)?.setData(sidesData);
}
let bordersGeo: Promise<BorderFC> | null = null;
let borderLines: BorderFC["features"] = [];

/** Map lines that go with the day's quest (equator, tropics, meridians, continent borders). */
function questLines() {
  return { type: "FeatureCollection" as const, features: [...parallelLines().features, ...borderLines] };
}

function parallelLines() {
  const lines = !showHints() || !quest
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
              : quest.kind === "primeMeridian"
                ? [meridian(0, t("primeMeridian"))]
                : quest.kind === "northOf"
                  ? [parallel(quest.lat, t("latN", { lat: quest.lat }))]
                  : quest.kind === "southOf"
                    ? [parallel(quest.lat, t("latS", { lat: -quest.lat }))]
                    : [];
  return { type: "FeatureCollection" as const, features: lines };
}

type AreaFC = { type: "FeatureCollection"; features: { type: "Feature"; properties: { continent: string; island: boolean }; geometry: object }[] };
const NO_AREAS: AreaFC = { type: "FeatureCollection", features: [] };
let areasData: AreaFC = NO_AREAS;

/** Whether the current quest's hint draws an outlined area (a country, or the circle round a city). */
function questAreaFilter(): ((f: AreaFC["features"][number]) => boolean) | null {
  if (!showHints() || !showPlaceHints() || !quest) return null;
  if (quest.kind === "nearCity") return () => true;
  if (quest.kind === "country") return () => true;
  // continent quests: just the lines where continents meet (see refreshHints)
  // islands-only: no shading of where the big continents are
  return null;
}

/** Shaded relief: always on the Standard and Hard maps; on the satellite map only for height quests. */
const showRelief = () => difficulty !== "easy" || (showHints() && quest?.kind === "high");

/** Redraw the quest hints for the current quest, difficulty and lock state. */
function refreshHints() {
  if (map.getLayer("quest-hillshade")) map.setLayoutProperty("quest-hillshade", "visibility", showRelief() ? "visible" : "none");
  syncQuestGo();
  const myQuest = quest;
  borderLines = [];
  setSides(showHints() && quest && (quest.kind === "west" || quest.kind === "east") ? hemisphereSides() : []);
  if (showHints() && showPlaceHints() && quest && (quest.kind === "continent" || quest.kind === "twoContinents")) {
    const only = quest.kind === "continent" ? quest.continent : null;
    bordersGeo ??= fetch(`${import.meta.env.BASE_URL}hints/continent-borders.geojson`).then((r) => r.json() as Promise<BorderFC>);
    bordersGeo
      .then((fc) => {
        if (quest !== myQuest) return;
        const touches = (a?: string, b?: string) => !only || a === only || b === only;
        // the lines (unlabelled: the names go on each side of them instead)
        borderLines = fc.features.filter((f) => f.geometry.type === "LineString" && touches(f.properties.a, f.properties.b));
        (map.getSource("quest-lines") as maplibregl.GeoJSONSource | undefined)?.setData(questLines());
        setSides(
          fc.features
            .filter((f) => f.geometry.type === "Point" && touches(f.properties.first, f.properties.second))
            .flatMap((f) => sidePair(f.geometry.coordinates as [number, number], t(f.properties.first as Continent), t(f.properties.second as Continent), f.properties.orient as "ns" | "ew")),
        );
      })
      .catch(() => {
        bordersGeo = null; // a hint is optional; try again next time
      });
  }
  (map.getSource("quest-lines") as maplibregl.GeoJSONSource | undefined)?.setData(questLines());
  const keep = questAreaFilter();
  const apply = (fc: AreaFC) => {
    areasData = fc;
    (map.getSource("quest-areas") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  };
  if (!keep || !quest) return apply(NO_AREAS);
  if (quest.kind === "nearCity") {
    // the area the ring's centre must stay in: a circle around the city
    const c = cityOf(quest.city);
    if (!c) return apply(NO_AREAS);
    return apply({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { continent: "country", island: false }, geometry: { type: "Polygon", coordinates: [circleRing(c, quest.km)] } }],
    });
  }
  if (quest.kind === "country") {
    fetch(`${import.meta.env.BASE_URL}hints/countries/${quest.country}.geojson`)
      .then((r) => r.json() as Promise<AreaFC>)
      .then((fc) => {
        if (quest === myQuest && questAreaFilter()) apply(fc);
      })
      .catch(() => {}); // a hint is optional
    return;
  }
  apply(NO_AREAS);
}

/**
 * Tap the quest: while placing, fly to what it's about (the country,
 * continent, city circle, line or meridian, the nearest continent border, or
 * the nearest place that suits it); after lock-in, to the gold ring that does
 * it, if there is one.
 */
function questFocus(): maplibregl.LngLatBounds | null {
  if (!quest) return null;
  const here = map.getCenter().wrap();
  const around = (lng: number, lat: number, km: number) => boundsOf([{ center: { lng, lat }, radiusKm: km }]);
  const gold = locked ? centerPoints.find((p) => p.kind === "quest") : undefined;
  if (gold) return boundsOf([{ center: gold.at, radiusKm: puzzle.radiusKm * 1.6 }]);
  if (!showPlaceHints() && !LINE_QUESTS.has(quest.kind)) return null; // Hard: no flying to the place
  switch (quest.kind) {
    case "continent": {
      const [w, s, e, n] = CONTINENT_VIEW[quest.continent];
      return new maplibregl.LngLatBounds([w, s], [e, n]);
    }
    case "country": {
      // the country's biggest piece (so islands far away don't zoom the map right out)
      const polys = areasData.features.flatMap((f) => {
        const g = f.geometry as { type: string; coordinates: number[][][] | number[][][][] };
        return g.type === "Polygon" ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
      });
      const biggest = polys.sort((a, b) => b[0].length - a[0].length)[0];
      if (biggest) {
        const b = new maplibregl.LngLatBounds();
        for (const [lng, lat] of biggest[0]) b.extend([lng, lat]);
        return b;
      }
      break;
    }
    case "nearCity": {
      const c = cityOf(quest.city);
      if (c) return boundsOf([{ center: c, radiusKm: quest.km * 1.15 }]);
      break;
    }
    case "touchSea": {
      const id = quest.sea;
      const sea = SEAS.find((x) => x.id === id);
      if (sea) return new maplibregl.LngLatBounds([sea.view[0], sea.view[1]], [sea.view[2], sea.view[3]]);
      break;
    }
    case "northOf":
    case "southOf":
      return around(here.lng, quest.lat, 1800);
    case "primeMeridian":
      return around(0, Math.max(-50, Math.min(55, here.lat)), 1500);
    case "equator":
      return around(here.lng, 0, 2200);
    case "northOfCancer":
      return around(here.lng, TROPIC_LAT, 2200);
    case "southOfCapricorn":
      return around(here.lng, -TROPIC_LAT, 2200);
    case "tropics":
      return around(here.lng, 0, 3000);
    case "west":
    case "east": {
      // the nearer of the two meridians that split the hemispheres
      const m = Math.abs(here.lng) < 90 ? 0 : here.lng > 0 ? 180 : -180;
      return around(m, Math.max(-50, Math.min(50, here.lat)), 2200);
    }
    case "landlocked":
    case "islandsOnly":
    case "high":
    case "centreAtSea":
      // no zooming help for these: finding the place is the quest
      return null;
    case "twoContinents": {
      // the continent border nearest the map's centre
      let best: { b: maplibregl.LngLatBounds; d: number } | null = null;
      for (const f of borderLines) {
        const coords = (f.geometry as unknown as { coordinates: [number, number][] }).coordinates;
        const d = Math.min(...coords.map(([lng, lat]) => haversineKm(here, { lng, lat })));
        if (!best || d < best.d) {
          const b = new maplibregl.LngLatBounds();
          for (const p of coords) b.extend(p);
          best = { b, d };
        }
      }
      if (best) {
        const c = best.b.getCenter();
        return around(c.lng, c.lat, 600);
      }
      break;
    }
  }
  return null;
}

/** Quests where finding the place is the point: no "Show on map" while placing. */
const NO_ZOOM = new Set<Quest["kind"]>(["landlocked", "islandsOnly", "high", "centreAtSea"]);

/** Only quests that have somewhere to show look tappable ("Show on map ›"). */
function syncQuestGo() {
  const can =
    !!quest && (centerPoints.some((p) => p.kind === "quest") || (!NO_ZOOM.has(quest.kind) && (showPlaceHints() || LINE_QUESTS.has(quest.kind))));
  $("quest").classList.toggle("can-go", can);
  if (can) $("quest").setAttribute("role", "button");
  else $("quest").removeAttribute("role");
  $("quest").tabIndex = can ? 0 : -1;
}

function goToQuest() {
  const b = questFocus();
  if (!b) return;
  const pad = locked ? padding() : { top: $("challenge").getBoundingClientRect().bottom + 20, bottom: 130, left: 30, right: 30 };
  map.fitBounds(b, { padding: pad, duration: 1400, maxZoom: locked ? 13 : 8 });
}
$("quest").addEventListener("click", goToQuest);

// while placing: back out to most of the globe (a little closer than the
// whole thing, so the edges just run off the screen); the ring stays put
$("globe-btn").addEventListener("click", () =>
  map.easeTo({ zoom: Math.min(map.getZoom(), wholeGlobeZoom() + 0.45), duration: 900 }),
);

// ---- the challenge card collapses to its one line (a big ring can sit under it) ----
function setChallengeCollapsed(collapsed: boolean) {
  const card = $("challenge");
  if (card.classList.contains("collapsed") === collapsed) return;
  card.classList.toggle("collapsed", collapsed);
  const btn = $("challenge-toggle");
  btn.setAttribute("aria-expanded", String(!collapsed));
  btn.setAttribute("aria-label", t(collapsed ? "showChallenge" : "hideChallenge"));
  fitChallenge();
}
$("challenge-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  setChallengeCollapsed(!$("challenge").classList.contains("collapsed"));
});
// collapsed, the whole card is the way back
$("challenge").addEventListener("click", () => {
  if ($("challenge").classList.contains("collapsed")) setChallengeCollapsed(false);
});
// the "★ Closest that does the quest" line in the results goes there too
$("quest-answer").addEventListener("click", () => {
  if (centerPoints.some((p) => p.kind === "quest")) goToQuest();
});
$("quest").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    goToQuest();
  }
});

function renderQuest() {
  refreshHints();
  syncQuestGo();
  $("quest").hidden = !quest; // ring 1 has no quest
  $("challenge").classList.toggle("has-quest", !!quest);
  if (!quest) setChallengeCollapsed(false); // (nothing to hide: no toggle)
  if (quest)
    $("quest-text").replaceChildren(
      Object.assign(document.createElement("span"), { className: "quest-do", textContent: questText(quest) }),
      Object.assign(document.createElement("span"), {
        className: "quest-rule",
        textContent: t("questRule", { pass: PASS_SCORE, half: fmtPoints(STAGES[stage].max * PASS_SHARE) }),
      }),
    );
}

function renderPuzzle() {
  $("puzzle-num").textContent = practice ? t("practiceTag") : `#${day}${UNLIMITED ? t("testTag") : ""}`;
  // the ring number badge: "2/3", read out as "Ring 2 of 3"
  $("ring-no-n").textContent = String(stage + 1);
  $("ring-no").setAttribute("aria-label", t("ringLabel", { n: stage + 1 }));
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
  $("again-btn").hidden = false;
  $("new-btn").hidden = false;
  $("next-info").hidden = true;
}
if (PRACTICE) {
  // the "Practice ✕" pill says it's practice (and leaves it), so no "· practice" tag
  $("today-btn").hidden = false;
  $("puzzle-num").hidden = true;
  $("stats-practice").hidden = true;
  // (?practice&day=<today>: today's rings again, from "Other maps" on the results)
  const replay = dayParam === todaysNumber();
  $("pick-title").textContent = t(replay ? "pickMapReplay" : "pickMapPractice");
  $("pick-sub").textContent = t(replay ? "pickMapReplaySub" : "pickMapPracticeSub");
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
  if (source === "quest-answer") questAnswerData = data;
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

const overlayExtras = [$("ring-trace"), $("ring-spin")];
/** While locking in, the ring stays where it was locked (the map glides to frame it). */
let lockingAt: LngLat | null = null;

/**
 * Whether the globe hides this point (it's round the back). The overlay is
 * flat on top of the map, so without this a locked ring would show through
 * the planet while you spin it. Public API only: the point's pixel, read back,
 * is the near side of the globe there; if that's somewhere else, the point is
 * behind it.
 */
function hiddenOnGlobe(lng: number, lat: number, at: { x: number; y: number }, toleranceKm: number) {
  const front = map.unproject([at.x, at.y]);
  return haversineKm({ lng: front.lng, lat: front.lat }, { lng, lat }) > toleranceKm;
}

function drawOverlay() {
  const c = lockingAt ?? (locked ? { lng: locked.lng, lat: locked.lat } : map.getCenter());
  // start the path at the top of the ring, so the trace and the glow go round from twelve o'clock
  const ring = circleRing({ lng: c.lng, lat: c.lat }, puzzle.radiusKm, 96);
  const tolerance = 1 + puzzle.radiusKm * 0.02;
  const pts = ring.map(([lng, lat]) => {
    const at = map.project([lng, lat]);
    return { x: at.x, y: at.y, hidden: hiddenOnGlobe(lng, lat, at, tolerance) };
  });
  const xy = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  let d: string;
  if (!pts.some((p) => p.hidden)) d = `M${pts.map(xy).join("L")}Z`;
  else {
    // only the stretches on the near side of the globe; they end at the horizon
    const start = pts.findIndex((p, i) => p.hidden && !pts[(i + 1) % pts.length].hidden); // (start just after a hidden run)
    d = "";
    let pen = false;
    for (let k = 1; k <= pts.length; k++) {
      const p = pts[(start + k) % pts.length];
      if (p.hidden) pen = false;
      else {
        d += `${pen ? "L" : "M"}${xy(p)}`;
        pen = true;
      }
    }
  }
  overlayPath.setAttribute("d", d);
  for (const el of overlayExtras) el.setAttribute("d", d);
}

/** Map gestures on / off (off while the lock-in animation plays). */
function setInteractive(on: boolean) {
  for (const h of [map.dragPan, map.scrollZoom, map.boxZoom, map.doubleClickZoom, map.keyboard, map.touchZoomRotate]) {
    if (on) h.enable();
    else h.disable();
  }
  if (on) map.touchZoomRotate.disableRotation();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The lock-in moment: glide to frame the ring, trace a bright line round it,
 * keep a glow circling while the count (or the quest check) is still loading,
 * then "ding" (a pulse, a soft chime, a buzz) before the answer is revealed.
 */
async function lockAnimation(center: LngLat, ready: Promise<unknown>) {
  const ov = overlay as unknown as HTMLElement;
  lockingAt = center;
  setInteractive(false);
  ov.classList.remove("tracing", "waiting", "ding");
  // only the centre shows at first: the ring is drawn by the trace
  ov.classList.add("locking");
  let isReady = false;
  ready.then(
    () => (isReady = true),
    () => (isReady = true),
  );

  // 1. centre the ring and frame it
  const pad = { top: $("challenge").getBoundingClientRect().bottom + 24, bottom: 140, left: 32, right: 32 };
  const cam = map.cameraForBounds(boundsOf([{ center, radiusKm: puzzle.radiusKm * 1.15 }]), { padding: pad });
  const zoom = cam?.zoom ?? map.getZoom();
  map.easeTo({ center: [center.lng, center.lat], zoom, duration: 850, easing: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) });
  await sleep(850);
  drawOverlay();

  // 2. a line traces round the ring
  void ov.getBoundingClientRect(); // restart the CSS animations
  ov.classList.add("tracing");
  await sleep(1000);

  // 3. still counting? a glow keeps going round until it's ready
  if (!isReady) {
    ov.classList.add("waiting");
    await ready.catch(() => {});
    ov.classList.remove("waiting");
  }

  // 4. the ring closes: ding, and it fills in
  ov.classList.add("ding");
  chime();
  buzz(35);
  await sleep(420);
}

/** Forget any lock-in animation (a new ring, or a retry). */
function clearLockAnimation() {
  lockingAt = null;
  (overlay as unknown as HTMLElement).classList.remove("locking", "tracing", "waiting", "ding", "settled");
  setInteractive(true);
}

/** A soft two-note chime (Web Audio; made on the lock-in tap so phones allow it). */
let audio: AudioContext | null = null;
function primeAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null; // no sound, no problem
  }
}
function chime() {
  if (!audio) return;
  const now = audio.currentTime;
  for (const [freq, delay, level] of [
    [1318.5, 0, 0.09], // E6
    [1975.5, 0.09, 0.06], // B6
  ] as const) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(level, now + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.9);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 1);
  }
}

/**
 * The player's ring is always the screen overlay (redrawn on every camera
 * move): while placing it's the plain ring; once locked it keeps the glowing
 * traced line and fill from the lock-in animation (.settled), so nothing
 * swaps or flashes when the answer appears.
 */
function updateRing() {
  overlay.style.display = "";
  (overlay as unknown as HTMLElement).classList.toggle("settled", !!locked);
  setData("ring", EMPTY);
  drawOverlay();
}

let answerData: Feature | typeof EMPTY = EMPTY;
let questAnswerData: Feature | typeof EMPTY = EMPTY; // a sample ring that does the quest
let ringData: Feature | typeof EMPTY = EMPTY;
type PointFC = { type: "FeatureCollection"; features: { type: "Feature"; properties: { kind: string }; geometry: { type: "Point"; coordinates: [number, number] } }[] };
let centerData: PointFC = { type: "FeatureCollection", features: [] };

/** Centre dots for the locked-in ring, the answer ring and the quest's sample ring. */
type CenterKind = "mine" | "answer" | "quest";
function setCenters(points: { kind: CenterKind; at: LngLat }[]) {
  centerPoints = points;
  syncQuestGo();
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
    "quest-answer": { type: "geojson", data: questAnswerData },
    "quest-lines": { type: "geojson", data: questLines() },
    "quest-areas": { type: "geojson", data: areasData },
    "quest-sides": { type: "geojson", data: sidesData },
    // height quests: shaded relief from the same elevation tiles the quest is judged on
    "quest-dem": {
      type: "raster-dem",
      tiles: [ELEVATION_TILES],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 12,
      attribution: "Elevation: Mapzen Terrain Tiles",
    },
    centers: { type: "geojson", data: centerData },
  },
  layers: [
    {
      id: "quest-hillshade",
      type: "hillshade",
      source: "quest-dem",
      layout: { visibility: showRelief() ? "visible" : "none" },
      paint: {
        "hillshade-exaggeration": 0.55,
        "hillshade-shadow-color": "#4a3b2a",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#6b5330",
      },
    },
    {
      id: "quest-area-fill",
      type: "fill",
      source: "quest-areas",
      // outlines only: the borders a quest needs, not shaded areas
      paint: { "fill-color": QUEST_GOLD, "fill-opacity": 0 },
    },
    {
      id: "quest-area-line",
      type: "line",
      source: "quest-areas",
      paint: { "line-color": QUEST_GOLD, "line-width": 2, "line-opacity": 0.95 },
    },
    { id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": COLOR.ring, "fill-opacity": 0.12 } },
    {
      id: "answer-line",
      type: "line",
      source: "answer",
      paint: { "line-color": COLOR.good, "line-width": 3, "line-dasharray": [2, 1.5] },
    },
    { id: "quest-answer-fill", type: "fill", source: "quest-answer", paint: { "fill-color": COLOR.quest, "fill-opacity": 0.13 } },
    {
      id: "quest-answer-line",
      type: "line",
      source: "quest-answer",
      paint: { "line-color": COLOR.quest, "line-width": 3, "line-dasharray": [1, 1.2] },
    },
    { id: "ring-line", type: "line", source: "ring", paint: { "line-color": COLOR.ring, "line-width": 3 } },
    // the equator, drawn when today's side quest is to cross it
    {
      id: "quest-line",
      type: "line",
      source: "quest-lines",
      paint: { "line-color": QUEST_GOLD, "line-width": 2.5, "line-dasharray": [4, 3] },
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
      // labels in a deeper shade of the quest gold, so they read on light and satellite maps
      paint: { "text-color": "#8a6400", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6 },
    },
    {
      id: "quest-side-label",
      type: "symbol",
      source: "quest-sides",
      layout: {
        "text-field": ["get", "text"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-anchor": ["get", "anchor"] as unknown as maplibregl.DataDrivenPropertyValueSpecification<"right">,
        "text-offset": ["get", "offset"] as unknown as maplibregl.DataDrivenPropertyValueSpecification<[number, number]>,
      },
      paint: { "text-color": "#8a6400", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6 },
    },
    {
      id: "centers",
      type: "circle",
      source: "centers",
      paint: {
        "circle-radius": 6,
        "circle-color": ["match", ["get", "kind"], "answer", COLOR.good, "quest", COLOR.quest, COLOR.ring],
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
  // hint data that arrived while this style was loading went to the old one: send it again
  (map.getSource("quest-lines") as maplibregl.GeoJSONSource | undefined)?.setData(questLines());
  (map.getSource("quest-areas") as maplibregl.GeoJSONSource | undefined)?.setData(areasData);
  (map.getSource("quest-sides") as maplibregl.GeoJSONSource | undefined)?.setData(sidesData);
  updateRing();
});

map.once("load", () => {
  if (locked) showResult(locked, false);
});

map.on("move", () => {
  drawOverlay();
});
map.on("resize", () => {
  drawOverlay();
});

map.on("movestart", (e) => {
  if (locked || !(e as { originalEvent?: Event }).originalEvent) return;
  document.body.classList.add("explored");
});

// ---- locking in ----
const lockBtn = $<HTMLButtonElement>("lock-btn");

lockBtn.addEventListener("click", async () => {
  const c = map.getCenter().wrap();
  const center = { lng: c.lng, lat: c.lat };
  const myAttempt = attempt;
  lockBtn.disabled = true;
  lockBtn.classList.add("counting");
  lockBtn.setAttribute("aria-label", t("counting"));
  buzz(25); // a little tap on phones that support it
  primeAudio();
  try {
    let seaShare: number | undefined;
    let highest: number | null = null;
    const counting = Promise.all([
      populationInRing(center, puzzle.radiusKm),
      // the side quest is a bonus: if the land data can't load, it just doesn't count
      Promise.all([
        readLandBlock(center, puzzle.radiusKm),
        // sea quests: which named waters the ring touches
        quest?.kind === "touchSea" ? loadSeaLookup() : undefined,
        // country quests only need the cells right around the centre
        quest?.kind === "country" ? readCountryBlock(center, 3).then((block) => countryAt(block, center)) : null,
        // height quests: the highest ground in the ring, from the elevation tiles
        quest?.kind === "high" ? highestInRing(center, puzzle.radiusKm) : null,
      ])
        .then(([block, seaAt, country, high]) => {
          const surface = surveyRing(block, center, puzzle.radiusKm, seaAt);
          seaShare = surface.seaShare;
          highest = high;
          return quest ? questDone(quest, surface, center, puzzle.radiusKm, country, high) : false;
        })
        .catch(() => false),
    ]);
    // the animation runs while the count loads, and waits for it
    await lockAnimation(center, counting);
    const [population, done] = await counting;
    if (myAttempt !== attempt) return;
    const s = score(population, puzzle.target);
    const g = gradeRing(stage, s, !!quest, done);
    const result: Result = {
      puzzle: day,
      stage,
      ...center,
      population,
      accuracy: accuracy(population, puzzle.target),
      score: s,
      questDone: quest ? done : undefined,
      grade: g.grade,
      emoji: g.emoji,
      points: g.points,
      seaShare,
      highest: highest ?? undefined,
      map: difficulty,
    };
    if (!UNLIMITED) {
      saveResult(result);
      pushResult(result);
    }
    results[stage] = result;
    locked = result;
    // a happy buzz for a bullseye, a short one otherwise
    buzz(result.grade === "bullseye" ? [40, 70, 40, 70, 90] : result.points > 0 ? [30, 60, 30] : 60);
    lockingAt = null;
    setInteractive(true);
    showResult(result, true);
  } catch (e) {
    console.error(e);
    clearLockAnimation();
    toast(t("loadFailed"));
    lockBtn.disabled = false;
    lockBtn.classList.remove("counting");
    lockBtn.setAttribute("aria-label", t("lockIn"));
  }
});

// ---- results ----
/**
 * A fun one-liner for the result (the caption beside it already says how far
 * off it was). Picked from the tier's list, the same way every time for the
 * same result, so a reload doesn't change it.
 */
function verdict(r: Result): string {
  const seed = Math.abs(Math.round(r.lng * 1000) * 31 + Math.round(r.lat * 1000) * 7 + r.puzzle + r.stage);
  const pick = (key: Parameters<typeof t>[0]) => {
    const lines = t(key).split("|");
    return lines[seed % lines.length];
  };
  if (r.grade === "bullseye") return pick("verdictBullseye");
  if (r.grade === "good") return pick("verdictGood");
  if (r.grade === "pass") return pick("verdictPass");
  if (r.grade === "meh") return pick("verdictMeh");
  if ((r.seaShare ?? 0) >= 0.5) return t("verdictOcean");
  return pick(r.population > puzzle.target ? "verdictBadMany" : "verdictBadFew");
}

let lastBounds: maplibregl.LngLatBounds | null = null;

/** Frame the given rings in the part of the map the panels don't cover. */
/** Frame the locked ring plus whichever answer rings are shown. */
function fitShown(duration: number) {
  const rings = centerPoints.map((p) => ({ center: p.at, radiusKm: puzzle.radiusKm }));
  if (rings.length) fitRings(rings, duration);
}

function fitRings(rings: { center: LngLat; radiusKm: number }[], duration: number) {
  lastBounds = boundsOf(rings);
  map.fitBounds(lastBounds, { padding: padding(), duration, maxZoom: 13 });
}

/** Wide screens: results in a left column (and no bottom sheet). */
const wide = matchMedia("(min-width: 800px)");

// ---- phones: the results panel is a bottom sheet ----
// The handle slides the details shut to a one-line summary (and back). While
// dragging, the details' height follows the finger and the summary fades in;
// on release it eases to whichever state the gesture points at. Wide screens
// show the results in a column with no handle (CSS keeps them open there).
const sheet = (() => {
  const panel = $("result-panel");
  const body = $("result-body");
  const details = $("result-details");
  const summary = $("result-summary");
  const toggle = $("result-toggle");
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  const MS = 320;
  const closedH = () => summary.offsetHeight; // the summary line is all that's left
  const openH = () => details.scrollHeight;
  const isCollapsed = () => panel.classList.contains("collapsed");
  let settle = 0; // pending end-of-slide timer

  /** Show how far open the sheet is (0 shut … 1 open), without animating. */
  function paint(h: number) {
    const p = Math.max(0, Math.min(1, (h - closedH()) / Math.max(1, openH() - closedH())));
    body.style.height = `${h}px`;
    details.style.opacity = String(Math.min(1, p * 1.6)); // the details clear before the summary appears
    summary.style.opacity = String(Math.max(0, 1 - p * 2.2));
  }

  /** Slide to open or shut, from wherever the sheet is now. */
  function slide(collapsed: boolean, animate = true, refit = true) {
    clearTimeout(settle);
    panel.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    $("result-toggle-label").textContent = t(collapsed ? "showResults" : "hideResults");
    const done = () => {
      panel.classList.remove("sliding");
      body.style.transition = details.style.transition = summary.style.transition = "";
      // open: the details can still grow (the answer line, the quest), so let them size themselves
      if (!isCollapsed()) body.style.height = "";
      if (refit && lastBounds) map.fitBounds(lastBounds, { padding: padding(), duration: 400, maxZoom: 13 });
    };
    if (!animate || panel.hidden || wide.matches) {
      body.style.height = collapsed ? `${closedH()}px` : "";
      details.style.opacity = collapsed ? "0" : "";
      summary.style.opacity = collapsed ? "1" : "";
      done();
      return;
    }
    panel.classList.add("sliding"); // (clips the details only while they move)
    paint(body.offsetHeight); // from the current height (open is "auto")
    void body.offsetHeight;
    const tr = `${MS}ms ${EASE}`;
    body.style.transition = `height ${tr}`;
    details.style.transition = summary.style.transition = `opacity ${tr}`;
    paint(collapsed ? closedH() : openH());
    settle = window.setTimeout(done, MS + 20);
  }

  // Drag anywhere on the panel: the height follows the finger (swipe up to
  // open, down to shut). On the handle a drag starts at once and a tap
  // toggles; elsewhere it starts only once the finger clearly moves up or
  // down, so taps on the buttons still work. On release a flick or a drag
  // past halfway decides, otherwise it springs back.
  const TAP_PX = 6;
  const START_PX = 10;
  type Drag = { id: number; x: number; y: number; h: number; lastY: number; lastT: number; v: number; onHandle: boolean; active: boolean };
  let drag: Drag | null = null;
  let swallowClick = false; // a drag that ended over a button isn't a click

  const begin = (d: Drag) => {
    clearTimeout(settle);
    body.style.transition = details.style.transition = summary.style.transition = "";
    d.h = body.offsetHeight;
    d.active = true;
    panel.setPointerCapture(d.id);
    panel.classList.add("dragging");
  };

  panel.addEventListener("pointerdown", (e) => {
    if (wide.matches || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const onHandle = toggle.contains(e.target as Node);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, h: 0, lastY: e.clientY, lastT: e.timeStamp, v: 0, onHandle, active: false };
    if (onHandle) begin(drag);
  });

  panel.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dy) < START_PX || Math.abs(dy) < Math.abs(e.clientX - drag.x)) return;
      begin(drag);
      drag.y = e.clientY; // (no jump: follow from here)
      swallowClick = true;
    }
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.v = 0.7 * ((e.clientY - drag.lastY) / dt) + 0.3 * drag.v; // px/ms, + is down
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    let h = drag.h - (e.clientY - drag.y);
    // a little give past either end
    const lo = closedH(), hi = openH();
    if (h > hi) h = hi + (h - hi) * 0.25;
    if (h < lo) h = lo - (lo - h) * 0.25;
    paint(Math.max(lo * 0.6, h));
  });

  const release = (e: PointerEvent, cancelled: boolean) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.active) return; // a tap on the panel: let the click through
    panel.classList.remove("dragging");
    if (cancelled) return slide(isCollapsed(), true, false);
    const moved = d.lastY - d.y;
    if (d.onHandle && Math.abs(moved) < TAP_PX) return slide(!isCollapsed());
    // a flick decides; otherwise a quarter of the way is enough to commit
    const FLICK = 0.4; // px/ms
    const p = (body.offsetHeight - closedH()) / Math.max(1, openH() - closedH());
    const collapse = d.v > FLICK ? true : d.v < -FLICK ? false : isCollapsed() ? p < 0.25 : p < 0.75;
    slide(collapse, true, collapse !== isCollapsed());
  };
  panel.addEventListener("pointerup", (e) => release(e, false));
  panel.addEventListener("pointercancel", (e) => release(e, true));
  panel.addEventListener(
    "click",
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  panel.addEventListener("pointerdown", () => (swallowClick = false), true);

  // Scrolling over the panel (wheel, trackpad) works like a swipe: fingers up
  // (natural scrolling: deltaY > 0) opens it, fingers down shuts it to the
  // summary. One gesture, one move: a trackpad's long tail of wheel events is
  // ignored until it goes quiet.
  let wheelSum = 0;
  let wheelUsed = false;
  let wheelQuiet = 0;
  panel.addEventListener(
    "wheel",
    (e) => {
      if (wide.matches || e.ctrlKey) return; // (ctrl + wheel is a pinch zoom)
      e.preventDefault(); // (don't zoom the map underneath)
      clearTimeout(wheelQuiet);
      wheelQuiet = window.setTimeout(() => ((wheelSum = 0), (wheelUsed = false)), 220);
      if (wheelUsed) return;
      wheelSum += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (wheelSum > 30 && isCollapsed()) slide(false);
      else if (wheelSum < -30 && !isCollapsed()) slide(true);
      else return;
      wheelUsed = true;
    },
    { passive: false },
  );

  // Keyboard (Enter / Space) arrives as a click with detail 0; pointer taps
  // were already handled on pointerup, so ignore their clicks.
  toggle.addEventListener("click", (e) => {
    if (e.detail === 0) slide(!isCollapsed());
  });
  // shut, the summary line opens it too
  summary.addEventListener("click", () => {
    if (isCollapsed()) slide(false);
  });
  // a wide screen has no sheet: drop any phone-sized inline height
  wide.addEventListener("change", () => slide(false, false, false));

  return { slide };
})();

function setCollapsed(collapsed: boolean, refit = true) {
  sheet.slide(collapsed, false, refit);
}

function boundsOf(rings: { center: LngLat; radiusKm: number }[]) {
  const b = new maplibregl.LngLatBounds();
  for (const { center, radiusKm } of rings) for (const p of circleRing(center, radiusKm, 32)) b.extend(p);
  return b;
}

// While playing, the challenge sits top centre and the lock-in panel bottom
// centre. Once you lock in on a wide screen, the results move to a left column
// (body.showing-result, see CSS) and the map's centre shifts right of it.
const SIDEBAR_PX = 16 + 380 + 16;
const sidebar = () => wide.matches && document.body.classList.contains("showing-result");

function setResultLayout(on: boolean) {
  document.body.classList.toggle("showing-result", on);
  // the challenge card moves with the layout (and on wide screens gets narrower):
  // refit its line, then place the results below its new spot
  requestAnimationFrame(() => {
    fitChallenge();
    fitCaption(); // (its column changes width too)
    updateChallengeBottom();
  });
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
// the challenge card grows with the quest; on wide screens the results column starts below it
function updateChallengeBottom() {
  document.documentElement.style.setProperty("--challenge-bottom", `${Math.round($("challenge").getBoundingClientRect().bottom)}px`);
}
new ResizeObserver(updateChallengeBottom).observe($("challenge"));
addEventListener("resize", updateChallengeBottom);

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
  // a 🎯 or 🟠 ring was close: "Only 30% too many people" / 「只多了 30%」
  const close = ["bullseye", "good"].includes(levelOf(r.score).level);
  return t(close ? (over ? "onlyTooMany" : "onlyTooFew") : over ? "tooMany" : "tooFew", { amount });
}

/** "Only 64% too many people" always on one line: the font shrinks to fit its column. */
const fitCaption = () => {
  if (!$("result-panel").hidden) fitOneLine($("gauge-caption"), wide.matches ? 15 : 14, 10);
};
addEventListener("resize", fitCaption);

function renderGauge(r: Result, animate: boolean) {
  const marker = $("gauge-marker");
  const ratio = r.population / puzzle.target;
  const pos = gaugePos(ratio);
  const offScale = r.population <= 0 || Math.abs(Math.log10(ratio)) > GAUGE_DECADES;
  marker.classList.toggle("good", r.accuracy >= MATCH_ACCURACY);
  marker.classList.toggle("off-left", offScale && ratio < 1);
  marker.classList.toggle("off-right", offScale && ratio > 1);
  // "Only 53% too many people", then a comment ("Solid placement.") under it
  $("gauge-caption").textContent = gaugeCaption(r);
  fitCaption();
  $("verdict").textContent = verdict(r);
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
let revealDone: Promise<void> = Promise.resolve(); // camera moves wait for the wipe

/** Lift the fog: full-colour map with roads and labels once the ring is locked in. */
function revealMap(r: Result, animate: boolean) {
  if (revealed || (r.map ?? STAGES[r.stage].map) === "easy") return;
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
  await rippleTo(at, () => applyRevealStyle(map, LANG, gameLayers));
  updateRing();
}

/**
 * Change the map with a ripple: snapshot the current map, make the change
 * underneath (`change` resolves once the new map has been handed over), then
 * grow a soft-edged hole in the snapshot outward from `at`. Used for the
 * answer reveal and for moving on to the next ring.
 */
async function rippleTo(at: { x: number; y: number }, change: () => Promise<unknown> | void) {
  const snap = $<HTMLCanvasElement>("reveal-snap");
  await snapshotTo(snap);
  setMask(snap, "none");
  snap.hidden = false;
  updateRing();

  // wait for the new map to draw, but not long: slow tiles can fill in as the ripple opens
  const timer = new Promise<void>((resolve) => setTimeout(resolve, 1200));
  const changed = Promise.resolve(change());
  snap.hidden = false; // (a ring switch resets the snapshot; keep it up for the ripple)
  await Promise.race([changed, timer]);
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
  const max = STAGES[r.stage].max;
  // "🎯  80 / 80 pts": the level and the points (the 0–100 closeness score
  // behind the level isn't shown; the caption says how far off the ring was)
  $("result-bar").textContent = r.emoji;
  $("result-points").innerHTML = t("points", { points: fmtPoints(r.points), max });
  $("result-summary").innerHTML = t("summary", { pop: fmt(r.population), emoji: r.emoji, points: fmtPoints(r.points), max });
  // the quest: complete, or not done (so this ring was pass / fail)
  const qr = $("quest-result");
  $("quest-lines").hidden = r.questDone === undefined;
  qr.classList.toggle("done", !!r.questDone);
  qr.textContent = r.questDone ? t("questDoneLine") : t("questMissedLine", { pass: PASS_SCORE });
  if (r.highest !== undefined) qr.textContent += t("highestLine", heights(r.highest));
  renderDayEnd();
  updateRing();
  setCenters([{ kind: "mine", at: center }]);
  showPlace($("result-place"), center, myAttempt);
  renderGauge(r, animate);
  countUp($("result-pop"), r.population, animate ? 1000 : 0);
  if (dayDone()) startCountdown();

  revealDone.then(() => {
    if (myAttempt === attempt) fitRings([{ center, radiusKm: puzzle.radiusKm * 1.3 }], animate ? 800 : 0);
  });

  // The green ring is the player's own (if it hit the target) or the closest
  // one that does. If that ring doesn't also do the quest, find the closest
  // ring that hits the target AND does the quest, and show it in gold.
  const q = quest;
  const qa = $("quest-answer");
  if (q) {
    qa.hidden = false;
    qa.classList.add("searching");
    qa.textContent = t("questSearching");
  }
  const questCheck = (greenDone: Promise<boolean>) => {
    if (!q) return;
    greenDone
      .catch(() => false)
      .then((ok) => {
        if (myAttempt !== attempt) return;
        if (ok) qa.hidden = true;
        else findQuestAnswer(r, q, myAttempt, animate);
      });
  };

  if (r.accuracy >= MATCH_ACCURACY) {
    setAnswerLine("found");
    questCheck(Promise.resolve(!!r.questDone));
    return;
  }
  setAnswerLine("searching");
  findClosestAnswer(center, puzzle.radiusKm, puzzle.target, readBlock)
    .then((res) => {
      if (myAttempt !== attempt) return;
      showAnswer(r, res, animate);
      // (a best miss isn't a correct ring, so the quest still gets its own)
      questCheck(q && res.answer ? questOkAt(q, res.answer.center) : Promise.resolve(false));
    })
    .catch((e) => {
      console.error(e);
      if (myAttempt === attempt) setAnswerLine("error");
      questCheck(Promise.resolve(false));
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
  setCenters([...centerPoints.filter((p) => p.kind !== "answer"), { kind: "answer", at: a.center }]);
  const myAttempt = attempt;
  revealDone.then(() => {
    if (myAttempt === attempt) fitShown(animate ? 1200 : 0);
  });
}

/** Does a ring here do the quest? (Reads the land / country / height data it needs.) */
async function questOkAt(q: Quest, center: LngLat): Promise<boolean> {
  const r = puzzle.radiusKm;
  const blank = { center: 0, touchesSea: false, touchesMainland: false, touchesIsland: false, continents: new Set<never>(), seaShare: 0, seas: new Set<number>() };
  if (GEOMETRY_ONLY.has(q.kind)) return questDone(q, blank, center, r);
  if (q.kind === "country") return questDone(q, blank, center, r, countryAt(await readCountryBlock(center, 3), center));
  if (q.kind === "high") return questDone(q, blank, center, r, null, await highestInRing(center, r));
  const seaAt = q.kind === "touchSea" ? await loadSeaLookup() : undefined;
  return questDone(q, surveyRing(await readLandBlock(center, r), center, r, seaAt), center, r);
}

/**
 * When the green ring doesn't do the quest: find the closest ring that hits
 * the target (within 5%) and does it, searching around the player's ring
 * first, then around places that suit the quest (nearest first). If none is
 * that close, show the ring that does the quest and comes closest to the
 * target, with how close it gets: there's always a gold ring.
 */
async function findQuestAnswer(r: Result, q: Quest, myAttempt: number, animate: boolean) {
  const el = $("quest-answer");
  el.hidden = false;
  el.classList.add("searching");
  el.textContent = t("questSearching");
  const player = { lng: r.lng, lat: r.lat };
  const anchors = questAnchors(q, player);
  const origins = [player, ...anchors].slice(0, 7);
  const accept = (c: LngLat) => questOkAt(q, c).catch(() => false);
  let found: { center: LngLat; accuracy: number } | null = null;
  let fallback: { center: LngLat; accuracy: number } | null = null;
  const consider = (a: { center: LngLat; accuracy: number } | null) => {
    if (a && (!fallback || a.accuracy > fallback.accuracy)) fallback = a;
  };
  try {
    for (const [i, origin] of origins.entries()) {
      // right around the player's ring first (just the nearest area), then the quest's places
      const res = await findClosestAnswer(origin, puzzle.radiusKm, puzzle.target, readBlock, accept, i === 0 ? 1 : 3);
      if (myAttempt !== attempt) return;
      if (res.answer) {
        found = res.answer;
        break;
      }
      consider(res.best);
    }
    // last resort: a ring right on one of the quest's places
    if (!found && !fallback) {
      for (const a of anchors) {
        if (!(await accept(a))) continue;
        consider({ center: a, accuracy: accuracy(await populationInRing(a, puzzle.radiusKm), puzzle.target) });
        if (myAttempt !== attempt) return;
      }
    }
  } catch (e) {
    console.error(e);
  }
  if (myAttempt !== attempt) return;
  el.classList.remove("searching");
  const shown = found ?? fallback;
  if (!shown) {
    el.hidden = true; // (only if the data couldn't load at all)
    return;
  }
  const where = t("away", { km: fmt(haversineKm(player, shown.center)) });
  const label = found ? t("questSample") : t("questSampleNear", { acc: shown.accuracy.toFixed(0) });
  showPlace(el, shown.center, myAttempt, `${label}${where} · `);
  setData("quest-answer", circleFeature(shown.center, puzzle.radiusKm));
  setCenters([...centerPoints.filter((p) => p.kind !== "quest"), { kind: "quest", at: shown.center }]);
  revealDone.then(() => {
    if (myAttempt === attempt) fitShown(animate ? 1200 : 0);
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

// ---- the end of a ring: next ring, or the day's total ----
/**
 * After rings 1 and 2: a Next ring button. Once all three are played: the
 * day's rings and total out of 330, the share button and the countdown.
 */
function renderDayEnd() {
  const done = dayDone();
  $("next-btn").hidden = stage === 2 || !results[stage];
  $("share-btn").hidden = !done || PRACTICE;
  $("practice-btn").hidden = !done || UNLIMITED;
  $("replay-btn").hidden = !done || UNLIMITED;
  // a finished day: Share and the countdown, then Other maps and Practice on a row of their own
  document.querySelector(".actions")!.classList.toggle("day-done", done && !UNLIMITED);
  $("next-info").hidden = !done || UNLIMITED;
  // a finished day: the streak (all three rings, days in a row), which opens the stats
  const streak = done && !UNLIMITED ? currentStats().currentStreak : 0;
  $("streak-line").hidden = !streak;
  if (streak) $("streak-line").textContent = `${t("streakLine", { n: streak })} · ${t("seeStats")}`;
  $("day-summary").hidden = !done;
  if (!done) return;
  const rows = results.map((r, i) =>
    Object.assign(document.createElement("li"), {
      innerHTML: `<span>${t("ringN", { n: i + 1 })}</span> <span>${r!.emoji}</span> <span><strong>${fmtPoints(r!.points)}</strong> / ${STAGES[i].max}</span>`,
    }),
  );
  $("day-rows").replaceChildren(...rows);
  const total = results.reduce((n, r) => n + (r?.points ?? 0), 0);
  $("day-total").textContent = `${results.map((r) => r!.emoji).join("")} ${fmtPoints(total)} / ${STAGES.reduce((n, st) => n + st.max, 0)}`;
}

/** Back to placing a ring (the current stage's), on the day's map. */
function resetPlay() {
  attempt++;
  locked = null;
  clearLockAnimation();
  $("result-panel").hidden = true;
  $("play-panel").hidden = false;
  setResultLayout(false);
  setCollapsed(false, false);
  lastBounds = null;
  $("crosshair").classList.remove("hidden");
  lockBtn.disabled = false;
  lockBtn.classList.remove("counting");
  lockBtn.setAttribute("aria-label", t("lockIn"));
  setData("answer", EMPTY);
  setData("quest-answer", EMPTY);
  $("quest-answer").hidden = true;
  setAnswerLine("hide");
  setCenters([]);
  document.body.classList.remove("explored");
  const want = ringMap(stage);
  if (difficulty !== want || revealed) {
    difficulty = want;
    styleSwap = applyMapStyle(map, difficulty, LANG, gameLayers);
  }
  revealed = false;
  $("reveal-snap").hidden = true;
  refreshHints();
  updateRing();
}

let styleSwap: Promise<void> = Promise.resolve(); // the last base-map switch (resetPlay)
let switching = false;

/**
 * Start ring `st` of the current day: the results slide away, the camera
 * flies back out to the whole globe, then the next ring's map fades in over
 * the old one.
 */
async function startRing(st: Stage) {
  if (switching) return;
  switching = true;
  const snap = $<HTMLCanvasElement>("reveal-snap");
  try {
    setInteractive(false);
    attempt++; // drop the last ring's pending searches (they'd re-frame the map)
    $("result-panel").hidden = true;
    setChallengeCollapsed(false); // a new ring: show its quest
    setResultLayout(false);
    // (the layout padding changes next, and that would cut a camera move short)
    await revealDone;
    await sleep(30);
    applyLayoutPadding();
    // 1. back out to the globe (the rings shrink away with the map)
    const FLY_MS = 1500;
    map.flyTo({ zoom: wholeGlobeZoom(), duration: FLY_MS, curve: 1.3, essential: true });
    await sleep(FLY_MS + 50);
    // clear the last ring's rings and dots (mine, the green answer, the gold one)
    // and let the map redraw, so only the new ring's dot shows from here on
    setData("answer", EMPTY);
    setData("quest-answer", EMPTY);
    setCenters([]);
    overlay.style.display = "none";
    await Promise.race([new Promise<void>((r) => map.once("idle", () => r())), sleep(600)]);
    map.triggerRepaint();
    await Promise.race([new Promise<void>((r) => map.once("idle", () => r())), sleep(400)]);
    // 2. the next ring's map ripples out from the centre, like the answer reveal
    const c = map.project(map.getCenter());
    await rippleTo({ x: c.x, y: c.y }, () => {
      stage = st;
      puzzle = rings[st];
      quest = questFor(puzzle);
      renderPuzzle();
      resetPlay();
      return styleSwap;
    });
  } catch (e) {
    console.error(e);
  } finally {
    snap.hidden = true;
    switching = false;
    setInteractive(true);
  }
}

/** Copy the map's current frame onto a canvas (for the reveal wipe and ring switches). */
function snapshotTo(snap: HTMLCanvasElement): Promise<void> {
  const src = map.getCanvas();
  snap.width = src.width;
  snap.height = src.height;
  // Without preserveDrawingBuffer the WebGL canvas can only be copied inside
  // the frame that drew it, so grab it from a render event.
  return new Promise<void>((resolve) => {
    map.once("render", () => {
      snap.getContext("2d")!.drawImage(src, 0, 0);
      resolve();
    });
    map.triggerRepaint();
  });
}

$("next-btn").addEventListener("click", () => {
  if (stage < 2 && results[stage]) startRing((stage + 1) as Stage);
});

// test mode: retry this ring, or a brand-new random day
$("again-btn").addEventListener("click", () => {
  results[stage] = null;
  resetPlay();
});
$("new-btn").addEventListener("click", async () => {
  if (switching) return;
  practice = true;
  day = randomDay();
  rings = dayRings(day);
  results = [null, null, null];
  dayMap = await pickMap(); // a new day: pick its map
  startRing(0);
});

// ---- sharing: the whole day ("MapRinger #3 · 🎯🌙🟠 263/330") ----
$("share-btn").addEventListener("click", async () => {
  const played = results.filter((r): r is Result => !!r);
  if (!played.length) return;
  // "MapRinger #3 · Hard map" (days from before the map pick: no map)
  const m = played[0].map;
  const title = (n: number) => t("shareTitle", { n }) + (m ? ` · ${t("shareMap", { map: DIFFICULTIES[m].label })}` : "");
  const text = shareText(day, played, location.origin + location.pathname, title, t("ptsUnit"));
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

// ---- stats (from the rings saved in this browser) and practice ----
function currentStats() {
  return computeStats(loadAllDays(), todaysNumber());
}
const statsDialog = $<HTMLDialogElement>("stats-dialog");
function openStats() {
  renderStats($("stats-body"), currentStats());
  statsDialog.showModal();
}
$("stats-btn").addEventListener("click", openStats);
$("streak-line").addEventListener("click", openStats);
$("stats-close").addEventListener("click", () => statsDialog.close());

// ---- Game Rabbit accounts (cloud.ts): stats kept in the account, on any device ----
function renderAccount() {
  const a = currentAccount();
  $("account-text").textContent = a ? t("statsSignedIn", { email: a.email }) : t("statsLocal");
  const btn = $("account-btn");
  btn.hidden = !cloudEnabled;
  btn.textContent = a ? t("signOut") : t("signInToKeep");
  // the map picker (the start of each day): guest + sign in, or who's signed in
  $("pick-account").hidden = !cloudEnabled || UNLIMITED; // (practice and test mode save nothing)
  $("pick-account-text").textContent = a ? t("pickSignedIn", { email: a.email }) : t("pickGuest");
  $("pick-signin").hidden = $("pick-account-end").hidden = !!a;
}
$("pick-signin").addEventListener("click", () => openSignIn());
$("account-btn").addEventListener("click", async () => {
  if (!currentAccount()) return openSignIn();
  await signOut();
  toast(t("signedOutToast"));
});

const signInDialog = $<HTMLDialogElement>("signin-dialog");
const emailForm = $<HTMLFormElement>("email-form");
const codeForm = $<HTMLFormElement>("code-form");
const emailInput = $<HTMLInputElement>("signin-email");
const codeInput = $<HTMLInputElement>("signin-code");
function signInError(msg: string | null) {
  $("signin-error").hidden = !msg;
  $("signin-error").textContent = msg ?? "";
}
function showCodeStep(on: boolean) {
  emailForm.hidden = on;
  codeForm.hidden = !on;
  $("google-btn").hidden = $("signin-or").hidden = on || !googleOn;
  signInError(null);
  if (on) {
    $("code-sent").textContent = t("codeSent", { email: emailInput.value.trim() });
    codeInput.value = "";
    codeInput.focus();
    startResendWait();
  } else stopResendWait();
}

// waiting for the code: "Send a new code in 60 s", then a button; the spam hint after a few seconds
const RESEND_S = 60;
const SPAM_HINT_MS = 10_000;
let resendTimer: number | undefined;
let spamTimer: number | undefined;
function stopResendWait() {
  clearInterval(resendTimer);
  clearTimeout(spamTimer);
  $("code-help").hidden = true;
}
function startResendWait() {
  stopResendWait();
  const btn = $<HTMLButtonElement>("resend-btn");
  const until = Date.now() + RESEND_S * 1000;
  const tick = () => {
    const s = Math.ceil((until - Date.now()) / 1000);
    btn.disabled = s > 0;
    btn.textContent = s > 0 ? t("resendIn", { s }) : t("resend");
    if (s <= 0) clearInterval(resendTimer);
  };
  tick();
  resendTimer = window.setInterval(tick, 1000);
  spamTimer = window.setTimeout(() => ($("code-help").hidden = false), SPAM_HINT_MS);
}
$("resend-btn").addEventListener("click", () =>
  busy(codeForm, async () => {
    try {
      await sendCode(emailInput.value.trim());
      signInError(null);
      toast(t("codeResent"));
    } catch (err) {
      console.warn(err);
      signInError(t("sendFailed"));
    }
  }).finally(startResendWait),
);
signInDialog.addEventListener("close", stopResendWait);
let googleOn = false;
function openSignIn() {
  showCodeStep(false);
  signInDialog.showModal();
  googleEnabled().then((on) => {
    googleOn = on;
    if (!codeForm.hidden) return;
    $("google-btn").hidden = $("signin-or").hidden = !on;
  });
}
/** Disable a form's buttons while its request runs. */
async function busy(form: HTMLFormElement, work: () => Promise<void>) {
  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await work();
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
emailForm.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(emailForm, async () => {
    try {
      await sendCode(emailInput.value.trim());
      showCodeStep(true);
    } catch (err) {
      console.warn(err);
      signInError(t("sendFailed"));
    }
  });
});
codeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(codeForm, async () => {
    try {
      await verifyCode(emailInput.value.trim(), codeInput.value.trim());
      signInDialog.close();
      toast(t("signedInToast"));
    } catch (err) {
      console.warn(err);
      signInError(t("signInFailed"));
    }
  });
});
$("code-back").addEventListener("click", () => showCodeStep(false));
$("google-btn").addEventListener("click", () => signInWithGoogle().catch((err) => (console.warn(err), signInError(t("sendFailed")))));
$("signin-close").addEventListener("click", () => signInDialog.close());

onAccount(() => {
  renderAccount();
  if (statsDialog.open) renderStats($("stats-body"), currentStats());
  if (!$("result-panel").hidden) renderDayEnd(); // (the streak line)
});
startCloud((days) => {
  // rings from the account (e.g. played on another device): today's change the
  // game itself, so start over from them (unless a ring is being locked in)
  if (!UNLIMITED && days.includes(day) && !lockingAt) return location.reload();
  if (statsDialog.open) renderStats($("stats-body"), currentStats());
  if (!$("result-panel").hidden) renderDayEnd(); // (the streak line)
});

/**
 * Into practice (a fresh page with ?practice; with `replayDay`, that day's
 * rings again, on a map picked afresh) or back to the day's real rings.
 */
function goPractice(on: boolean, replayDay?: number) {
  const url = new URL(location.href);
  for (const k of ["practice", "day", "unlimited"]) url.searchParams.delete(k);
  if (on) url.searchParams.set("practice", "");
  if (on && replayDay) url.searchParams.set("day", String(replayDay));
  // (the dev server plays test mode by default: back to today's rings means the real ones)
  if (!on && import.meta.env.DEV) url.searchParams.set("unlimited", "0");
  location.href = url.toString();
}
$("replay-btn").addEventListener("click", () => goPractice(true, day));
$("practice-btn").addEventListener("click", () => goPractice(true));
$("stats-practice").addEventListener("click", () => goPractice(true));
$("today-btn").addEventListener("click", () => goPractice(false));

// ---- help ----
const helpDialog = $<HTMLDialogElement>("help-dialog");
$("help-btn").addEventListener("click", () => helpDialog.showModal());

/**
 * How-to-play demo: a 7 s clip recorded from the real game (day 1, ring 1 on the
 * satellite map: spin the globe,
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
$("lang-btn").addEventListener("click", () => {
  const c = map.getCenter();
  const keep: CarryOver = { camera: { center: [c.lng, c.lat], zoom: map.getZoom() } };
  if (UNLIMITED) keep.test = { day, practice, stage, results, map: dayMap };
  try {
    sessionStorage.setItem(CARRY_KEY, JSON.stringify(keep));
  } catch {
    /* storage unavailable: the switch still works, from a fresh start */
  }
  switchLanguage();
});
$("help-close").addEventListener("click", () => helpDialog.close());
try {
  if (!localStorage.getItem("mapringer:seen-help")) {
    helpDialog.showModal();
    localStorage.setItem("mapringer:seen-help", "1");
  }
} catch {
  /* storage unavailable */
}

// ---- the day's map: picked once, at the start of the day ----
const mapDialog = $<HTMLDialogElement>("map-dialog");
// a map has to be picked: Esc doesn't skip it (closedby="none" in the HTML;
// browsers without that can still close it, so it reopens)
let picking = false;
mapDialog.addEventListener("cancel", (e) => e.preventDefault());
mapDialog.addEventListener("close", () => {
  if (picking) openPicker();
  else $("pick-shade").hidden = true;
});
/**
 * Not a modal: the header (language, stats, help) stays usable while picking.
 * A shade under the picker covers the game below the header instead.
 */
function openPicker() {
  $("pick-shade").hidden = false;
  mapDialog.show();
}

/** Ask which map to play the day on. */
function pickMap(): Promise<Difficulty> {
  return new Promise((resolve) => {
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-map]");
      if (!btn) return;
      mapDialog.removeEventListener("click", onClick);
      picking = false;
      document.body.classList.remove("picking-map");
      mapDialog.close();
      resolve(btn.dataset.map as Difficulty);
    };
    mapDialog.addEventListener("click", onClick);
    picking = true;
    document.body.classList.add("picking-map");
    openPicker();
  });
}

if (!dayMap && !dayDone()) {
  // no ring until there's a map to play it on (also under a first visit's how-to-play)
  document.body.classList.add("picking-map");
  const ask = () =>
    pickMap().then((d) => {
      dayMap = d;
      if (!UNLIMITED) {
        saveDayMap(day, d);
        pushDayMap(day, d);
      }
      if (difficulty !== d) {
        difficulty = d;
        styleSwap = applyMapStyle(map, d, LANG, gameLayers);
      }
      renderPuzzle();
    });
  // first visit: the how-to-play comes first
  if (helpDialog.open) helpDialog.addEventListener("close", ask, { once: true });
  else ask();
}

/**
 * Haptics where the browser allows it (Android Chrome and others; iPhones'
 * Safari has no vibration API, so there it's just the glow).
 */
function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

let toastTimer: number | undefined;
function toast(msg: string) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2500);
}
