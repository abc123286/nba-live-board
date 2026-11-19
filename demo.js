/* Demo games (open the page with ?demo=1). Everything here is simulated: the teams are real NBA teams but the
   players, scores and plays are made up. The demo answers in the same shape as ESPN's feed, so the page runs
   exactly the same code as with live data. One game is live (8x speed), one starts in a minute, one is final. */
window.Demo = (function () {
  const SPEED = 8; // game seconds per real second
  const T0 = Date.now();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const TEAMS = {
    LAL: { id: "13", abbreviation: "LAL", shortDisplayName: "Lakers", displayName: "Los Angeles Lakers", color: "552583", alternateColor: "fdb927", rec: "9-4" },
    BOS: { id: "2", abbreviation: "BOS", shortDisplayName: "Celtics", displayName: "Boston Celtics", color: "007a33", alternateColor: "ba9653", rec: "8-5" },
    DEN: { id: "7", abbreviation: "DEN", shortDisplayName: "Nuggets", displayName: "Denver Nuggets", color: "0e2240", alternateColor: "fec524", rec: "7-6" },
    MIA: { id: "14", abbreviation: "MIA", shortDisplayName: "Heat", displayName: "Miami Heat", color: "98002e", alternateColor: "f9a01b", rec: "6-7" },
    GS: { id: "9", abbreviation: "GS", shortDisplayName: "Warriors", displayName: "Golden State Warriors", color: "1d428a", alternateColor: "ffc72c", rec: "8-6" },
    PHX: { id: "21", abbreviation: "PHX", shortDisplayName: "Suns", displayName: "Phoenix Suns", color: "1d1160", alternateColor: "e56020", rec: "5-8" }
  };
  const FIRST = ["Marcus", "Dante", "Theo", "Jalen", "Andre", "Kofi", "Luis", "Malik", "Owen", "Ravi", "Tyrese", "Nico", "Cole", "Isaiah", "Darius", "Femi", "Jonah", "Quinn", "Elijah", "Bram", "Caleb", "Rafael", "Victor", "Sami"];
  const LAST = ["Holloway", "Okafor", "Brennan", "Vasquez", "Lindqvist", "Ashby", "Mensah", "Carver", "Doyle", "Petrovic", "Ruiz", "Thornton", "Kamara", "Whitfield", "Sato", "Delgado", "Fontaine", "Achebe", "Grimes", "Novak", "Pruitt", "Haddad", "Sinclair", "Varga"];
  const POS = ["G", "G", "F", "F", "C", "G", "F", "C", "G", "F", "F", "G"];
  let pid = 1000;
  const usedLast = new Set();
  const lastName = () => { let l; do { l = pick(LAST); } while (usedLast.has(l) && usedLast.size < LAST.length); usedLast.add(l); return l; };
  const roster = () => { if (usedLast.size > LAST.length - 12) usedLast.clear(); return POS.map((pos, i) => { const f = pick(FIRST), l = lastName(); return { id: String(pid++), displayName: `${f} ${l}`, shortName: `${f[0]}. ${l}`, jersey: String(Math.floor(rnd() * 40) + (i < 5 ? 0 : 3)), position: { abbreviation: pos }, skill: i < 5 ? 1.25 - i * 0.04 : 0.8 - (i - 5) * 0.05 }; }); };

  const etToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
  const GAMES = [
    { id: "9001", away: "LAL", home: "BOS", startGameSec: 900 },   // live, already in the 2nd quarter
    { id: "9002", away: "DEN", home: "MIA", startGameSec: -60 * SPEED }, // tips off in about a minute
    { id: "9003", away: "GS", home: "PHX", startGameSec: 99999 }     // final
  ].map((g) => Object.assign(g, { r: { away: roster(), home: roster() } }));
  GAMES.forEach(simulate);

  function simulate(g) {
    const plays = []; const court = { home: g.r.home.slice(0, 5), away: g.r.away.slice(0, 5) };
    const segs = new Map(); // player id -> [[from,to]]
    const startSeg = (p, t) => { if (!segs.has(p.id)) segs.set(p.id, []); segs.get(p.id).push([t, null]); };
    const endSeg = (p, t) => { const s = segs.get(p.id); if (s && s.length) s[s.length - 1][1] = t; };
    court.home.concat(court.away).forEach((p) => startSeg(p, 0));
    const dnp = { home: new Set([g.r.home[10].id, g.r.home[11].id]), away: new Set([g.r.away[10].id, g.r.away[11].id]) };
    let score = { home: 0, away: 0 }; let t = 0; let off = "away"; let seq = 1; const nextSub = { home: 140, away: 160 };
    const clockOf = (tt) => { const l = Math.max(0, Math.round(720 - (tt % 720))); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, "0")}`; };
    const add = (type, text, side, parts, d, pts) => {
      const p = { id: g.id + "-" + seq, sequenceNumber: String(seq++), _t: t, type: { text: type }, text, period: { number: Math.min(4, Math.floor(t / 720) + 1) }, clock: { displayValue: clockOf(t) }, team: side ? { id: TEAMS[g[side]].id } : undefined, scoringPlay: !!pts, participants: parts.map((x) => ({ athlete: { id: x.id } })), _d: d || [] };
      if (pts) {
        score[side] += pts;
        const other = side === "home" ? "away" : "home";
        court[side].forEach((x) => p._d.push([x.id, "pm", pts])); court[other].forEach((x) => p._d.push([x.id, "pm", -pts]));
      }
      p.homeScore = score.home; p.awayScore = score.away; plays.push(p); return p;
    };
    const weighted = (list) => { const tot = list.reduce((a, x) => a + x.skill, 0); let r = rnd() * tot; for (const x of list) { r -= x.skill; if (r <= 0) return x; } return list[0]; };
    const sub = (side, n) => {
      for (let k = 0; k < n; k++) {
        const bench = g.r[side].filter((x) => !court[side].includes(x) && !dnp[side].has(x.id));
        if (!bench.length) return;
        const outP = court[side].slice().sort((a, b) => (b.tired || 0) - (a.tired || 0) || rnd() - 0.5)[0];
        const same = bench.filter((x) => x.position.abbreviation === outP.position.abbreviation);
        const inP = (same.length ? same : bench).sort((a, b) => b.skill - a.skill + (rnd() - 0.5) * 0.3)[0];
        court[side] = court[side].map((x) => (x === outP ? inP : x)); outP.tired = 0; inP.tired = 0;
        endSeg(outP, t); startSeg(inP, t);
        add("Substitution", `${inP.displayName} enters the game for ${outP.displayName}`, side, [inP, outP]);
      }
    };
    while (t < 2880) {
      const q = Math.floor(t / 720);
      t += 11 + rnd() * 9;
      if (Math.floor(t / 720) > q && t < 2880) { t = (q + 1) * 720; sub("home", 1 + Math.floor(rnd() * 2)); sub("away", 1 + Math.floor(rnd() * 2)); t += 8; }
      if (t >= 2880) break;
      for (const s of ["home", "away"]) { court[s].forEach((x) => (x.tired = (x.tired || 0) + 1)); if (t > nextSub[s]) { sub(s, rnd() < 0.5 ? 1 : 2); nextSub[s] = t + 110 + rnd() * 150; } }
      const def = off === "home" ? "away" : "home";
      const sh = weighted(court[off]);
      const r = rnd();
      if (r < 0.12) { const st = rnd() < 0.5 ? weighted(court[def]) : null; add("Turnover", `${sh.displayName} bad pass${st ? ` (${st.displayName} steals)` : ""}`, off, st ? [sh, st] : [sh], [[sh.id, "to", 1]].concat(st ? [[st.id, "stl", 1]] : [])); }
      else if (r < 0.24) {
        const fo = weighted(court[def]); const d1 = rnd() < 0.78, d2 = rnd() < 0.78;
        add("Personal Foul", `${fo.displayName} shooting foul`, def, [fo], [[fo.id, "pf", 1]]);
        add("Free Throw", `${sh.displayName} ${d1 ? "makes" : "misses"} free throw 1 of 2`, off, [sh], [[sh.id, "fta", 1]].concat(d1 ? [[sh.id, "ftm", 1], [sh.id, "pts", 1]] : []), d1 ? 1 : 0);
        add("Free Throw", `${sh.displayName} ${d2 ? "makes" : "misses"} free throw 2 of 2`, off, [sh], [[sh.id, "fta", 1]].concat(d2 ? [[sh.id, "ftm", 1], [sh.id, "pts", 1]] : []), d2 ? 1 : 0);
      } else {
        const three = rnd() < 0.38 && sh.position.abbreviation !== "C";
        const make = rnd() < (three ? 0.36 : 0.53) * Math.min(1.15, sh.skill);
        const ft = three ? 22 + Math.floor(rnd() * 6) : Math.floor(rnd() * 18) + 1;
        if (make) {
          const asst = rnd() < 0.62 ? weighted(court[off].filter((x) => x !== sh)) : null;
          const d = [[sh.id, "fga", 1], [sh.id, "fgm", 1], [sh.id, "pts", three ? 3 : 2]].concat(three ? [[sh.id, "tpa", 1], [sh.id, "tpm", 1]] : []).concat(asst ? [[asst.id, "ast", 1]] : []);
          add(three ? "Jump Shot" : rnd() < 0.5 ? "Layup Shot" : "Jump Shot", `${sh.displayName} makes ${ft}-foot ${three ? "three point jumper" : ft < 4 ? "layup" : "jumper"}${asst ? ` (${asst.displayName} assists)` : ""}`, off, asst ? [sh, asst] : [sh], d, three ? 3 : 2);
        } else {
          const blk = !three && rnd() < 0.08 ? weighted(court[def]) : null;
          add(three ? "Jump Shot" : "Jump Shot", `${sh.displayName} misses ${ft}-foot ${three ? "three point jumper" : "jumper"}${blk ? ` (${blk.displayName} blocks)` : ""}`, off, blk ? [sh, blk] : [sh], [[sh.id, "fga", 1]].concat(three ? [[sh.id, "tpa", 1]] : []).concat(blk ? [[blk.id, "blk", 1]] : []));
          const rebSide = rnd() < 0.73 ? def : off; const rb = weighted(court[rebSide].map((x) => Object.assign(Object.create(x), { skill: x.position.abbreviation === "C" ? 2 : x.position.abbreviation === "F" ? 1.3 : 0.7 })));
          const real = g.r[rebSide].find((x) => x.id === rb.id);
          add("Rebound", `${real.displayName} ${rebSide === def ? "defensive" : "offensive"} rebound`, rebSide, [real], [[real.id, "reb", 1], [real.id, rebSide === def ? "dreb" : "oreb", 1]]);
          if (rebSide === off) continue;
        }
      }
      off = def;
    }
    if (score.home === score.away) { t = 2879; const sh = court.home[0]; add("Free Throw", `${sh.displayName} makes free throw 1 of 1`, "home", [sh], [[sh.id, "fta", 1], [sh.id, "ftm", 1], [sh.id, "pts", 1]], 1); }
    court.home.concat(court.away).forEach((p) => endSeg(p, 2880));
    g.plays = plays; g.segs = segs; g.dnp = dnp;
  }

  const gameSec = (g) => g.startGameSec >= 99999 ? 2880 : Math.min(2880, g.startGameSec + ((Date.now() - T0) / 1000) * SPEED);
  function snapshot(g) {
    const T = gameSec(g);
    const state = T < 0 ? "pre" : T >= 2880 ? "post" : "in";
    const shown = state === "pre" ? [] : g.plays.filter((p) => p._t <= T);
    const last = shown[shown.length - 1];
    const score = { home: last ? last.homeScore : 0, away: last ? last.awayScore : 0 };
    const period = state === "pre" ? 0 : Math.min(4, Math.floor(Math.min(T, 2879) / 720) + 1);
    const left = state === "post" ? 0 : state === "pre" ? 720 : 720 - (T - (period - 1) * 720);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
    const lines = { home: [], away: [] };
    for (let q = 1; q <= period; q++) { const upto = shown.filter((p) => p._t <= q * 720 && p.period.number <= q); const before = shown.filter((p) => p.period.number < q); const end = upto[upto.length - 1], st = before[before.length - 1]; for (const s of ["home", "away"]) lines[s].push((end ? end[s + "Score"] : 0) - (st ? st[s + "Score"] : 0)); }
    const date = new Date(T0 - (g.startGameSec / SPEED) * 1000).toISOString();
    const short = state === "pre" ? "Scheduled" : state === "post" ? "Final" : (T - (period - 1) * 720 >= 720 ? `End of ${period}${["st", "nd", "rd", "th"][period - 1]}` : `${clock} - ${period}${["st", "nd", "rd", "th"][period - 1]}`);
    return { T, state, shown, score, period, clock, lines, date, short };
  }
  function comp(g, snap) {
    return {
      date: snap.date,
      status: { period: snap.period, displayClock: snap.clock, type: { state: snap.state, shortDetail: snap.short, completed: snap.state === "post" } },
      competitors: ["home", "away"].map((s) => ({ homeAway: s, score: String(snap.score[s]), team: TEAMS[g[s]], records: [{ summary: TEAMS[g[s]].rec }], linescores: snap.lines[s].map((v) => ({ value: v })) }))
    };
  }
  function scoreboard() { return { events: GAMES.map((g) => { const snap = snapshot(g); return { id: g.id, date: snap.date, competitions: [comp(g, snap)] }; }) }; }
  function summary(id) {
    const g = GAMES.find((x) => x.id === id); if (!g) return {};
    const snap = snapshot(g);
    const players = ["away", "home"].map((s) => {
      const tot = {};
      for (const p of snap.shown) for (const [pid2, k, v] of p._d) { tot[pid2] = tot[pid2] || {}; tot[pid2][k] = (tot[pid2][k] || 0) + v; }
      return {
        team: TEAMS[g[s]],
        statistics: [{
          labels: ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"],
          athletes: g.r[s].map((a, i) => {
            const x = tot[a.id] || {};
            const min = Math.round(((g.segs.get(a.id) || []).reduce((acc, [f, to]) => acc + Math.max(0, Math.min(to == null ? snap.T : to, snap.T) - f), 0)) / 60);
            const dnp = g.dnp[s].has(a.id) && snap.state !== "pre";
            const stats = snap.state === "pre" || dnp ? [] : [String(min), `${x.fgm || 0}-${x.fga || 0}`, `${x.tpm || 0}-${x.tpa || 0}`, `${x.ftm || 0}-${x.fta || 0}`, String(x.oreb || 0), String(x.dreb || 0), String(x.reb || 0), String(x.ast || 0), String(x.stl || 0), String(x.blk || 0), String(x.to || 0), String(x.pf || 0), String(x.pm > 0 ? "+" + x.pm : x.pm || 0), String(x.pts || 0)];
            return { athlete: { id: a.id, displayName: a.displayName, shortName: a.shortName, jersey: a.jersey, position: a.position }, starter: i < 5, didNotPlay: dnp, reason: dnp ? "COACH'S DECISION" : "", stats };
          })
        }]
      };
    });
    return { header: { id: g.id, competitions: [comp(g, snap)] }, boxscore: { players }, plays: snap.shown.map(({ _t, _d, ...rest }) => rest) };
  }
  return {
    get(path) {
      return new Promise((res) => setTimeout(() => {
        if (/scoreboard/.test(path)) { const m = /dates=(\d{8})/.exec(path); res(m && m[1] !== etToday ? { events: [] } : scoreboard()); }
        else { const m = /event=(\w+)/.exec(path); res(summary(m ? m[1] : "")); }
      }, 120));
    }
  };
})();
