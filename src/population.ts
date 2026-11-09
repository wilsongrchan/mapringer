import { fromUrl, type GeoTIFFImage } from "geotiff";
import { circleWindows, sumCircle, type Block, type GridInfo, type LngLat } from "./geo";

const BASE = import.meta.env.VITE_POPULATION_BASE_URL ?? `${import.meta.env.BASE_URL}data/`;
/** 30 arc-second (~1 km) grid, and a 10x coarser (~10 km) grid of summed cells. */
const FINE_URL = `${BASE}population.tif`;
const COARSE_URL = `${BASE}population_10x.tif`;
/** Rings at least this big are counted on the coarse grid. */
export const COARSE_FROM_KM = 100;

type Source = { image: GeoTIFFImage; grid: GridInfo };
const sources = new Map<string, Promise<Source>>();

function load(url: string): Promise<Source> {
  let p = sources.get(url);
  if (!p) {
    p = (async () => {
      const tiff = await fromUrl(url, { allowFullFile: false });
      const image = await tiff.getImage();
      const [originLng, originLat] = image.getOrigin();
      const [res] = image.getResolution();
      return { image, grid: { originLng, originLat, res, width: image.getWidth(), height: image.getHeight() } };
    })();
    p.catch(() => sources.delete(url)); // allow a retry
    sources.set(url, p);
  }
  return p;
}

const sourceFor = (ringKm: number) => load(ringKm >= COARSE_FROM_KM ? COARSE_URL : FINE_URL);

/** Start fetching the file headers early so the first count is quick. */
export function preloadPopulation(): void {
  load(FINE_URL).catch(() => {});
  load(COARSE_URL).catch(() => {});
}

/**
 * Read every grid cell within `radiusKm` of `center` into one in-memory block,
 * at the resolution used for rings of size `ringKm`.
 */
export async function readBlock(center: LngLat, radiusKm: number, ringKm: number): Promise<Block> {
  const { image, grid } = await sourceFor(ringKm);
  const segments = circleWindows(grid, center, radiusKm);
  if (!segments.length) return { grid, row0: 0, col0: 0, rows: 0, cols: 0, values: new Float32Array(0) };
  const { row0, rows } = segments[0].window;
  const cols = segments.reduce((n, s) => n + s.window.cols, 0);
  const values = new Float32Array(rows * cols);
  let offset = 0;
  for (const s of segments) {
    const w = s.window;
    const data = (await image.readRasters({
      window: [w.col0, w.row0, w.col0 + w.cols, w.row0 + w.rows],
      samples: [0],
      interleave: true,
    })) as unknown as ArrayLike<number>;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < w.cols; c++) values[r * cols + offset + c] = data[r * w.cols + c];
    }
    offset += w.cols;
  }
  return { grid, row0, col0: segments[0].logicalCol0, rows, cols, values };
}

/** Estimated number of people living within `radiusKm` of `center` (GHSL 2025). */
export async function populationInRing(center: LngLat, radiusKm: number): Promise<number> {
  const { image, grid } = await sourceFor(radiusKm);
  let total = 0;
  for (const segment of circleWindows(grid, center, radiusKm)) {
    const { col0, row0, cols, rows } = segment.window;
    const rasters = await image.readRasters({
      window: [col0, row0, col0 + cols, row0 + rows],
      samples: [0],
      interleave: true,
    });
    total += sumCircle(grid, center, radiusKm, segment, rasters as unknown as ArrayLike<number>);
  }
  return total;
}
