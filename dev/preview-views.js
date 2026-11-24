/**
 * The preview's Views row (dev/phone.html): jump straight to a state of the
 * game instead of playing through to it. Served by the Vite dev server only
 * (it imports the game's own modules), never part of the build.
 *
 * Every view runs the real daily game (?unlimited=0: one try, no retry
 * buttons), with made-up results for that day's real rings and quests saved
 * in this origin's localStorage (the dev server's, not the live site's). The
 * dev-only ?stage=N opens the ring a view is about (main.ts devStage).
 * Practice views run ?practice (retries, nothing saved); their rings come in
 * through the session carry-over the game uses for a language switch.
 */
import { DAY_MAX, accuracy, dayRings, gradeRing, score, todaysNumber } from "/src/puzzle.ts";
import { questAnchors, questFor } from "/src/quests.ts";

const DEMO_DAY = 5; // the ring views' day (a past day, kept out of the stats history)
const PRACTICE_DAY = 4242; // practice plays random days; this one stands in for one
const MAP = "standard";
const TODAY = todaysNumber();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// where each ring's made-up result sits, when the quest doesn't pick the spot
const SPOTS = [
  { lng: 114.17, lat: 22.32 }, // Hong Kong
  { lng: 121.47, lat: 31.23 }, // Shanghai
  { lng: 77.2, lat: 28.6 }, // Delhi
];
// how far off each kind of result is (population / target)
const RATIO = { bullseye: 1.08, close: 1.4, pass: 1.6, fail: 7, low: 0.3, wayOff: 0.00007, wayOver: 400 };

/**
 * A saved ring for `day`'s ring `stage`. `kind`: bullseye / close / low, or for
 * rings with a quest: done (close, quest done), pass / fail (quest skipped).
 */
function makeResult(day, stage, kind, map = MAP) {
  const p = dayRings(day)[stage];
  const q = stage > 0 ? questFor(p) : null;
  const questDone = q ? kind === "done" || kind === "bullseye" : undefined;
  const at = (q && questDone && questAnchors(q, SPOTS[stage])[0]) || SPOTS[stage];
  const population = Math.round(p.target * (RATIO[kind] ?? RATIO.close));
  const sc = score(population, p.target);
  const g = gradeRing(stage, sc, !!q, !!questDone);
  return {
    puzzle: day, stage, lng: at.lng, lat: at.lat, population,
    accuracy: accuracy(population, p.target), score: sc, questDone,
    grade: g.grade, emoji: g.emoji, points: g.points, map,
  };
}

const ringKey = (day, stage) => `mapringer:ring:${day}:${stage}`;
function saveDay(day, kinds, map = MAP) {
  kinds.forEach((k, st) => localStorage.setItem(ringKey(day, st), JSON.stringify(makeResult(day, st, k, map))));
  localStorage.setItem(`mapringer:map:${day}`, map);
}
function clearDay(day) {
  for (const st of [0, 1, 2]) localStorage.removeItem(ringKey(day, st));
  localStorage.removeItem(`mapringer:map:${day}`);
}

/**
 * A view of DEMO_DAY's ring `stage`, in the real game, with these rings
 * already played (`kinds`, ring 1 first; fewer than stage + 1 = still placing).
 */
const ring = (name, stage, kinds, extra = {}) => ({
  name,
  path: `/?day=${DEMO_DAY}&unlimited=0&stage=${stage}`,
  once: () => {
    localStorage.setItem("mapringer:seen-help", "1");
    clearDay(DEMO_DAY);
    saveDay(DEMO_DAY, kinds);
  },
  ...extra,
});

/** Wait for the game in a frame to be up, then close any dialog it opened by itself. */
async function settle(iframe, keepOpen = null) {
  const w = iframe.contentWindow;
  for (let i = 0; i < 50 && !w.document.querySelector("#challenge-line")?.textContent; i++) await sleep(100);
  await sleep(300);
  for (const d of w.document.querySelectorAll("dialog[open]")) if (d.id !== keepOpen) d.close();
  return w;
}

/**
 * A practice view (?practice): ring `stage` of a random-looking day, with these
 * rings already played. Practice saves nothing, so the state goes through the
 * session carry-over (read once on load), set just before each frame loads.
 */
const practice = (name, stage, kinds, path = "/?practice") => ({
  name,
  path,
  before: () => {
    localStorage.setItem("mapringer:seen-help", "1");
    const results = [0, 1, 2].map((i) => (kinds[i] ? makeResult(PRACTICE_DAY, i, kinds[i]) : null));
    sessionStorage.setItem(
      "mapringer:carry-over",
      JSON.stringify({ camera: { center: [10, 25], zoom: 1.5 }, test: { day: PRACTICE_DAY, practice: true, stage, results, map: MAP } }),
    );
  },
});

