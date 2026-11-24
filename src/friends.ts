/**
 * Friends: the shared Game Rabbit friend list (one nickname and friend code for
 * every Game Rabbit game, made by Kowloon Dragons) plus what MapRinger friends
 * can see of each other (supabase/friends.sql):
 *
 * - a friend's scores, always (never where their rings were);
 * - where a friend put today's rings, only once you've finished all three of
 *   today's rings yourself, only today, and only if they haven't hidden their
 *   spots. The database enforces this; the browser just asks.
 *
 * Signed out, or on a build without accounts, there are no friends
 * (`friendsApi()` is null). On the dev server, ?fakefriends (or having no
 * accounts there) gives a made-up friend list (friends-fake.ts) so the screens
 * can be worked on locally.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudEnabled, currentAccount, signedInClient } from "./cloud";
import type { Result } from "./storage";

export interface Profile {
  code: string;
  name: string;
}

export interface Friend {
  id: string;
  name: string;
  /** accepted, a request they sent you (incoming), or one you sent them (outgoing) */
  status: "accepted" | "incoming" | "outgoing";
}

export type AddResult = { status: "pending" | "accepted" | "not_found" | "self"; name?: string };

/** Where a friend put today's rings, or why you can't see it. */
export type TodayView = { status: "ok"; rings: Result[] } | { status: "locked" | "hidden" | "none" };

export interface FriendsApi {
  /** Your profile (made on first use: a friend code, and a nickname you can set). */
  me(): Promise<Profile>;
  setName(name: string): Promise<void>;
  list(): Promise<Friend[]>;
  add(code: string): Promise<AddResult>;
  accept(id: string): Promise<void>;
  /** Unfriend, decline a request, or take back one you sent. */
  remove(id: string): Promise<void>;
  /** Every ring the friend has played, without where it was (for their stats). */
  rings(id: string): Promise<Result[]>;
  today(id: string, day: number): Promise<TodayView>;
  /** Do you keep your spots from friends? */
  hidden(): Promise<boolean>;
  setHidden(hidden: boolean): Promise<void>;
}

export const NAME_MAX = 24; // (gamerabbit_profiles.name)

/** The friend code from what someone typed or pasted: letters and digits, upper case. */
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

let fake: FriendsApi | null | undefined;
// dev server: made-up friends with ?fakefriends, and always when there are no accounts here
// (no Supabase settings), so the Friends tab can be tried locally
const fakeWanted = () => import.meta.env.DEV && (new URLSearchParams(location.search).has("fakefriends") || !cloudEnabled);

/** The friends API, or null when there are no friends here (signed out, or no accounts). */
export async function friendsApi(): Promise<FriendsApi | null> {
  // (import.meta.env.DEV first, so builds drop the fake altogether)
  if (import.meta.env.DEV && fakeWanted()) {
    fake ??= (await import("./friends-fake")).fakeFriends();
    return fake;
  }
  const c = signedInClient();
  const me = currentAccount();
  return c && me ? cloudFriends(await c, me.id) : null;
}

/** Can this build have friends at all (accounts on, or the dev fake)? The Friends tab shows when it can. */
export const friendsPossible = () => fakeWanted() || cloudEnabled;

function cloudFriends(c: SupabaseClient, me: string): FriendsApi {
  const check = <T>(r: { data: T; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    async me() {
      const mine = check(await c.from("gamerabbit_profiles").select("code, name").eq("user_id", me).maybeSingle());
      if (mine) return mine as Profile;
      // first time: the code comes from the database (gamerabbit_new_code)
      return check(await c.from("gamerabbit_profiles").insert({ name: "" }).select("code, name").single()) as Profile;
    },
    async setName(name) {
      check(await c.from("gamerabbit_profiles").update({ name: name.trim().slice(0, NAME_MAX) }).eq("user_id", me));
    },
    async list() {
      const rows = check(await c.from("gamerabbit_friends").select("requester, addressee, status")) as {
        requester: string;
        addressee: string;
        status: "pending" | "accepted";
      }[];
      const others = rows.map((r) => (r.requester === me ? r.addressee : r.requester));
      if (!others.length) return [];
      const profiles = check(await c.from("gamerabbit_profiles").select("user_id, name").in("user_id", others)) as { user_id: string; name: string }[];
      const names = new Map(profiles.map((p) => [p.user_id, p.name]));
      return rows.map((r, i) => ({
        id: others[i],
        name: names.get(others[i]) ?? "",
        status: r.status === "accepted" ? "accepted" : r.requester === me ? "outgoing" : "incoming",
      }));
    },
    async add(code) {
      return check(await c.rpc("gamerabbit_add_friend", { friend_code: cleanCode(code) })) as AddResult;
    },
    async accept(id) {
      check(await c.rpc("gamerabbit_accept_friend", { other: id }));
    },
    async remove(id) {
      check(
        await c
          .from("gamerabbit_friends")
          .delete()
          .or(`and(requester.eq.${me},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${me})`),
      );
    },
    async rings(id) {
      const rows = check(await c.rpc("mapringer_friend_rings", { friend: id })) as { result: Result }[];
      return rows.map((r) => r.result);
    },
    async today(id, day) {
      return check(await c.rpc("mapringer_friend_today", { friend: id, today: day })) as TodayView;
    },
    async hidden() {
      const row = check(await c.from("mapringer_settings").select("hide_rings").eq("user_id", me).maybeSingle()) as { hide_rings: boolean } | null;
      return !!row?.hide_rings;
    },
    async setHidden(hidden) {
      check(await c.from("mapringer_settings").upsert({ hide_rings: hidden, updated_at: new Date().toISOString() }, { onConflict: "user_id" }));
    },
  };
}
