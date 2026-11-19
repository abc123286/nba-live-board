// Follows, live player tracking and in-app notifications.
// Milestones are detected from the live box score while the app is open (no server push yet).
import { Live, getBoard, getSummary, watchGame, unwatchGame } from "./live.js";
import * as DB from "./supa.js";
import { emit, on, store, toast, esc } from "./util.js";

let follows = DB.localFollows();
let prefs = { ...DB.DEFAULT_PREFS, ...store.get("prefs", {}) };
const tracked = new Set();

export const isFollowing = (kind, id) => follows.some((f) => f.kind === kind && f.ref_id === String(id));
export const getFollows = () => follows;
export const getPrefsSync = () => prefs;

export async function toggleFollow(f) {
  const onNow = isFollowing(f.kind, f.ref_id);
  follows = await DB.setFollow(f, !onNow);
  syncTracking();
  toast(onNow ? `Unfollowed ${esc(f.ref_name)}` : `Following ${esc(f.ref_name)}. You'll get live alerts while the app is open.`);
  return !onNow;
}

// ---------- inbox (local + server) ----------
let inbox = store.get("inbox", []);
export const getInbox = () => inbox;
export const unreadCount = () => inbox.filter((n) => !n.read).length;

export function push(n) {
  const key = n.key || n.title + n.body;
  if (inbox.some((x) => x.key === key)) return;
  const item = { id: "l" + Date.now() + Math.random().toString(36).slice(2, 6), key, kind: n.kind, title: n.title, body: n.body || "", link: n.link || "", at: Date.now(), read: false };
  inbox = [item, ...inbox].slice(0, 100);
  store.set("inbox", inbox);
  emit("inbox", inbox);
  toast(`<b>${esc(item.title)}</b>${item.body ? "<br>" + esc(item.body) : ""}`, "note");
  if (prefs.browser_push && "Notification" in window && Notification.permission === "granted" && document.hidden) {
    try {
      new Notification(item.title, { body: item.body, tag: key });
    } catch {}
  }
}
export function markAllRead() {
  inbox = inbox.map((n) => ({ ...n, read: true }));
  store.set("inbox", inbox);
  DB.markServerRead(inbox.filter((n) => n.server).map((n) => n.serverId)).catch(() => {});
  emit("inbox", inbox);
}
export function clearInbox() {
  inbox = [];
  store.set("inbox", inbox);
  emit("inbox", inbox);
}

async function pullServerInbox() {
  try {
    const rows = await DB.serverNotifications();
    let added = false;
    for (const r of rows) {
      const key = "s" + r.id;
      if (inbox.some((x) => x.key === key)) continue;
      inbox.push({ id: key, key, server: true, serverId: r.id, kind: r.kind, title: r.title, body: r.body || "", link: r.link || "", at: Date.parse(r.created_at), read: !!r.read_at });
      added = true;
    }
    if (added) {
      inbox.sort((a, b) => b.at - a.at);
      store.set("inbox", inbox);
      emit("inbox", inbox);
    }
  } catch {}
}

// ---------- milestone engine ----------
const MILESTONES = [
  { id: "pts10", test: (p) => p.pts >= 10, label: (p) => `${p.pts} points` },
  { id: "pts20", test: (p) => p.pts >= 20, label: (p) => `${p.pts} points` },
  { id: "pts30", test: (p) => p.pts >= 30, label: (p) => `${p.pts} points` },
  { id: "pts40", test: (p) => p.pts >= 40, label: (p) => `${p.pts} points` },
  { id: "pts50", test: (p) => p.pts >= 50, label: (p) => `${p.pts} points` },
  { id: "reb10", test: (p) => p.reb >= 10, label: (p) => `${p.reb} rebounds` },
  { id: "ast10", test: (p) => p.ast >= 10, label: (p) => `${p.ast} assists` },
  { id: "3pm5", test: (p) => p.tpm >= 5, label: (p) => `${p.tpm} threes` },
  { id: "dd", test: (p) => [p.pts, p.reb, p.ast, p.stl, p.blk].filter((x) => x >= 10).length >= 2, label: () => "a double-double" },
  { id: "td", test: (p) => [p.pts, p.reb, p.ast, p.stl, p.blk].filter((x) => x >= 10).length >= 3, label: () => "a triple-double" },
];
const seen = store.get("seen", {});
const baselined = new Set();
function markSeen(k) {
  seen[k] = Date.now();
  // prune entries older than 3 days
  const cut = Date.now() - 3 * 864e5;
  for (const x of Object.keys(seen)) if (seen[x] < cut) delete seen[x];
  store.set("seen", seen);
}