/**
 * The Friends tab with made-up friends, on today (where friends' spots show).
 * `doneToday`: you've finished today's three rings (so their spots unlock).
 * `open`: then open that friend's page.
 */
function friends(name, doneToday, open = null) {
  return {
    name,
    path: `/?unlimited=0&fakefriends`,
    once: () => {
      localStorage.setItem("mapringer:seen-help", "1");
      clearDay(TODAY);
      if (doneToday) saveDay(TODAY, ["close", "done", "pass"]);
      else localStorage.setItem(`mapringer:map:${TODAY}`, MAP);
    },
    after: async (iframe) => {
      const w = await settle(iframe);
      const doc = w.document;
      doc.querySelector("#stats-btn").click();
      await sleep(200);
      doc.querySelector("#tab-friends").click();
      if (!open) return;
      for (let i = 0; i < 40 && !doc.querySelector(".friend-open"); i++) await sleep(100);
      [...doc.querySelectorAll(".friend-open")].find((b) => b.textContent.includes(open))?.click();
    },
  };
}

// a finished yesterday (the finished-day view), and 30 days of history before it (stats)
const YESTERDAY = TODAY - 1;
function seedHistory() {
  // varied but fixed: some great days, some poor, a few missed
  const pattern = [
    ["close", "done", "done"], ["bullseye", "done", "pass"], ["low", "pass", "fail"], null,
    ["close", "done", "bullseye"], ["bullseye", "bullseye", "done"], ["close", "fail", "pass"],
    ["low", "done", "done"], null, ["close", "pass", "pass"],
  ];
  const maps = ["standard", "easy", "hard"];
  for (let i = 1; i <= 30; i++) {
    const day = YESTERDAY - i;
    if (day < 1 || day === DEMO_DAY) continue;
    const kinds = pattern[i % pattern.length];
    if (kinds) saveDay(day, kinds, maps[i % 3]);
    else clearDay(day);
  }
}

const VIEWS = [
  ring("Ring 1 · placing", 0, []),
  ring("Ring 2 · placing", 1, ["close"]),
  ring("Ring 1 · result", 0, ["close"]),
  ring("Ring 1 · bullseye", 0, ["bullseye"]),
  ring("Ring 1 · way off ◀", 0, ["wayOff"]),
  ring("Ring 1 · way over ▶", 0, ["wayOver"]),
  ring("Ring 2 · quest done", 1, ["close", "done"]),
  ring("Ring 2 · quest skipped 🌙", 1, ["close", "pass"]),
  ring("Ring 3 · quest skipped ⚪ (day done)", 2, ["close", "done", "fail"]),
  {
    name: "Day finished",
    path: `/?day=${YESTERDAY}&unlimited=0`,
    once: () => {
      localStorage.setItem("mapringer:seen-help", "1");
      saveDay(YESTERDAY, ["close", "done", "pass"]);
    },
  },
  {
    name: "Stats",
    path: `/?day=${YESTERDAY}&unlimited=0`,
    once: () => {
      localStorage.setItem("mapringer:seen-help", "1");
      saveDay(YESTERDAY, ["close", "done", "pass"]);
      seedHistory();
    },
    after: async (iframe) => {
      const w = await settle(iframe);
      w.document.querySelector("#stats-btn").click();
    },
  },
  {
    name: "Map picker",
    path: "/?unlimited=0",
    once: () => {
      localStorage.setItem("mapringer:seen-help", "1");
      clearDay(TODAY);
    },
  },
  practice("Practice · placing", 0, []),
  practice("Practice · result", 0, ["close"]),
  practice("Practice · quest skipped", 1, ["close", "pass"]),
  practice("Practice · ring 3 done", 2, ["close", "done", "done"]),
  {
    name: "Other maps (replay a day)",
    path: `/?practice&day=${YESTERDAY}`,
    once: () => {
      localStorage.setItem("mapringer:seen-help", "1");
      saveDay(YESTERDAY, ["close", "done", "pass"]);
    },
  },
  // friends: made-up friends (?fakefriends, src/friends-fake.ts): Mei shares, Tom hides, Aisha hasn't played today
  friends("Friends · list", false),
  friends("Friends · Mei, today locked", false, "Mei"),
  friends("Friends · Mei, today open", true, "Mei"),
  friends("Friends · Tom hides spots", true, "Tom"),
  {
    name: "Friends · invite link",
    path: `/?unlimited=0&fakefriends&friend=ABC234`,
    once: () => {
      localStorage.setItem("mapringer:seen-help", "1");
      localStorage.setItem(`mapringer:map:${TODAY}`, MAP);
    },
    after: async () => {}, // (keep the Friends tab the link opens)
  },
  ring("How to play", 0, [], {
    after: async (iframe) => {
      const w = await settle(iframe);
      w.document.querySelector("#help-btn").click();
    },
  }),
];

