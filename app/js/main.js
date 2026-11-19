// App shell: router, navigation, theme, freshness indicator, notifications bell.
import { $, esc, on, store, ago, avatar, toast } from "./util.js";
import { Live, watchDay, freshness, getBoard } from "./live.js";
import { initAuth, Auth, enabled as dbEnabled } from "./supa.js";
import { initNotify, unreadCount } from "./notify.js";
import { closeSheet, setTheme } from "./ui.js";

const NAV = [
  ["home", "#/", "Home", "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"],
  ["games", "#/games", "Games", "M4 5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 4h16M8 3v4m8-4v4"],
  ["players", "#/players", "Players", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0"],
  ["community", "#/community", "Community", "M4 5h16v10H8l-4 4Z"],
  ["profile", "#/profile", "Profile", "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-6 10.5a7 7 0 0 1 12 0"],
];
const navHtml = (active) =>
  NAV.map(([id, href, label, d]) => `<a href="${href}" class="${id === active ? "on" : ""}" ${id === active ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24"><path d="${d}"/></svg><span>${label}</span></a>`).join("");

const ROUTES = [
  [/^\/?$/, "home", () => import("./views/home.js")],
  [/^\/games$/, "games", () => import("./views/games.js")],
  [/^\/game\/(\d+)(?:\/(\w+))?$/, "games", () => import("./views/game.js"), ["id", "tab"]],
  [/^\/players$/, "players", () => import("./views/players.js")],
  [/^\/player\/(\d+)$/, "players", () => import("./views/player.js"), ["id"]],
  [/^\/community$/, "community", () => import("./views/community.js")],
  [/^\/profile$/, "profile", () => import("./views/profile.js")],
  [/^\/notifications$/, "profile", () => import("./views/notifications.js")],
  [/^\/(login|register|forgot|reset)$/, "profile", () => import("./views/auth.js"), ["mode"]],
];

let active = null; // { key, mod, inst }
let navToken = 0;

function parseHash() {
  let h = location.hash.replace(/^#/, "");
  if (/^(access_token|error|type=)/.test(h)) return null; // Supabase auth redirect fragments
  const [path, qs] = h.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(qs || "")) };
}

async function route() {
  const r = parseHash();
  if (!r) return;
  const token = ++navToken;
  let match = null;
  for (const [re, section, load, names] of ROUTES) {
    const m = r.path.match(re);
    if (m) {
      const params = {};
      (names || []).forEach((n, i) => (params[n] = m[i + 1]));
      match = { section, load, params };
      break;
    }
  }
  const view = $("#view");
  if (!match) {
    active?.inst?.destroy?.();
    active = null;
    view.innerHTML = `<div class="page"><h1>Page not found</h1><p><a href="#/">Go home</a></p></div>`;
    return;
  }
  $("#navSide").innerHTML = navHtml(match.section);
  $("#bottomnav").innerHTML = navHtml(match.section);
  closeSheet();

  const key = r.path.startsWith("/game/") ? "/game/" + match.params.id : r.path;
  // Same game page, different tab: let the view switch tabs without a full remount.
  if (active && active.key === key && active.inst?.navigate) {
    active.inst.navigate(match.params, r.query);
    return;
  }
  try {
    active?.inst?.destroy?.();
  } catch (e) {
    console.error(e);
  }
  active = null;
  const mod = await match.load();
  if (token !== navToken) return;
  // Fresh container per mount so listeners from the previous view die with it.
  const host = document.createElement("div");
  host.className = "view-host";
  view.replaceChildren(host);
  window.scrollTo(0, 0);
  const inst = (await mod.mount(host, match.params, r.query)) || {};
  if (token !== navToken) {
    inst.destroy?.();
    return;
  }
  active = { key, mod, inst };
  document.title = (inst.title ? inst.title + " · " : "") + "NBA Live";
}

// ---------- theme ----------
$("#themeBtn").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
setTheme(document.documentElement.dataset.theme || "dark");

// ---------- freshness pill ----------
function renderFresh() {
  const el = $("#fresh");
  if (!Live.online) {
    el.className = "fresh bad";
    el.innerHTML = `<i></i>Offline — showing saved data`;
    return;
  }
  const b = getBoard(Live.today);
  const f = freshness("board", Live.today);
  const live = (b?.games || []).filter((g) => g.state === "in").length;
  if (f.level === "loading") {
    el.className = "fresh";
    el.innerHTML = `<i></i>Connecting…`;
  } else if (f.level === "unavailable") {
    el.className = "fresh bad";
    el.innerHTML = `<i></i>Feed unavailable`;
  } else if (f.level === "delayed") {
    el.className = "fresh warn";
    el.innerHTML = `<i></i>Delayed · ${ago(f.at)}`;
  } else {
    el.className = "fresh " + (live ? "live" : "");
    el.innerHTML = `<i></i>${live ? `${live} live` : "Up to date"} · ${ago(f.at)}`;
  }
  el.title = `${Live.provider.name}. ${Live.provider.note}`;
}

function renderBell() {
  const n = unreadCount();
  const b = $("#bellCount");
  b.hidden = !n;
  b.textContent = n > 9 ? "9+" : n;
}
function renderMe() {
  $("#meBtn").innerHTML = Auth.profile ? avatar(Auth.profile, "sm") : `<svg viewBox="0 0 24 24"><path d="${NAV[4][3]}"/></svg>`;
  $("#sideFoot").innerHTML = Auth.profile
    ? `<a href="#/profile" class="side-me">${avatar(Auth.profile, "sm")}<span>${esc(Auth.profile.display_name || Auth.profile.username)}<small>@${esc(Auth.profile.username)}</small></span></a>`
    : `<a href="#/login" class="btn ghost sm">Sign in</a><p class="tiny">${dbEnabled ? "Join to comment, react and get synced alerts." : "Community features switch on once the database is connected."}</p>`;
}

// ---------- boot ----------
watchDay(Live.today);
on("tick", renderFresh);
on("board", renderFresh);
on("net", renderFresh);
on("inbox", renderBell);
on("auth", renderMe);
addEventListener("hashchange", route);

const qs = new URLSearchParams(location.search);
if (qs.has("confirmed")) toast("Email confirmed — welcome to NBA Live!", "good");
initNotify();
initAuth().then(() => {
  if (qs.has("reset") && !location.hash.startsWith("#/reset")) location.hash = "#/reset";
  if (qs.has("confirmed") || qs.has("reset")) history.replaceState(null, "", location.pathname + location.hash);
});
renderMe();
renderBell();
renderFresh();
if (!parseHash()) {
  // auth fragment: wait for Supabase to consume it, then go home
  setTimeout(() => {
    if (!parseHash()) location.hash = "#/";
  }, 1500);
} else route();

// Expose for debugging in the browser console.
window.__nba = { Live, Auth };
