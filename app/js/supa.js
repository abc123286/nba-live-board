// Supabase: auth, profiles, discussions, reactions, chat, follows, notification prefs.
// Loaded lazily from a CDN so the app shell stays fast. Everything degrades gracefully
// when the database isn't configured yet.
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_URL } from "./config.js";
import { emit, store } from "./util.js";

export const enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const Auth = { ready: false, user: null, profile: null };

let client = null;
let loading = null;

export async function sb() {
  if (!enabled) return null;
  if (client) return client;
  loading =
    loading ||
    import("https://esm.sh/@supabase/supabase-js@2").then((m) => {
      client = m.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
        realtime: { params: { eventsPerSecond: 5 } },
      });
      return client;
    });
  return loading;
}

const need = async () => {
  const c = await sb();
  if (!c) throw new Error("Community features aren't connected yet.");
  return c;
};
const me = () => {
  if (!Auth.user) throw new Error("Please sign in first.");
  return Auth.user.id;
};
const check = ({ data, error }) => {
  if (error) throw new Error(friendly(error));
  return data;
};
function friendly(e) {
  const m = e?.message || String(e);
  if (/rate limit/i.test(m)) return "You're posting too fast. Wait a few seconds and try again.";
  if (/duplicate key.*username/i.test(m)) return "That username is taken.";
  if (/violates row-level security/i.test(m)) return "You don't have permission to do that.";
  return m;
}

export async function initAuth() {
  if (!enabled) {
    Auth.ready = true;
    emit("auth", Auth);
    return;
  }
  try {
    const c = await sb();
    const { data } = await c.auth.getSession();
    await setUser(data.session?.user || null);
    c.auth.onAuthStateChange(async (event, session) => {
      await setUser(session?.user || null);
      if (event === "PASSWORD_RECOVERY") location.hash = "#/reset";
    });
  } catch (e) {
    console.warn("[auth] init failed", e);
  }
  Auth.ready = true;
  emit("auth", Auth);
}

async function setUser(user) {
  const changed = (Auth.user?.id || null) !== (user?.id || null);
  Auth.user = user;
  if (!user) Auth.profile = null;
  else if (changed || !Auth.profile) {
    try {
      Auth.profile = await getProfile(user.id);
    } catch {
      Auth.profile = null;
    }
  }
  if (changed) emit("auth", Auth);
}

// ---------- auth ----------
const USERNAME = /^[a-zA-Z0-9_]{3,20}$/;
export async function signUp({ email, password, username }) {
  if (!USERNAME.test(username)) throw new Error("Username: 3–20 letters, numbers or _.");
  if (String(password).length < 8) throw new Error("Password must be at least 8 characters.");
  const c = await need();
  const { data: taken } = await c.from("profiles").select("id").ilike("username", username).maybeSingle();
  if (taken) throw new Error("That username is taken.");
  const res = check(await c.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: APP_URL + "?confirmed=1" } }));
  return res;
}
export async function signIn({ email, password }) {
  const c = await need();
  return check(await c.auth.signInWithPassword({ email, password }));
}
export async function signOut() {
  const c = await need();
  await c.auth.signOut();
}
export async function sendReset(email) {
  const c = await need();
  return check(await c.auth.resetPasswordForEmail(email, { redirectTo: APP_URL + "?reset=1" }));
}
export async function updatePassword(password) {
  if (String(password).length < 8) throw new Error("Password must be at least 8 characters.");
  const c = await need();
  return check(await c.auth.updateUser({ password }));
}

