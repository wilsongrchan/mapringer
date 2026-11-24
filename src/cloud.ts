/**
 * Game Rabbit accounts (Supabase, through the Vercel Marketplace): sign in with
 * an emailed code or Google, and the rings saved in this browser are kept in the
 * account too, so stats and streaks follow the player to any device.
 *
 * - One account for every Game Rabbit game. The games share an origin on
 *   gamerabbit.io, and the session sits under one shared key, so signing in to
 *   one signs you in to all of them.
 * - Signed out, nothing changes: rings stay in this browser (storage.ts).
 * - Signing in merges both ways. A ring saved in both places keeps the account's
 *   copy (rings are one try each, so the first one saved is the real one).
 * - The Supabase library is only downloaded once someone is (or is becoming)
 *   signed in.
 * - Builds without the Supabase settings (the GitHub Pages test site, tests)
 *   have no accounts at all: `cloudEnabled` is false.
 *
 * Tables and access rules: supabase/schema.sql.
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Difficulty } from "./difficulty";
import type { Stage } from "./puzzle";
import { loadAllDayMaps, loadAllDays, loadDayMap, loadResult, saveDayMap, saveResult, type Result } from "./storage";

const URL_ = import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const KEY = (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as
  | string
  | undefined;
export const cloudEnabled = !!(URL_ && KEY);

/** Shared by every Game Rabbit game on gamerabbit.io. */
const AUTH_KEY = "gamerabbit:auth";

export interface Account {
  id: string;
  email: string;
}
let account: Account | null = null;
const listeners = new Set<(a: Account | null) => void>();
/** Called now and on every sign-in / sign-out. */
export function onAccount(f: (a: Account | null) => void): void {
  listeners.add(f);
  f(account);
}
export const currentAccount = () => account;

let pulled: (days: number[]) => void = () => {};
let client: Promise<SupabaseClient> | null = null;
let syncedFor: string | null = null;

function getClient(): Promise<SupabaseClient> {
  client ??= import("@supabase/supabase-js").then(({ createClient }) => {
    const c = createClient(URL_!, KEY!, {
      auth: { storageKey: AUTH_KEY, flowType: "pkce", detectSessionInUrl: true, persistSession: true },
    });
    c.auth.onAuthStateChange((_event, session) => {
      // (no Supabase calls inside this callback: it can deadlock the client)
      setTimeout(() => setSession(c, session), 0);
    });
    return c;
  });
  return client;
}

function setSession(c: SupabaseClient, session: Session | null) {
  const next = session?.user ? { id: session.user.id, email: session.user.email ?? "" } : null;
  if (next?.id !== account?.id || next?.email !== account?.email) {
    account = next;
    for (const f of listeners) f(account);
  }
  if (session?.user && syncedFor !== session.user.id) {
    syncedFor = session.user.id;
    sync(c).catch((e) => console.warn("sync failed", e));
  }
  if (!session) syncedFor = null;
}

/**
 * Start accounts. `onPulled` gets the days whose rings (or map) the account
 * changed in this browser, e.g. a ring played on another device.
 */
export function startCloud(onPulled: (days: number[]) => void): void {
  if (!cloudEnabled) return;
  pulled = onPulled;
  const params = new URLSearchParams(location.search);
  let signedIn = false;
  try {
    signedIn = !!localStorage.getItem(AUTH_KEY);
  } catch {
    /* storage unavailable: no accounts this visit */
  }
  // back from Google (?code=…), or already signed in: load the library now
  if (signedIn || params.has("code")) {
    getClient().then(async (c) => {
      if (params.has("code") || params.has("error")) {
        await c.auth.getSession(); // (finishes the sign-in from the URL)
        const url = new URL(location.href);
        for (const k of ["code", "error", "error_code", "error_description", "state"]) url.searchParams.delete(k);
        history.replaceState(history.state, "", url);
      }
    });
  }
}

const PAGE = 1000;
async function fetchAll<T>(c: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c.from(table).select(columns).order("day").range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data.length < PAGE) return rows;
  }
}

