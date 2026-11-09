export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_DEG = (Math.PI * EARTH_RADIUS_KM) / 180;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface LngLat {
  lng: number;
  lat: number;
}

/** Great-circle distance in km. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point reached travelling `distKm` from `start` on initial bearing `bearingDeg`. */
export function destination(start: LngLat, distKm: number, bearingDeg: number): LngLat {
  const δ = distKm / EARTH_RADIUS_KM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(start.lat);
  const λ1 = toRad(start.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

/**
 * Geodesic circle as a ring of [lng, lat] coordinates for GeoJSON.
 * Longitudes are kept continuous around the centre (not wrapped to ±180)
 * so MapLibre draws rings across the antimeridian correctly.
 */
export function circleRing(center: LngLat, radiusKm: number, steps = 128): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, radiusKm, (360 * i) / steps);
    let lng = p.lng;
    while (lng - center.lng > 180) lng -= 360;
    while (lng - center.lng < -180) lng += 360;
    coords.push([lng, p.lat]);
  }
  return coords;
}

/** Geometry of a regular lat/lng grid (row 0 at the top). */
export interface GridInfo {
  originLng: number; // west edge of column 0
  originLat: number; // north edge of row 0
  res: number; // cell size in degrees
  width: number;
  height: number;
}

/** A contiguous rectangle of grid cells to read. */
export interface CellWindow {
  col0: number;
  row0: number;
  cols: number;
  rows: number;
}

/** A logical column (may be outside [0,width) when wrapping) mapped to a window. */
interface ColumnSegment {
  window: CellWindow;
  logicalCol0: number;
}

/**
 * Work out which grid windows a circle touches. Usually one window; two when
 * the circle crosses the antimeridian.
 */
export function circleWindows(grid: GridInfo, center: LngLat, radiusKm: number): ColumnSegment[] {
  const latR = radiusKm / KM_PER_DEG;
  const north = center.lat + latR;
  const south = center.lat - latR;
  const row0 = Math.max(0, Math.floor((grid.originLat - north) / grid.res));
  const row1 = Math.min(grid.height - 1, Math.floor((grid.originLat - south) / grid.res));
  if (row1 < row0) return [];

  const revolution = Math.round(360 / grid.res);
  const maxAbsLat = Math.min(89.9, Math.max(Math.abs(north), Math.abs(south)));
  const lngR = latR / Math.cos(toRad(maxAbsLat));

  let c0: number;
  let c1: number;
  if (north >= 90 || south <= -90 || lngR >= 180) {
    c0 = 0;
    c1 = revolution - 1;
  } else {
    c0 = Math.floor((center.lng - lngR - grid.originLng) / grid.res);
    c1 = Math.floor((center.lng + lngR - grid.originLng) / grid.res);
  }

  const rows = row1 - row0 + 1;
  const segments: ColumnSegment[] = [];
  let logical = c0;
  while (logical <= c1) {
    const actual = ((logical % revolution) + revolution) % revolution;
    const runEnd = Math.min(c1, logical + (Math.min(revolution, grid.width) - actual) - 1);
    const cols = runEnd - logical + 1;
    segments.push({ window: { col0: actual, row0, cols, rows }, logicalCol0: logical });
    logical = runEnd + 1;
  }
  return segments;
}

const SUBSAMPLES = 6; // per axis, for cells straddling the ring edge

/**
 * Sum the population of grid cells inside a circle. Cells cut by the edge are
 * weighted by the fraction of their area inside the circle (assuming people
 * are spread evenly within a cell).
 */
export function sumCircle(
  grid: GridInfo,
  center: LngLat,
  radiusKm: number,
  segment: ColumnSegment,
  values: ArrayLike<number>,
): number {
  const { window: w, logicalCol0 } = segment;
  return sumCore(grid, center, radiusKm, w.row0, logicalCol0, w.cols, values, 0, w.rows - 1, 0, w.cols - 1);
}

/**
 * A block of the grid held in memory. Columns are "logical" (continuous across
 * the antimeridian), so `col0` may be negative or beyond the grid width.
 */
export interface Block {
  grid: GridInfo;
  row0: number;
  col0: number;
  rows: number;
  cols: number;
  values: Float32Array;
}

/** Exact ring population for a circle that lies (mostly) inside a block. */
export function sumCircleBlock(block: Block, center: LngLat, radiusKm: number): number {
  const { grid } = block;
  const latR = radiusKm / KM_PER_DEG;
  const maxAbsLat = Math.min(89.9, Math.abs(center.lat) + latR);
  const lngR = latR / Math.cos(toRad(maxAbsLat));
  // logical column of the centre, choosing the copy of the longitude nearest the block
  const blockMidLng = grid.originLng + (block.col0 + block.cols / 2) * grid.res;
  let lng = center.lng;
  while (lng - blockMidLng > 180) lng -= 360;
  while (lng - blockMidLng < -180) lng += 360;
  const c = { lat: center.lat, lng };
  const rA = Math.max(0, Math.floor((grid.originLat - (center.lat + latR)) / grid.res) - block.row0);
  const rB = Math.min(block.rows - 1, Math.floor((grid.originLat - (center.lat - latR)) / grid.res) - block.row0);
  const cA = Math.max(0, Math.floor((lng - lngR - grid.originLng) / grid.res) - block.col0);
  const cB = Math.min(block.cols - 1, Math.floor((lng + lngR - grid.originLng) / grid.res) - block.col0);
  if (rB < rA || cB < cA) return 0;
  return sumCore(grid, c, radiusKm, block.row0, block.col0, block.cols, block.values, rA, rB, cA, cB);
}

function sumCore(
  grid: GridInfo,
  center: LngLat,
  radiusKm: number,
  row0: number,
  logicalCol0: number,
  stride: number,
  values: ArrayLike<number>,
  rA: number,
  rB: number,
  cA: number,
  cB: number,
): number {
  const res = grid.res;
  let total = 0;
  for (let r = rA; r <= rB; r++) {
    const latTop = grid.originLat - (row0 + r) * res;
    const latMid = latTop - res / 2;
    const dy = res * KM_PER_DEG;
    const dx = dy * Math.cos(toRad(latMid));
    const halfDiag = 0.5 * Math.hypot(dx, dy);
    for (let c = cA; c <= cB; c++) {
      const v = values[r * stride + c];
      if (!(v > 0)) continue;
      const lngLeft = grid.originLng + (logicalCol0 + c) * res;
      const d = haversineKm(center, { lat: latMid, lng: lngLeft + res / 2 });
      if (d - halfDiag > radiusKm) continue;
      if (d + halfDiag <= radiusKm) {
        total += v;
        continue;
      }
      let inside = 0;
      for (let i = 0; i < SUBSAMPLES; i++) {
        const lat = latTop - ((i + 0.5) / SUBSAMPLES) * res;
        for (let j = 0; j < SUBSAMPLES; j++) {
          const lng = lngLeft + ((j + 0.5) / SUBSAMPLES) * res;
          if (haversineKm(center, { lat, lng }) <= radiusKm) inside++;
        }
      }
      total += (v * inside) / (SUBSAMPLES * SUBSAMPLES);
    }
  }
  return total;
}
