// Live win-probability model. Pure functions, shared by the page and the tests.
(function (root) {
  const SIGMA = 13.5;        // standard deviation of an NBA final margin, in points
  const REG = 2880;          // regulation seconds (4 x 12 min)

  // Standard normal CDF (Abramowitz-Stegun 7.1.26)
  function phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  // Inverse normal CDF (Acklam)
  function phiInv(p) {
    p = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // "PT05M32.00S" -> 332
  function clockSeconds(s) {
    if (!s) return 0;
    const m = /PT(?:(\d+)M)?(?:([\d.]+)S)?/.exec(s);
    if (!m) return 0;
    return (parseInt(m[1] || "0", 10) * 60) + parseFloat(m[2] || "0");
  }

  // Seconds of game time left (regulation counts as 2880; overtime is 300 each).
  function secondsLeft(period, clockSec, status) {
    if (status === 1) return REG;
    if (status === 3) return 0;
    if (period <= 4) return (4 - period) * 720 + clockSec;
    return clockSec;
  }

  // Pre-game home win probability -> expected home margin (points).
  function spreadFromProb(p) { return phiInv(p) * SIGMA; }

  // Home win probability given lead (home minus away), seconds left, pre-game expected margin.
  // OT periods use the same formula with their own remaining time.
  function liveHomeProb(lead, secLeft, preSpread, period) {
    const f = Math.max(secLeft, 0) / REG;
    if (secLeft <= 0) return lead > 0 ? 1 : lead < 0 ? 0 : 0.5;
    const expected = lead + preSpread * (period > 4 ? 0 : f);
    // extra 3-point floor covers late-game fouling and possession swings
    const sd = Math.sqrt(SIGMA * SIGMA * f + 9);
    return Math.min(Math.max(phi(expected / sd), 0.001), 0.999);
  }

  // Back out the pre-game margin from a live market price (used when we join mid-game).
  function impliedPreSpread(marketHomeProb, lead, secLeft) {
    const f = secLeft / REG;
    if (f < 0.1) return null;
    return (phiInv(marketHomeProb) * Math.sqrt(SIGMA * SIGMA * f + 9) - lead) / f;
  }

  // Edge of a bet: probability x decimal odds - 1. Quarter Kelly stake fraction, capped.
  function evaluate(prob, odds, minEdge, cap) {
    if (!odds || odds < 2.0) return null;
    const ev = prob * odds - 1;
    const kelly = Math.max(0, ev / (odds - 1)) / 4;
    const verdict = ev >= minEdge ? "value" : ev >= -0.02 ? "close" : "pass";
    return { ev, stakeFrac: Math.min(kelly, cap), verdict };
  }

  const api = { phi, phiInv, clockSeconds, secondsLeft, spreadFromProb, liveHomeProb, impliedPreSpread, evaluate, SIGMA, REG };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Model = api;
})(typeof window !== "undefined" ? window : globalThis);
