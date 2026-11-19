// Live data manager: one controlled polling loop, caching, freshness/stale detection,
// and score-change events. Views subscribe through the event bus.
import * as P from "./provider/espn.js";
import { emit, etDay, store } from "./util.js";

const now = () => Date.now();

export const Live = {
  provider: P.PROVIDER,
  today: etDay(),
  boards: new Map(), // day -> { games, at, err, fetching }
  sums: new Map(), // gameId -> { data, at, err, fetching }
  watchedDays: new Set(),
  watchedGames: new Map(), // gameId -> reason count
  flashes: new Map(), // `${gameId}:${teamId}` -> { delta, until }
  lastPlaySeq: new Map(),
  online: navigator.onLine !== false,
};

// ---------- intervals -----------
function boardInterval(day) {
  const b = Live.boards.get(day);
  const games = b?.games || [];
  if (games.some((g) => g.state === "in")) return 12000;
  if (day === Live.today) {
    // Poll faster when a tip-off is within 20 minutes.
    const soon = games.some((g) => g.state === "pre" && new Date(g.date) - now() < 20 * 60000);
    return soon ? 20000 : 60000;
  }
  return 10 * 60000;
}
function sumInterval(id) {
  const g = Live.sums.get(id)?.data?.game || findGame(id);
  // The game page being viewed polls fast; background uses (home, tracking) poll gently.
  const focused = Live.watchedGames.get(id)?.has("view");
  if (!g || g.state === "in") return focused ? 6000 : 30000;
  if (g.state === "pre") return 60000;
  return 15 * 60000;
}
const hiddenFactor = () => (document.hidden ? 4 : 1);

export function findGame(id) {
  for (const b of Live.boards.values()) {
    const g = b.games?.find((x) => x.id === String(id));
    if (g) return g;
  }
  return Live.sums.get(String(id))?.data?.game || null;
}

// ---------- freshness -----------
// Status shown to users: live | delayed | final | scheduled | unavailable | loading
export function freshness(kind, key) {
  const rec = kind === "board" ? Live.boards.get(key) : Live.sums.get(key);
  if (!rec || (!rec.at && !rec.err)) return { level: "loading", at: 0 };
  const iv = kind === "board" ? boardInterval(key) : sumInterval(key);
  const age = now() - (rec.at || 0);
  if (!rec.at) return { level: "unavailable", at: 0, err: rec.err };
  if (rec.err && age > iv * 2) return { level: "delayed", at: rec.at, err: rec.err };
  if (age > Math.max(iv * 3, 30000) * hiddenFactor()) return { level: "delayed", at: rec.at };
  return { level: "ok", at: rec.at };
}

// ---------- fetching -----------
async function fetchBoard(day) {
  const rec = Live.boards.get(day) || {};
  if (rec.fetching) return;
  rec.fetching = true;
  Live.boards.set(day, rec);
  try {
    const games = await P.scoreboard(day);
    detectScoreChanges(rec.games, games);
    rec.games = games;
    rec.at = now();
    rec.err = null;
    if (day === Live.today) store.set("board:" + day, { games, at: rec.at });
  } catch (e) {
    rec.err = String(e.message || e);
    if (!rec.games) {
      const cached = store.get("board:" + day);
      if (cached) {
        rec.games = cached.games;
        rec.cachedAt = cached.at;
      }
    }
  } finally {
    rec.fetching = false;
    rec.lastTry = now();
    emit("board", day);
  }
}

async function fetchSummary(id) {
  const rec = Live.sums.get(id) || {};
  if (rec.fetching) return;
  rec.fetching = true;
  Live.sums.set(id, rec);
  try {
    const prev = rec.data;
    const data = await P.summary(id);
    rec.data = data;
    rec.at = now();
    rec.err = null;
    // keep scoreboard copy in sync with the fresher summary header
    for (const b of Live.boards.values()) {
      const i = b.games?.findIndex((g) => g.id === id) ?? -1;
      if (i >= 0) {
        const old = b.games[i];
        detectScoreChanges([old], [data.game]);
        b.games[i] = { ...old, ...pickLive(data.game, old) };
      }
    }
    emit("summary", { id, prev, data });
  } catch (e) {
    rec.err = String(e.message || e);
    emit("summary", { id, error: rec.err });
  } finally {
    rec.fetching = false;
    rec.lastTry = now();
  }
}

