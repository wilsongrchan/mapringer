/**
 * The stats dialog's Friends tab: you (nickname, friend code, invite link), add
 * a friend by code, requests, your friends, and the switch that keeps your ring
 * spots from them. Tap a friend for their page: their stats, and where they put
 * today's rings once you've finished yours (friends.ts says when).
 */
import { friendsApi, NAME_MAX, cleanCode, type Friend, type FriendsApi, type TodayView } from "./friends";
import { t } from "./i18n";
import { placeName } from "./places";
import { fmtPoints, STAGES, type Stage } from "./puzzle";
import { computeStats, daysFromRings } from "./stats";
import { renderStats } from "./stats-view";
import type { Result } from "./storage";

export interface FriendsCtx {
  /** Today's day number (the player's local date). */
  today: number;
  signIn(): void;
  toast(msg: string): void;
  /** Close the dialog and show a friend's ring for today on the map. */
  showRing(name: string, r: Result): void;
  inviteUrl(code: string): string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (text: string, onClick: () => void, cls = "") => {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};
const section = (title: string, ...children: Node[]) => {
  const s = el("section", "stat-section");
  s.append(el("h3", "", title), ...children);
  return s;
};
const nameOf = (f: { name: string }) => f.name || t("friendsNoName");

let view: { friend: Friend } | null = null; // null: the list
let run = 0; // a newer render replaces an older one still loading

/**
 * Show the Friends tab in `box` (the list, or the friend last opened). While it
 * loads, an orange ring spins in the middle of the dialog (which keeps one
 * height for both tabs, see style.css).
 */
export function renderFriends(box: HTMLElement, ctx: FriendsCtx, reset = false): void {
  if (reset) view = null;
  const mine = ++run;
  const stale = () => mine !== run;
  const loading = el("div", "friends-loading");
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-label", t("friendsLoading"));
  loading.append(el("span", "ring-spinner"));
  box.replaceChildren(loading);
  const show = (...parts: Node[]) => {
    if (stale()) return;
    box.replaceChildren(...parts);
  };
  friendsApi()
    .then(async (api) => {
      if (stale()) return;
      if (!api) return show(signedOut(ctx));
      show(...(view ? await friendPage(api, view.friend, box, ctx) : await friendList(api, box, ctx)));
    })
    .catch((e) => {
      console.warn("friends", e);
      show(el("p", "small", t("friendsError")));
    });
}

function signedOut(ctx: FriendsCtx) {
  const d = el("div", "friends-signin");
  d.append(el("p", "small", t("friendsSignIn")), button(t("signInTitle"), ctx.signIn, "primary"));
  return d;
}

async function friendList(api: FriendsApi, box: HTMLElement, ctx: FriendsCtx): Promise<Node[]> {
  // (the switch's setting is MapRinger's own table: if it can't be read, the switch just doesn't show)
  const [me, friends, hidden] = await Promise.all([api.me(), api.list(), api.hidden().catch(() => null)]);
  const again = () => renderFriends(box, ctx);

  // you: nickname, code, invite link
  const nick = el("input", "friends-input");
  Object.assign(nick, { value: me.name, maxLength: NAME_MAX, placeholder: t("friendsNicknamePh"), autocomplete: "nickname" });
  nick.setAttribute("aria-label", t("friendsNickname"));
  const save = button(t("friendsSave"), async () => {
    await api.setName(nick.value);
    ctx.toast(t("friendsSaved"));
  });
  const nickRow = el("div", "friends-row");
  nickRow.append(nick, save);
  const code = el("div", "friends-code");
  code.append(el("span", "", t("friendsCode")), el("strong", "", me.code));
  const copy = button(t("friendsCopyLink"), async () => {
    try {
      await navigator.clipboard.writeText(ctx.inviteUrl(me.code));
      ctx.toast(t("friendsCopied"));
    } catch {
      ctx.toast(ctx.inviteUrl(me.code));
    }
  }, "link-btn");
  code.append(copy);
  const you = section(t("friendsYou"), nickRow, code);

  // add by code
  const input = el("input", "friends-input");
  Object.assign(input, { placeholder: t("friendsCodePh"), autocapitalize: "characters", autocomplete: "off", spellcheck: false, maxLength: 12 });
  input.setAttribute("aria-label", t("friendsCodePh"));
  const msg = el("p", "small friends-msg");
  const add = async () => {
    if (!cleanCode(input.value)) return input.focus();
    try {
      const r = await api.add(input.value);
      const name = r.name || t("friendsNoName");
      msg.textContent =
        r.status === "accepted" ? t("friendsAddAccepted", { name })
        : r.status === "pending" ? t("friendsAddSent", { name })
        : r.status === "self" ? t("friendsAddSelf")
        : t("friendsAddNotFound");
      if (r.status === "accepted" || r.status === "pending") {
        ctx.toast(msg.textContent);
        again();
      }
    } catch {
      msg.textContent = t("friendsAddFailed");
    }
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && add());
  const addRow = el("div", "friends-row");
  addRow.append(input, button(t("friendsAddBtn"), add, "primary"));
  const addSection = section(t("friendsAdd"), addRow, msg);

  const out: Node[] = [];
  // requests to you first: they're waiting on you
  const incoming = friends.filter((f) => f.status === "incoming");
  if (incoming.length) {
    const list = el("ul", "friends-list");
    for (const f of incoming) {
      const li = el("li", "friend-row");
      const acts = el("span", "friend-acts");
      acts.append(
        button(t("friendsAccept"), async () => (await api.accept(f.id), again()), "primary"),
        button(t("friendsDecline"), async () => (await api.remove(f.id), again())),
      );
      li.append(el("span", "friend-name", nameOf(f)), acts);
      list.append(li);
    }
    out.push(section(t("friendsRequests"), list));
  }

  // your friends (tap for their page), then requests you sent
  const accepted = friends.filter((f) => f.status === "accepted").sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const outgoing = friends.filter((f) => f.status === "outgoing");
  const list = el("ul", "friends-list scroll");
  for (const f of accepted) {
    const li = el("li");
    const open = button("", () => {
      view = { friend: f };
      renderFriends(box, ctx);
    }, "friend-row friend-open");
    open.append(el("span", "friend-name", nameOf(f)), el("span", "chev", "›"));
    li.append(open);
    list.append(li);
  }
  for (const f of outgoing) {
    const li = el("li", "friend-row");
    const who = el("span", "friend-name");
    who.append(nameOf(f), el("small", "", ` · ${t("friendsWaiting")}`));
    li.append(who, button(t("friendsCancel"), async () => (await api.remove(f.id), again()), "link-btn"));
    list.append(li);
  }
  out.push(section(t("friendsList"), accepted.length || outgoing.length ? list : el("p", "small", t("friendsNone"))));
  out.push(addSection, you);

  // share today's spots with friends (on unless you switch it off)
  if (hidden === null) return out;
  const share = el("label", "friends-share");
  const box_ = el("input");
  box_.type = "checkbox";
  box_.checked = !hidden;
  box_.addEventListener("change", () => api.setHidden(!box_.checked).catch(() => (box_.checked = !box_.checked)));
  const words = el("span");
  words.append(el("span", "", t("friendsShare")), el("small", "", t("friendsShareNote")));
  share.append(box_, words);
  out.push(share);
  return out;
}

async function friendPage(api: FriendsApi, f: Friend, box: HTMLElement, ctx: FriendsCtx): Promise<Node[]> {
  // (each part on its own: one failing doesn't take the other with it)
  const [rings, today] = await Promise.all([api.rings(f.id).catch(() => null), api.today(f.id, ctx.today).catch(() => null)]);
  const name = nameOf(f);
  const back = button(`‹ ${t("friendsBack")}`, () => {
    view = null;
    renderFriends(box, ctx);
  }, "link-btn friends-back");
  const head = el("div", "friend-head");
  head.append(back, el("h3", "friend-title", name));

  const stats = el("div");
  if (rings) renderStats(stats, computeStats(daysFromRings(rings), ctx.today), true);
  else stats.append(el("p", "small", t("friendsError")));

  const remove = button(t("friendsRemove"), async () => {
    if (!confirm(t("friendsRemoveConfirm", { name }))) return;
    await api.remove(f.id);
    view = null;
    renderFriends(box, ctx);
  }, "link-btn friends-remove");

  const todayBox = today ? todayPart(today, name, ctx) : el("p", "small", t("friendsError"));
  return [head, section(t("friendsToday"), todayBox), section(t("friendsStats"), stats), remove];
}

/** Where they put today's rings (each with Show on map), or why it's not shown. */
function todayPart(today: TodayView, name: string, ctx: FriendsCtx): Node {
  if (today.status !== "ok") {
    const key = today.status === "locked" ? "friendsLocked" : today.status === "hidden" ? "friendsHidden" : "friendsNotPlayed";
    return el("p", "small", t(key, { name }));
  }
  const list = el("ul", "friends-list");
  for (const r of today.rings) {
    const li = el("li", "friend-row friend-ring");
    const what = el("span", "friend-name");
    const place = el("small", "friend-place");
    what.append(
      `${t("ringN", { n: r.stage + 1 })} ${r.emoji} `,
      el("strong", "", fmtPoints(r.points)),
      ` / ${STAGES[r.stage as Stage].max}`,
      place,
    );
    placeName({ lng: r.lng, lat: r.lat })
      .then((p) => (place.textContent = p))
      .catch(() => {});
    li.append(what, button(t("friendsShowOnMap"), () => ctx.showRing(name, r), "link-btn"));
    list.append(li);
  }
  return list;
}
