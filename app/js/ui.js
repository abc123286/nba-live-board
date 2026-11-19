// Shared UI pieces: sheet/drawer, data-status chips, game cards, empty states.
import { esc, teamBadge, localTime, ago, store } from "./util.js";
import { flashFor, freshness } from "./live.js";

// ---------- sheet (bottom sheet on mobile, side drawer on desktop) ----------
let current = null;
export function openSheet(html, { onClose, wide = false } = {}) {
  closeSheet();
  const root = document.getElementById("sheetRoot");
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet-bg" data-close></div><section class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true"><button class="sheet-x" data-close aria-label="Close">×</button><div class="sheet-body">${html}</div></section>`;
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  const keyh = (e) => e.key === "Escape" && closeSheet();
  wrap.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeSheet();
  });
  document.addEventListener("keydown", keyh);
  current = { wrap, onClose, keyh };
  wrap.querySelector(".sheet").focus?.();
  return wrap.querySelector(".sheet-body");
}
export function closeSheet() {
  if (!current) return;
  const { wrap, onClose, keyh } = current;
  current = null;
  document.removeEventListener("keydown", keyh);
  wrap.classList.remove("open");
  setTimeout(() => wrap.remove(), 220);
  try {
    onClose?.();
  } catch {}
}
export const sheetOpen = () => !!current;

// ---------- status labels: live / delayed / final / scheduled / unavailable ----------
export function stateChip(g, fresh) {
  if (!g) return `<span class="chip muted">Unavailable</span>`;
  if (g.state === "in") {
    if (fresh?.level === "delayed") return `<span class="chip warn" title="Feed hasn't updated recently">Delayed</span>`;
    return `<span class="chip live"><i class="dot"></i>Live</span>`;
  }
  if (g.state === "post") return `<span class="chip">Final${/OT/.test(g.detail) ? " " + esc(g.detail.replace(/^Final\/?/, "")) : ""}</span>`;
  if (/postponed|canceled|cancelled|suspended/i.test(g.detail)) return `<span class="chip warn">${esc(g.detail)}</span>`;
  return `<span class="chip muted">Scheduled</span>`;
}

export function scoreCell(g, s) {
  const f = flashFor(g.id, g[s].id);
  const val = g.state === "pre" || g[s].score == null ? "" : g[s].score;
  return `<b class="sc ${f ? "flash" : ""}" data-score="${g.id}:${g[s].id}">${val}${f ? `<em class="delta">+${f.delta}</em>` : ""}</b>`;
}

export function gameCard(g, { big = false } = {}) {
  const lead = g.state !== "pre" && g.home.score != null ? Math.sign((g.home.score || 0) - (g.away.score || 0)) : 0;
  const row = (s, isLead) => `
    <div class="gc-row ${isLead ? "lead" : ""} ${g.state === "post" && !isLead ? "lost" : ""}">
      ${teamBadge(g[s])}<span class="gc-name"><b>${esc(big ? g[s].name : g[s].short || g[s].abbr)}</b><small>${esc(g[s].record || "")}</small></span>
      ${scoreCell(g, s)}
    </div>`;
  const status =
    g.state === "in"
      ? `<span class="gc-clock">${esc(g.detail)}</span>`
      : g.state === "post"
      ? `<span class="gc-clock">${esc(g.detail)}</span>`
      : `<span class="gc-clock">${esc(localTime(g.date))}${g.broadcast ? " · " + esc(g.broadcast) : ""}</span>`;
  return `<a class="gcard ${g.state} ${big ? "big" : ""}" href="#/game/${g.id}" style="--ha:${esc(g.away.color)};--hh:${esc(g.home.color)}">
    <div class="gc-top">${stateChip(g, freshness("summary", g.id).level === "delayed" ? freshness("summary", g.id) : null)}${status}</div>
    ${row("away", lead < 0)}${row("home", lead > 0)}
    ${g.venue && big ? `<div class="gc-foot">${esc(g.venue)}</div>` : ""}
  </a>`;
}

export function empty(title, body = "", action = "") {
  return `<div class="empty"><div class="empty-ball"></div><h3>${esc(title)}</h3>${body ? `<p>${body}</p>` : ""}${action}</div>`;
}

export function skeleton(n = 3, cls = "sk-card") {
  return Array.from({ length: n }, () => `<div class="sk ${cls}"></div>`).join("");
}

export function freshNote(f, label = "Updated") {
  if (!f || f.level === "loading") return `<span class="fresh-note">Loading…</span>`;
  if (f.level === "unavailable") return `<span class="fresh-note bad">Data unavailable — ${esc(f.err || "feed not responding")}</span>`;
  if (f.level === "delayed") return `<span class="fresh-note warn">Delayed · last update ${ago(f.at)}</span>`;
  return `<span class="fresh-note">${label} ${ago(f.at)}</span>`;
}

export function tabs(list, active, base) {
  return `<nav class="tabs" role="tablist">${list
    .map(([id, label]) => `<a role="tab" aria-selected="${id === active}" class="${id === active ? "on" : ""}" href="${base}/${id}">${label}</a>`)
    .join("")}</nav>`;
}

// ---------- theme ----------
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set("theme", t);
  document.getElementById("themeIcon").setAttribute("d", t === "dark" ? "M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" : "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1");
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#0b0d12" : "#f6f4ef";
}
