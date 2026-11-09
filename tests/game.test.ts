import { existsSync } from "node:fs";
import { fromFile, type GeoTIFFImage } from "geotiff";
import { beforeAll, describe, expect, it } from "vitest";
import { circleWindows, haversineKm, sumCircle, type GridInfo, type LngLat } from "../src/geo";
import { accuracy, niceRound, puzzleFor, puzzleNumber, score } from "../src/puzzle";

describe("geometry", () => {
  it("haversine matches a known distance (London → Paris ≈ 344 km)", () => {
    expect(haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeCloseTo(343.5, 0);
  });

  it("sums a uniform grid to roughly density × πr²", () => {
    const res = 1 / 120;
    const grid: GridInfo = { originLng: -1, originLat: 1, res, width: 240, height: 240 };
    const center = { lat: 0, lng: 0 };
    const [seg] = circleWindows(grid, center, 20);
    const values = new Float32Array(seg.window.cols * seg.window.rows).fill(1);
    const cellArea = (res * 111.195) ** 2; // at the equator
    const expected = (Math.PI * 20 ** 2) / cellArea;
    expect(sumCircle(grid, center, 20, seg, values) / expected).toBeCloseTo(1, 2);
  });

  it("splits a ring that crosses the antimeridian into two windows", () => {
    const grid: GridInfo = { originLng: -180, originLat: 90, res: 1 / 120, width: 43200, height: 21600 };
    const segs = circleWindows(grid, { lat: -17, lng: 179.95 }, 20);
    expect(segs).toHaveLength(2);
    expect(segs[1].window.col0).toBe(0);
  });
});

describe("puzzles", () => {
  it("numbers days from launch", () => {
    expect(puzzleNumber(new Date(2026, 10, 9, 8))).toBe(1);
    expect(puzzleNumber(new Date(2026, 10, 10, 23, 59))).toBe(2);
  });

  it("is deterministic and sensible", () => {
    expect(puzzleFor(5)).toEqual(puzzleFor(5));
    for (let n = 1; n < 400; n++) {
      const p = puzzleFor(n);
      expect(p.radiusKm).toBeGreaterThanOrEqual(3);
      expect(p.target).toBeGreaterThan(0);
    }
  });

  it("rounds and scores", () => {
    expect(niceRound(48_213)).toBe(48_000);
    expect(accuracy(100, 100)).toBe(100);
    expect(accuracy(200, 100)).toBe(50);
    expect(accuracy(50, 100)).toBe(50);
    expect(accuracy(0, 100)).toBe(0);
  });

  it("scores on a symmetric log curve that plateaus", () => {
    expect(score(100, 100)).toBe(100);
    expect(score(200, 100)).toBeCloseTo(score(50, 100), 6); // 2x over = 2x under
    expect(score(200, 100)).toBeGreaterThan(80);
    expect(score(50_000, 51_000)).toBe(100); // within 5% is perfect
    expect(score(105, 100)).toBe(100);
    expect(score(110, 100)).toBeGreaterThan(97); // flat near the target
    expect(score(1000, 100)).toBeGreaterThan(40); // 10x off still scores
    expect(score(1e6, 100)).toBeGreaterThan(5);
    expect(score(0, 100)).toBe(0);
  });
});

const DATA = "public/data/population.tif";
const COARSE = "public/data/population_10x.tif";

describe.skipIf(!existsSync(DATA))("real GHSL data", () => {
  let image: GeoTIFFImage;
  let grid: GridInfo;

  beforeAll(async () => {
    image = await (await fromFile(DATA)).getImage();
    const [originLng, originLat] = image.getOrigin();
    grid = { originLng, originLat, res: image.getResolution()[0], width: image.getWidth(), height: image.getHeight() };
  });

  async function pop(center: LngLat, r: number) {
    let total = 0;
    for (const seg of circleWindows(grid, center, r)) {
      const { col0, row0, cols, rows } = seg.window;
      const data = await image.readRasters({ window: [col0, row0, col0 + cols, row0 + rows], samples: [0], interleave: true });
      total += sumCircle(grid, center, r, seg, data as unknown as ArrayLike<number>);
    }
    return total;
  }

  it("coarse grid agrees with the fine grid on a 100 km ring", async () => {
    const fine = await pop({ lat: 51.5, lng: -0.12 }, 100);
    const img = await (await fromFile(COARSE)).getImage();
    const [oL, oT] = img.getOrigin();
    const g = { originLng: oL, originLat: oT, res: img.getResolution()[0], width: img.getWidth(), height: img.getHeight() };
    let c = 0;
    for (const seg of circleWindows(g, { lat: 51.5, lng: -0.12 }, 100)) {
      const w = seg.window;
      const d = await img.readRasters({ window: [w.col0, w.row0, w.col0 + w.cols, w.row0 + w.rows], samples: [0], interleave: true });
      c += sumCircle(g, { lat: 51.5, lng: -0.12 }, 100, seg, d as unknown as ArrayLike<number>);
    }
    console.log("London 100km fine:", Math.round(fine), "coarse:", Math.round(c));
    expect(Math.abs(c - fine) / fine).toBeLessThan(0.01);
  });

  it("open ocean is empty", async () => {
    expect(await pop({ lat: 0, lng: -140 }, 50)).toBe(0);
  });

  it("central London (10 km) holds millions", async () => {
    const p = await pop({ lat: 51.5074, lng: -0.1278 }, 10);
    console.log("London 10km:", Math.round(p));
    expect(p).toBeGreaterThan(2_500_000);
    expect(p).toBeLessThan(5_000_000);
  });

  it("Tom Forth's example (Tuscany, 5 km) is plausible", async () => {
    const p = await pop({ lat: 43.7465, lng: 10.82611 }, 5);
    console.log("Tuscany 5km:", Math.round(p));
    expect(p).toBeGreaterThan(5_000);
    expect(p).toBeLessThan(200_000);
  });

  it("is continuous across the antimeridian (Fiji)", async () => {
    const a = await pop({ lat: -16.75, lng: 179.99 }, 30);
    const b = await pop({ lat: -16.75, lng: -180.01 }, 30);
    console.log("Fiji 30km:", Math.round(a));
    expect(a).toBeGreaterThan(1_000);
    expect(Math.abs(a - b) / a).toBeLessThan(0.001);
  });
});

describe.skipIf(!existsSync(DATA))("closest answer search", async () => {
  const { findClosestAnswer } = await import("../src/answer");
  const { circleWindows: cw } = await import("../src/geo");
  const tiff = existsSync(DATA) ? await fromFile(DATA) : null;
  const coarse = existsSync(COARSE) ? await fromFile(COARSE) : null;

  async function readBlock(center: LngLat, r: number, ringKm: number) {
    const image = await (ringKm >= 100 ? coarse! : tiff!).getImage();
    const [originLng, originLat] = image.getOrigin();
    const grid = { originLng, originLat, res: image.getResolution()[0], width: image.getWidth(), height: image.getHeight() };
    const segs = cw(grid, center, r);
    const { row0, rows } = segs[0].window;
    const cols = segs.reduce((n, s) => n + s.window.cols, 0);
    const values = new Float32Array(rows * cols);
    let off = 0;
    for (const s of segs) {
      const w = s.window;
      const d = (await image.readRasters({ window: [w.col0, w.row0, w.col0 + w.cols, w.row0 + w.rows], samples: [0], interleave: true })) as unknown as ArrayLike<number>;
      for (let rr = 0; rr < rows; rr++) for (let c = 0; c < w.cols; c++) values[rr * cols + off + c] = d[rr * w.cols + c];
      off += w.cols;
    }
    return { grid, row0, col0: segs[0].logicalCol0, rows, cols, values };
  }

  const cases: [string, LngLat, number, number][] = [
    ["Oxford, 15 km, 33k", { lat: 51.752, lng: -1.2577 }, 15, 33_000],
    ["Hong Kong, 15 km, 33k", { lat: 22.32, lng: 114.17 }, 15, 33_000],
    ["Sahara, 15 km, 33k", { lat: 25, lng: 5 }, 15, 33_000],
    ["London, 30 km, 14M", { lat: 51.5, lng: -0.12 }, 30, 14_000_000],
    ["Fiji, 20 km, 50k", { lat: -16.75, lng: 179.99 }, 20, 50_000],
    ["Paris, 300 km, 20M", { lat: 48.85, lng: 2.35 }, 300, 20_000_000],
    ["Sahara, 1000 km, 100M", { lat: 23, lng: 10 }, 1000, 100_000_000],
    ["N. India, 1000 km, 600M", { lat: 26, lng: 83 }, 1000, 600_000_000],
  ];
  for (const [name, player, r, target] of cases) {
    it(name, async () => {
      const t0 = performance.now();
      const { answer, best, searchedKm } = await findClosestAnswer(player, r, target, readBlock);
      const ms = Math.round(performance.now() - t0);
      console.log(name, "→", answer ? `${Math.round(answer.population)} (${answer.accuracy.toFixed(1)}%) ${answer.distanceKm.toFixed(0)} km away at ${answer.center.lat.toFixed(3)},${answer.center.lng.toFixed(3)}` : `none within ${searchedKm} km; best ${Math.round(best?.population ?? 0)} (${best?.accuracy.toFixed(1)}%)`, `${ms} ms`);
      if (answer) {
        expect(answer.accuracy).toBeGreaterThanOrEqual(100 / 1.05);
        // re-check independently with the tile-based counter
        let exact = 0;
        const image = await (r >= 100 ? coarse! : tiff!).getImage();
        const [oL, oT] = image.getOrigin();
        const grid = { originLng: oL, originLat: oT, res: image.getResolution()[0], width: image.getWidth(), height: image.getHeight() };
        for (const seg of cw(grid, answer.center, r)) {
          const w = seg.window;
          const d = await image.readRasters({ window: [w.col0, w.row0, w.col0 + w.cols, w.row0 + w.rows], samples: [0], interleave: true });
          exact += sumCircle(grid, answer.center, r, seg, d as unknown as ArrayLike<number>);
        }
        expect(Math.abs(exact - answer.population) / exact).toBeLessThan(0.001);
      }
    }, 60_000);
  }
});
