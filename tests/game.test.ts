import { existsSync } from "node:fs";
import { fromFile, type GeoTIFFImage } from "geotiff";
import { beforeAll, describe, expect, it } from "vitest";
import { circleWindows, haversineKm, sumCircle, type GridInfo, type LngLat } from "../src/geo";
import { accuracy, dayRings, gradeRing, levelOf, niceRound, puzzleNumber, ringFor, score, STAGES, type Stage } from "../src/puzzle";

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

describe("people counts", async () => {
  const { formatPeople } = await import("../src/numbers");
  it("uses 萬 and 億 in Chinese", () => {
    expect(formatPeople(4_000, "zh")).toBe("4,000");
    expect(formatPeople(9_999, "zh")).toBe("9,999");
    expect(formatPeople(10_000, "zh")).toBe("1萬");
    expect(formatPeople(65_000, "zh")).toBe("6萬5000");
    expect(formatPeople(51_000, "zh")).toBe("5萬1000");
    expect(formatPeople(17_000_000, "zh")).toBe("1700萬");
    expect(formatPeople(6_235_539, "zh")).toBe("623萬5539");
    expect(formatPeople(1_300_000_000, "zh")).toBe("13億");
    expect(formatPeople(938_000_000, "zh")).toBe("9億3800萬");
    expect(formatPeople(100_000_001, "zh")).toBe("1億零1");
    expect(formatPeople(60_050, "zh")).toBe("6萬零50");
    expect(formatPeople(105_000_000, "zh")).toBe("1億零500萬");
    expect(formatPeople(1_000_500_000, "zh")).toBe("10億零50萬");
  });
  it("uses commas in English", () => {
    expect(formatPeople(17_000_000, "en")).toBe("17,000,000");
  });
});

