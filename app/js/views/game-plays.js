// Play-by-play tab and the play detail sheet (reactions + play-level discussion).
import { esc, teamBadge, playerBadge, toast } from "../util.js";
import { openSheet } from "../ui.js";
import { courtSvg, shotDots, zoneOf, ZONES } from "./shotchart.js";
import { mountThread } from "./discuss.js";
import * as DB from "../supa.js";
import { APP_URL } from "../config.js";

export const TYPES = [
  ["", "All"],
  ["scoring", "Scoring"],
  ["shot", "Shots"],
  ["ft", "Free throws"],
  ["reb", "Rebounds"],
  ["to", "Turnovers"],
  ["foul", "Fouls"],
  ["sub", "Subs"],
  ["timeout", "Timeouts"],
];
const qLabel = (q) => (q <= 4 ? "Q" + q : "OT" + (q - 4));

export function filterPlays(sum, st) {
  let list = sum.plays.filter((p) => p.cat !== "period" || /end/i.test(p.type));
  if (st.period) list = list.filter((p) => String(p.period) === st.period);
  if (st.team) list = list.filter((p) => p.teamId === st.team);
  if (st.player) list = list.filter((p) => p.athletes.includes(st.player));
  if (st.type === "scoring") list = list.filter((p) => p.scoring);
  else if (st.type) list = list.filter((p) => p.cat === st.type);
  return list;
}

function playRow(p, ctx, act) {
  const t = ctx.teamById[p.teamId];
  const a = act?.[p.id];
  const rx = a ? Object.entries(a.reactions).sort((x, y) => y[1] - x[1]).slice(0, 3) : [];
  const g = ctx.sum.game;
  return `<li class="play ${p.scoring ? "scoring" : ""} cat-${p.cat}" data-play="${p.id}" tabindex="0" role="button" aria-label="${esc(p.text)}">
    <span class="pl-clock">${esc(qLabel(p.period))}<b>${esc(p.clock)}</b></span>
    <span class="pl-team">${t ? teamBadge(t, "xs") : ""}</span>
    <span class="pl-text">${p.scoring ? `<em class="pts">+${p.value}</em>` : ""}${esc(p.text)}
      ${a && (a.comments || rx.length) ? `<span class="pl-act">${rx.map(([e, n]) => `${e}${n}`).join(" ")}${a.comments ? ` 💬${a.comments}` : ""}</span>` : ""}
    </span>
    <span class="pl-score ${p.scoring ? "hot" : ""}">${p.away}-${p.home}</span>
  </li>`;
}

