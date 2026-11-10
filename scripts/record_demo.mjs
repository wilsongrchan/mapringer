// Record the how-to-play demo (public/help/demo-<lang>.mp4) from the real game.
//
// Needs the dev server running (npm run dev), Playwright with Chromium in a
// scratch folder (npm i playwright && npx playwright install chromium) and
// ffmpeg (the imageio-ffmpeg wheel in .venv has one). Each frame places the
// camera exactly and waits for tiles, so it's smooth however slow the render.
//
//   node scripts/record_demo.mjs en && node scripts/record_demo.mjs zh
//   ffmpeg -framerate 30 -i <frames>/f%04d.png -c:v libx264 -profile:v main -pix_fmt yuv420p \
//     -crf 27 -preset slow -movflags +faststart -an public/help/demo-<lang>.mp4
//   ffmpeg -i <frames>/f0000.png -q:v 4 public/help/demo-<lang>.jpg
//
// The clip is 7 s: spin to Asia (0.4–2.6 s), zoom into Hong Kong (2.6–4.6 s),
// the ring turns green at 5.3 s. main.ts times the overlay to those marks.
import { chromium } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
const [,, lang] = process.argv;
const FRAMES = process.env.FRAMES ?? `/tmp/mapringer-frames-${lang}/`;
rmSync(FRAMES, { recursive: true, force: true }); mkdirSync(FRAMES);
const FPS = 30, SECONDS = 7;
const START = { lng: -5, lat: 32 }, END = { lng: 114.15, lat: 22.32 };
const Z0 = 0.75, Z1 = 7.6;
const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (x) => Math.max(0, Math.min(1, x));
function camera(t) {
  const spin = ease(clamp((t - 0.4) / 2.2));
  const zoom = ease(clamp((t - 2.6) / 2.0));
  return { center: [START.lng + (END.lng - START.lng) * spin, START.lat + (END.lat - START.lat) * spin], zoom: Z0 + (Z1 - Z0) * zoom };
}
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 300, height: 160 }, deviceScaleFactor: 2 });
await p.addInitScript(() => localStorage.setItem("mapringer:seen-help", "1"));
await p.goto(`http://localhost:5173/?day=1&lang=${lang}`);
await p.waitForFunction(() => window.__map?.getLayer("ring-line"), null, { timeout: 30000 });
await p.evaluate(() => { document.querySelector('#difficulty button[data-d="standard"]').click(); });
await p.click('#confirm-dialog button[value="ok"]');
await p.waitForTimeout(3000);
await p.addStyleTag({ content: `.topbar,.challenge,.bottom,.maplibregl-control-container{display:none!important}
  body.demo-green .ring-overlay path{stroke:#2a9d8f;fill:rgba(42,157,143,.25)} body.demo-green .crosshair{background:#2a9d8f}` });
await p.evaluate(() => { for (const id of ["quest-area-fill", "quest-area-line", "quest-line", "quest-line-label"]) window.__map.setLayoutProperty(id, "visibility", "none"); });
const settle = () => p.evaluate(() => Promise.race([new Promise((r) => window.__map.once("idle", r)), new Promise((r) => setTimeout(r, 3000))]));
for (let i = 0; i < FPS * SECONDS; i++) {
  const t = i / FPS;
  await p.evaluate(([cam, green]) => { window.__map.jumpTo(cam); document.body.classList.toggle("demo-green", green); }, [camera(t), t >= 5.3]);
  await settle();
  await p.screenshot({ path: `${FRAMES}f${String(i).padStart(4, "0")}.png` });
  if (i % 30 === 0) console.log(lang, "frame", i);
}
await b.close();
console.log(lang, "done");
