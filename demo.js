// Demo data so the board can be checked without live games (open the page with #demo).
// Scores, clock and market prices are simulated; nothing here is real.
window.Demo = (function () {
  const M = window.Model;
  const roster = (names) => names.map((n, i) => ({ name: n, pos: ["G", "G", "F", "F", "C"][i % 5], starter: i < 5, on: i < 5, active: true, pts: 0, pf: 0, min: 0 }));
  let t0 = null;
  const seeds = [
    { id: "demo1", away: ["PHI", "76ers", "7-1", 0.46], home: ["DET", "Pistons", "6-1"], startLag: 6 },
    { id: "demo2", away: ["ATL", "Hawks", "4-4", 0.56], home: ["WAS", "Wizards", "4-3"], startLag: 6 },
    { id: "demo3", away: ["MIN", "Timberwolves", "5-3", 0.27], home: ["HOU", "Rockets", "7-1"], startLag: 90 }
  ];
  function init(games) {
    t0 = Date.now();
    for (const s of seeds) {
      games.set(s.id, {
        id: s.id, status: 1, period: 0, clock: 720, tipUTC: new Date(Date.now() + s.startLag * 1000).toISOString(),
        away: { tri: s.away[0], name: s.away[1], rec: s.away[2], score: 0 }, home: { tri: s.home[0], name: s.home[1], rec: s.home[2], score: 0 },
        onCourt: { away: roster(["A. Guard", "B. Wing", "C. Forward", "D. Big", "E. Center"]), home: roster(["F. Guard", "G. Wing", "H. Forward", "I. Big", "J. Center"]) },
        out: { away: [{ name: "K. Starter", reason: "Injury/Illness - Ankle" }], home: [] },
        fouledOut: { away: [], home: [] },
        pAwayPre: s.away[3], market: { awayPrice: s.away[3], homePrice: 1.03 - s.away[3], homeProb: (1.03 - s.away[3]) / 1.03, at: Date.now() },
        _true: M.spreadFromProb(1 - s.away[3]) + (Math.random() - 0.5) * 6
      });
    }
  }
  // each 4-second tick = 40 seconds of game time
  function step(games) {
    if (!t0) init(games);
    for (const v of games.values()) {
      if (Date.now() < Date.parse(v.tipUTC)) continue;
      if (v.status === 1) { v.status = 2; v.period = 1; v.clock = 720; }
      if (v.status !== 2) continue;
      v.clock -= 40;
      const drift = v._true / 96; // per 30s of game time
      const swing = (Math.random() - 0.5) * 7 + drift;
      if (swing > 0) v.home.score += Math.round(Math.random() * 4 + swing); else v.away.score += Math.round(Math.random() * 4 - swing);
      for (const side of ["home", "away"]) v.onCourt[side].forEach((p) => { if (Math.random() < 0.04) p.pf = Math.min(6, p.pf + 1); });
      if (v.clock <= 0) {
        if (v.period >= 4 && v.home.score !== v.away.score) { v.status = 3; v.clock = 0; }
        else { v.period += 1; v.clock = v.period > 4 ? 300 : 720; }
      }
      // market reacts to the score, with noise and a small lag
      const lead = v.home.score - v.away.score;
      const secLeft = M.secondsLeft(v.period, Math.max(v.clock, 0), v.status);
      const fair = M.liveHomeProb(lead, secLeft, M.spreadFromProb(1 - v.pAwayPre), v.period);
      const noisy = Math.min(0.97, Math.max(0.03, fair + (Math.random() - 0.5) * 0.08));
      v.market = { homePrice: noisy + 0.015, awayPrice: 1 - noisy + 0.015, homeProb: noisy, at: Date.now() };
    }
  }
  return { step };
})();
