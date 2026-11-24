/**
 * Dev only (?fakefriends on the dev server, see friends.ts): a made-up friend
 * list that behaves like the real one, so the friends screens can be worked on
 * without an account. Nothing is sent anywhere; it resets on reload.
 *
 * Today's spots follow the real rule: you see them once you've finished
 * today's three rings in this browser. One friend hides their spots and one
 * hasn't played today, so every case shows up.
 */
import type { AddResult, Friend, FriendsApi, Profile, TodayView } from "./friends";
import { accuracy, dayRings, gradeRing, score, todaysNumber, type Stage } from "./puzzle";
import { questFor } from "./quests";
import { loadResult, type Result } from "./storage";

const CITIES = [
  { lng: 139.69, lat: 35.68 },
  { lng: 121.47, lat: 31.23 },
  { lng: 77.2, lat: 28.6 },
  { lng: -46.63, lat: -23.55 },
  { lng: 31.24, lat: 30.04 },
  { lng: -99.13, lat: 19.43 },
  { lng: 106.85, lat: -6.21 },
  { lng: 3.38, lat: 6.52 },
];

/** A small fixed random sequence, so the fake friends' days look the same every reload. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeRing(day: number, stage: Stage, r: () => number): Result {
  const p = dayRings(day)[stage];
  const q = stage > 0 ? questFor(p) : null;
  const ratio = 10 ** ((r() - 0.45) * 1.6); // mostly within ×/÷ 3
  const population = Math.round(p.target * ratio);
  const sc = score(population, p.target);
  const questDone = q ? r() < 0.7 : undefined;
  const g = gradeRing(stage, sc, !!q, !!questDone);
  const c = CITIES[Math.floor(r() * CITIES.length)];
  return {
    puzzle: day, stage, lng: c.lng + (r() - 0.5) * 2, lat: c.lat + (r() - 0.5) * 2, population,
    accuracy: accuracy(population, p.target), score: sc, questDone,
    grade: g.grade, emoji: g.emoji, points: g.points, map: (["easy", "standard", "hard"] as const)[day % 3],
  };
}

/** `days` of history up to today (today included if `playsToday`), skipping some. */
function history(seed: number, days: number, playsToday: boolean): Result[] {
  const r = rand(seed);
  const today = todaysNumber();
  const out: Result[] = [];
  for (let day = Math.max(1, today - days); day <= today; day++) {
    if (day === today ? !playsToday : r() < 0.2) continue;
    for (const st of [0, 1, 2] as Stage[]) out.push(fakeRing(day, st, r));
  }
  return out;
}

export function fakeFriends(): FriendsApi {
  const me: Profile = { code: "MR7K2Q", name: "" };
  let hidden = false;
  const friends: (Friend & { rings: Result[]; hides?: boolean })[] = [
    { id: "f1", name: "Mei", status: "accepted", rings: history(1, 20, true) },
    { id: "f2", name: "Tom", status: "accepted", rings: history(2, 12, true), hides: true },
    { id: "f3", name: "Aisha", status: "accepted", rings: history(3, 25, false) },
    { id: "f4", name: "Kenji", status: "incoming", rings: [] },
    { id: "f5", name: "Lucas", status: "outgoing", rings: [] },
  ];
  const later = <T>(v: T) => new Promise<T>((res) => setTimeout(() => res(v), 250));
  const strip = (r: Result) => ({ ...r, lng: NaN, lat: NaN });

  return {
    me: () => later({ ...me }),
    async setName(name) {
      me.name = name.trim().slice(0, 24);
    },
    list: () => later(friends.map(({ id, name, status }) => ({ id, name, status }))),
    async add(code): Promise<AddResult> {
      if (code === me.code) return { status: "self" };
      if (code !== "ABC234") return later({ status: "not_found" });
      friends.push({ id: "f6", name: "Priya", status: "outgoing", rings: [] });
      return later({ status: "pending", name: "Priya" });
    },
    async accept(id) {
      const f = friends.find((x) => x.id === id);
      if (f) {
        f.status = "accepted";
        f.rings = history(4, 10, true);
      }
    },
    async remove(id) {
      const i = friends.findIndex((x) => x.id === id);
      if (i >= 0) friends.splice(i, 1);
    },
    rings: (id) => later((friends.find((x) => x.id === id)?.rings ?? []).map(strip)),
    async today(id, day): Promise<TodayView> {
      const f = friends.find((x) => x.id === id)!;
      const mine = [0, 1, 2].every((st) => loadResult(day, st as Stage));
      if (!mine) return later({ status: "locked" });
      if (f.hides) return later({ status: "hidden" });
      const rings = f.rings.filter((r) => r.puzzle === day);
      return later(rings.length ? { status: "ok", rings } : { status: "none" });
    },
    hidden: () => later(hidden),
    async setHidden(h) {
      hidden = h;
    },
  };
}
