// Interactive half-court shot chart. Only plots shots that came with coordinates from the feed.
// Feed coordinates are feet: x 0–50 across the baseline, y measured from (approximately) the rim
// line; the rim sits at about (25, 0.75). We draw a 50×47 ft half court, baseline 5.25 ft behind the rim.
import { esc, pct, teamBadge } from "../util.js";

const RIM = { x: 25, y: 0.75 };
const S = 10; // px per foot
const toSvg = (x, y) => [x * S, (y - RIM.y + 5.25) * S];

export function zoneOf(p) {
  const d = Math.hypot(p.x - RIM.x, p.y - RIM.y);
  const fromBaseline = p.y - RIM.y + 5.25;
  if (p.attempted === 3) return fromBaseline <= 14 ? "c3" : "ab3";
  if (d <= 4) return "ra";
  if (p.x >= 17 && p.x <= 33 && fromBaseline <= 19) return "paint";
  return "mid";
}
export const ZONES = [
  ["ra", "Restricted area"],
  ["paint", "Paint (non-RA)"],
  ["mid", "Mid-range"],
  ["c3", "Corner 3"],
  ["ab3", "Above-the-break 3"],
];

export function courtSvg(inner = "", { cls = "" } = {}) {
  const [rx, ry] = toSvg(RIM.x, RIM.y);
  const arcR = 23.75 * S;
  // three-point line: straight corners 3 ft from sidelines up to 14 ft, then arc
  const cornerY = 14 * S;
  const dx = 22 * S;
  const arcStartY = ry + Math.sqrt(arcR * arcR - dx * dx);
  return `<svg class="court ${cls}" viewBox="0 0 500 470" role="img" aria-label="Half court shot chart">
    <rect x="0" y="0" width="500" height="470" class="c-floor"/>
    <g class="c-lines">
      <rect x="170" y="0" width="160" height="190"/>
      <circle cx="250" cy="190" r="60"/>
      <path d="M ${rx - 40} ${ry} A 40 40 0 0 0 ${rx + 40} ${ry}"/>
      <line x1="220" y1="40" x2="280" y2="40"/>
      <circle cx="${rx}" cy="${ry}" r="7.5" class="c-rim"/>
      <path d="M 30 0 L 30 ${cornerY} L 30 ${arcStartY.toFixed(1)} A ${arcR} ${arcR} 0 0 0 470 ${arcStartY.toFixed(1)} L 470 0"/>
      <path d="M 190 470 A 60 60 0 0 1 310 470"/>
      <rect x="0" y="0" width="500" height="470"/>
    </g>
    ${inner}
  </svg>`;
}

export function shotDots(shots, teamColor, selectedId) {
  return shots
    .map((p) => {
      const [x, y] = toSvg(p.x, p.y);
      const c = esc(teamColor(p.teamId));
      const sel = p.id === selectedId ? " sel" : "";
      return p.scoring
        ? `<circle class="shot made${sel}" data-play="${p.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" style="fill:${c}"><title>${esc(p.text)}</title></circle>`
        : `<g class="shot miss${sel}" data-play="${p.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" style="stroke:${c}"><circle r="8" class="hit"/><path d="M-5 -5 L5 5 M5 -5 L-5 5"/><title>${esc(p.text)}</title></g>`;
    })
    .join("");
}

export function renderShotTab(ctx, st) {
  const { sum, teamById } = ctx;
  const all = sum.plays.filter((p) => p.shooting && p.cat === "shot");
  const located = all.filter((p) => p.x != null);
  if (!all.length) return `<div class="panel"><p class="muted">No shot attempts yet.</p></div>`;
  if (!located.length) return `<div class="panel"><p class="muted">Shot locations aren't available from the data feed for this game, so no chart is shown.</p></div>`;

  const shooter = (p) => p.athletes[0];
  let shots = located;
  if (st.team) shots = shots.filter((p) => p.teamId === st.team);
  if (st.player) shots = shots.filter((p) => shooter(p) === st.player);
  if (st.period) shots = shots.filter((p) => String(p.period) === st.period);
  if (st.result === "made") shots = shots.filter((p) => p.scoring);
  if (st.result === "miss") shots = shots.filter((p) => !p.scoring);

  const zone = {};
  for (const [z] of ZONES) zone[z] = { m: 0, a: 0 };
  const zoneBase = located.filter((p) => (!st.team || p.teamId === st.team) && (!st.player || shooter(p) === st.player) && (!st.period || String(p.period) === st.period));
  for (const p of zoneBase) {
    const z = zone[zoneOf(p)];
    z.a++;
    if (p.scoring) z.m++;
  }
  const made = shots.filter((p) => p.scoring).length;
  const g = sum.game;
  const shooters = [...new Set(located.filter((p) => !st.team || p.teamId === st.team).map(shooter))]
    .map((id) => sum.byId.get(id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  const periods = [...new Set(located.map((p) => p.period))].sort();
  const color = (tid) => teamById[tid]?.color || "#888";
  const missingN = all.length - located.length;

  return `<div class="shot-layout">
    <div class="panel">
      <div class="filters">
        <div class="seg">${["", g.away.id, g.home.id].map((t) => `<button data-shot-team="${t}" class="${(st.team || "") === t ? "on" : ""}">${t ? esc(teamById[t].abbr) : "Both"}</button>`).join("")}</div>
        <select data-shot="player" aria-label="Player"><option value="">All players</option>${shooters.map((p) => `<option value="${p.id}" ${st.player === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <select data-shot="period" aria-label="Quarter"><option value="">All quarters</option>${periods.map((q) => `<option value="${q}" ${st.period === String(q) ? "selected" : ""}>${q <= 4 ? "Q" + q : "OT" + (q - 4)}</option>`).join("")}</select>
        <div class="seg">${[["", "All"], ["made", "Made"], ["miss", "Missed"]].map(([v, l]) => `<button data-shot-result="${v}" class="${(st.result || "") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="court-wrap" data-court>${courtSvg(shotDots(shots, color, st.sel))}</div>
      <p class="legend"><span class="lg made"></span> Made <span class="lg miss">×</span> Missed · ${made}/${shots.length} shown (${pct(made, shots.length)}%) ${missingN ? `· ${missingN} attempt${missingN > 1 ? "s" : ""} had no location` : ""}</p>
    </div>
    <div class="panel">
      <h3>By zone</h3>
      <table class="zones"><thead><tr><th>Zone</th><th>FGM-A</th><th>FG%</th><th></th></tr></thead><tbody>
      ${ZONES.map(([z, label]) => {
        const v = zone[z];
        const p = v.a ? (100 * v.m) / v.a : 0;
        return `<tr><td>${label}</td><td>${v.m}-${v.a}</td><td>${v.a ? p.toFixed(0) + "%" : "–"}</td><td class="barcell"><i style="width:${p}%"></i></td></tr>`;
      }).join("")}
      </tbody></table>
      <p class="tiny">Zones are computed from the feed's shot coordinates; three-pointers use the feed's own 2/3-point value.</p>
      ${st.team ? "" : `<div class="row gap">${[g.away, g.home].map((t) => {
        const ts = located.filter((p) => p.teamId === t.id);
        const m = ts.filter((p) => p.scoring).length;
        return `<div class="mini-stat">${teamBadge(t, "xs")} <b>${m}/${ts.length}</b> <small>${pct(m, ts.length)}%</small></div>`;
      }).join("")}</div>`}
    </div>
  </div>`;
}