// ---------- profiles ----------
export async function getProfile(id) {
  const c = await need();
  return check(await c.from("profiles").select("*").eq("id", id).maybeSingle());
}
export async function updateProfile(patch) {
  const c = await need();
  const clean = {};
  if (patch.display_name != null) clean.display_name = String(patch.display_name).slice(0, 40);
  if (patch.favourite_team != null) clean.favourite_team = String(patch.favourite_team).slice(0, 8);
  if (patch.avatar_color != null && /^#[0-9a-f]{6}$/i.test(patch.avatar_color)) clean.avatar_color = patch.avatar_color;
  const row = check(await c.from("profiles").update(clean).eq("id", me()).select().single());
  Auth.profile = row;
  emit("auth", Auth);
  return row;
}

// ---------- comments (game-level when playId is null, play-level otherwise) ----------
const COMMENT_SELECT = "id, game_id, play_id, parent_id, user_id, body, created_at, edited_at, deleted, like_count, reply_count, profiles!comments_user_id_fkey(username, display_name, avatar_color)";

export async function listComments(gameId, playId = null, { limit = 100 } = {}) {
  const c = await need();
  let q = c.from("comments").select(COMMENT_SELECT).eq("game_id", gameId).eq("hidden", false).order("created_at", { ascending: true }).limit(limit);
  q = playId ? q.eq("play_id", playId) : q.is("play_id", null);
  const rows = check(await q);
  let liked = new Set();
  if (Auth.user && rows.length) {
    const l = check(await c.from("comment_likes").select("comment_id").eq("user_id", Auth.user.id).in("comment_id", rows.map((r) => r.id)));
    liked = new Set(l.map((x) => x.comment_id));
  }
  return rows.map((r) => ({ ...r, liked: liked.has(r.id) }));
}

export async function addComment({ gameId, playId = null, parentId = null, body }) {
  const text = String(body || "").trim();
  if (!text) throw new Error("Write something first.");
  if (text.length > 1000) throw new Error("Keep it under 1000 characters.");
  const c = await need();
  return check(await c.from("comments").insert({ game_id: gameId, play_id: playId, parent_id: parentId, user_id: me(), body: text }).select(COMMENT_SELECT).single());
}
export async function deleteComment(id) {
  const c = await need();
  return check(await c.from("comments").update({ deleted: true, body: "" }).eq("id", id).eq("user_id", me()));
}
export async function toggleLike(commentId, liked) {
  const c = await need();
  if (liked) return check(await c.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", me()));
  return check(await c.from("comment_likes").insert({ comment_id: commentId, user_id: me() }));
}
export async function report({ commentId = null, chatId = null, reason }) {
  const c = await need();
  return check(await c.from("reports").insert({ comment_id: commentId, chat_id: chatId, user_id: me(), reason: String(reason || "").slice(0, 200) }));
}

// Per-play counts for a whole game (comments + reactions), one round-trip each.
export async function playActivity(gameId) {
  const c = await need();
  const [cm, rx] = await Promise.all([
    c.from("comments").select("play_id").eq("game_id", gameId).eq("hidden", false).eq("deleted", false).not("play_id", "is", null).limit(5000),
    c.from("play_reactions").select("play_id, emoji, user_id").eq("game_id", gameId).limit(10000),
  ]);
  const out = {};
  for (const r of check(cm)) (out[r.play_id] ||= { comments: 0, reactions: {}, mine: new Set() }).comments++;
  for (const r of check(rx)) {
    const o = (out[r.play_id] ||= { comments: 0, reactions: {}, mine: new Set() });
    o.reactions[r.emoji] = (o.reactions[r.emoji] || 0) + 1;
    if (Auth.user && r.user_id === Auth.user.id) o.mine.add(r.emoji);
  }
  return out;
}

export const EMOJIS = ["🔥", "👏", "😮", "😂", "😤", "💀"];
export async function toggleReaction(gameId, playId, emoji, on) {
  if (!EMOJIS.includes(emoji)) throw new Error("Unknown reaction");
  const c = await need();
  if (on) return check(await c.from("play_reactions").delete().match({ play_id: playId, user_id: me(), emoji }));
  return check(await c.from("play_reactions").insert({ game_id: gameId, play_id: playId, user_id: me(), emoji }));
}

export async function recentComments(limit = 30) {
  const c = await need();
  return check(await c.from("comments").select(COMMENT_SELECT).eq("hidden", false).eq("deleted", false).order("created_at", { ascending: false }).limit(limit));
}

// ---------- live game chat ----------
const CHAT_SELECT = "id, game_id, user_id, body, created_at, profiles!chat_messages_user_id_fkey(username, display_name, avatar_color)";
export async function chatHistory(gameId, limit = 60) {
  const c = await need();
  const rows = check(await c.from("chat_messages").select(CHAT_SELECT).eq("game_id", gameId).eq("hidden", false).order("created_at", { ascending: false }).limit(limit));
  return rows.reverse();
}
export async function sendChat(gameId, body) {
  const text = String(body || "").trim();
  if (!text) return;
  if (text.length > 300) throw new Error("Keep chat messages under 300 characters.");
  const c = await need();
  return check(await c.from("chat_messages").insert({ game_id: gameId, user_id: me(), body: text }).select(CHAT_SELECT).single());
}

// Realtime subscription for a game's chat + discussions. Returns unsubscribe.
export async function subscribeGame(gameId, handlers) {
  const c = await sb();
  if (!c) return () => {};
  const ch = c
    .channel("game:" + gameId)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `game_id=eq.${gameId}` }, (p) => handlers.chat?.(p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `game_id=eq.${gameId}` }, (p) => handlers.comment?.(p))
    .on("postgres_changes", { event: "*", schema: "public", table: "play_reactions", filter: `game_id=eq.${gameId}` }, (p) => handlers.reaction?.(p))
    .on("presence", { event: "sync" }, () => handlers.presence?.(Object.keys(ch.presenceState()).length))
    .subscribe(async (st) => {
      if (st === "SUBSCRIBED") await ch.track({ at: Date.now() });
    });
  return () => c.removeChannel(ch);
}