/** Merge this browser's rings with the account's (the account's copy wins). */
async function sync(c: SupabaseClient) {
  const [rings, days] = await Promise.all([
    fetchAll<{ day: number; stage: Stage; result: Result }>(c, "mapringer_rings", "day, stage, result"),
    fetchAll<{ day: number; map: Difficulty }>(c, "mapringer_days", "day, map"),
  ]);
  const changed = new Set<number>();
  const haveRing = new Set<string>();
  for (const r of rings) {
    haveRing.add(`${r.day}:${r.stage}`);
    if (JSON.stringify(loadResult(r.day, r.stage)) !== JSON.stringify(r.result)) {
      saveResult(r.result);
      changed.add(r.day);
    }
  }
  const haveMap = new Set<number>();
  for (const d of days) {
    haveMap.add(d.day);
    if (loadDayMap(d.day) !== d.map) {
      saveDayMap(d.day, d.map);
      changed.add(d.day);
    }
  }
  // up: what only this browser has
  const local = loadAllDays();
  const upRings = local.flatMap((d) => d.rings.filter((r): r is Result => !!r && !haveRing.has(`${r.puzzle}:${r.stage}`)));
  const upDays = loadAllDayMaps().filter((d) => !haveMap.has(d.day));
  if (upRings.length) await insertRings(c, upRings);
  if (upDays.length) await insertDays(c, upDays);
  if (changed.size) pulled([...changed]);
}

const ringRow = (r: Result) => ({ day: r.puzzle, stage: r.stage, points: r.points, map: r.map ?? null, result: r });
async function insertRings(c: SupabaseClient, rs: Result[]) {
  const { error } = await c.from("mapringer_rings").upsert(rs.map(ringRow), { onConflict: "user_id,day,stage", ignoreDuplicates: true });
  if (error) throw error;
}
async function insertDays(c: SupabaseClient, ds: { day: number; map: Difficulty }[]) {
  const { error } = await c.from("mapringer_days").upsert(ds, { onConflict: "user_id,day", ignoreDuplicates: true });
  if (error) throw error;
}

/** Signed in on this device, or about to be (the session is still being restored)? */
export function maybeSignedIn(): boolean {
  if (account) return true;
  try {
    return cloudEnabled && !!localStorage.getItem(AUTH_KEY);
  } catch {
    return false;
  }
}

/** The database client, while signed in (friends.ts uses it). */
export function signedInClient(): Promise<SupabaseClient> | null {
  return account && client ? client : null;
}

/** Save a just-played ring to the account too (if signed in; a failure is retried at the next sync). */
export function pushResult(r: Result): void {
  if (!account || !client) return;
  client.then((c) => insertRings(c, [r])).catch((e) => console.warn("save failed", e));
}
export function pushDayMap(day: number, map: Difficulty): void {
  if (!account || !client) return;
  client.then((c) => insertDays(c, [{ day, map }])).catch((e) => console.warn("save failed", e));
}

/** This page without any sign-in leftovers: where Google and email links come back to. */
function returnUrl(): string {
  const url = new URL(location.href);
  for (const k of ["code", "error", "error_code", "error_description", "state"]) url.searchParams.delete(k);
  url.hash = "";
  return url.toString();
}

/** Is Google sign-in switched on in Supabase? (The button only shows when it is.) */
export async function googleEnabled(): Promise<boolean> {
  if (!cloudEnabled) return false;
  try {
    const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY! } });
    const s = (await res.json()) as { external?: { google?: boolean } };
    return !!s.external?.google;
  } catch {
    return false;
  }
}

export async function signInWithGoogle(): Promise<void> {
  const c = await getClient();
  const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl() } });
  if (error) throw error;
}

/** Email a sign-in code (it makes the account on first use). */
export async function sendCode(email: string): Promise<void> {
  const c = await getClient();
  const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: returnUrl() } });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const c = await getClient();
  const { error } = await c.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

/** Sign out of this browser. Its saved rings stay. */
export async function signOut(): Promise<void> {
  const c = await getClient();
  await c.auth.signOut({ scope: "local" });
}