function checkGame(sum) {
  const g = sum.game;
  const firstLook = !baselined.has(g.id);
  baselined.add(g.id);
  if (!prefs.milestones) return;
  for (const f of follows.filter((x) => x.kind === "player")) {
    const p = sum.byId.get(f.ref_id);
    if (!p) continue;
    for (const m of MILESTONES) {
      const k = `${g.id}:${p.id}:${m.id}`;
      if (seen[k] || !m.test(p)) continue;
      markSeen(k);
      // On first look at a game, record what's already happened silently (no flood of old alerts).
      if (firstLook) continue;
      push({ key: k, kind: "milestone", title: `${p.name} has ${m.label(p)}`, body: `${g.away.abbr} ${g.away.score ?? ""} – ${g.home.score ?? ""} ${g.home.abbr} · ${g.detail}`, link: `#/player/${p.id}` });
    }
  }
}

function followedTeamIds() {
  const ids = new Set(follows.filter((f) => f.kind === "team").map((f) => f.ref_id));
  for (const f of follows) if (f.kind === "player" && f.team_id) ids.add(String(f.team_id));
  return ids;
}

function syncTracking() {
  const board = getBoard(Live.today);
  const teamIds = followedTeamIds();
  const want = new Set();
  for (const g of board?.games || []) {
    if (g.state === "in" && (teamIds.has(g.home.id) || teamIds.has(g.away.id))) want.add(g.id);
  }
  for (const id of want) if (!tracked.has(id)) watchGame(id, "track");
  for (const id of tracked) if (!want.has(id)) unwatchGame(id, "track");
  tracked.clear();
  want.forEach((id) => tracked.add(id));
}

export function initNotify() {
  on("board", (day) => {
    if (day === Live.today) syncTracking();
  });
  on("summary", ({ id, data }) => {
    if (data && tracked.has(id)) checkGame(data);
    else if (data && follows.some((f) => f.kind === "player" && data.byId.has(f.ref_id))) checkGame(data);
  });
  on("state", ({ game: g, from }) => {
    const teamIds = followedTeamIds();
    if (!(teamIds.has(g.home.id) || teamIds.has(g.away.id))) return;
    if (g.state === "in" && from === "pre" && prefs.game_start) push({ key: g.id + ":start", kind: "game", title: `Tip-off: ${g.away.abbr} @ ${g.home.abbr}`, body: "Your followed team is live now.", link: `#/game/${g.id}` });
    if (g.state === "post" && prefs.game_final) push({ key: g.id + ":final", kind: "game", title: `Final: ${g.away.abbr} ${g.away.score} – ${g.home.score} ${g.home.abbr}`, body: "Tap for the box score and summary.", link: `#/game/${g.id}/overview` });
  });
  on("board", (day) => {
    if (day !== Live.today || !prefs.close_game) return;
    const teamIds = followedTeamIds();
    for (const g of getBoard(day)?.games || []) {
      if (g.state !== "in" || !(teamIds.has(g.home.id) || teamIds.has(g.away.id))) continue;
      const [m, s] = String(g.clock || "0:0").split(":").map(Number);
      const secs = (m || 0) * 60 + (s || 0);
      const diff = Math.abs((g.home.score ?? 0) - (g.away.score ?? 0));
      if (g.period >= 4 && secs <= 180 && diff <= 5) push({ key: `${g.id}:close:${g.period}`, kind: "game", title: `Close game: ${g.away.abbr} ${g.away.score} – ${g.home.score} ${g.home.abbr}`, body: `${g.detail} — within ${diff}.`, link: `#/game/${g.id}` });
    }
  });
  on("prefs", (p) => (prefs = p));
  on("auth", async () => {
    try {
      follows = await DB.listFollows();
      prefs = await DB.getPrefs();
    } catch {}
    syncTracking();
    pullServerInbox();
    DB.subscribeInbox(() => pullServerInbox());
    emit("follows", follows);
  });
  setInterval(pullServerInbox, 120000);
}

// For views: is this player on the floor and what is their live line?
export function liveLineFor(playerId, teamId) {
  const board = getBoard(Live.today);
  const g = (board?.games || []).find((x) => x.home.id === String(teamId) || x.away.id === String(teamId));
  if (!g) return { game: null };
  const sum = getSummary(g.id);
  return { game: g, sum, player: sum?.byId.get(String(playerId)) || null };
}