export async function profilesByIds(ids) {
  const c = await need();
  if (!ids.length) return [];
  return check(await c.from("profiles").select("id, username, display_name, avatar_color").in("id", ids));
}

// ---------- follows (local for guests, synced when signed in) ----------
export function localFollows() {
  return store.get("follows", []);
}
export async function listFollows() {
  if (!enabled || !Auth.user) return localFollows();
  const c = await sb();
  const rows = check(await c.from("follows").select("kind, ref_id, ref_name, team_id").eq("user_id", Auth.user.id));
  // merge any guest follows made before signing in
  const local = localFollows();
  const missing = local.filter((l) => !rows.some((r) => r.kind === l.kind && r.ref_id === l.ref_id));
  if (missing.length) {
    await c.from("follows").upsert(missing.map((m) => ({ ...m, user_id: Auth.user.id })));
    rows.push(...missing);
  }
  store.set("follows", rows);
  return rows;
}
export async function setFollow(f, on) {
  const local = localFollows().filter((x) => !(x.kind === f.kind && x.ref_id === f.ref_id));
  if (on) local.push({ kind: f.kind, ref_id: String(f.ref_id), ref_name: f.ref_name || "", team_id: f.team_id || null });
  store.set("follows", local);
  if (enabled && Auth.user) {
    const c = await sb();
    if (on) check(await c.from("follows").upsert({ user_id: Auth.user.id, kind: f.kind, ref_id: String(f.ref_id), ref_name: f.ref_name || "", team_id: f.team_id || null }));
    else check(await c.from("follows").delete().match({ user_id: Auth.user.id, kind: f.kind, ref_id: String(f.ref_id) }));
  }
  emit("follows", local);
  return local;
}

// ---------- notification preferences + inbox ----------
export const DEFAULT_PREFS = { game_start: true, game_final: true, close_game: true, milestones: true, replies: true, browser_push: false };
export async function getPrefs() {
  const local = { ...DEFAULT_PREFS, ...store.get("prefs", {}) };
  if (!enabled || !Auth.user) return local;
  const c = await sb();
  const row = check(await c.from("notification_prefs").select("*").eq("user_id", Auth.user.id).maybeSingle());
  const merged = { ...local, ...(row || {}) };
  store.set("prefs", merged);
  return merged;
}
export async function savePrefs(p) {
  const clean = {};
  for (const k of Object.keys(DEFAULT_PREFS)) clean[k] = !!p[k];
  store.set("prefs", clean);
  if (enabled && Auth.user) {
    const c = await sb();
    check(await c.from("notification_prefs").upsert({ user_id: Auth.user.id, ...clean }));
  }
  emit("prefs", clean);
  return clean;
}
export async function serverNotifications(limit = 40) {
  if (!enabled || !Auth.user) return [];
  const c = await sb();
  return check(await c.from("notifications").select("*").eq("user_id", Auth.user.id).order("created_at", { ascending: false }).limit(limit));
}
export async function markServerRead(ids) {
  if (!enabled || !Auth.user || !ids.length) return;
  const c = await sb();
  await c.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids).eq("user_id", Auth.user.id);
}
export async function subscribeInbox(fn) {
  const c = await sb();
  if (!c || !Auth.user) return () => {};
  const ch = c
    .channel("inbox:" + Auth.user.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${Auth.user.id}` }, (p) => fn(p.new))
    .subscribe();
  return () => c.removeChannel(ch);
}
