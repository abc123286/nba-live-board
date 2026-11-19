// Game centre: live scoreboard header + Overview / Plays / Box score / Stats / Shot chart / Discussion.
import { watchGame, getSummary, sumRecord, freshness, findGame, flashFor, provider, Live } from "../live.js";
import { esc, on, emit, teamBadge, playerBadge, pct, signed, localDateTime, ago } from "../util.js";
import { stateChip, tabs, empty, freshNote, sheetOpen } from "../ui.js";
import { renderPlaysTab, openPlaySheet } from "./game-plays.js";
import { renderShotTab } from "./shotchart.js";
import { mountThread, mountChat } from "./discuss.js";
import * as DB from "../supa.js";

const TABS = [
  ["overview", "Overview"],
  ["plays", "Play-by-Play"],
  ["box", "Box Score"],
  ["stats", "Statistics"],
  ["shots", "Shot Chart"],
  ["discussion", "Discussion"],
];
const qLabel = (q) => (q <= 4 ? "Q" + q : "OT" + (q - 4));

export async function mount(el, params, query) {
  const id = params.id;
  let tab = TABS.some(([t]) => t === params.tab) ? params.tab : "overview";
  const unwatch = watchGame(id, "view");
  const st = { plays: { order: "desc" }, box: { side: "away", sort: "", dir: -1 }, shots: {} };
  const ctx = { id, sum: null, teamById: {}, activity: null };
  let disc = [];
  let pendingPlay = query.play || null;
  let sheetThread = null;
  let unsubRT = () => {};
  let pendingRender = false;

  el.innerHTML = `<div class="page game"><div data-head></div><div data-tabs></div><div data-body></div></div>`;
  const $head = el.querySelector("[data-head]");
  const $tabs = el.querySelector("[data-tabs]");
  const $body = el.querySelector("[data-body]");

  // realtime fan-out for this game (chat, comments, reactions, presence)
  if (DB.enabled) {
    DB.subscribeGame(id, {
      chat: (m) => emit("rt:chat", m),
      comment: (p) => {
        emit("rt:comment", p);
        refreshActivity();
      },
      reaction: () => refreshActivity(),
      presence: (n) => emit("rt:presence", n),
    }).then((u) => (unsubRT = u));
  }
  let actTimer = null;
  function refreshActivity() {
    if (!DB.enabled) return;
    clearTimeout(actTimer);
    actTimer = setTimeout(async () => {
      try {
        ctx.activity = await DB.playActivity(id);
        if (tab === "plays") renderBody();
      } catch {}
    }, 400);
  }
  refreshActivity();

  // ---------------- header ----------------
  function teamSide(g, s) {
    const t = g[s];
    const timeouts = t.timeouts != null ? `<span class="to-dots" title="${t.timeouts} timeouts left">${Array.from({ length: 7 }, (_, i) => `<i class="${i < t.timeouts ? "on" : ""}"></i>`).join("")}</span>` : "";
    const fouls = t.teamFouls != null && g.state === "in" ? `<span class="fouls ${t.bonus ? "bonus" : ""}">Fouls ${t.teamFouls}${t.bonus ? " · Bonus" : ""}</span>` : "";
    return `<div class="sh-team ${s}">
      ${teamBadge(t, "lg")}
      <div><b class="sh-name">${esc(t.name)}</b><small>${esc(t.record || "")}</small>
      ${g.state === "in" ? `<div class="sh-meta">${timeouts}${fouls}${t.possession ? `<span class="poss">● Ball</span>` : ""}</div>` : ""}</div>
    </div>`;
  }
  function renderHead() {
    const sum = getSummary(id);
    const g = sum?.game || findGame(id);
    if (!g) {
      const rec = sumRecord(id);
      $head.innerHTML = rec?.err ? empty("Game unavailable", `The data feed didn't return this game (${esc(rec.err)}). Retrying automatically.`) : `<div class="sk sk-head"></div>`;
      return;
    }
    const f = freshness("summary", id);
    const sc = (s) => {
      const fl = flashFor(g.id, g[s].id);
      return `<b class="big-score ${fl ? "flash" : ""}">${g.state === "pre" || g[s].score == null ? "–" : g[s].score}${fl ? `<em class="delta">+${fl.delta}</em>` : ""}</b>`;
    };
    const periods = Math.max(4, g.home.linescores.length, g.away.linescores.length);
    const ls = (s) => Array.from({ length: periods }, (_, i) => `<td>${g[s].linescores[i] ?? ""}</td>`).join("");
    $head.innerHTML = `
      <section class="scorehead" style="--ca:${esc(g.away.color)};--ch:${esc(g.home.color)}">
        ${teamSide(g, "away")}
        <div class="sh-mid">
          <div class="sh-scores">${sc("away")}<span class="sh-dash">–</span>${sc("home")}</div>
          <div class="sh-status">${stateChip(g, f)} <span>${g.state === "pre" ? esc(localDateTime(g.date)) : esc(g.detail)}</span></div>
          <div class="sh-fresh">${freshNote(f)}</div>
        </div>
        ${teamSide(g, "home")}
      </section>
      ${
        g.state !== "pre"
          ? `<table class="linescore"><thead><tr><th></th>${Array.from({ length: periods }, (_, i) => `<th>${i < 4 ? i + 1 : "OT" + (i - 3)}</th>`).join("")}<th>T</th></tr></thead>
        <tbody>${["away", "home"].map((s) => `<tr><th>${teamBadge(g[s], "xs")} ${esc(g[s].abbr)}</th>${ls(s)}<td class="tot">${g[s].score ?? ""}</td></tr>`).join("")}</tbody></table>`
          : ""
      }`;
    document.title = `${g.away.abbr} ${g.state !== "pre" ? g.away.score + "–" + g.home.score : "@"} ${g.home.abbr} · NBA Live`;
  }

  // ---------------- overview ----------------
  function leaders(teamId) {
    const ps = ctx.sum.players.filter((p) => p.teamId === teamId && p.hasStats);
    const top = (k) => [...ps].sort((a, b) => b[k] - a[k])[0];
    return [
      ["Points", "pts"],
      ["Rebounds", "reb"],
      ["Assists", "ast"],
    ]
      .map(([l, k]) => {
        const p = top(k);
        return p && p[k] > 0 ? `<a class="leader" href="#/player/${p.id}">${playerBadge(p, ctx.teamById[teamId])}<span><small>${l}</small><b>${esc(p.short)}</b></span><strong>${p[k]}</strong></a>` : "";
      })
      .join("");
  }

  function wpChart(sum) {
    const wp = sum.winprob;
    if (!wp?.length || wp.length < 5) return "";
    const g = sum.game;
    const W = 600, H = 120;
    const pts = wp.map((w, i) => `${((i / (wp.length - 1)) * W).toFixed(1)},${(H - (w.home ?? 0.5) * H).toFixed(1)}`).join(" ");
    const last = wp[wp.length - 1].home ?? 0.5;
    const fav = last >= 0.5 ? g.home : g.away;
    return `<div class="panel"><h3>Win probability <span class="hint" title="This is ESPN's model, delivered with the feed. NBA Live does not compute it.">ESPN model</span></h3>
      <svg class="wp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/><polyline points="${pts}" style="stroke:${esc(g.home.color)}"/></svg>
      <div class="wp-legend"><span>${teamBadge(g.away, "xs")} ${(100 - last * 100).toFixed(1)}%</span><span>${g.state === "post" ? "Final" : "Now"}: ${esc(fav.abbr)} ${(Math.max(last, 1 - last) * 100).toFixed(1)}%</span><span>${teamBadge(g.home, "xs")} ${(last * 100).toFixed(1)}%</span></div></div>`;
  }

  function factsSummary(sum) {
    const g = sum.game;
    const win = (g.home.score ?? 0) > (g.away.score ?? 0) ? g.home : g.away;
    const lose = win === g.home ? g.away : g.home;
    const ts = sum.teamStats;
    const top = (tid) => [...sum.players.filter((p) => p.teamId === tid && p.hasStats)].sort((a, b) => b.pts - a.pts)[0];
    const tw = top(win.id), tl = top(lose.id);
    const v = (tid, k) => ts[tid]?.[k]?.value;
    const facts = [
      `Final: ${win.name} ${win.score}, ${lose.name} ${lose.score}${/OT/.test(g.detail) ? " (" + esc(g.detail.replace(/^Final\/?/, "")) + ")" : ""}.`,
      tw && `${tw.name} led ${win.abbr} with ${tw.pts} points, ${tw.reb} rebounds and ${tw.ast} assists.`,
      tl && `${tl.name} led ${lose.abbr} with ${tl.pts} points.`,
      v(win.id, "fieldGoalPct") && `Shooting: ${win.abbr} ${v(win.id, "fieldGoalPct")}% FG, ${v(win.id, "threePointFieldGoalPct")}% from three; ${lose.abbr} ${v(lose.id, "fieldGoalPct")}% FG, ${v(lose.id, "threePointFieldGoalPct")}% from three.`,
      v(win.id, "largestLead") && `Largest lead: ${win.abbr} ${v(win.id, "largestLead")}, ${lose.abbr} ${v(lose.id, "largestLead")}.${v(win.id, "leadChanges") ? ` Lead changes: ${v(win.id, "leadChanges")}.` : ""}`,
    ].filter(Boolean);
    // Generated narrative from the same facts, clearly labelled.
    const q = (s) => g[s].linescores;
    let best = null;
    for (let i = 0; i < Math.min(q("home").length, q("away").length); i++) {
      const d = (q(win === g.home ? "home" : "away")[i] || 0) - (q(win === g.home ? "away" : "home")[i] || 0);
      if (!best || d > best.d) best = { i, d };
    }
    const margin = Math.abs((g.home.score ?? 0) - (g.away.score ?? 0));
    const tone = margin <= 3 ? "edged" : margin <= 9 ? "beat" : margin <= 19 ? "pulled away from" : "routed";
    const recap = `${win.short || win.name} ${tone} the ${lose.short || lose.name} ${win.score}-${lose.score}${tw ? `, behind ${tw.pts} points from ${tw.name}` : ""}.${best && best.d > 0 ? ` The ${qLabel(best.i + 1)} made the difference, won ${q(win === g.home ? "home" : "away")[best.i]}-${q(win === g.home ? "away" : "home")[best.i]}.` : ""}${tl ? ` ${tl.name} scored ${tl.pts} in the loss.` : ""}`;
    return `<div class="panel summary">
      <h3>Game summary</h3>
      <ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <div class="generated"><span class="gen-tag">Auto-generated recap</span><p>${esc(recap)}</p><small>Written automatically from the box score above. No outside reporting.</small></div>
    </div>`;
  }

  function renderOverview() {
    const sum = ctx.sum;
    const g = sum.game;
    if (g.state === "pre") {
      return `<div class="grid two">
        <div class="panel"><h3>Matchup</h3>
          <div class="matchup">${["away", "home"].map((s) => `<div>${teamBadge(g[s], "lg")}<b>${esc(g[s].name)}</b><small>${esc(g[s].record || "")} · ${s === "home" ? "Home" : "Away"}</small></div>`).join('<span class="vs">vs</span>')}</div>
          <dl class="kv"><dt>Tip-off</dt><dd>${esc(localDateTime(g.date))} (your time)</dd>${g.venue ? `<dt>Venue</dt><dd>${esc(g.venue)}</dd>` : ""}${g.broadcast ? `<dt>TV</dt><dd>${esc(g.broadcast)}</dd>` : ""}</dl>
          <p class="tiny">Play-by-play, box score and shot chart start at tip-off. This page updates on its own.</p>
        </div>
        <div class="panel"><h3>Injury report</h3>${injuries(sum)}</div>
      </div>`;
    }
    const L = lineupsOf(sum);
    const recent = sum.plays.filter((p) => p.cat !== "period").slice(-6).reverse();
    const run = provider.currentRun(sum);
    const runTeam = run && ctx.teamById[run.teamId];
    const onCourt = (t) => {
      const ids = [...(L.on[t.id] || [])];
      const ps = ids.map((i) => sum.byId.get(i)).filter(Boolean);
      return `<div class="oncourt" style="--tc:${esc(t.color)}"><h4>${teamBadge(t, "xs")} ${esc(t.abbr)} ${g.state === "post" ? "finished with" : "on the floor"}</h4>
        ${ps.map((p) => `<a href="#/player/${p.id}" class="oc-p">${playerBadge(p, t)}<span><b>${esc(p.short)}</b><small>${esc(p.pos)}</small></span><span class="oc-line">${p.pts}<small>pts</small> ${p.reb}<small>reb</small> ${p.ast}<small>ast</small> <em class="${p.pf >= 5 ? "bad" : ""}">${p.pf} PF</em></span></a>`).join("") || `<p class="muted">Lineup not available.</p>`}
      </div>`;
    };
    const subs = L.subs.slice(-8).reverse();
    return `
      ${g.state === "post" ? factsSummary(sum) : ""}
      <div class="grid two">
        <div class="panel">
          <h3>${g.state === "in" ? "Latest plays" : "Final plays"}</h3>
          ${run && run.pts >= 6 && g.state === "in" ? `<div class="run" style="--tc:${esc(runTeam?.color)}">${teamBadge(runTeam, "xs")} <b>${esc(runTeam?.abbr)} on a ${run.pts}-0 run</b> <small>since ${esc(qLabel(run.since.period))} ${esc(run.since.clock)}</small></div>` : ""}
          <ol class="plays compact">${recent.map((p) => `<li class="play ${p.scoring ? "scoring" : ""}" data-play="${p.id}" tabindex="0" role="button"><span class="pl-clock">${esc(qLabel(p.period))}<b>${esc(p.clock)}</b></span><span class="pl-team">${ctx.teamById[p.teamId] ? teamBadge(ctx.teamById[p.teamId], "xs") : ""}</span><span class="pl-text">${p.scoring ? `<em class="pts">+${p.value}</em>` : ""}${esc(p.text)}</span><span class="pl-score">${p.away}-${p.home}</span></li>`).join("")}</ol>
          <a class="more" href="#/game/${id}/plays">All plays →</a>
        </div>
        <div class="panel">
          <h3>Leaders</h3>
          <div class="leaders">${[g.away, g.home].map((t) => `<div><h4>${teamBadge(t, "xs")} ${esc(t.abbr)}</h4>${leaders(t.id)}</div>`).join("")}</div>
        </div>
      </div>
      <div class="panel">
        <h3>${g.state === "in" ? "Players on court" : "Closing lineups"} <span class="hint" title="Worked out from the starting five plus every substitution in the play-by-play.">from play-by-play</span></h3>
        <div class="grid two">${onCourt(g.away)}${onCourt(g.home)}</div>
        ${
          subs.length
            ? `<h4 class="subhead">Recent substitutions</h4><ul class="subs">${subs
                .map((s) => {
                  const t = ctx.teamById[s.teamId];
                  const pin = sum.byId.get(s.inId), pout = sum.byId.get(s.outId);
                  return `<li data-play="${s.playId}" role="button" tabindex="0">${teamBadge(t, "xs")}<span class="sub-in">▲ ${esc(pin?.short || "?")}</span><span class="sub-out">▼ ${esc(pout?.short || "?")}</span><small>${esc(qLabel(s.period))} ${esc(s.clock)}</small></li>`;
                })
                .join("")}</ul>`
            : ""
        }
      </div>
      ${wpChart(sum)}
      <div class="panel"><h3>Game info</h3><dl class="kv">${g.venue ? `<dt>Venue</dt><dd>${esc(g.venue)}</dd>` : ""}${g.attendance ? `<dt>Attendance</dt><dd>${g.attendance.toLocaleString()}</dd>` : ""}${g.officials?.length ? `<dt>Officials</dt><dd>${esc(g.officials.join(", "))}</dd>` : ""}${g.broadcast ? `<dt>TV</dt><dd>${esc(g.broadcast)}</dd>` : ""}<dt>Data</dt><dd>${esc(provider.PROVIDER.name)}. ${esc(provider.PROVIDER.note)}</dd></dl></div>`;
  }

  function injuries(sum) {
    const blocks = sum.injuries.filter((t) => t.list.length);
    if (!blocks.length) return `<p class="muted">No injuries listed by the feed.</p>`;
    return blocks.map((t) => `<h4>${teamBadge(ctx.teamById[t.teamId], "xs")} ${esc(ctx.teamById[t.teamId]?.abbr || "")}</h4><ul class="inj">${t.list.map((i) => `<li><a href="#/player/${i.id}">${esc(i.name)}</a> <span class="chip ${/out/i.test(i.status) ? "bad" : "warn"}">${esc(i.status)}</span> <small>${esc(i.detail)}</small></li>`).join("")}</ul>`).join("");
  }

  let lineupCache = { at: 0, v: null };
  function lineupsOf(sum) {
    if (lineupCache.at !== sum.fetchedAt) lineupCache = { at: sum.fetchedAt, v: provider.lineups(sum) };
    return lineupCache.v;
  }

  // ---------------- box score ----------------
  const COLS = [
    ["min", "MIN"],
    ["pts", "PTS"],
    ["reb", "REB"],
    ["ast", "AST"],
    ["stl", "STL"],
    ["blk", "BLK"],
    ["to", "TO"],
    ["pf", "PF"],
    ["fg", "FG"],
    ["tp", "3PT"],
    ["ft", "FT"],
    ["oreb", "OREB"],
    ["dreb", "DREB"],
    ["pm", "+/-"],
  ];
  const cell = (p, k) => (k === "fg" ? `${p.fgm}-${p.fga}` : k === "tp" ? `${p.tpm}-${p.tpa}` : k === "ft" ? `${p.ftm}-${p.fta}` : k === "pm" ? signed(p.pm) : p[k]);
  const sortVal = (p, k) => (k === "fg" ? p.fgm : k === "tp" ? p.tpm : k === "ft" ? p.ftm : p[k]);

  function renderBox() {
    const sum = ctx.sum;
    const g = sum.game;
    if (!sum.players.length) return `<div class="panel"><p class="muted">${g.state === "pre" ? "Box score appears at tip-off." : "Box score isn't available for this game."}</p></div>`;
    const t = g[st.box.side];
    const L = lineupsOf(sum);
    const on = L.on[t.id] || new Set();
    let ps = sum.players.filter((p) => p.teamId === t.id);
    const sorter = st.box.sort ? (a, b) => (sortVal(b, st.box.sort) - sortVal(a, st.box.sort)) * (st.box.dir < 0 ? 1 : -1) : null;
    const starters = ps.filter((p) => p.starter);
    const bench = ps.filter((p) => !p.starter && !p.dnp);
    const dnp = ps.filter((p) => p.dnp);
    const tot = ps.reduce((a, p) => {
      for (const k of ["pts", "reb", "ast", "stl", "blk", "to", "pf", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb"]) a[k] = (a[k] || 0) + p[k];
      return a;
    }, {});
    const row = (p) => `<tr class="${on.has(p.id) && g.state === "in" ? "oncourt-row" : ""}"><th><a href="#/player/${p.id}">${on.has(p.id) && g.state === "in" ? '<i class="oc-dot" title="On court"></i>' : ""}${esc(p.short)}</a> <small>${esc(p.pos)}</small></th>${COLS.map(([k]) => `<td class="${st.box.sort === k ? "sorted" : ""}">${cell(p, k)}</td>`).join("")}</tr>`;
    const section = (label, list) => (list.length ? `<tr class="grp"><th colspan="${COLS.length + 1}">${label}</th></tr>${(sorter ? [...list].sort(sorter) : list).map(row).join("")}` : "");
    return `<div class="panel">
      <div class="filters"><div class="seg">${["away", "home"].map((s) => `<button data-box-side="${s}" class="${st.box.side === s ? "on" : ""}">${teamBadge(g[s], "xs")} ${esc(g[s].abbr)}</button>`).join("")}</div>
      ${st.box.sort ? `<button class="btn ghost sm" data-box-sort="">Clear sort</button>` : ""}<span class="tiny">Tap a column to sort${g.state === "in" ? " · green dot = on court now" : ""}</span></div>
      <div class="tablewrap"><table class="box">
        <thead><tr><th>Player</th>${COLS.map(([k, l]) => `<th><button data-box-sort="${k}" class="${st.box.sort === k ? "on" : ""}">${l}${st.box.sort === k ? (st.box.dir < 0 ? " ▼" : " ▲") : ""}</button></th>`).join("")}</tr></thead>
        <tbody>
          ${section("Starters", starters)}${section("Bench", bench)}
          <tr class="totals"><th>Team totals</th><td></td><td>${tot.pts}</td><td>${tot.reb}</td><td>${tot.ast}</td><td>${tot.stl}</td><td>${tot.blk}</td><td>${tot.to}</td><td>${tot.pf}</td><td>${tot.fgm}-${tot.fga}</td><td>${tot.tpm}-${tot.tpa}</td><td>${tot.ftm}-${tot.fta}</td><td>${tot.oreb}</td><td>${tot.dreb}</td><td></td></tr>
          <tr class="pcts"><th>Shooting</th><td colspan="8"></td><td>${pct(tot.fgm, tot.fga)}%</td><td>${pct(tot.tpm, tot.tpa)}%</td><td>${pct(tot.ftm, tot.fta)}%</td><td colspan="3"></td></tr>
        </tbody>
      </table></div>
      ${dnp.length ? `<p class="dnp"><b>Did not play:</b> ${dnp.map((p) => `${esc(p.short)}${p.reason ? ` (${esc(p.reason)})` : ""}`).join(", ")}</p>` : ""}
      <p class="tiny">Totals add up the players listed; team rebounds/turnovers credited to no player are in Statistics.</p>
    </div>`;
  }

  // ---------------- team statistics ----------------
  function renderStats() {
    const sum = ctx.sum;
    const g = sum.game;
    const A = sum.teamStats[g.away.id], H = sum.teamStats[g.home.id];
    if (!A || !H || !Object.keys(A).length) return `<div class="panel"><p class="muted">${g.state === "pre" ? "Team statistics appear at tip-off." : "Team statistics aren't available for this game."}</p></div>`;
    const ROWS = [
      ["fieldGoalsMade-fieldGoalsAttempted", "Field goals"],
      ["fieldGoalPct", "Field goal %", "%"],
      ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "Three pointers"],
      ["threePointFieldGoalPct", "Three point %", "%"],
      ["freeThrowsMade-freeThrowsAttempted", "Free throws"],
      ["freeThrowPct", "Free throw %", "%"],
      ["totalRebounds", "Rebounds"],
      ["offensiveRebounds", "Offensive rebounds"],
      ["defensiveRebounds", "Defensive rebounds"],
      ["assists", "Assists"],
      ["steals", "Steals"],
      ["blocks", "Blocks"],
      ["totalTurnovers", "Turnovers (incl. team)", "", true],
      ["fouls", "Fouls", "", true],
      ["pointsInPaint", "Points in the paint"],
      ["fastBreakPoints", "Fast break points"],
      ["turnoverPoints", "Points off turnovers"],
      ["largestLead", "Largest lead"],
    ];
    const first = (v) => parseFloat(String(v).split("-")[0]) || 0;
    const bar = ([k, label, unit, lowerBetter]) => {
      if (!A[k] || !H[k]) return "";
      const a = first(A[k].value), h = first(H[k].value);
      const tot = a + h || 1;
      const aw = (a / tot) * 100;
      const better = a === h ? "" : (a > h) !== !!lowerBetter ? "a" : "h";
      return `<div class="cmp"><span class="${better === "a" ? "win" : ""}">${esc(A[k].value)}${unit || ""}</span><div class="cmp-mid"><small>${label}</small><div class="cmp-bar"><i style="width:${aw}%;background:${esc(g.away.color)}"></i><i style="width:${100 - aw}%;background:${esc(g.home.color)}"></i></div></div><span class="${better === "h" ? "win" : ""}">${esc(H[k].value)}${unit || ""}</span></div>`;
    };
    // Derived efficiency from box-score totals (standard formulas, shown as derived)
    const tot = (tid) => sum.players.filter((p) => p.teamId === tid).reduce((a, p) => ({ pts: a.pts + p.pts, fgm: a.fgm + p.fgm, fga: a.fga + p.fga, tpm: a.tpm + p.tpm, fta: a.fta + p.fta, ast: a.ast + p.ast, to: a.to + p.to }), { pts: 0, fgm: 0, fga: 0, tpm: 0, fta: 0, ast: 0, to: 0 });
    const ta = tot(g.away.id), th = tot(g.home.id);
    const efg = (t) => (t.fga ? ((t.fgm + 0.5 * t.tpm) / t.fga) * 100 : 0);
    const tsp = (t) => (t.fga + 0.44 * t.fta ? (t.pts / (2 * (t.fga + 0.44 * t.fta))) * 100 : 0);
    const ato = (t) => (t.to ? t.ast / t.to : t.ast);
    const drow = (label, fa, fh, d = 1, unit = "%") => {
      const a = fa, h = fh, tot2 = a + h || 1;
      return `<div class="cmp"><span class="${a > h ? "win" : ""}">${a.toFixed(d)}${unit}</span><div class="cmp-mid"><small>${label}</small><div class="cmp-bar"><i style="width:${(a / tot2) * 100}%;background:${esc(g.away.color)}"></i><i style="width:${(h / tot2) * 100}%;background:${esc(g.home.color)}"></i></div></div><span class="${h > a ? "win" : ""}">${h.toFixed(d)}${unit}</span></div>`;
    };
    const periods = Math.max(g.home.linescores.length, g.away.linescores.length);
    const maxQ = Math.max(1, ...g.home.linescores, ...g.away.linescores);
    return `<div class="grid two">
      <div class="panel"><div class="cmp-head">${teamBadge(g.away)} <b>Team comparison</b> ${teamBadge(g.home)}</div>${ROWS.map(bar).join("")}
        ${A.leadChanges ? `<p class="tiny">Lead changes: ${esc(A.leadChanges.value)}${A.leadPercentage ? ` · time leading: ${esc(g.away.abbr)} ${esc(A.leadPercentage.value)}%, ${esc(g.home.abbr)} ${esc(H.leadPercentage?.value ?? "–")}%` : ""}</p>` : ""}
      </div>
      <div>
        <div class="panel"><h3>Efficiency <span class="hint" title="Calculated by NBA Live from the box score with standard formulas: eFG% = (FGM + 0.5×3PM) / FGA; TS% = PTS / (2 × (FGA + 0.44×FTA)).">derived</span></h3>
          ${drow("Effective FG%", efg(ta), efg(th))}${drow("True shooting %", tsp(ta), tsp(th))}${drow("Assist / turnover", ato(ta), ato(th), 2, "")}
        </div>
        <div class="panel"><h3>Scoring by quarter</h3>
          <div class="qbars">${Array.from({ length: periods }, (_, i) => {
            const a = g.away.linescores[i] ?? 0, h = g.home.linescores[i] ?? 0;
            return `<div class="qb"><div class="qb-bars"><i style="height:${(a / maxQ) * 100}%;background:${esc(g.away.color)}" title="${esc(g.away.abbr)} ${a}"></i><i style="height:${(h / maxQ) * 100}%;background:${esc(g.home.color)}" title="${esc(g.home.abbr)} ${h}"></i></div><small>${qLabel(i + 1)}</small><span>${a}-${h}</span></div>`;
          }).join("")}</div>
        </div>
      </div>
    </div>`;
  }

  // ---------------- discussion ----------------
  function mountDiscussion() {
    disc.forEach((d) => d.destroy());
    disc = [];
    const g = ctx.sum?.game || findGame(id);
    const live = g?.state === "in";
    // top discussed plays
    const act = ctx.activity || {};
    const hot = Object.entries(act)
      .map(([pid, a]) => ({ pid, n: a.comments * 2 + Object.values(a.reactions).reduce((x, y) => x + y, 0) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .map((x) => ctx.sum?.plays.find((p) => p.id === x.pid))
      .filter(Boolean);
    $body.innerHTML = `<div class="grid two disc">
      <div class="panel chat" data-chat></div>
      <div>
        ${hot.length ? `<div class="panel"><h3>Most talked-about plays</h3><ol class="plays compact">${hot.map((p) => `<li class="play" data-play="${p.id}" role="button" tabindex="0"><span class="pl-clock">${esc(qLabel(p.period))}<b>${esc(p.clock)}</b></span><span class="pl-text">${esc(p.text)}</span><span class="pl-score">${p.away}-${p.home}</span></li>`).join("")}</ol></div>` : ""}
        <div class="panel"><h3>Game thread</h3><div data-thread></div></div>
        <p class="tiny">Be respectful. Reported posts are reviewed by moderators. Predictions here are for fun only — NBA Live never involves real money.</p>
      </div>
    </div>`;
    disc.push(mountChat($body.querySelector("[data-chat]"), { gameId: id, live }));
    disc.push(mountThread($body.querySelector("[data-thread]"), { gameId: id, placeholder: "Thoughts on this game?" }));
  }

  // ---------------- tab body ----------------
  function renderBody(force) {
    if (tab === "discussion") {
      if (force || !disc.length) mountDiscussion();
      return;
    }
    disc.forEach((d) => d.destroy());
    disc = [];
    const sum = getSummary(id);
    ctx.sum = sum;
    if (!sum) {
      const rec = sumRecord(id);
      $body.innerHTML = rec?.err ? empty("Couldn't load this game", esc(rec.err)) : `<div class="panel"><div class="sk sk-block"></div></div>`;
      return;
    }
    ctx.teamById = { [sum.game.home.id]: sum.game.home, [sum.game.away.id]: sum.game.away };
    // Don't re-render under someone using a dropdown.
    const ae = document.activeElement;
    if (!force && ae && $body.contains(ae) && ae.tagName === "SELECT") {
      pendingRender = true;
      return;
    }
    const y = window.scrollY;
    $body.innerHTML =
      tab === "overview" ? renderOverview() : tab === "plays" ? renderPlaysTab(ctx, st.plays) : tab === "box" ? renderBox() : tab === "stats" ? renderStats() : renderShotTab(ctx, st.shots);
    if (!force) window.scrollTo(0, y);
    if (pendingPlay && sum.plays.length) {
      const pid = pendingPlay;
      pendingPlay = null;
      showPlay(pid);
    }
  }
  $body.addEventListener("focusout", () => {
    if (pendingRender) {
      pendingRender = false;
      setTimeout(() => renderBody(), 50);
    }
  });

  function renderTabs() {
    $tabs.innerHTML = tabs(TABS, tab, `#/game/${id}`);
  }

  function showPlay(pid) {
    if (!ctx.sum) return;
    sheetThread?.destroy();
    sheetThread = openPlaySheet(ctx, pid, { onClose: () => sheetThread?.destroy() });
  }

  // ---------------- interactions ----------------
  el.addEventListener("click", (e) => {
    const pl = e.target.closest("[data-play]");
    if (pl && !e.target.closest("a")) {
      if (pl.classList.contains("shot")) st.shots.sel = pl.dataset.play;
      return showPlay(pl.dataset.play);
    }
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.pf) {
      st.plays[b.dataset.pf] = b.dataset.v;
      if (b.dataset.pf === "team") st.plays.player = "";
      return renderBody(true);
    }
    if (b.dataset.order != null) {
      st.plays.order = st.plays.order === "asc" ? "desc" : "asc";
      return renderBody(true);
    }
    if (b.dataset.boxSide) {
      st.box.side = b.dataset.boxSide;
      return renderBody(true);
    }
    if (b.dataset.boxSort != null) {
      const k = b.dataset.boxSort;
      if (st.box.sort === k) st.box.dir *= -1;
      else {
        st.box.sort = k;
        st.box.dir = -1;
      }
      return renderBody(true);
    }
    if (b.dataset.shotTeam != null) {
      st.shots.team = b.dataset.shotTeam;
      st.shots.player = "";
      return renderBody(true);
    }
    if (b.dataset.shotResult != null) {
      st.shots.result = b.dataset.shotResult;
      return renderBody(true);
    }
  });
  el.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-play]")) {
      e.preventDefault();
      showPlay(e.target.dataset.play);
    }
  });
  el.addEventListener("change", (e) => {
    const s = e.target;
    if (s.dataset.pfs) {
      st.plays[s.dataset.pfs] = s.value;
      renderBody(true);
    }
    if (s.dataset.shot) {
      st.shots[s.dataset.shot] = s.value;
      renderBody(true);
    }
  });

  // ---------------- live updates ----------------
  let lastHead = 0;
  const offs = [
    on("summary", ({ id: sid }) => {
      if (sid !== id) return;
      renderHead();
      lastHead = Date.now();
      if (tab !== "discussion") renderBody();
      else if (!disc.length) mountDiscussion();
    }),
    on("board", () => {
      if (!getSummary(id)) renderHead();
    }),
    on("tick", () => {
      // clear score flashes / refresh "updated Xs ago"
      if (Date.now() - lastHead > 3000) {
        renderHead();
        lastHead = Date.now();
      }
    }),
    on("auth", () => refreshActivity()),
  ];

  renderHead();
  renderTabs();
  renderBody(true);

  return {
    title: "Game",
    navigate(p, q) {
      const next = TABS.some(([t]) => t === p.tab) ? p.tab : "overview";
      if (q.play) pendingPlay = q.play;
      if (next !== tab) {
        tab = next;
        renderTabs();
        renderBody(true);
        window.scrollTo(0, 0);
      } else if (pendingPlay) renderBody(true);
    },
    destroy() {
      unwatch();
      offs.forEach((o) => o());
      disc.forEach((d) => d.destroy());
      sheetThread?.destroy();
      unsubRT();
      clearTimeout(actTimer);
    },
  };
}
