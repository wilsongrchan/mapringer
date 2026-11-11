import type { SeaLookup } from "./quests";

/**
 * Which named sea each patch of water belongs to (public/hints/seas.png, built
 * by scripts/build_quest_zones.py from Natural Earth's marine areas): a
 * 4320 x 2160 grey image on a 5 arc-minute grid, value = label. Loaded once,
 * only when a "touch the …" quest needs it.
 */
const COLS = 4320;
const ROWS = 2160;
let loading: Promise<SeaLookup> | null = null;

export function loadSeaLookup(): Promise<SeaLookup> {
  loading ??= (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}hints/seas.png`);
    if (!res.ok) throw new Error(`seas ${res.status}`);
    // no colour management: the grey values are the labels
    const img = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
    const grid = new Uint8Array(COLS * ROWS);
    for (let i = 0; i < grid.length; i++) grid[i] = rgba[i * 4];
    return (lng: number, lat: number) => {
      const c = Math.floor(((((lng + 180) % 360) + 360) % 360) * 12);
      const r = Math.floor((90 - lat) * 12);
      return r < 0 || r >= ROWS ? 0 : grid[r * COLS + Math.min(COLS - 1, c)];
    };
  })();
  loading.catch(() => (loading = null)); // allow a retry
  return loading;
}