const box = document.getElementById("views");
const status = document.getElementById("view-status");
let current = null;

function show(view) {
  current = view;
  for (const b of box.querySelectorAll("button")) b.classList.toggle("on", b.textContent === view?.name);
  view?.once?.();
  status.textContent = !view
    ? ""
    : view.path.includes("practice")
      ? `${view.path} · practice: retries, nothing saved`
      : `${view.path} · the real daily game, results saved in this origin's localStorage`;
  window.previewRender({
    path: view?.path ?? "/",
    before: view?.before,
    after: async (iframe) => {
      if (view?.after) return view.after(iframe);
      await settle(iframe); // (close the first-visit help, if it opened)
    },
  });
}

for (const v of VIEWS) {
  const b = document.createElement("button");
  b.textContent = v.name;
  b.addEventListener("click", () => show(v));
  box.append(b);
}
const clear = document.createElement("button");
clear.textContent = "Clear saved";
clear.title = "Remove every saved ring and map pick from this origin (the dev server's localStorage)";
clear.addEventListener("click", () => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("mapringer:") && k !== "mapringer:seen-help") localStorage.removeItem(k);
  status.textContent = "Cleared saved rings.";
});
box.append(clear);

// switching language re-shows the current view
document.querySelector(".views").addEventListener("change", (e) => {
  if (e.target.name === "lang") current ? show(current) : window.previewRender();
});

// ---- every quest, past and upcoming: pick one to open the ring it's on ----
// (scans the days' rings; a quest's ring is the latest day it was on so far,
// else the first day it's coming up)
const SCAN_DAYS = 3000;
const questLabel = (q) => {
  const { kind, ...rest } = q;
  const v = Object.values(rest);
  if (kind === "high") return `high · ${q.m} m`;
  if (kind === "northOf" || kind === "southOf") return `${kind} · ${Math.abs(q.lat)}°`;
  if (kind === "nearCity") return `nearCity · ${q.city} (${q.km} km)`;
  return v.length ? `${kind} · ${v.join(" · ")}` : kind;
};
const quests = new Map(); // key → { q, used: {day, stage} | null, next: {day, stage} | null, count }
for (let day = 1; day <= SCAN_DAYS; day++) {
  const rings = dayRings(day);
  for (const stage of [1, 2]) {
    const q = questFor(rings[stage]);
    if (!q) continue;
    const key = JSON.stringify(q);
    const e = quests.get(key) ?? { q, used: null, next: null, count: 0 };
    e.count++;
    if (day <= TODAY) e.used = { day, stage };
    else if (!e.next) e.next = { day, stage };
    quests.set(key, e);
  }
}
const qSelect = document.getElementById("quests");
const list = [...quests.values()].sort((a, b) => questLabel(a.q).localeCompare(questLabel(b.q)));
qSelect.append(new Option(`${list.length} quests (days 1–${SCAN_DAYS})…`, ""));
for (const [title, items] of [
  [`Used so far (days 1–${TODAY})`, list.filter((e) => e.used)],
  ["Not used yet", list.filter((e) => !e.used)],
]) {
  const group = document.createElement("optgroup");
  group.label = `${title}: ${items.length}`;
  for (const e of items) {
    const at = e.used ?? e.next;
    const o = new Option(`${questLabel(e.q)} — day ${at.day}, ring ${at.stage + 1} (${e.count}×)`, JSON.stringify(at));
    group.append(o);
  }
  qSelect.append(group);
}
qSelect.addEventListener("change", () => {
  if (!qSelect.value) return;
  const { day, stage } = JSON.parse(qSelect.value);
  show({
    name: "",
    path: `/?day=${day}&unlimited=0&stage=${stage}`,
    once: () => {
      localStorage.setItem("mapringer:seen-help", "1");
      // placing that ring: its day's map picked, the ring itself not played yet
      localStorage.setItem(`mapringer:map:${day}`, MAP);
      localStorage.removeItem(ringKey(day, stage));
    },
  });
});

console.info(`preview views: day max ${DAY_MAX}, today #${TODAY}, ${quests.size} quests`);
