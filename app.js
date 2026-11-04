/* NBA Live Value Board
   Live game data: NBA live data feed (cdn.nba.com), refreshed every few seconds.
   Live odds: Polymarket prices (free, public). Price 0.46 = 46% chance = decimal odds 2.17.
   Only sides at decimal odds 2.00+ are ever suggested. */
(function () {
  const M = window.Model;
  const POLL_MS = 4000;
  const RELAY = "http://127.0.0.1:8787";
  const URLS = {
    scoreboard: { direct: "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json", relay: RELAY + "/nba/static/json/liveData/scoreboard/todaysScoreboard_00.json" },
    box: (id) => ({ direct: `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`, relay: `${RELAY}/nba/static/json/liveData/boxscore/boxscore_${id}.json` }),
    market: (slug) => ({ direct: `https://gamma-api.polymarket.com/events?slug=${slug}`, relay: `${RELAY}/pm/events?slug=${slug}` })
  };

  // ---------- persistent settings ----------
  const LS = "nba-live-board-v1";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { saved = {}; }
  const S = Object.assign({ bankroll: 500, minEdge: 0.04, cap: 0.02, sound: false, overrides: {}, baselines: {} }, saved);
  function persist() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }

  // ---------- state ----------
  const demo = location.hash === "#demo";
  const route = { nba: null, market: null }; // "direct" | "relay"
  const status = { nba: "connecting", market: "connecting", last: null, error: "" };
  const games = new Map();   // gameId -> game view model
  const history = new Map(); // gameId -> [{t, p}]
  const log = [];
  const alerted = new Set();
  const streak = new Map();

  // ---------- fetching with direct -> relay fallback ----------
  async function getJSON(pair, kind) {
    const order = route[kind] === "relay" ? ["relay", "direct"] : ["direct", "relay"];
    let lastErr;
    for (const way of order) {
      try {
        const r = await fetch(pair[way], { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "404" : "HTTP " + r.status);
        const j = await r.json();
        route[kind] = way;
        return j;
      } catch (e) {
        lastErr = e;
        if (e.message === "404") throw e; // the resource doesn't exist; trying the other route won't help
      }
    }
    throw lastErr;
  }

  // ---------- NBA ----------
  async function pollNBA() {
    const sb = await getJSON(URLS.scoreboard, "nba");
    status.nba = "ok";
    const list = (sb.scoreboard && sb.scoreboard.games) || [];
    const seen = new Set();
    await Promise.all(list.map(async (g) => {
      seen.add(g.gameId);
      const v = games.get(g.gameId) || { id: g.gameId, onCourt: { home: [], away: [] }, out: { home: [], away: [] }, market: null };
      v.status = g.gameStatus; v.statusText = g.gameStatusText;
      v.period = g.period; v.clock = M.clockSeconds(g.gameClock);
      v.tipUTC = g.gameTimeUTC; v.etDate = (g.gameEt || g.gameTimeUTC || "").slice(0, 10);
      v.home = teamOf(g.homeTeam); v.away = teamOf(g.awayTeam);
      if (g.gameStatus === 2) {
        try { applyBox(v, await getJSON(URLS.box(g.gameId), "nba")); } catch (e) { /* box score not posted yet */ }
      } else if (g.gameStatus === 1 && !v.boxChecked) {
        try { applyBox(v, await getJSON(URLS.box(g.gameId), "nba")); } catch (e) { /* lineups usually post ~30 min before tip */ }
        v.boxChecked = Date.now() > Date.parse(v.tipUTC) - 45 * 60e3;
      }
      games.set(g.gameId, v);
    }));
    for (const id of [...games.keys()]) if (!seen.has(id)) games.delete(id);
  }
  function teamOf(t) {
    return { tri: t.teamTricode, name: t.teamName, city: t.teamCity, score: t.score || 0, rec: (t.wins != null ? t.wins + "-" + t.losses : ""), fouls: t.teamFoulsInPeriod ?? null, timeouts: t.timeoutsRemaining ?? null };
  }
  function applyBox(v, box) {
    const g = box.game; if (!g) return;
    for (const side of ["home", "away"]) {
      const team = g[side + "Team"]; if (!team || !team.players) continue;
      const players = team.players.map((p) => ({
        name: p.nameI || p.name, pos: p.position || "", starter: p.starter === "1",
        on: p.oncourt === "1", active: p.status === "ACTIVE", reason: p.notPlayingDescription || p.notPlayingReason || "",
        pts: p.statistics ? p.statistics.points : 0, pf: p.statistics ? p.statistics.foulsPersonal : 0,
        min: p.statistics ? Math.round(M.clockSeconds(p.statistics.minutes) / 60) : 0
      }));
      v.onCourt[side] = players.filter((p) => p.on);
      v.out[side] = players.filter((p) => !p.active);
      v.foulTrouble = v.foulTrouble || {};
      v.foulTrouble[side] = players.filter((p) => p.active && p.starter && p.pf >= Math.min(6, (v.period || 1) + 2));
      v.fouledOut = v.fouledOut || {};
      v.fouledOut[side] = players.filter((p) => p.starter && p.pf >= 6);
    }
  }

  // ---------- Polymarket ----------
  function slugsFor(v) {
    const d = v.etDate; const a = v.away.tri.toLowerCase(); const h = v.home.tri.toLowerCase();
    return [`nba-${a}-${h}-${d}`, `nba-${h}-${a}-${d}`];
  }
  async function pollMarket(v) {
    if (v.status === 3) return;
    const slugs = v.marketSlug ? [v.marketSlug] : slugsFor(v);
    for (const slug of slugs) {
      let ev;
      try { ev = await getJSON(URLS.market(slug), "market"); } catch (e) { if (e.message === "404") continue; throw e; }
      const event = Array.isArray(ev) ? ev[0] : ev;
      if (!event || !event.markets) continue;
      const m = pickMoneyline(event.markets, v);
      if (!m) continue;
      v.marketSlug = slug; v.market = m; v.market.at = Date.now();
      status.market = "ok";
      return;
    }
    v.market = v.market && Date.now() - v.market.at < 60e3 ? v.market : null;
  }
  function pickMoneyline(markets, v) {
    const hn = v.home.name.toLowerCase(), an = v.away.name.toLowerCase();
    const cands = markets.filter((m) => !m.closed && m.outcomes && m.outcomePrices);
    const ordered = cands.sort((x, y) => (y.sportsMarketType === "moneyline") - (x.sportsMarketType === "moneyline"));
    for (const m of ordered) {
      let outs, prices;
      try { outs = JSON.parse(m.outcomes); prices = JSON.parse(m.outcomePrices).map(Number); } catch (e) { continue; }
      if (outs.length !== 2) continue;
      const iH = outs.findIndex((o) => o.toLowerCase().includes(hn) || hn.includes(o.toLowerCase()));
      const iA = outs.findIndex((o) => o.toLowerCase().includes(an) || an.includes(o.toLowerCase()));
      if (iH < 0 || iA < 0 || iH === iA) continue;
      const ph = prices[iH], pa = prices[iA];
      if (!(ph > 0 && pa > 0)) continue;
      return { homePrice: ph, awayPrice: pa, homeProb: ph / (ph + pa) };
    }
    return null;
  }

  // ---------- model ----------
  function compute(v) {
    const lead = v.home.score - v.away.score;
    const secLeft = M.secondsLeft(v.period, v.clock, v.status);
    v.secLeft = secLeft;
    let base = S.baselines[v.id];
    if (v.status === 1 && v.market) {
      base = { spread: M.spreadFromProb(v.market.homeProb), source: "market pre-game" };
      S.baselines[v.id] = base;
    } else if (!base && v.status === 2 && v.market) {
      const s = M.impliedPreSpread(v.market.homeProb, lead, secLeft);
      if (s != null) { base = { spread: s, source: "estimated from live market" }; S.baselines[v.id] = base; }
    }
    if (!base) base = { spread: 0, source: "no market yet, coin flip" };
    let spread = base.spread;
    // in-game roster shock: a starter fouled out costs about 2 points over a full game
    if (v.fouledOut) spread += (v.fouledOut.away.length - v.fouledOut.home.length) * 2;
    v.baseSource = base.source;
    v.modelHome = v.status === 3 ? (lead > 0 ? 1 : 0) : M.liveHomeProb(lead, secLeft, spread, v.period);
    const h = history.get(v.id) || [];
    const last = h[h.length - 1];
    if (!last || Math.abs(last.p - v.modelHome) > 0.002 || Date.now() - last.t > 30e3) {
      h.push({ t: Date.now(), p: v.modelHome, m: v.market ? v.market.homeProb : null });
      if (h.length > 400) h.shift();
      history.set(v.id, h);
    }
    v.sides = ["away", "home"].map((side) => {
      const p = side === "home" ? v.modelHome : 1 - v.modelHome;
      const mprice = v.market ? (side === "home" ? v.market.homePrice : v.market.awayPrice) : null;
      const marketOdds = mprice ? 1 / mprice : null;
      const over = S.overrides[v.id + ":" + side];
      const odds = over || marketOdds;
      const late = v.status === 2 && secLeft < 240; // last 4 minutes: prices jump too fast to act on
      const r = v.status === 3 ? null : M.evaluate(p, odds, S.minEdge, S.cap);
      return { side, team: v[side], p, marketOdds, odds, override: !!over, r, late };
    });
  }

  // ---------- render ----------
  const $ = (s) => document.querySelector(s);
  const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
  const f2 = (x) => (x == null || !isFinite(x) ? "–" : x.toFixed(2));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const myt = (iso) => new Date(iso).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit" });
  function clockText(v) {
    if (v.status === 1) return "Tip " + myt(v.tipUTC);
    if (v.status === 3) return "Final";
    const q = v.period > 4 ? "OT" + (v.period - 4 > 1 ? v.period - 4 : "") : "Q" + v.period;
    const m = Math.floor(v.clock / 60), s = Math.floor(v.clock % 60);
    return `${q} ${m}:${String(s).padStart(2, "0")}`;
  }
  const VL = { value: "VALUE", close: "CLOSE", pass: "PASS" };

  function spark(v) {
    const h = history.get(v.id) || [];
    if (h.length < 2) return '<div class="spark empty">Win-chance line appears once the game moves</div>';
    const W = 260, H = 54;
    const x = (i) => (i / (h.length - 1)) * W, y = (p) => H - p * H;
    const line = h.map((d, i) => `${x(i).toFixed(1)},${y(d.p).toFixed(1)}`).join(" ");
    const mk = h.filter((d) => d.m != null).length > 1 ? h.map((d, i) => d.m == null ? null : `${x(i).toFixed(1)},${y(d.m).toFixed(1)}`).filter(Boolean).join(" ") : "";
    const lastP = h[h.length - 1].p;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(v.home.tri)} win chance over time, now ${pct(lastP)}">
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/>
      <polygon points="0,${H} ${line} ${W},${H}" class="area"/>
      ${mk ? `<polyline points="${mk}" class="mkt"/>` : ""}
      <polyline points="${line}" class="mdl"/>
      <circle cx="${W}" cy="${y(lastP).toFixed(1)}" r="3" class="dot"/>
    </svg>`;
  }

  function players(list, cls) {
    if (!list || !list.length) return '<span class="muted">–</span>';
    return list.map((p) => `<span class="pl ${cls || ""}">${esc(p.name)}${p.pos ? ` <i>${esc(p.pos)}</i>` : ""}${p.pf != null && cls !== "out" ? ` <b class="${p.pf >= 5 ? "hot" : ""}">${p.pf}PF</b>` : ""}${cls === "out" && p.reason ? ` <i>${esc(p.reason)}</i>` : ""}</span>`).join("");
  }

  function sideRow(v, s) {
    const chip = v.status === 3 ? "" : s.r ? (s.late && s.r.verdict === "value" ? '<span class="chip close">LATE, SKIP</span>' : `<span class="chip ${s.r.verdict}">${VL[s.r.verdict]}</span>`) : s.odds ? '<span class="chip na">UNDER 2.00</span>' : '<span class="chip na">NO PRICE</span>';
    return `<div class="side">
      <div class="tname"><strong>${esc(s.team.tri)}</strong> <span>${esc(s.team.name)} ${esc(s.team.rec)}</span></div>
      <div class="kv">Model <b class="num">${pct(s.p)}</b></div>
      <div class="kv">Market odds <b class="num">${f2(s.marketOdds)}</b></div>
      <div class="kv"><label for="ov-${v.id}-${s.side}">Your odds</label><input id="ov-${v.id}-${s.side}" class="ov num" data-k="${v.id}:${s.side}" type="number" step="0.01" min="1.01" inputmode="decimal" placeholder="opt." value="${S.overrides[v.id + ":" + s.side] || ""}"></div>
      <div class="kv">${s.r ? `Edge <b class="num">${(s.r.ev >= 0 ? "+" : "") + pct(s.r.ev, 1)}</b>` : ""}</div>
      <div class="kv">${chip}</div>
    </div>`;
  }

  function render() {
    const list = [...games.values()].sort((a, b) => (a.status === 2 ? 0 : a.status === 1 ? 1 : 2) - (b.status === 2 ? 0 : b.status === 1 ? 1 : 2) || Date.parse(a.tipUTC) - Date.parse(b.tipUTC));
    // connection bar
    const dot = (st) => st === "ok" ? "ok" : st === "connecting" ? "wait" : "bad";
    $("#conn").innerHTML = `
      <span class="cs ${dot(status.nba)}">Game feed: ${status.nba === "ok" ? ({ relay: "via helper", demo: "demo" }[route.nba] || "direct") : status.nba}</span>
      <span class="cs ${dot(status.market)}">Market odds: ${status.market === "ok" ? ({ relay: "via helper", demo: "demo" }[route.market] || "direct") : status.market}</span>
      <span class="muted">${status.last ? "Updated " + new Date(status.last).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }) : ""}${demo ? " · DEMO DATA" : ""}</span>`;
    $("#help").hidden = !(status.nba === "blocked" || status.market === "blocked");

    // suggestions
    const picks = [];
    for (const v of list) for (const s of v.sides || []) {
      if (s.r && (s.r.verdict === "value" || s.r.verdict === "close") && !(s.late)) picks.push({ v, s });
    }
    picks.sort((a, b) => b.s.r.ev - a.s.r.ev);
    $("#picks").innerHTML = picks.length ? picks.map(({ v, s }) => `<div class="pick ${s.r.verdict}">
        <span class="chip ${s.r.verdict}">${VL[s.r.verdict]}</span>
        <b>${esc(s.team.tri)} to win</b>
        <span class="muted">${esc(v.away.tri)} ${v.away.score} – ${v.home.score} ${esc(v.home.tri)} · ${clockText(v)}</span>
        <span>Odds <b class="num">${f2(s.odds)}</b>${s.override ? " (yours)" : ""} · Model <b class="num">${pct(s.p)}</b> · Edge <b class="num">${(s.r.ev >= 0 ? "+" : "") + pct(s.r.ev, 1)}</b></span>
        <span>Stake <b class="num">RM ${(s.r.stakeFrac * S.bankroll).toFixed(0)}</b></span>
      </div>`).join("") : `<p class="muted">No side at 2.00+ beats the model right now. This updates every few seconds.</p>`;

    // games
    $("#games").innerHTML = list.length ? list.map((v) => `<article class="game ${v.status === 2 ? "live" : ""}">
      <header>
        <div class="score"><span>${esc(v.away.tri)} <b class="num">${v.status === 1 ? "" : v.away.score}</b></span><span class="at">@</span><span>${esc(v.home.tri)} <b class="num">${v.status === 1 ? "" : v.home.score}</b></span></div>
        <div class="clock ${v.status === 2 ? "on" : ""}">${v.status === 2 ? '<i class="pulse"></i>' : ""}${clockText(v)}</div>
      </header>
      <div class="body">
        <div class="sides">${(v.sides || []).map((s) => sideRow(v, s)).join("")}</div>
        <div class="chart">${spark(v)}<div class="muted small">Solid: model ${esc(v.home.tri)} win chance · Dashed: market · Baseline: ${esc(v.baseSource || "")}</div></div>
      </div>
      <div class="roster">
        <div><h4>${esc(v.away.tri)} on court</h4>${players(v.onCourt.away)}</div>
        <div><h4>${esc(v.home.tri)} on court</h4>${players(v.onCourt.home)}</div>
        <div><h4>Out</h4>${players(v.out.away, "out")}${players(v.out.home, "out")}</div>
      </div>
    </article>`).join("") : `<p class="muted">${status.nba === "ok" ? "No games on today's NBA scoreboard." : "Waiting for the game feed…"}</p>`;

    $("#log").innerHTML = log.slice(-30).reverse().map((l) => `<li><span class="num">${l.t}</span> ${esc(l.msg)}</li>`).join("") || '<li class="muted">New VALUE signals will be listed here with the time.</li>';

    document.querySelectorAll("input.ov").forEach((inp) => inp.addEventListener("change", (e) => {
      const val = parseFloat(e.target.value);
      if (isNaN(val)) delete S.overrides[e.target.dataset.k]; else S.overrides[e.target.dataset.k] = val;
      persist(); tick(true);
    }));
  }

  function noteSignals() {
    for (const v of games.values()) for (const s of v.sides || []) {
      const key = v.id + s.side;
      if (s.r && s.r.verdict === "value" && !s.late) {
        // a signal must hold for two refreshes in a row before it's logged, to cut flicker
        streak.set(key, (streak.get(key) || 0) + 1);
        if (!alerted.has(key) && streak.get(key) >= 2) {
          alerted.add(key);
          log.push({ t: new Date().toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }), msg: `VALUE: ${s.team.tri} at ${f2(s.odds)} (${v.away.tri} ${v.away.score}-${v.home.score} ${v.home.tri}, ${clockText(v)}), model ${pct(s.p)}, edge +${pct(s.r.ev, 1)}` });
          beep();
        }
      } else if (streak.delete(key) && alerted.has(key)) {
        alerted.delete(key);
        log.push({ t: new Date().toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }), msg: `Signal gone: ${s.team.tri} (${v.away.tri} @ ${v.home.tri})` });
      }
    }
  }

  let audio = null;
  function beep() {
    if (!S.sound || !audio) return;
    try { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.18); } catch (e) { /* audio blocked */ }
  }

  // ---------- main loop ----------
  let busy = false;
  async function tick(renderOnly) {
    if (renderOnly) { for (const v of games.values()) compute(v); render(); return; }
    if (busy) return; busy = true;
    try {
      if (demo) { Demo.step(games); status.nba = "ok"; status.market = "ok"; route.nba = route.market = "demo"; } else {
        try { await pollNBA(); } catch (e) { status.nba = "blocked"; }
        let anyMarket = false, marketErr = false;
        await Promise.all([...games.values()].map(async (v) => {
          try { await pollMarket(v); if (v.market) anyMarket = true; } catch (e) { marketErr = true; }
        }));
        if (marketErr && !anyMarket) status.market = "blocked";
        else if (!anyMarket && games.size) status.market = "no markets found";
      }
      for (const v of games.values()) compute(v);
      persist();
      status.last = Date.now();
      noteSignals();
      render();
    } finally { busy = false; }
  }

  // ---------- controls ----------
  $("#bankroll").value = S.bankroll;
  $("#minEdge").value = String(S.minEdge);
  $("#sound").checked = S.sound;
  $("#bankroll").addEventListener("change", (e) => { S.bankroll = parseFloat(e.target.value) || 0; persist(); tick(true); });
  $("#minEdge").addEventListener("change", (e) => { S.minEdge = parseFloat(e.target.value); persist(); tick(true); });
  $("#sound").addEventListener("change", (e) => {
    S.sound = e.target.checked; persist();
    if (S.sound && !audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { audio = null; } }
    beep();
  });
  $("#demoLink").href = demo ? location.pathname : "#demo";
  $("#demoLink").textContent = demo ? "Switch to live data" : "Try demo data";
  window.addEventListener("hashchange", () => location.reload());

  tick();
  setInterval(tick, POLL_MS);
})();
