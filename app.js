/* NBA Live: scores, players on court, substitutions, box scores and top performers.
   Data: ESPN's public NBA feed (scoreboard + game summary). No odds.
   On-court players are worked out from each team's starters plus every substitution in the play-by-play. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo") || location.hash === "#demo";
  if (location.hash === "#demo") history.replaceState(null, "", "?demo=1");
  const RELAY = "http://127.0.0.1:8787";
  const ESPN = "https://site.api.espn.com/";
  const TRI = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MYT = "Asia/Kuala_Lumpur";

  // ---------- fetching (direct, then the optional local helper) ----------
  let route = null; const diag = {};
  async function getJSON(path) {
    if (DEMO) return window.Demo.get(path);
    const ways = route === "relay" ? ["relay", "direct"] : ["direct", "relay"];
    let last;
    for (const w of ways) {
      const url = w === "direct" ? ESPN + path : RELAY + "/espn/" + path;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json(); route = w; delete diag[w]; return j;
      } catch (e) { last = e; diag[w] = e.message || String(e); }
    }
    throw last;
  }

  // ---------- dates (NBA days are US Eastern dates; label them by the Malaysia morning they're played) ----------
  const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
  const shiftDay = (ymd, n) => { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n, 12)); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
  const dayLabel = (ymd) => { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + 1, 4)); return d.toLocaleDateString("en-MY", { timeZone: MYT, weekday: "short", day: "numeric", month: "short" }); };
  const mytTime = (iso) => new Date(iso).toLocaleTimeString("en-MY", { timeZone: MYT, hour: "numeric", minute: "2-digit" });

  // ---------- state ----------
  const S = {
    day: params.get("date") || etDate(new Date()),
    games: new Map(), sums: new Map(), sumAt: new Map(),
    sbAt: 0, ok: null, updated: null,
    tab: "court", boxSide: "away", sort: null, subFilter: "all", scoringOnly: false,
    seenSubs: new Map(), fresh: new Map(), sheet: null
  };
  try { const t = localStorage.getItem("nbalive-tab"); if (t) S.tab = t; } catch (e) { /* storage unavailable */ }

  // ---------- parsing ----------
  function parseComp(c, id, date) {
    const st = c.status || {}; const t = st.type || {};
    const g = { id: String(id), date: date || c.date, state: t.state || "pre", period: st.period || 0, clock: st.displayClock || "", short: t.shortDetail || t.detail || "", completed: !!t.completed, home: null, away: null };
    for (const comp of c.competitors || []) {
      const tm = comp.team || {}; const ab = tm.abbreviation || "";
      const side = comp.homeAway === "home" ? "home" : "away";
      g[side] = {
        id: String(tm.id || ""), abbr: TRI[ab] || ab, espnAbbr: ab, name: tm.shortDisplayName || tm.name || ab, full: tm.displayName || tm.name || ab,
        color: "#" + (tm.color || "4a5568"), alt: "#" + (tm.alternateColor || "a0aec0"),
        score: parseInt(comp.score && comp.score.value != null ? comp.score.value : comp.score, 10) || 0,
        record: (comp.records && comp.records[0] && comp.records[0].summary) || (comp.record && comp.record[0] && comp.record[0].displayValue) || "",
        lines: (comp.linescores || []).map((l) => (l.value != null ? l.value : parseInt(l.displayValue, 10) || 0)),
        leaders: comp.leaders || []
      };
    }
    return g;
  }
  const parseEvent = (e) => parseComp(e.competitions[0], e.id, e.date);

  const LABELS = { MIN: ["MIN", "minutes"], FG: ["FG", "fieldGoalsMade-fieldGoalsAttempted"], "3PT": ["3PT", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"], FT: ["FT", "freeThrowsMade-freeThrowsAttempted"], OREB: ["OREB", "offensiveRebounds"], DREB: ["DREB", "defensiveRebounds"], REB: ["REB", "rebounds"], AST: ["AST", "assists"], STL: ["STL", "steals"], BLK: ["BLK", "blocks"], TO: ["TO", "turnovers"], PF: ["PF", "fouls"], PM: ["+/-", "plusMinus"], PTS: ["PTS", "points"] };
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

  function parseSummary(g, s) {
    const out = { players: { home: [], away: [] }, byId: new Map(), plays: [], subs: [], onCourt: { home: [], away: [] }, approx: { home: false, away: false } };
    const sideOf = (teamId, abbr) => (String(teamId) === g.home.id || abbr === g.home.espnAbbr ? "home" : String(teamId) === g.away.id || abbr === g.away.espnAbbr ? "away" : null);
    let flags = false;
    for (const tb of (s.boxscore && s.boxscore.players) || []) {
      const side = sideOf(tb.team && tb.team.id, tb.team && tb.team.abbreviation); if (!side) continue;
      const block = (tb.statistics || [])[0]; if (!block) continue;
      const labels = (block.labels || block.names || []).map((x) => String(x).toUpperCase());
      const keys = block.keys || [];
      const col = {};
      for (const k in LABELS) { let i = labels.indexOf(LABELS[k][0]); if (i < 0) i = keys.indexOf(LABELS[k][1]); col[k] = i; }
      for (const a of block.athletes || []) {
        const at = a.athlete || {}; const st = a.stats || [];
        const v = (k) => (col[k] >= 0 ? st[col[k]] : undefined);
        const n = (k) => { const x = parseInt(v(k), 10); return isNaN(x) ? 0 : x; };
        const pair = (k) => { const x = String(v(k) || "0-0").split("-"); return [parseInt(x[0], 10) || 0, parseInt(x[1], 10) || 0]; };
        const [fgm, fga] = pair("FG"), [tpm, tpa] = pair("3PT"), [ftm, fta] = pair("FT");
        const p = {
          id: String(at.id || at.displayName), name: at.displayName || at.shortName || "", short: at.shortName || at.displayName || "",
          jersey: at.jersey || "", pos: (at.position && at.position.abbreviation) || "", starter: !!a.starter,
          dnp: !!a.didNotPlay || (g.state === "post" && !st.length), reason: a.reason || "", ejected: !!a.ejected, side, team: g[side],
          s: { min: n("MIN"), pts: n("PTS"), reb: n("REB"), oreb: n("OREB"), dreb: n("DREB"), ast: n("AST"), stl: n("STL"), blk: n("BLK"), to: n("TO"), pf: n("PF"), pm: n("PM"), fgm, fga, tpm, tpa, ftm, fta }
        };
        if (typeof a.onCourt === "boolean") { p.flag = a.onCourt; flags = true; }
        out.players[side].push(p); out.byId.set(p.id, p);
      }
    }
    const plays = (s.plays || []).map((p, i) => ({
      id: String(p.id || i), seq: parseInt(p.sequenceNumber, 10) || i, period: (p.period && p.period.number) || 0,
      clock: (p.clock && p.clock.displayValue) || "", text: p.text || "", type: (p.type && p.type.text) || "",
      teamId: p.team && p.team.id != null ? String(p.team.id) : null, home: p.homeScore, away: p.awayScore, scoring: !!p.scoringPlay,
      parts: (p.participants || []).map((x) => x.athlete && x.athlete.id != null && String(x.athlete.id)).filter(Boolean)
    })).sort((a, b) => a.seq - b.seq);
    out.plays = plays;

    // name lookup for "X enters the game for Y"
    const findName = (name, side) => {
      const t = norm(name); if (!t) return null;
      const pool = side ? out.players[side] : out.players.home.concat(out.players.away);
      let hit = pool.find((p) => norm(p.name) === t) || pool.find((p) => norm(p.short) === t);
      if (!hit) { const last = t.split(" ").pop(); const c = pool.filter((p) => norm(p.name).split(" ").pop() === last); if (c.length === 1) hit = c[0]; }
      return hit ? hit.id : null;
    };
    const SUB = /^(.+?) enters the game for (.+?)\.?$/i;
    const court = { home: new Set(out.players.home.filter((p) => p.starter).map((p) => p.id)), away: new Set(out.players.away.filter((p) => p.starter).map((p) => p.id)) };
    for (const p of plays) {
      if (!/substitution/i.test(p.type) && !/enters the game for/i.test(p.text)) continue;
      let side = p.teamId ? sideOf(p.teamId) : null;
      let inId = null, outId = null; const m = SUB.exec(p.text.trim());
      if (m) { inId = findName(m[1], side); outId = findName(m[2], side); }
      if ((!inId || !outId) && p.parts.length >= 2) { inId = inId || p.parts[0]; outId = outId || p.parts[1]; }
      if (!side) side = (out.byId.get(inId) || out.byId.get(outId) || {}).side;
      if (!side) continue;
      out.subs.push({ seq: p.seq, period: p.period, clock: p.clock, side, inId, outId, text: p.text });
      if (outId) court[side].delete(outId);
      if (inId) court[side].add(inId);
    }
    for (const side of ["home", "away"]) {
      let ids = [...court[side]];
      if (flags) { const f = out.players[side].filter((p) => p.flag).map((p) => p.id); if (f.length === 5) ids = f; }
      out.onCourt[side] = ids.map((id) => out.byId.get(id)).filter(Boolean);
      out.approx[side] = out.onCourt[side].length !== 5;
    }
    out.last = plays.length ? plays[plays.length - 1] : null;
    return out;
  }

  // ---------- polling ----------
  const live = () => [...S.games.values()].some((g) => g.state === "in");
  async function loadScoreboard() {
    const sb = await getJSON("apis/site/v2/sports/basketball/nba/scoreboard?dates=" + S.day);
    const seen = new Set();
    for (const e of sb.events || []) { const g = parseEvent(e); seen.add(g.id); S.games.set(g.id, g); }
    for (const id of [...S.games.keys()]) if (!seen.has(id)) S.games.delete(id);
    S.sbAt = Date.now(); S.ok = true;
  }
  async function loadSummary(id) {
    const s = await getJSON("apis/site/v2/sports/basketball/nba/summary?event=" + id);
    let g = S.games.get(id);
    const hc = s.header && s.header.competitions && s.header.competitions[0];
    if (hc) { const hg = parseComp(hc, id, hc.date); if (!g) g = hg; else { g.home.lines = hg.home.lines.length ? hg.home.lines : g.home.lines; g.away.lines = hg.away.lines.length ? hg.away.lines : g.away.lines; } }
    if (!g || !g.home) return;
    S.games.set(id, g);
    const prev = S.sums.get(id);
    const sum = parseSummary(g, s);
    S.sums.set(id, sum); S.sumAt.set(id, Date.now());
    noticeSubs(g, prev, sum);
  }
  function noticeSubs(g, prev, sum) {
    const lastSeen = S.seenSubs.get(g.id);
    const maxSeq = sum.subs.length ? sum.subs[sum.subs.length - 1].seq : -1;
    S.seenSubs.set(g.id, maxSeq);
    if (lastSeen == null || !prev) return; // first load: no toasts
    const fresh = sum.subs.filter((x) => x.seq > lastSeen);
    if (!fresh.length) return;
    const now = Date.now(); const f = S.fresh.get(g.id) || new Map();
    for (const x of fresh) if (x.inId) f.set(x.inId, now);
    S.fresh.set(g.id, f);
    if (currentGameId() !== g.id) return;
    for (const x of fresh.slice(-3)) {
      const pin = sum.byId.get(x.inId), pout = sum.byId.get(x.outId);
      toast(`<b class="in">▲ ${esc(pin ? pin.short : "?")}</b> in · <span class="out">▼ ${esc(pout ? pout.short : "?")}</span> out <span class="muted">· ${esc(g[x.side].abbr)} · Q${x.period} ${esc(x.clock)}</span>`, g[x.side].color);
    }
  }

  let busy = false;
  async function tick(force) {
    if (busy) return; busy = true;
    try {
      const now = Date.now();
      const sbEvery = live() ? 10e3 : 30e3;
      if (force || now - S.sbAt > sbEvery) {
        try { await loadScoreboard(); } catch (e) { S.ok = false; }
      }
      const open = currentGameId();
      const due = [];
      for (const g of S.games.values()) {
        const at = S.sumAt.get(g.id) || 0;
        if (g.id === open) { if (force || (g.state === "in" ? now - at > 5e3 : now - at > 60e3)) due.unshift(g.id); continue; }
        if (g.state === "in" && now - at > 25e3) due.push(g.id);
        else if (g.state === "post" && !at) due.push(g.id);
        else if (g.state === "pre" && now - at > 300e3 && Date.parse(g.date) - now < 90 * 60e3) due.push(g.id);
      }
      if (open && !S.games.has(open) && (force || now - (S.sumAt.get(open) || 0) > 5e3)) due.unshift(open);
      for (const id of due.slice(0, 5)) { try { await loadSummary(id); } catch (e) { /* keep last good data */ } }
      S.updated = Date.now();
      render();
    } finally { busy = false; }
  }

  // ---------- helpers ----------
  const currentGameId = () => { const m = /^#g-(\w+)/.exec(location.hash); return m ? m[1] : null; };
  const statusText = (g) => g.state === "pre" ? mytTime(g.date) : g.state === "post" ? (g.short || "Final") : (g.short || `Q${g.period} ${g.clock}`);
  const initials = (p) => p.jersey ? p.jersey : p.name.split(" ").map((x) => x[0]).join("").slice(0, 2);
  const tc = (t) => `--tc:${esc(t.color)}`;
  const gameScore = (s) => s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.oreb + 0.3 * s.dreb + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * s.pf - s.to;
  const pct = (m, a) => (a ? Math.round((100 * m) / a) + "%" : "–");
  const posRank = (p) => (/C/.test(p.pos) && !/^G/.test(p.pos) ? 2 : /F/.test(p.pos) ? 1 : 0);
  const playerLine = (s) => `${s.pts} PTS · ${s.reb} REB · ${s.ast} AST`;

  function allPlayersToday() {
    const list = [];
    for (const [id, sum] of S.sums) {
      const g = S.games.get(id); if (!g) continue;
      for (const p of sum.players.home.concat(sum.players.away)) if (!p.dnp && (p.s.min > 0 || p.s.pts > 0)) list.push({ p, g, gs: gameScore(p.s) });
    }
    return list;
  }

  // ---------- rendering ----------
  function renderStatus() {
    const n = [...S.games.values()].filter((g) => g.state === "in").length;
    const cls = S.ok === false ? "bad" : n ? "live" : S.ok ? "ok" : "";
    const via = DEMO ? "demo games" : route === "relay" ? "via helper" : "ESPN";
    $("#status").innerHTML = `<span class="dot ${cls}"></span>${S.ok === false ? "Can't reach the live feed" : `${n ? n + " live · " : ""}${via}${S.updated ? " · " + new Date(S.updated).toLocaleTimeString("en-MY", { timeZone: MYT }) : ""}`}`;
    $("#help").hidden = DEMO || S.ok !== false;
    $("#diag").textContent = Object.keys(diag).length ? "Details: " + Object.entries(diag).map(([k, v]) => k + " → " + v).join(" | ") : "";
    $("#dateLabel").textContent = dayLabel(S.day);
  }

  function renderHome() {
    const games = [...S.games.values()].sort((a, b) => ({ in: 0, pre: 1, post: 2 }[a.state] - { in: 0, pre: 1, post: 2 }[b.state]) || Date.parse(a.date) - Date.parse(b.date));
    const all = allPlayersToday();
    const top = all.slice().sort((a, b) => b.gs - a.gs).slice(0, 6);
    const lead = (label, f) => {
      const best = all.slice().sort((a, b) => f(b.p.s) - f(a.p.s))[0];
      if (!best || !f(best.p.s)) return "";
      return `<button class="leader" type="button" data-player="${esc(best.g.id)}|${esc(best.p.id)}"><div class="k">${label}</div><div class="v"><span>${esc(best.p.short)} <span class="muted">${esc(best.p.team.abbr)}</span></span><b>${f(best.p.s)}</b></div></button>`;
    };
    const perf = top.length ? `
      <section class="perf" aria-labelledby="ph">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h2 id="ph">Top performers</h2><span class="muted small">Ranked by game score (points, efficiency, rebounds, assists, defence) across ${S.sums.size} game${S.sums.size === 1 ? "" : "s"}</span></div>
        <div class="perfrow">${top.map((x, i) => `
          <button class="pcard" type="button" style="${tc(x.p.team)}" data-player="${esc(x.g.id)}|${esc(x.p.id)}">
            <span class="rank">${i + 1}</span>
            <div class="who"><span class="badge">${esc(initials(x.p))}</span><div><div class="name">${esc(x.p.name)}</div><div class="muted small">${esc(x.p.team.abbr)} · ${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</div></div></div>
            <div class="line muted"><b>${x.p.s.pts}</b> PTS · <b>${x.p.s.reb}</b> REB · <b>${x.p.s.ast}</b> AST</div>
            <div class="muted small num">${x.p.s.fgm}-${x.p.s.fga} FG · ${x.p.s.tpm}-${x.p.s.tpa} 3PT · ${x.p.s.min} MIN ${x.g.state === "in" ? '<span class="chip live">LIVE</span>' : x.g.state === "post" ? '<span class="chip">FINAL</span>' : ""}</div>
          </button>`).join("")}</div>
        <div class="leaders">${lead("Points", (s) => s.pts)}${lead("Rebounds", (s) => s.reb)}${lead("Assists", (s) => s.ast)}${lead("Threes made", (s) => s.tpm)}${lead("Steals + blocks", (s) => s.stl + s.blk)}</div>
      </section>` : `<section class="perf"><h2>Top performers</h2><div class="empty">Top performers show up once games tip off.</div></section>`;

    const card = (g) => {
      const sum = S.sums.get(g.id);
      const best = (side) => { if (!sum) return ""; const b = sum.players[side].slice().sort((a, c) => c.s.pts - a.s.pts)[0]; return b && b.s.pts ? `${esc(b.short)} ${b.s.pts}` : ""; };
      const row = (side) => { const t = g[side], o = g[side === "home" ? "away" : "home"]; const lose = g.state === "post" && t.score < o.score;
        return `<div class="trow ${lose ? "lose" : ""}"><span class="tcode" style="${tc(t)}">${esc(t.abbr)}</span><span class="tname">${esc(t.name)} <span class="small">${esc(t.record)}</span></span><span class="tscore">${g.state === "pre" ? "" : t.score}</span></div>`; };
      return `<button class="gcard ${g.state === "in" ? "live" : ""}" type="button" data-game="${esc(g.id)}">
        ${row("away")}${row("home")}
        <div class="gfoot"><span class="st ${g.state === "in" ? "live" : ""}">${g.state === "in" ? '<span class="dot live"></span> ' : ""}${esc(statusText(g))}</span><span>${g.state === "pre" ? "Tap for lineups" : [best("away"), best("home")].filter(Boolean).join(" · ") || "Tap for box score"}</span></div>
      </button>`;
    };
    return perf + `<section style="display:grid;gap:10px" aria-labelledby="gh"><h2 id="gh">Games <span class="muted small">${games.length}</span></h2>${games.length ? `<div class="games">${games.map(card).join("")}</div>` : `<div class="empty">${S.ok === false ? "Waiting for the live feed…" : "No NBA games on this day."}</div>`}</section>`;
  }

  function renderGame(id) {
    const g = S.games.get(id); const sum = S.sums.get(id);
    if (!g) return `<button class="back" type="button" data-home>← All games</button><div class="empty">Loading game…</div>`;
    const periods = Math.max(4, g.home.lines.length, g.away.lines.length);
    const ph = Array.from({ length: periods }, (_, i) => (i < 4 ? "Q" + (i + 1) : "OT" + (i - 3 > 1 ? i - 3 : "")));
    const lsRow = (t) => `<tr><td><span class="tcode" style="${tc(t)};font-size:15px;min-width:40px">${esc(t.abbr)}</span></td>${ph.map((_, i) => `<td>${t.lines[i] != null ? t.lines[i] : "–"}</td>`).join("")}<td><b>${g.state === "pre" ? "–" : t.score}</b></td></tr>`;
    const team = (side) => `<div class="sh-team"><span class="tcode" style="${tc(g[side])}">${esc(g[side].abbr)}</span><span class="muted small">${esc(g[side].full)}</span><span class="muted small">${esc(g[side].record)}</span></div>`;
    const last = sum && sum.last;
    const head = `
      <button class="back" type="button" data-home>← All games</button>
      <section class="scorehead">
        <div class="sh-main">${team("away")}
          <div class="sh-mid"><div class="sh-score"><span>${g.state === "pre" ? "" : g.away.score}</span> <span class="muted">${g.state === "pre" ? "vs" : "–"}</span> <span>${g.state === "pre" ? "" : g.home.score}</span></div><div class="st ${g.state === "in" ? "live" : ""}">${g.state === "in" ? '<span class="dot live"></span> ' : ""}${esc(statusText(g))}</div></div>
          ${team("home")}</div>
        <div style="overflow-x:auto"><table class="linescore"><thead><tr><th></th>${ph.map((x) => `<th>${x}</th>`).join("")}<th>T</th></tr></thead><tbody>${lsRow(g.away)}${lsRow(g.home)}</tbody></table></div>
        ${last && g.state !== "pre" ? `<div class="lastplay">Last play · <span class="num">Q${last.period} ${esc(last.clock)}</span> · <b>${esc(last.text)}</b></div>` : ""}
      </section>`;
    const tabs = `<div class="tabs" role="tablist">${[["court", "Court"], ["box", "Box score"], ["plays", "Plays"]].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</div>`;
    if (!sum) return head + tabs + `<div class="empty">Loading players…</div>`;
    const body = S.tab === "box" ? renderBox(g, sum) : S.tab === "plays" ? renderPlays(g, sum) : renderCourt(g, sum);
    return head + tabs + body;
  }

  const SPOTS = [[30, 22], [70, 22], [20, 52], [80, 52], [50, 70]]; // G, G, F, F, C (basket at the bottom)
  function renderCourt(g, sum) {
    const fresh = S.fresh.get(g.id) || new Map(); const now = Date.now();
    const label = g.state === "pre" ? "Starting five" : g.state === "post" ? "Final five on court" : "On court now";
    const half = (side) => {
      const t = g[side];
      const five = sum.onCourt[side].slice().sort((a, b) => posRank(a) - posRank(b));
      const spots = five.slice(0, 5).map((p, i) => {
        const [x, y] = SPOTS[i] || [50, 50];
        const isNew = fresh.has(p.id) && now - fresh.get(p.id) < 20e3;
        const pf = p.s.pf >= 6 ? '<span class="pf5">FOULED OUT</span>' : p.s.pf >= 5 ? `<span class="pf5">${p.s.pf} PF</span>` : `${p.s.pf} PF`;
        return `<button type="button" class="spot ${isNew ? "fresh" : ""}" style="left:${x}%;top:${y}%;${tc(t)}" data-player="${esc(g.id)}|${esc(p.id)}" aria-label="${esc(p.name)}">
          <span class="badge">${esc(initials(p))}</span><span class="pn">${esc(p.short)}</span><span class="ps">${p.s.pts} PTS · ${pf}</span></button>`;
      }).join("");
      return `<div style="display:grid;gap:6px"><div class="court" style="${tc(t)}"><div class="ctitle"><span class="tcode" style="${tc(t)}">${esc(t.abbr)}</span><span class="small">${label}</span></div>${spots || '<div class="empty" style="position:absolute;inset:40% 10% auto">Lineup not posted yet</div>'}</div>
        ${sum.approx[side] && five.length ? `<div class="lineupnote">Showing ${five.length} players: the play-by-play hasn't confirmed a full five yet.</div>` : ""}</div>`;
    };
    const subs = sum.subs.slice().reverse().filter((x) => S.subFilter === "all" || x.side === S.subFilter);
    // group subs made at the same stoppage by the same team
    const groups = [];
    for (const x of subs) { const gk = x.period + "|" + x.clock + "|" + x.side; const last = groups[groups.length - 1]; if (last && last.k === gk) last.items.push(x); else groups.push({ k: gk, items: [x], x }); }
    const fname = (id) => { const p = sum.byId.get(id); return p ? `<button type="button" data-player="${esc(g.id)}|${esc(p.id)}" style="background:none;border:0;padding:0;cursor:pointer;color:inherit">${esc(p.short)}</button>` : "?"; };
    const subHtml = groups.slice(0, 60).map((gr) => `
      <div class="sub ${Date.now() - (fresh.get(gr.items[0].inId) || 0) < 20e3 ? "new" : ""}" style="${tc(g[gr.x.side])}">
        <div class="when"><b>Q${gr.x.period}</b>${esc(gr.x.clock)}<div><span class="tcode" style="${tc(g[gr.x.side])};font-size:12px;min-width:0;padding:0 5px">${esc(g[gr.x.side].abbr)}</span></div></div>
        <div style="display:grid;gap:4px">${gr.items.map((x) => `<div class="swap"><span class="in">▲ ${fname(x.inId)}</span><span class="out">▼ ${fname(x.outId)}</span></div>`).join("")}</div>
      </div>`).join("");
    return `<section style="display:grid;gap:12px">
      <div class="courts">${half("away")}${half("home")}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Substitutions <span class="muted small">${sum.subs.length}</span></h2>
        <div class="subfilter">${[["all", "All"], ["away", g.away.abbr], ["home", g.home.abbr]].map(([k, l]) => `<button type="button" data-subf="${k}" aria-pressed="${S.subFilter === k}">${esc(l)}</button>`).join("")}</div></div>
      <div class="subs">${subHtml || `<div class="empty">${g.state === "pre" ? "Substitutions appear here once the game starts." : "No substitutions yet."}</div>`}</div>
    </section>`;
  }

  const COLS = [["min", "MIN"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"], ["to", "TO"], ["pf", "PF"], ["fg", "FG"], ["tp", "3PT"], ["ft", "FT"], ["oreb", "OREB"], ["dreb", "DREB"], ["pm", "+/-"]];
  const cell = (p, k) => k === "fg" ? `${p.s.fgm}-${p.s.fga}` : k === "tp" ? `${p.s.tpm}-${p.s.tpa}` : k === "ft" ? `${p.s.ftm}-${p.s.fta}` : k === "pm" ? (p.s.pm > 0 ? "+" + p.s.pm : p.s.pm) : p.s[k];
  const sortVal = (p, k) => k === "fg" ? p.s.fgm : k === "tp" ? p.s.tpm : k === "ft" ? p.s.ftm : p.s[k];
  function renderBox(g, sum) {
    const side = S.boxSide; const t = g[side];
    const on = new Set(sum.onCourt[side].map((p) => p.id));
    const players = sum.players[side];
    const played = players.filter((p) => !p.dnp); const dnp = players.filter((p) => p.dnp);
    const row = (p) => `<tr data-player="${esc(g.id)}|${esc(p.id)}"><td>${g.state === "in" ? `<span class="oc ${on.has(p.id) ? "" : "off"}" title="${on.has(p.id) ? "On court" : "Bench"}"></span>` : ""}${esc(p.short)} <span class="muted small">${esc(p.pos)}</span></td>${COLS.map(([k]) => `<td class="${k === "pts" ? "pts" : ""}">${cell(p, k)}</td>`).join("")}</tr>`;
    let body;
    if (S.sort) { body = played.slice().sort((a, b) => sortVal(b, S.sort) - sortVal(a, S.sort)).map(row).join(""); }
    else {
      const st = played.filter((p) => p.starter), bn = played.filter((p) => !p.starter).sort((a, b) => b.s.min - a.s.min);
      body = `<tr class="sep"><td colspan="${COLS.length + 1}">Starters</td></tr>${st.map(row).join("")}<tr class="sep"><td colspan="${COLS.length + 1}">Bench</td></tr>${bn.map(row).join("")}`;
    }
    body += dnp.map((p) => `<tr class="dnp" data-player="${esc(g.id)}|${esc(p.id)}"><td>${esc(p.short)}</td><td colspan="${COLS.length}" style="text-align:left">${esc(p.reason || "Did not play")}</td></tr>`).join("");
    const tot = played.reduce((a, p) => { for (const k in p.s) a[k] = (a[k] || 0) + p.s[k]; return a; }, {});
    const totRow = `<tr><td>Team</td>${COLS.map(([k]) => `<td>${k === "fg" ? `${tot.fgm || 0}-${tot.fga || 0}` : k === "tp" ? `${tot.tpm || 0}-${tot.tpa || 0}` : k === "ft" ? `${tot.ftm || 0}-${tot.fta || 0}` : k === "pm" || k === "min" ? "" : tot[k] || 0}</td>`).join("")}</tr>`;
    const pctRow = `<tr><td class="muted">Shooting</td>${COLS.map(([k]) => `<td class="muted">${k === "fg" ? pct(tot.fgm, tot.fga) : k === "tp" ? pct(tot.tpm, tot.tpa) : k === "ft" ? pct(tot.ftm, tot.fta) : ""}</td>`).join("")}</tr>`;
    return `<section style="display:grid;gap:10px">
      <div class="boxteam">${["away", "home"].map((s2) => `<button type="button" data-box="${s2}" aria-pressed="${side === s2}"><span class="tcode" style="${tc(g[s2])};font-size:15px;min-width:40px">${esc(g[s2].abbr)}</span>${esc(g[s2].name)}</button>`).join("")}
        ${S.sort ? `<button type="button" data-sort="">Reset order</button>` : ""}</div>
      ${players.length ? `<div class="tablewrap"><table class="box"><thead><tr><th>Player</th>${COLS.map(([k, l]) => `<th data-sort="${k}" ${S.sort === k ? 'aria-sort="descending"' : ""} title="Sort by ${l}">${l}</th>`).join("")}</tr></thead><tbody>${body}</tbody><tfoot>${totRow}${pctRow}</tfoot></table></div>
      <div class="muted small">Tap a player for their full stats and plays. Tap a column to sort. ${g.state === "in" ? "Green dot = on court now." : ""}</div>` : `<div class="empty">The box score appears once ${esc(t.name)}'s lineup is posted.</div>`}
    </section>`;
  }

  function renderPlays(g, sum) {
    const list = sum.plays.slice().reverse().filter((p) => !S.scoringOnly || p.scoring).slice(0, 200);
    const side = (p) => (p.teamId === g.home.id ? g.home : p.teamId === g.away.id ? g.away : null);
    return `<section style="display:grid;gap:10px">
      <div class="subfilter"><button type="button" data-scoring aria-pressed="${S.scoringOnly}">Scoring plays only</button></div>
      <div class="plays">${list.map((p) => { const t = side(p); return `<div class="play ${p.scoring ? "score" : ""}" style="${t ? tc(t) : ""}"><span class="t">Q${p.period} ${esc(p.clock)}</span><span class="q">${t ? `<span class="tcode" style="${tc(t)};font-size:12px;min-width:0;padding:0 5px">${esc(t.abbr)}</span>` : ""}</span><span>${esc(p.text)}</span><span class="s">${p.away != null ? `${p.away}–${p.home}` : ""}</span></div>`; }).join("") || '<div class="empty">No plays yet.</div>'}</div>
    </section>`;
  }

  function renderSheet() {
    const el = $("#sheet");
    if (!S.sheet) { el.hidden = true; el.innerHTML = ""; return; }
    const [gid, pid] = S.sheet; const g = S.games.get(gid); const sum = S.sums.get(gid);
    const p = sum && sum.byId.get(pid);
    if (!g || !p) { el.hidden = true; return; }
    const keep = el.querySelector(".card") ? el.querySelector(".card").scrollTop : 0;
    const on = sum.onCourt[p.side].some((x) => x.id === p.id);
    const status = p.dnp ? (p.reason || "Did not play") : g.state === "in" ? (on ? "On court" : "On the bench") : g.state === "post" ? "Final" : "";
    const s = p.s;
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    const shoot = (m, a, l) => `<div class="stat"><b>${m}-${a}</b><span>${l} · ${pct(m, a)}</span><div class="bar"><i style="width:${a ? Math.round((100 * m) / a) : 0}%"></i></div></div>`;
    const mySubs = sum.subs.filter((x) => x.inId === p.id || x.outId === p.id).slice().reverse();
    const myPlays = sum.plays.filter((x) => x.parts.includes(p.id) && !/substitution/i.test(x.type)).slice(-15).reverse();
    el.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="${esc(p.name)}" style="${tc(p.team)}">
      <div class="phead"><span class="badge">${esc(initials(p))}</span><div><div style="font-family:var(--display);font-size:24px">${esc(p.name)}</div><div class="muted small">${esc(p.team.full)}${p.pos ? " · " + esc(p.pos) : ""}${p.jersey ? " · #" + esc(p.jersey) : ""} ${status ? `· <span class="chip ${on && g.state === "in" ? "in" : ""}">${esc(status)}</span>` : ""}</div></div><button type="button" class="close" data-close>Close</button></div>
      <div class="statgrid">${stat(s.pts, "Points")}${stat(s.reb, "Rebounds")}${stat(s.ast, "Assists")}${stat(s.stl, "Steals")}${stat(s.blk, "Blocks")}${stat(s.to, "Turnovers")}${stat(s.pf, "Fouls")}${stat(s.min, "Minutes")}${stat(s.pm > 0 ? "+" + s.pm : s.pm, "+/-")}${stat(s.oreb + " / " + s.dreb, "Off / Def reb")}${stat(gameScore(s).toFixed(1), "Game score")}</div>
      <div class="statgrid">${shoot(s.fgm, s.fga, "FG")}${shoot(s.tpm, s.tpa, "3PT")}${shoot(s.ftm, s.fta, "FT")}</div>
      ${mySubs.length ? `<div><h3 style="font-size:18px;margin-bottom:6px">Substitutions</h3><div class="subs">${mySubs.slice(0, 12).map((x) => `<div class="small"><span class="num muted">Q${x.period} ${esc(x.clock)}</span> · ${x.inId === p.id ? '<span class="in" style="color:var(--in)">▲ Checked in</span>' : '<span style="color:var(--out)">▼ Checked out</span>'}</div>`).join("")}</div></div>` : ""}
      <div><h3 style="font-size:18px;margin-bottom:6px">Recent plays</h3>${myPlays.length ? `<div class="plays" style="max-height:none">${myPlays.map((x) => `<div class="play ${x.scoring ? "score" : ""}" style="grid-template-columns:62px 1fr auto"><span class="t">Q${x.period} ${esc(x.clock)}</span><span>${esc(x.text)}</span><span class="s">${x.away != null ? `${x.away}–${x.home}` : ""}</span></div>`).join("")}</div>` : '<div class="muted small">No plays yet.</div>'}</div>
    </div>`;
    el.hidden = false;
    el.querySelector(".card").scrollTop = keep;
  }

  function render() {
    renderStatus();
    const v = $("#view");
    const keepX = [...v.querySelectorAll(".tablewrap,.perfrow")].map((x) => x.scrollLeft);
    const keepY = [...v.querySelectorAll(".plays")].map((x) => x.scrollTop);
    const id = currentGameId();
    v.innerHTML = id ? renderGame(id) : renderHome();
    v.querySelectorAll(".tablewrap,.perfrow").forEach((x, i) => { if (keepX[i]) x.scrollLeft = keepX[i]; });
    v.querySelectorAll(".plays").forEach((x, i) => { if (keepY[i]) x.scrollTop = keepY[i]; });
    renderSheet();
  }

  function toast(html, color) {
    const t = document.createElement("div"); t.className = "toast"; t.style.setProperty("--tc", color || "#888"); t.innerHTML = html;
    $("#toasts").appendChild(t); setTimeout(() => t.remove(), 6000);
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-player],[data-game],[data-home],[data-tab],[data-box],[data-sort],[data-subf],[data-scoring],[data-close]");
    if (!el) { if (e.target.id === "sheet") { S.sheet = null; renderSheet(); } return; }
    if (el.dataset.player) { S.sheet = el.dataset.player.split("|"); const gid = S.sheet[0]; if (!S.sums.has(gid)) tick(true); renderSheet(); return; }
    if (el.hasAttribute("data-close")) { S.sheet = null; renderSheet(); return; }
    if (el.dataset.game) { location.hash = "g-" + el.dataset.game; return; }
    if (el.hasAttribute("data-home")) { location.hash = ""; return; }
    if (el.dataset.tab) { S.tab = el.dataset.tab; try { localStorage.setItem("nbalive-tab", S.tab); } catch (err) { /* ignore */ } render(); return; }
    if (el.dataset.box) { S.boxSide = el.dataset.box; render(); return; }
    if (el.hasAttribute("data-sort")) { S.sort = el.dataset.sort ? (S.sort === el.dataset.sort ? null : el.dataset.sort) : null; render(); return; }
    if (el.dataset.subf) { S.subFilter = el.dataset.subf; render(); return; }
    if (el.hasAttribute("data-scoring")) { S.scoringOnly = !S.scoringOnly; render(); return; }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.sheet) { S.sheet = null; renderSheet(); } });
  window.addEventListener("hashchange", () => { S.sort = null; S.subFilter = "all"; window.scrollTo(0, 0); render(); tick(true); });
  const setDay = (d) => { S.day = d; S.games.clear(); S.sums.clear(); S.sumAt.clear(); S.seenSubs.clear(); S.sbAt = 0; location.hash = ""; render(); tick(true); };
  $("#prevDay").addEventListener("click", () => setDay(shiftDay(S.day, -1)));
  $("#nextDay").addEventListener("click", () => setDay(shiftDay(S.day, 1)));
  $("#todayBtn").addEventListener("click", () => setDay(etDate(new Date())));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(true); });

  render();
  tick(true);
  setInterval(() => tick(false), 2500);
  window.__nbaLive = S; // handy for debugging in the browser console
})();