function pickLive(g, old) {
  return {
    state: g.state,
    detail: g.detail,
    period: g.period,
    clock: g.clock,
    completed: g.completed,
    home: { ...old.home, score: g.home.score, linescores: g.home.linescores },
    away: { ...old.away, score: g.away.score, linescores: g.away.linescores },
  };
}

function detectScoreChanges(prevGames, games) {
  if (!prevGames) return;
  const byId = new Map(prevGames.map((g) => [g.id, g]));
  for (const g of games) {
    const p = byId.get(g.id);
    if (!p) continue;
    for (const s of ["home", "away"]) {
      const d = (g[s].score ?? 0) - (p[s].score ?? 0);
      if (d > 0 && p[s].score != null) {
        Live.flashes.set(`${g.id}:${g[s].id}`, { delta: d, until: now() + 5000 });
        emit("score", { gameId: g.id, teamId: g[s].id, delta: d });
      }
    }
    if (p.state !== g.state) emit("state", { game: g, from: p.state });
  }
}

export function flashFor(gameId, teamId) {
  const f = Live.flashes.get(`${gameId}:${teamId}`);
  return f && f.until > now() ? f : null;
}

// ---------- public API -----------
export function getBoard(day) {
  return Live.boards.get(day);
}
export function getSummary(id) {
  return Live.sums.get(String(id))?.data || null;
}
export function sumRecord(id) {
  return Live.sums.get(String(id));
}

export function watchDay(day) {
  Live.watchedDays.add(day);
  const rec = Live.boards.get(day);
  if (!rec || (!rec.at && !rec.fetching)) fetchBoard(day);
  return () => Live.watchedDays.delete(day);
}

// reason lets several features watch the same game (open page, followed player tracking).
export function watchGame(id, reason = "view") {
  id = String(id);
  const set = Live.watchedGames.get(id) || new Set();
  set.add(reason);
  Live.watchedGames.set(id, set);
  const rec = Live.sums.get(id);
  if (!rec || (!rec.at && !rec.fetching)) fetchSummary(id);
  return () => unwatchGame(id, reason);
}
export function unwatchGame(id, reason = "view") {
  const set = Live.watchedGames.get(String(id));
  if (!set) return;
  set.delete(reason);
  if (!set.size) Live.watchedGames.delete(String(id));
}

export function refreshNow() {
  for (const d of Live.watchedDays) fetchBoard(d);
  for (const id of Live.watchedGames.keys()) fetchSummary(id);
}

export function ensureSummary(id) {
  const rec = Live.sums.get(String(id));
  if (rec?.data && now() - rec.at < sumInterval(String(id))) return Promise.resolve(rec.data);
  return fetchSummary(String(id)).then(() => Live.sums.get(String(id))?.data);
}

// Cached static-ish lookups (teams list, rosters, athletes) with TTL.
const memo = new Map();
export async function cached(key, ttlMs, fn) {
  const m = memo.get(key);
  if (m && now() - m.at < ttlMs) return m.v;
  const s = store.get("c:" + key);
  if (s && now() - s.at < ttlMs) {
    memo.set(key, s);
    return s.v;
  }
  try {
    const v = await fn();
    const rec = { v, at: now() };
    memo.set(key, rec);
    store.set("c:" + key, rec);
    return v;
  } catch (e) {
    if (s) return s.v; // stale cache beats nothing
    throw e;
  }
}
export const provider = P;

// ---------- loop -----------
function tick() {
  Live.today = etDay();
  const t = now();
  for (const d of Live.watchedDays) {
    const rec = Live.boards.get(d);
    if (!rec || rec.fetching) continue;
    if (t - (rec.lastTry || 0) >= boardInterval(d) * hiddenFactor()) fetchBoard(d);
  }
  for (const id of Live.watchedGames.keys()) {
    const rec = Live.sums.get(id);
    if (rec?.fetching) continue;
    if (!rec || t - (rec.lastTry || 0) >= sumInterval(id) * hiddenFactor()) fetchSummary(id);
  }
  emit("tick", t);
}
setInterval(tick, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshNow();
});
addEventListener("online", () => {
  Live.online = true;
  refreshNow();
  emit("net", true);
});
addEventListener("offline", () => {
  Live.online = false;
  emit("net", false);
});
