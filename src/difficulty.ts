import type * as maplibregl from "maplibre-gl";
import { t, type Lang } from "./i18n";

export type Difficulty = "easy" | "standard" | "hard";

export const DIFFICULTIES: Record<Difficulty, { label: string; multiplier: number; blurb: string }> = {
  easy: { label: t("diffEasy"), multiplier: 0.8, blurb: t("blurbEasy") },
  standard: { label: t("diffStandard"), multiplier: 1, blurb: t("blurbStandard") },
  hard: { label: t("diffHard"), multiplier: 1.2, blurb: t("blurbHard") },
};

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "standard", "hard"];

const OFM = "https://tiles.openfreemap.org/styles";

type StyleSpec = maplibregl.StyleSpecification;
type LayerSpec = maplibregl.LayerSpecification;

const srcLayer = (l: LayerSpec) => ("source-layer" in l ? l["source-layer"] : undefined);

/**
 * Easy: satellite imagery with country borders and place / water names on top
 * (a "hybrid" view), built from the Liberty style's label and border layers.
 */
function satellite(style: StyleSpec): StyleSpec {
  const labels = style.layers
    .filter(
      (l) =>
        (l.type === "line" && srcLayer(l) === "boundary") ||
        (l.type === "symbol" && (srcLayer(l) === "place" || srcLayer(l) === "water_name")),
    )
    .map((l): LayerSpec => {
      if (l.type === "line") return { ...l, paint: { ...l.paint, "line-color": "rgba(255,255,255,0.75)" } };
      if (l.type === "symbol")
        return {
          ...l,
          paint: { ...l.paint, "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.8)", "text-halo-width": 1.5 },
        };
      return l;
    });
  return {
    ...style,
    sources: {
      ...style.sources,
      "mr-satellite": {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 18,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [{ id: "mr-satellite", type: "raster", source: "mr-satellite" }, ...labels],
  };
}

/** Standard: the light Positron map without roads, railways or airports. */
const ROAD_LAYERS = new Set(["transportation", "transportation_name", "aeroway", "aerodrome_label"]);
function noRoads(style: StyleSpec): StyleSpec {
  return { ...style, layers: style.layers.filter((l) => !ROAD_LAYERS.has(srcLayer(l) ?? "")) };
}

/**
 * Hard: only land, sea, lakes and rivers. Labels, borders, roads, buildings
 * and residential shading all give away where people live.
 */
function blank(style: StyleSpec): StyleSpec {
  const keep = (l: LayerSpec) =>
    l.type === "background" ||
    (l.type === "fill" && srcLayer(l) === "water") ||
    (l.type === "line" && srcLayer(l) === "waterway");
  return { ...style, layers: style.layers.filter(keep) };
}

/**
 * Chinese map labels: prefer Traditional Chinese names, then Chinese, then
 * the local name. (OpenMapTiles carries name:zh-Hant / name:zh where OSM has them.)
 */
const LABEL_LAYERS = new Set(["place", "water_name", "waterway"]);
function chineseLabels(style: StyleSpec): StyleSpec {
  return {
    ...style,
    layers: style.layers.map((l): LayerSpec => {
      if (l.type !== "symbol" || !LABEL_LAYERS.has(srcLayer(l) ?? "")) return l;
      return {
        ...l,
        layout: {
          ...l.layout,
          "text-field": ["coalesce", ["get", "name:zh-Hant"], ["get", "name:zh"], ["get", "name"]],
        },
      };
    }),
  };
}

/**
 * Every style is shown on a spinnable globe: no Mercator stretching near the
 * poles, and a ring looks the same size wherever it is. MapLibre switches to a
 * flat map by itself once you zoom in close.
 */
export const GLOBE = { type: "globe" } as const;
function globe(style: StyleSpec): StyleSpec {
  return {
    ...style,
    projection: GLOBE,
    // a soft atmosphere glow around the globe, fading out as you zoom in
    sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 1, 6, 0] },
  };
}

/**
 * After locking in on Hard or Standard, lift the "fog of war": switch to the
 * full-colour Liberty map (blue water, yellow roads, green forests, all labels).
 */
export function applyRevealStyle(map: maplibregl.Map, lang: Lang = "en"): void {
  const localise = lang === "zh" ? chineseLabels : (s: StyleSpec) => s;
  map.setStyle(`${OFM}/liberty`, { diff: false, transformStyle: (_prev, next) => globe(localise(next)) });
}

export function applyMapStyle(map: maplibregl.Map, d: Difficulty, lang: Lang = "en"): void {
  const url = d === "easy" ? `${OFM}/liberty` : `${OFM}/positron`;
  const transform = d === "easy" ? satellite : d === "hard" ? blank : noRoads;
  const localise = lang === "zh" ? chineseLabels : (s: StyleSpec) => s;
  map.setStyle(url, { diff: false, transformStyle: (_prev, next) => globe(localise(transform(next))) });
}

export function loadDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem("mapringer:difficulty");
    if (d === "easy" || d === "standard" || d === "hard") return d;
  } catch {
    /* storage unavailable */
  }
  return "standard";
}

export function saveDifficulty(d: Difficulty): void {
  try {
    localStorage.setItem("mapringer:difficulty", d);
  } catch {
    /* storage unavailable */
  }
}