export function renderPlaysTab(ctx, st) {
  const { sum, teamById } = ctx;
  const g = sum.game;
  if (!sum.plays.length) return `<div class="panel"><p class="muted">${g.state === "pre" ? "Play-by-play starts at tip-off." : "Play-by-play isn't available for this game."}</p></div>`;
  const list = filterPlays(sum, st);
  const periods = [...new Set(sum.plays.map((p) => p.period))].filter(Boolean).sort((a, b) => a - b);
  const players = sum.players.filter((p) => !p.dnp && (!st.team || p.teamId === st.team)).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = st.order === "asc" ? list : [...list].reverse();
  // group by period for readability
  const groups = [];
  for (const p of ordered) {
    const last = groups[groups.length - 1];
    if (!last || last.period !== p.period) groups.push({ period: p.period, items: [p] });
    else last.items.push(p);
  }
  return `<div class="panel">
    <div class="filters">
      <div class="seg wrap">${[["", "All"], ...periods.map((q) => [String(q), qLabel(q)])].map(([v, l]) => `<button data-pf="period" data-v="${v}" class="${(st.period || "") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="seg">${["", g.away.id, g.home.id].map((t) => `<button data-pf="team" data-v="${t}" class="${(st.team || "") === t ? "on" : ""}">${t ? esc(teamById[t].abbr) : "Both"}</button>`).join("")}</div>
      <select data-pfs="player" aria-label="Filter by player"><option value="">All players</option>${players.map((p) => `<option value="${p.id}" ${st.player === p.id ? "selected" : ""}>${esc(p.name)} (${esc(teamById[p.teamId]?.abbr || "")})</option>`).join("")}</select>
      <button class="btn ghost sm" data-order>${st.order === "asc" ? "Oldest first" : "Newest first"}</button>
    </div>
    <div class="chips">${TYPES.map(([v, l]) => `<button data-pf="type" data-v="${v}" class="chipbtn ${(st.type || "") === v ? "on" : ""}">${l}</button>`).join("")}</div>
    <p class="tiny">${list.length} play${list.length === 1 ? "" : "s"} · tap any play for details, reactions and its own discussion</p>
    ${groups.map((gr) => `<h3 class="pgroup">${gr.period <= 4 ? "Quarter " + gr.period : "Overtime " + (gr.period - 4)}</h3><ol class="plays">${gr.items.map((p) => playRow(p, ctx, ctx.activity)).join("")}</ol>`).join("") || `<p class="muted">No plays match these filters.</p>`}
  </div>`;
}

export function openPlaySheet(ctx, playId, { onClose } = {}) {
  const { sum, teamById } = ctx;
  const p = sum.plays.find((x) => x.id === String(playId));
  if (!p) {
    toast("That play isn't in the feed (yet).");
    return;
  }
  const t = teamById[p.teamId];
  const g = sum.game;
  const people = p.athletes.map((id) => sum.byId.get(id)).filter(Boolean);
  const roleNames = p.cat === "sub" ? ["In", "Out"] : p.cat === "shot" ? ["Shooter", /assist/i.test(p.text) ? "Assist" : /block/i.test(p.text) ? "Blocked by" : "Also"] : [];
  const zone = p.x != null ? ZONES.find(([z]) => z === zoneOf(p))?.[1] : "";
  const dist = (p.text.match(/(\d+)-foot/) || [])[1];
  const a = ctx.activity?.[p.id] || { reactions: {}, mine: new Set(), comments: 0 };

  const body = openSheet(
    `<div class="playsheet">
      <p class="eyebrow">${esc(qLabel(p.period))} · ${esc(p.clock)} · ${esc(p.type)}</p>
      <h2>${t ? teamBadge(t) : ""} ${esc(p.text)}</h2>
      <div class="ps-score"><span>${teamBadge(g.away, "xs")} ${p.away}</span><span>${teamBadge(g.home, "xs")} ${p.home}</span>${p.scoring ? `<em class="pts">+${p.value}</em>` : ""}</div>
      ${people.length ? `<div class="ps-people">${people.map((pl, i) => `<a href="#/player/${pl.id}" class="ps-person">${playerBadge(pl, teamById[pl.teamId])}<span><b>${esc(pl.name)}</b><small>${esc(roleNames[i] || "")}${roleNames[i] ? " · " : ""}${pl.pts} PTS, ${pl.reb} REB, ${pl.ast} AST</small></span></a>`).join("")}</div>` : ""}
      ${p.x != null ? `<div class="ps-court">${courtSvg(shotDots([p], (tid) => teamById[tid]?.color || "#888", p.id), { cls: "mini" })}<p class="tiny">${zone}${dist ? ` · ${dist} ft` : ""} · location from the data feed</p></div>` : ""}
      <div class="reactbar" data-reactbar>${DB.EMOJIS.map((e) => `<button data-react="${e}" class="${a.mine.has(e) ? "on" : ""}" aria-pressed="${a.mine.has(e)}">${e}<b>${a.reactions[e] || ""}</b></button>`).join("")}
        <button class="share" data-share>Share</button></div>
      <h3>Discussion</h3>
      <div data-thread></div>
    </div>`,
    { onClose }
  );
  const thread = mountThread(body.querySelector("[data-thread]"), { gameId: g.id, playId: p.id, placeholder: "What did you think of this play?" });

  body.addEventListener("click", async (e) => {
    const rb = e.target.closest("[data-react]");
    if (rb) {
      if (!DB.enabled) return toast("Reactions switch on once the community database is connected.");
      if (!DB.Auth.user) return toast('<a href="#/login">Sign in</a> to react.');
      const emoji = rb.dataset.react;
      const onNow = a.mine.has(emoji);
      try {
        await DB.toggleReaction(g.id, p.id, emoji, onNow);
        onNow ? a.mine.delete(emoji) : a.mine.add(emoji);
        a.reactions[emoji] = Math.max(0, (a.reactions[emoji] || 0) + (onNow ? -1 : 1));
        ctx.activity = ctx.activity || {};
        ctx.activity[p.id] = a;
        rb.classList.toggle("on", !onNow);
        rb.setAttribute("aria-pressed", String(!onNow));
        rb.querySelector("b").textContent = a.reactions[emoji] || "";
      } catch (err) {
        toast(esc(err.message), "bad");
      }
    }
    if (e.target.closest("[data-share]")) {
      const url = `${APP_URL}#/game/${g.id}/plays?play=${p.id}`;
      const text = `${g.away.abbr} @ ${g.home.abbr}, ${qLabel(p.period)} ${p.clock}: ${p.text}`;
      try {
        if (navigator.share) await navigator.share({ title: "NBA Live", text, url });
        else {
          await navigator.clipboard.writeText(`${text} ${url}`);
          toast("Link copied");
        }
      } catch {}
    }
  });
  return thread;
}
