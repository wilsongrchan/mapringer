/**
 * The stats dialog's contents: four headline numbers, the last 30 days as
 * bars (tap or hover a day to read it), how the rings went, and the average
 * per map. Built from computeStats (stats.ts).
 */
import { DIFFICULTIES } from "./difficulty";
import { t } from "./i18n";
import { DAY_MAX, fmtPoints } from "./puzzle";
import type { GradeBucket, Stats } from "./stats";

const SVG = "http://www.w3.org/2000/svg";
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const round = (n: number | null) => (n === null ? "–" : fmtPoints(Math.round(n)));

function tiles(s: Stats) {
  const box = el("div", "stat-tiles");
  const tile = (value: string, label: string) => {
    const d = el("div", "stat-tile");
    d.append(el("strong", "", value), el("span", "", label));
    return d;
  };
  box.append(
    tile(String(s.played), t("statPlayed")),
    tile(String(s.currentStreak), t("statStreak")),
    tile(String(s.bestStreak), t("statBestStreak")),
    tile(round(s.average), t("statAverage")),
  );
  return box;
}

/**
 * The last 30 days, from the first day you played: one bar per finished day
 * (out of 330); unplayed days are a dot on the baseline. Fewer days get wider
 * bars (at least 7 slots, so a first day isn't one giant bar).
 */
function recentChart(s: Stats) {
  const box = el("section", "stat-section");
  box.append(el("h3", "", t("statsLast30")));
  const W = 300;
  const H = 84;
  const TOP = 6;
  const LEFT = 22; // room for the 100 / 200 / 300 labels
  const first = s.recent.findIndex((d) => d.total !== null || d.map !== null);
  const days = first < 0 ? s.recent : s.recent.slice(first);
  const slot = (W - LEFT) / Math.max(7, days.length);
  const barW = Math.min(slot - 3, 22); // (at least a 3px gap between bars)
  const yOf = (pts: number) => H - ((H - TOP) * pts) / DAY_MAX;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H + 2}`, class: "stat-chart", role: "img", "aria-label": t("statsLast30") });
  // benchmarks every 100 points (labelled on the left), then the baseline
  for (const pts of [100, 200, 300]) {
    const y = yOf(pts);
    svg.append(svgEl("line", { x1: LEFT, x2: W, y1: y, y2: y, class: "grid" }));
    const label = svgEl("text", { x: LEFT - 4, y: y + 3, class: "tick" });
    label.textContent = String(pts);
    svg.append(label);
  }
  svg.append(svgEl("line", { x1: LEFT, x2: W, y1: H, y2: H, class: "axis" }));
  const bars: (SVGElement | null)[] = [];
  days.forEach((d, i) => {
    const x = LEFT + i * slot + (slot - barW) / 2;
    if (d.total === null) {
      bars.push(null);
      svg.append(svgEl("circle", { cx: x + barW / 2, cy: H - 2, r: 1.2, class: "gap" }));
      return;
    }
    const h = Math.max(2, ((H - TOP) * d.total) / DAY_MAX);
    const r = Math.min(2, barW / 2, h);
    // square at the baseline, rounded at the top
    const path = `M${x},${H}V${H - h + r}Q${x},${H - h} ${x + r},${H - h}H${x + barW - r}Q${x + barW},${H - h} ${x + barW},${H - h + r}V${H}Z`;
    const bar = svgEl("path", { d: path, class: "bar" });
    bars.push(bar);
    svg.append(bar);
  });
  // your average (all days played): above the line was a better-than-usual day
  if (s.average !== null) {
    const y = yOf(s.average);
    svg.append(svgEl("line", { x1: LEFT, x2: W, y1: y, y2: y, class: "avg" }));
    const label = svgEl("text", { x: W - 1, y: y - 3, class: "avg-label" });
    label.textContent = t("statsAvgLine", { avg: round(s.average) });
    svg.append(label);
  }
  const caption = el("p", "stat-caption");
  const select = (i: number) => {
    const d = days[i];
    if (!d) return;
    bars.forEach((b, j) => b?.classList.toggle("on", j === i));
    const map = d.map ? ` · ${DIFFICULTIES[d.map].label}` : "";
    caption.textContent = d.total === null ? t("statsDayNone", { n: d.day }) : t("statsDayTip", { n: d.day, total: fmtPoints(d.total), max: DAY_MAX }) + map;
  };
  // tap / hover anywhere in a day's column (much bigger than the bar itself)
  const pick = (e: PointerEvent) => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W; // (in chart units)
    const i = Math.floor((x - LEFT) / slot);
    select(Math.max(0, Math.min(days.length - 1, i)));
  };
  svg.addEventListener("pointermove", pick);
  svg.addEventListener("pointerdown", pick);
  let last = -1;
  days.forEach((d, i) => d.total !== null && (last = i));
  select(last >= 0 ? last : days.length - 1);
  box.append(svg, caption);
  return box;
}

const GRADE_LABEL: Record<GradeBucket, Parameters<typeof t>[0]> = {
  bullseye: "gradeBullseye",
  good: "gradeGood",
  meh: "gradeMeh",
  pass: "gradePass",
  miss: "gradeMiss",
};

/** Every ring played, by how it went. */
function gradeBars(s: Stats) {
  const box = el("section", "stat-section");
  box.append(el("h3", "", t("statsRings")));
  const most = Math.max(1, ...Object.values(s.grades));
  const list = el("div", "grade-bars");
  for (const g of Object.keys(GRADE_LABEL) as GradeBucket[]) {
    const n = s.grades[g];
    const track = el("span", "track");
    const fill = el("span", "fill");
    fill.style.width = n ? `max(4px, ${(100 * n) / most}%)` : "0";
    track.append(fill);
    list.append(el("span", "name", t(GRADE_LABEL[g])), track, el("span", "count", String(n)));
  }
  box.append(list);
  return box;
}

function mapRows(s: Stats) {
  const box = el("section", "stat-section");
  box.append(el("h3", "", t("statsByMap")));
  const list = el("div", "map-rows");
  for (const m of ["easy", "standard", "hard"] as const) {
    const r = s.byMap[m];
    list.append(
      el("span", "name", DIFFICULTIES[m].label),
      el("span", "", r.played ? t("statsMapRow", { n: r.played, avg: round(r.average) }) : t("statsMapNone")),
    );
  }
  box.append(list);
  if (s.best) box.append(el("p", "stat-caption", t("statsBest", { n: s.best.day, total: fmtPoints(s.best.total), max: DAY_MAX })));
  return box;
}

export function renderStats(body: HTMLElement, s: Stats): void {
  const anything = s.played > 0 || Object.values(s.grades).some(Boolean);
  if (!anything) {
    body.replaceChildren(tiles(s), el("p", "stat-empty", t("statsEmpty")));
    return;
  }
  body.replaceChildren(tiles(s), recentChart(s), gradeBars(s), mapRows(s));
}
