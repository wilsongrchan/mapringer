import * as maplibregl from "maplibre-gl";
import mlcontour from "maplibre-contour";
import { t, type Lang } from "./i18n";

export type Difficulty = "easy" | "standard" | "hard";

/** The map each of the day's rings is played on: ring 1 Easy, ring 2 Standard, ring 3 Hard. */
export const DIFFICULTIES: Record<Difficulty, { label: string; blurb: string }> = {
  easy: { label: t("diffEasy"), blurb: t("blurbEasy") },
  standard: { label: t("diffStandard"), blurb: t("blurbStandard") },
  hard: { label: t("diffHard"), blurb: t("blurbHard") },
};

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
 * Elevation contours on the Standard and Hard maps: a line every 500 m, a
 * bolder, labelled one every 1,000 m, on land only (no sea-depth lines).
 * Drawn in the browser from the free AWS / Mapzen Terrain Tiles.
 */
const dem = new mlcontour.DemSource({
  url: "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
  encoding: "terrarium",
  maxzoom: 10,
  worker: true,
});
dem.setupMaplibre(maplibregl);
const CONTOUR_TILES = dem.contourProtocolUrl({ thresholds: { 0: [500, 1000] }, elevationKey: "ele", levelKey: "level", contourLayer: "contours" });

function contours(style: StyleSpec): StyleSpec {
  const onLand: maplibregl.FilterSpecification = [">", ["get", "ele"], 0];
  return {
    ...style,
    sources: {
      ...style.sources,
      "mr-contours": {
        type: "vector",
        tiles: [CONTOUR_TILES],
        maxzoom: 11,
        attribution: "Elevation: Mapzen Terrain Tiles (SRTM, GMTED, ETOPO1)",
      },
    },
    layers: [
      ...style.layers,
      {
        id: "mr-contour-lines",
        type: "line",
        source: "mr-contours",
        "source-layer": "contours",
        filter: onLand,
        paint: {
          "line-color": "#9a7b55",
          "line-opacity": ["match", ["get", "level"], 1, 0.6, 0.35],
          "line-width": ["match", ["get", "level"], 1, 1.1, 0.6],
        },
      },
      {
        id: "mr-contour-labels",
        type: "symbol",
        source: "mr-contours",
        "source-layer": "contours",
        filter: ["all", onLand, [">", ["get", "level"], 0]],
        minzoom: 4,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 400,
          "text-size": 10,
          "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"],
          "text-font": ["Noto Sans Regular"],
        },
        paint: { "text-color": "#7a5c38", "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.2 },
      },
    ],
  };
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

/** The game's own sources and layers (ring, answer, quest line…), on top of any base map. */
export type GameLayers = () => { sources: StyleSpec["sources"]; layers: LayerSpec[] };

// Each base style is fetched once; switching difficulty then reuses it.
const styleCache = new Map<string, Promise<StyleSpec>>();
function baseStyle(url: string): Promise<StyleSpec> {
  let p = styleCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`style ${r.status}`);
      return r.json() as Promise<StyleSpec>;
    });
    p.catch(() => styleCache.delete(url)); // allow a retry
    styleCache.set(url, p);
  }
  return p;
}

/** Start downloading the styles we'll switch to, so the first switch is quick. */
export function prefetchStyles(): void {
  for (const name of ["positron", "liberty"]) baseStyle(`${OFM}/${name}`).catch(() => {});
}

let styleRequest = 0; // a newer switch wins over a slower, older one

/**
 * Swap the base map. All our styles share the same OpenMapTiles source, so
 * the change is applied as a diff: tiles already loaded are kept and only the
 * layers change, instead of tearing the whole map down and refetching it.
 * Resolves once the new style has been handed to the map.
 */
async function swapStyle(map: maplibregl.Map, url: string, transform: (s: StyleSpec) => StyleSpec, lang: Lang, game: GameLayers, diff = true): Promise<void> {
  const req = ++styleRequest;
  const base = structuredClone(await baseStyle(url));
  if (req !== styleRequest) return;
  const localise = lang === "zh" ? chineseLabels : (s: StyleSpec) => s;
  const style = globe(localise(transform(base)));
  const own = game();
  style.sources = { ...style.sources, ...own.sources };
  style.layers = [...style.layers, ...own.layers];
  map.setStyle(style, { diff });
}

/**
 * After locking in on Hard or Standard, lift the "fog of war": switch to the
 * full-colour Liberty map (blue water, yellow roads, green forests, all labels).
 */
export function applyRevealStyle(map: maplibregl.Map, lang: Lang, game: GameLayers): Promise<void> {
  return swapStyle(map, `${OFM}/liberty`, (s) => s, lang, game);
}

export function applyMapStyle(map: maplibregl.Map, d: Difficulty, lang: Lang, game: GameLayers, diff = true): Promise<void> {
  const url = d === "easy" ? `${OFM}/liberty` : `${OFM}/positron`;
  const transform = d === "easy" ? satellite : d === "hard" ? (s: StyleSpec) => contours(blank(s)) : (s: StyleSpec) => contours(noRoads(s));
  return swapStyle(map, url, transform, lang, game, diff);
}
