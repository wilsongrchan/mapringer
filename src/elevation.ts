import { haversineKm, KM_PER_DEG, type LngLat } from "./geo";

/**
 * Ground height for "reach ground above N m" quests, read at lock-in from the
 * free AWS / Mapzen Terrain Tiles (Terrarium PNGs, Web Mercator, 256 px):
 * only the few tiles under the ring, at a zoom that suits its size.
 * Nothing is drawn on the map.
 */
export const TILE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const EARTH_KM = 40_075;
const MAX_LAT = 85;

/** Metres above sea level from a Terrarium pixel. */
export const terrariumHeight = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/**
 * Tile zoom for a ring: pixels about 1/100 of the radius (≥150 m), so a ring
 * spans a handful of tiles. Tiles cover less ground towards the poles.
 */
export function zoomFor(radiusKm: number, lat = 0): number {
  const ground = EARTH_KM * Math.cos((Math.min(MAX_LAT, Math.abs(lat)) * Math.PI) / 180);
  return Math.max(2, Math.min(10, Math.round(Math.log2((ground * 100) / (256 * radiusKm)))));
}

const lngToX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) => {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const xToLng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const yToLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** The tiles (x may run past the 180° line; wrap it when fetching) covering a ring. */
export function tilesFor(center: LngLat, radiusKm: number, z: number): { x: number; y: number }[] {
  const latR = radiusKm / KM_PER_DEG;
  const widest = Math.min(89, Math.abs(center.lat) + latR);
  const lngR = Math.min(180, radiusKm / (KM_PER_DEG * Math.cos((widest * Math.PI) / 180)));
  const x0 = Math.floor(lngToX(center.lng - lngR, z));
  const x1 = Math.floor(lngToX(center.lng + lngR, z));
  const y0 = Math.max(0, Math.floor(latToY(center.lat + latR, z)));
  const y1 = Math.min(2 ** z - 1, Math.floor(latToY(center.lat - latR, z)));
  const out: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

async function tilePixels(z: number, x: number, y: number): Promise<Uint8ClampedArray> {
  const n = 2 ** z;
  const url = TILE_URL.replace("{z}", `${z}`).replace("{x}", `${((x % n) + n) % n}`).replace("{y}", `${y}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`elevation tile ${res.status}`);
  // no colour management: the RGB values are the data
  const img = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height).data;
}

/** The highest ground (m) inside the ring. Sea counts as 0 m. */
export async function highestInRing(center: LngLat, radiusKm: number): Promise<number> {
  const z = zoomFor(radiusKm, center.lat);
  const tiles = tilesFor(center, radiusKm, z);
  const all = await Promise.all(tiles.map((t) => tilePixels(z, t.x, t.y)));
  let best = 0;
  tiles.forEach(({ x, y }, i) => {
    const px = all[i];
    for (let py = 0; py < 256; py++) {
      const lat = yToLat(y + (py + 0.5) / 256, z);
      if (Math.abs(lat - center.lat) * KM_PER_DEG > radiusKm) continue;
      for (let pxl = 0; pxl < 256; pxl++) {
        const k = (py * 256 + pxl) * 4;
        const h = terrariumHeight(px[k], px[k + 1], px[k + 2]);
        if (h <= best) continue;
        if (haversineKm(center, { lat, lng: xToLng(x + (pxl + 0.5) / 256, z) }) <= radiusKm) best = h;
      }
    }
  });
  return Math.round(best);
}
