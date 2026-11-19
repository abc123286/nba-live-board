// Discussion components: threaded comments (game- or play-level) and live game chat.
import * as DB from "../supa.js";
import { esc, on, ago, avatar, toast } from "../util.js";

const profileCache = new Map();
async function profileFor(id) {
  if (profileCache.has(id)) return profileCache.get(id);
  const [p] = await DB.profilesByIds([id]).catch(() => []);
  profileCache.set(id, p || null);
  return p;
}

function signInPrompt(what) {
  return `<div class="signin-cta"><span>Sign in to ${what}.</span><a class="btn sm" href="#/login">Sign in</a><a class="btn ghost sm" href="#/register">Create account</a></div>`;
}
const offline = `<p class="muted">Discussions switch on once the community database is connected.</p>`;

// ---------- threaded comments ----------
export function mountThread(el, { gameId, playId = null, placeholder = "Add to the discussion…" }) {
  if (!DB.enabled) {
    el.innerHTML = offline;
    return { destroy() {} };
  }
  let rows = null;
  let replyTo = null;
  let err = null;
  let busy = false;

  async function load() {
    try {
      rows = await DB.listComments(gameId, playId);
      err = null;
    } catch (e) {
      err = e.message;
      rows = rows || [];
    }
    render();
  }

  function rootOf(c, byId) {
    let x = c;
    for (let i = 0; i < 20 && x.parent_id && byId.get(x.parent_id); i++) x = byId.get(x.parent_id);
    return x.id;
  }

  function item(c, isReply) {
    const mine = DB.Auth.user?.id === c.user_id;
    const name = c.profiles?.display_name || c.profiles?.username || "fan";
    return `<article class="cmt ${isReply ? "reply" : ""}" data-id="${c.id}">
      ${avatar(c.profiles, "sm")}
      <div class="cmt-main">
        <header><b>${esc(name)}</b><small>@${esc(c.profiles?.username || "")} · ${ago(Date.parse(c.created_at))}${c.edited_at && !c.deleted ? " · edited" : ""}</small></header>
        <p class="${c.deleted ? "muted" : ""}">${c.deleted ? "Comment deleted" : esc(c.body)}</p>
        ${
          c.deleted
            ? ""
            : `<footer>
          <button class="lk ${c.liked ? "on" : ""}" data-like="${c.id}" aria-pressed="${c.liked}">♥ ${c.like_count || ""}</button>
          <button data-reply="${c.id}">Reply</button>
          ${mine ? `<button data-del="${c.id}">Delete</button>` : DB.Auth.user ? `<button data-report="${c.id}">Report</button>` : ""}
        </footer>`
        }
      </div>
    </article>`;
  }

  function render() {
    if (rows == null) {
      el.innerHTML = `<p class="muted">Loading discussion…</p>`;
      return;
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const roots = rows.filter((r) => !r.parent_id || !byId.get(r.parent_id));
    const kids = {};
    for (const r of rows) if (r.parent_id && byId.get(r.parent_id)) (kids[rootOf(r, byId)] ||= []).push(r);
    const draft = el.querySelector("textarea")?.value || "";
    el.innerHTML = `
      ${err ? `<p class="bad">${esc(err)}</p>` : ""}
      <div class="thread">${roots.length ? roots.map((r) => item(r, false) + (kids[r.id] || []).map((k) => item(k, true)).join("")).join("") : `<p class="muted">No comments yet. Be the first.</p>`}</div>
      ${
        DB.Auth.user
          ? `<form class="composer" data-compose>
              ${replyTo ? `<div class="replying">Replying to <b>${esc(byId.get(replyTo)?.profiles?.username || "")}</b> <button type="button" data-cancel>Cancel</button></div>` : ""}
              <textarea maxlength="1000" rows="2" placeholder="${esc(placeholder)}" aria-label="Comment">${esc(draft)}</textarea>
              <button class="btn sm" ${busy ? "disabled" : ""}>Post</button>
            </form>`
          : signInPrompt("join the discussion")
      }`;
  }

  async function act(fn) {
    try {
      await fn();
    } catch (e) {
      toast(esc(e.message), "bad");
    }
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.like) {
      const c = rows.find((r) => r.id == b.dataset.like);
      if (!DB.Auth.user) return toast("Sign in to like comments.");
      act(async () => {
        await DB.toggleLike(c.id, c.liked);
        c.liked = !c.liked;
        c.like_count = (c.like_count || 0) + (c.liked ? 1 : -1);
        render();
      });
    } else if (b.dataset.reply) {
      if (!DB.Auth.user) return toast("Sign in to reply.");
      replyTo = +b.dataset.reply;
      render();
      el.querySelector("textarea")?.focus();
    } else if (b.dataset.cancel != null) {
      replyTo = null;
      render();
    } else if (b.dataset.del) {
      if (!confirmInline(b)) return;
      act(async () => {
        await DB.deleteComment(+b.dataset.del);
        await load();
      });
    } else if (b.dataset.report) {
      act(async () => {
        await DB.report({ commentId: +b.dataset.report, reason: "Reported from app" });
        toast("Thanks — a moderator will review it.");
      });
    }
  });
  // Two-tap confirm instead of a blocking dialog.
  function confirmInline(b) {
    if (b.dataset.armed) return true;
    b.dataset.armed = "1";
    b.textContent = "Tap again to delete";
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = "Delete";
    }, 3000);
    return false;
  }
  el.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-compose]")) return;
    e.preventDefault();
    const ta = e.target.querySelector("textarea");
    const body = ta.value;
    busy = true;
    act(async () => {
      try {
        const row = await DB.addComment({ gameId, playId, parentId: replyTo, body });
        ta.value = "";
        replyTo = null;
        if (!rows.some((r) => r.id === row.id)) rows.push({ ...row, liked: false });
      } finally {
        busy = false;
        render();
      }
    });
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.tagName === "TEXTAREA") e.target.form?.requestSubmit();
  });

  const off = on("rt:comment", (p) => {
    const r = p.new || p.old || {};
    if ((r.play_id || null) !== (playId || null)) return;
    // Don't yank the composer away mid-typing; refresh once it loses focus.
    if (document.activeElement?.tagName === "TEXTAREA" && el.contains(document.activeElement)) pending = true;
    else load();
  });
  let pending = false;
  el.addEventListener("focusout", () => {
    if (pending) {
      pending = false;
      setTimeout(load, 150);
    }
  });
  const offAuth = on("auth", load);
  load();
  return {
    destroy() {
      off();
      offAuth();
    },
  };
}

