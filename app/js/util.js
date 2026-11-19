// Small shared helpers: escaping, formatting, dates (US Eastern game days), storage, event bus.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const pct = (m, a, d = 1) => (a ? ((100 * m) / a).toFixed(d) : "–");
export const signed = (n) => (n > 0 ? "+" + n : String(n));

export function ago(ts) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

// NBA game days follow US Eastern time.
export function etDay(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p.replace(/-/g, "");
}
export function dayToDate(day) {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), 12));
}
export function shiftDay(day, n) {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
export function dayLabel(day, opts = { weekday: "short", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(dayToDate(day));
}
export function localTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function localDateTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function shortDate(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
}

// localStorage that never throws (private mode, WebView quirks).
export const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem("nbalive:" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("nbalive:" + k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem("nbalive:" + k);
    } catch {}
  },
};

// Tiny event bus.
const handlers = new Map();
export function on(evt, fn) {
  if (!handlers.has(evt)) handlers.set(evt, new Set());
  handlers.get(evt).add(fn);
  return () => handlers.get(evt).delete(fn);
}
export function emit(evt, data) {
  (handlers.get(evt) || []).forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error("[bus]", evt, e);
    }
  });
}

export function initials(name) {
  const parts = String(name || "?").replace(/\b(Jr\.?|Sr\.?|II|III|IV)\b/g, "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Readable text colour on a team colour.
export function inkOn(hex) {
  const h = String(hex || "#444").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#111" : "#fff";
}

export function teamBadge(t, cls = "") {
  if (!t) return "";
  const c = t.color || "#555";
  return `<span class="tbadge ${cls}" style="background:${esc(c)};color:${inkOn(c)}" title="${esc(t.name || t.abbr)}">${esc(t.abbr || "?")}</span>`;
}

export function playerBadge(p, team, cls = "") {
  const c = team?.color || "#444";
  return `<span class="pbadge ${cls}" style="--tc:${esc(c)};--ti:${inkOn(c)}">${esc(initials(p?.name))}${p?.jersey ? `<i>${esc(p.jersey)}</i>` : ""}</span>`;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function toast(msg, kind = "") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add("out"), 4200);
  setTimeout(() => el.remove(), 4800);
}

export function avatar(profile, cls = "") {
  const name = profile?.display_name || profile?.username || "?";
  const c = profile?.avatar_color || "#ff6a2b";
  return `<span class="avatar ${cls}" style="background:${esc(c)};color:${inkOn(c)}">${esc(initials(name))}</span>`;
}
