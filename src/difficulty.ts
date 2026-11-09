import type * as maplibregl from "maplibre-gl";

export type Difficulty = "easy" | "standard" | "hard";

export const DIFFICULTIES: Record<Difficulty, { label: string; multiplier: number; blurb: string }> = {
  easy: { label: "Easy", multiplier: 0.8, blurb: "Satellite with labels and borders" },
  standard: { label: "Standard", multiplier: 1, blurb: "Light map with labels, no roads" },
  hard: { label: "Hard", multiplier: 1.2, blurb: "Land, lakes and rivers only" },
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

export function applyMapStyle(map: maplibregl.Map, d: Difficulty): void {
  const url = d === "easy" ? `${OFM}/liberty` : `${OFM}/positron`;
  const transform = d === "easy" ? satellite : d === "hard" ? blank : noRoads;
  map.setStyle(url, { diff: false, transformStyle: (_prev, next) => transform(next) });
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