// ---------- live chat ----------
export function mountChat(el, { gameId, live }) {
  if (!DB.enabled) {
    el.innerHTML = offline;
    return { destroy() {} };
  }
  let msgs = [];
  let err = null;
  let online = 0;

  function msg(m) {
    const mine = DB.Auth.user?.id === m.user_id;
    return `<div class="chat-msg ${mine ? "mine" : ""}">${avatar(m.profiles, "xs")}<div><b>${esc(m.profiles?.display_name || m.profiles?.username || "fan")}</b> <small>${new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small><p>${esc(m.body)}</p></div></div>`;
  }
  function render(keepScroll) {
    const list = el.querySelector(".chat-list");
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const draft = el.querySelector("input")?.value || "";
    el.innerHTML = `
      <div class="chat-head"><b>${live ? "Live chat" : "Game chat"}</b><small>${online ? `${online} here now` : ""}</small></div>
      ${err ? `<p class="bad">${esc(err)}</p>` : ""}
      <div class="chat-list">${msgs.length ? msgs.map(msg).join("") : `<p class="muted">No messages yet.</p>`}</div>
      ${DB.Auth.user ? `<form class="chat-form" data-chat><input maxlength="300" placeholder="Say something…" aria-label="Chat message" value="${esc(draft)}"><button class="btn sm">Send</button></form>` : signInPrompt("chat")}`;
    const nl = el.querySelector(".chat-list");
    if (atBottom || !keepScroll) nl.scrollTop = nl.scrollHeight;
  }
  async function load() {
    try {
      msgs = await DB.chatHistory(gameId);
      err = null;
    } catch (e) {
      err = e.message;
    }
    render();
  }
  el.addEventListener("submit", async (e) => {
    if (!e.target.matches("[data-chat]")) return;
    e.preventDefault();
    const inp = e.target.querySelector("input");
    const body = inp.value;
    if (!body.trim()) return;
    inp.value = "";
    try {
      const row = await DB.sendChat(gameId, body);
      if (row && !msgs.some((m) => m.id === row.id)) msgs.push(row);
      const list = el.querySelector(".chat-list");
      list.innerHTML = msgs.map(msg).join("");
      list.scrollTop = list.scrollHeight;
    } catch (e2) {
      inp.value = body;
      toast(esc(e2.message), "bad");
    }
  });
  const offs = [
    on("rt:chat", async (m) => {
      if (msgs.some((x) => x.id === m.id)) return;
      m.profiles = await profileFor(m.user_id);
      msgs.push(m);
      msgs = msgs.slice(-200);
      const list = el.querySelector(".chat-list");
      if (!list) return render();
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      list.innerHTML = msgs.map(msg).join(""); // keep the input (and focus) untouched
      if (atBottom) list.scrollTop = list.scrollHeight;
    }),
    on("rt:presence", (n) => {
      online = n;
      const s = el.querySelector(".chat-head small");
      if (s) s.textContent = n ? `${n} here now` : "";
    }),
    on("auth", load),
  ];
  load();
  return { destroy: () => offs.forEach((o) => o()) };
}