describe("puzzles", () => {
  it("numbers days from launch", () => {
    expect(puzzleNumber(new Date(2026, 10, 9, 8))).toBe(1);
    expect(puzzleNumber(new Date(2026, 10, 10, 23, 59))).toBe(2);
  });

  it("gives each day three deterministic rings, gently harder", () => {
    expect(dayRings(5)).toEqual(dayRings(5));
    for (let n = 1; n < 400; n++) {
      const [a, b, c] = dayRings(n);
      expect([a.stage, b.stage, c.stage]).toEqual([0, 1, 2]);
      expect(a.radiusKm).toBeGreaterThanOrEqual(10); // ring 1: city-scale, no twists or big rings
      expect(a.radiusKm).toBeLessThanOrEqual(30);
      expect(a.twist).toBeUndefined();
      expect(b.radiusKm).toBeLessThanOrEqual(50); // ring 2: no big rings either
      expect(b.twist).toBeUndefined();
      expect(c.radiusKm).toBeGreaterThanOrEqual(3);
      for (const p of [a, b, c]) expect(p.target).toBeGreaterThan(0);
    }
  });

  it("only ring 3 has twists, now and then, and they stay reachable", () => {
    const hard = Array.from({ length: 2000 }, (_, i) => ringFor(i + 1, 2));
    const twists = hard.filter((p) => p.twist);
    expect(twists.length / 2000).toBeGreaterThan(0.06);
    expect(twists.length / 2000).toBeLessThan(0.14);
    const big = hard.filter((p) => !p.twist && p.radiusKm >= 100);
    expect(big.length / 2000).toBeGreaterThan(0.1);
    expect(big.length / 2000).toBeLessThan(0.2);
    for (const p of twists) {
      if (p.twist === "empty-giant") {
        expect(p.radiusKm).toBeGreaterThanOrEqual(500);
        expect(p.target).toBeLessThanOrEqual(20_000);
      } else {
        expect(p.radiusKm).toBeLessThanOrEqual(5);
        expect(p.target).toBeLessThan(p.radiusKm === 3 ? 3_980_000 : 6_930_000);
      }
    }
  });

  it("grades rings into four levels, or pass / fail without the quest", () => {
    expect(STAGES.map((s) => s.max)).toEqual([80, 100, 150]);
    expect([95, 75, 50, 10].map((sc) => levelOf(sc).emoji)).toEqual(["🎯", "🟠", "🟡", "⚪"]);
    // ring 1 (no quest): straight levels
    expect(gradeRing(0, 97, false, false)).toMatchObject({ grade: "bullseye", points: 80 });
    expect(gradeRing(0, 80, false, false)).toMatchObject({ grade: "good", points: 60 });
    expect(gradeRing(0, 50, false, false)).toMatchObject({ grade: "meh", points: 32 });
    expect(gradeRing(0, 20, false, false)).toMatchObject({ grade: "bad", points: 0 });
    // quest done: levels at full scale
    expect(gradeRing(2, 92, true, true)).toMatchObject({ grade: "bullseye", emoji: "🎯", points: 150 });
    expect(gradeRing(1, 75, true, true)).toMatchObject({ grade: "good", points: 75 });
    // quest not done: pass (60+) for half, else fail
    expect(gradeRing(1, 99, true, false)).toMatchObject({ grade: "pass", emoji: "🌙", points: 50 });
    expect(gradeRing(2, 60, true, false)).toMatchObject({ grade: "pass", points: 75 });
    expect(gradeRing(2, 59, true, false)).toMatchObject({ grade: "fail", emoji: "⚪", points: 0 });
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
    expect(score(200, 100)).toBeGreaterThan(65); // 2x off ≈ 70
    expect(score(50_000, 51_000)).toBe(100); // within 5% is perfect
    expect(score(105, 100)).toBe(100);
    expect(score(110, 100)).toBeGreaterThan(97); // flat near the target
    expect(score(1000, 100)).toBeGreaterThan(20); // 10x off still scores (≈ 27)
    expect(score(1e6, 100)).toBeGreaterThan(3);
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
    ["Pacific, 1000 km, 3k (twist)", { lat: -20, lng: -140 }, 1000, 3_000],
    ["Mumbai, 3 km, 1.5M (twist)", { lat: 19.07, lng: 72.88 }, 3, 1_500_000],
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

const LAND = "public/data/land.tif";

describe.skipIf(!existsSync(LAND))("side quests on the real land mask", async () => {
  const { questFor, surveyRing, questDone } = await import("../src/quests");
  const landTiff = existsSync(LAND) ? await fromFile(LAND) : null;

  async function readLand(center: LngLat, r: number) {
    const image = await landTiff!.getImage();
    const [originLng, originLat] = image.getOrigin();
    const grid = { originLng, originLat, res: image.getResolution()[0], width: image.getWidth(), height: image.getHeight() };
    const segs = circleWindows(grid, center, r);
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

  const check = async (center: LngLat, r: number) => {
    const s = surveyRing(await readLand(center, r), center, r);
    return (q: Parameters<typeof questDone>[0]) => questDone(q, s, center, r);
  };

  it("Paris: in Europe, landlocked, not islands", async () => {
    const done = await check({ lat: 48.85, lng: 2.35 }, 10);
    expect(done({ kind: "continent", continent: "europe" })).toBe(true);
    expect(done({ kind: "continent", continent: "asia" })).toBe(false);
    expect(done({ kind: "landlocked" })).toBe(true);
    expect(done({ kind: "islandsOnly" })).toBe(false);
  });

  it("London: only islands (Great Britain), no sea within 10 km", async () => {
    const done = await check({ lat: 51.5, lng: -0.12 }, 10);
    expect(done({ kind: "islandsOnly" })).toBe(true);
    expect(done({ kind: "landlocked" })).toBe(true);
  });

  it("Hong Kong: island and mainland, touches the sea", async () => {
    const done = await check({ lat: 22.3, lng: 114.17 }, 15);
    expect(done({ kind: "islandsOnly" })).toBe(false);
    expect(done({ kind: "landlocked" })).toBe(false);
  });

  it("Istanbul: two continents in a 5 km ring", async () => {
    const done = await check({ lat: 41.03, lng: 29.01 }, 5);
    expect(done({ kind: "twoContinents" })).toBe(true);
  });

  it("Quito: crosses the equator with a 30 km ring", async () => {
    const done = await check({ lat: -0.18, lng: -78.47 }, 30);
    expect(done({ kind: "equator" })).toBe(true);
    expect(done({ kind: "continent", continent: "southAmerica" })).toBe(true);
  });

  it("line quests: hemispheres and tropics, judged on the whole ring", async () => {
    const at = (lat: number, lng: number, r: number) => (kind: "west" | "east" | "northOfCancer" | "southOfCapricorn" | "tropics") =>
      questDone({ kind }, { center: 0, touchesSea: false, touchesMainland: false, touchesIsland: false, seaShare: 0, continents: new Set() }, { lat, lng }, r);
    // London straddles the prime meridian with a big ring, but not a tiny one west of it
    expect(at(51.5, -0.13, 50)("west")).toBe(false);
    expect(at(51.5, -0.5, 10)("west")).toBe(true);
    expect(at(51.5, -0.5, 10)("east")).toBe(false);
    // across the 180° meridian (Fiji) is in neither hemisphere
    expect(at(-17, 179.9, 50)("east")).toBe(false);
    expect(at(-17, 178, 50)("east")).toBe(true);
    // tropics
    expect(at(30, 0, 50)("northOfCancer")).toBe(true);
    expect(at(23.6, 0, 50)("northOfCancer")).toBe(false); // ring dips south of 23.44°N
    expect(at(-34, 151, 20)("southOfCapricorn")).toBe(true);
    expect(at(0, 30, 100)("tropics")).toBe(true);
    expect(at(23, 30, 100)("tropics")).toBe(false);
  });

  it("measures how much of the ring is sea (for the verdict)", async () => {
    const share = async (center: LngLat, r: number) => surveyRing(await readLand(center, r), center, r).seaShare;
    expect(await share({ lat: -20, lng: -140 }, 50)).toBe(1); // mid-Pacific
    expect(await share({ lat: 48.85, lng: 2.35 }, 10)).toBe(0); // Paris
    const hk = await share({ lat: 22.25, lng: 114.15 }, 20); // Hong Kong: islands and harbour
    expect(hk).toBeGreaterThan(0.2);
    expect(hk).toBeLessThan(0.8);
  });

  it("open ocean centre counts as no continent", async () => {
    const done = await check({ lat: -20, lng: -140 }, 50);
    expect(done({ kind: "continent", continent: "oceania" })).toBe(false);
  });

  it("no quest on ring 1, easy quests on ring 2, hard ones on ring 3", () => {
    const kinds = (st: Stage) => new Set(Array.from({ length: 400 }, (_, i) => questFor(ringFor(i + 1, st))?.kind ?? "none"));
    expect([...kinds(0)]).toEqual(["none"]);
    expect([...kinds(1)].sort()).toEqual(["continent", "east", "landlocked", "northOfCancer", "tropics", "west"]);
    expect([...kinds(2)].sort()).toEqual(["country", "equator", "islandsOnly", "nearCity", "southOfCapricorn", "twoContinents"]);
  });

  it("ring 3 quests suit the ring (tiny packed rings near megacities, no city quests for giant empty ones)", async () => {
    const { CITIES } = await import("../src/cities");
    for (let n = 1; n < 3000; n++) {
      const p = ringFor(n, 2);
      const q = questFor(p)!;
      if (p.twist === "packed-tiny") {
        expect(q.kind).toBe("nearCity");
        expect(CITIES.find((c) => c.id === (q as { city: string }).city)?.dense).toBe(true);
      }
      if (p.twist === "empty-giant") expect(["islandsOnly", "southOfCapricorn", "equator"]).toContain(q.kind);
    }
  });

  it("near-city quests measure from the ring's centre", () => {
    const none = { center: 0, touchesSea: false, touchesMainland: false, touchesIsland: false, seaShare: 0, continents: new Set<never>() };
    const q = { kind: "nearCity" as const, city: "paris", km: 200 };
    expect(questDone(q, none, { lat: 49.4, lng: 2.8 }, 10)).toBe(true); // ~70 km away
    expect(questDone(q, none, { lat: 51.5, lng: -0.12 }, 10)).toBe(false); // London, ~340 km
  });
});

const COUNTRY_TIF = "public/data/countries.tif";

describe.skipIf(!existsSync(COUNTRY_TIF))("country quests on the real country mask", async () => {
  const { countryAt, questDone, questFor, COUNTRIES } = await import("../src/quests");
  const tiff = existsSync(COUNTRY_TIF) ? await fromFile(COUNTRY_TIF) : null;

  async function countryOf(center: LngLat) {
    const image = await tiff!.getImage();
    const [originLng, originLat] = image.getOrigin();
    const grid = { originLng, originLat, res: image.getResolution()[0], width: image.getWidth(), height: image.getHeight() };
    const [seg] = circleWindows(grid, center, 3);
    const w = seg.window;
    const values = Float32Array.from((await image.readRasters({ window: [w.col0, w.row0, w.col0 + w.cols, w.row0 + w.rows], samples: [0], interleave: true })) as unknown as ArrayLike<number>);
    return countryAt({ grid, row0: w.row0, col0: seg.logicalCol0, rows: w.rows, cols: w.cols, values }, center);
  }

  it("finds the country under the ring's centre", async () => {
    expect(await countryOf({ lat: 48.85, lng: 2.35 })).toBe("FRA"); // Paris
    expect(await countryOf({ lat: 50.85, lng: 4.35 })).toBe(null); // Brussels: Belgium isn't on the list
    expect(await countryOf({ lat: 38.71, lng: -9.14 })).toBe(null); // Lisbon: Portugal isn't either
    expect(await countryOf({ lat: 35.68, lng: 139.77 })).toBe("JPN"); // Tokyo, on the coast
    expect(await countryOf({ lat: 0, lng: -30 })).toBe(null); // mid-Atlantic
    // the quest is "Mainland China": Hong Kong and Macau don't count
    expect(await countryOf({ lat: 22.32, lng: 114.17 })).toBe(null);
    expect(await countryOf({ lat: 22.19, lng: 113.54 })).toBe(null);
    expect(await countryOf({ lat: 25.03, lng: 121.56 })).toBe(null); // Taipei: Taiwan isn't on the list
    expect(await countryOf({ lat: 23.13, lng: 113.26 })).toBe("CHN"); // Guangzhou
  });

  it("country quests appear on ring 3, and judge the centre's country", () => {
    const picks = Array.from({ length: 400 }, (_, i) => questFor(ringFor(i + 1, 2))).filter((q) => q?.kind === "country");
    expect(picks.length).toBeGreaterThan(10);
    for (const q of picks) expect(COUNTRIES.some((c) => c.id === (q as { country: string }).country)).toBe(true);
    const none = { center: 0, touchesSea: false, touchesMainland: false, touchesIsland: false, seaShare: 0, continents: new Set<never>() };
    const q = { kind: "country" as const, country: "FRA" };
    expect(questDone(q, none, { lat: 48.85, lng: 2.35 }, 10, "FRA")).toBe(true);
    expect(questDone(q, none, { lat: 48.85, lng: 2.35 }, 10, "DEU")).toBe(false);
    expect(questDone(q, none, { lat: 48.85, lng: 2.35 }, 10, null)).toBe(false);
  });
});
