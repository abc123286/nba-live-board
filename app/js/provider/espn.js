// ESPN public feed adapter. Everything the UI uses goes through the normalised shapes below,
// so a licensed provider can replace this file later without touching the views.
//
// Game  { id, date, state:'pre'|'in'|'post', detail, period, clock, completed, home, away, venue, broadcast, pbp }
// Side  { id, abbr, name, short, location, color, alt, score, record, linescores[], leaders[] }
// Play  { id, seq, period, clock, secLeft, type, text, teamId, home, away, scoring, value, shooting,
//         attempted, x, y, athletes[], wallclock, cat }

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";

export const PROVIDER = { id: "espn", name: "ESPN public feed", note: "Unofficial public feed; can lag the broadcast by 10–60 seconds." };

const TRI = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS" };
const abbr = (a) => TRI[a] || a || "?";

async function get(url, timeout = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function team(t = {}) {
  return {
    id: String(t.id ?? ""),
    abbr: abbr(t.abbreviation),
    name: t.displayName || t.name || "",
    short: t.shortDisplayName || t.name || "",
    location: t.location || "",
    color: t.color ? "#" + t.color : "#555",
    alt: t.alternateColor ? "#" + t.alternateColor : "#999",
  };
}

function recordOf(c) {
  const r = c.records || c.record;
  if (!Array.isArray(r) || !r.length) return "";
  const tot = r.find((x) => /overall|total/i.test(x.type || x.name || "")) || r[0];
  return tot.summary || tot.displayValue || "";
}

function side(c = {}) {
  const s = {
    ...team(c.team),
    homeAway: c.homeAway,
    score: n(c.score?.value ?? c.score?.displayValue ?? c.score),
    record: recordOf(c),
    linescores: (c.linescores || []).map((l) => n(l.value ?? l.displayValue) ?? 0),
    leaders: [],
    winner: !!c.winner,
  };
  if (Array.isArray(c.leaders)) {
    s.leaders = c.leaders
      .map((l) => {
        const top = l.leaders?.[0];
        if (!top) return null;
        return {
          cat: l.name,
          label: l.shortDisplayName || l.abbreviation || l.displayName || l.name,
          value: top.displayValue || String(top.value ?? ""),
          athlete: { id: String(top.athlete?.id ?? ""), name: top.athlete?.displayName || top.athlete?.fullName || "", short: top.athlete?.shortName || "", jersey: top.athlete?.jersey || "" },
        };
      })
      .filter(Boolean);
  }
  if (c.fouls) {
    s.teamFouls = n(c.fouls.teamFoulsCurrent);
    s.bonus = c.fouls.bonusState && c.fouls.bonusState !== "NONE" ? c.fouls.bonusState : "";
    s.foulsToGive = n(c.fouls.foulsToGive);
  }
  if (c.timeoutsRemaining != null) s.timeouts = n(c.timeoutsRemaining);
  if (c.possession != null) s.possession = !!c.possession;
  return s;
}

function status(st = {}) {
  const t = st.type || {};
  return {
    state: t.state || "pre",
    detail: t.shortDetail || t.detail || t.description || "",
    long: t.detail || t.description || "",
    period: n(st.period) || 0,
    clock: st.displayClock || "",
    completed: !!t.completed,
    name: t.name || "",
  };
}

function game(e, comp) {
  comp = comp || e.competitions?.[0] || {};
  const cs = comp.competitors || [];
  const home = side(cs.find((c) => c.homeAway === "home") || cs[0]);
  const away = side(cs.find((c) => c.homeAway === "away") || cs[1]);
  return {
    id: String(e.id ?? comp.id),
    date: comp.date || e.date,
    name: e.shortName || `${away.abbr} @ ${home.abbr}`,
    ...status(comp.status || e.status),
    home,
    away,
    venue: comp.venue?.fullName || "",
    city: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(", "),
    broadcast: comp.broadcast || (comp.broadcasts || []).flatMap((b) => b.names || []).join(", ") || "",
    pbp: comp.playByPlayAvailable !== false,
    attendance: n(comp.attendance),
  };
}

export async function scoreboard(day) {
  const j = await get(`${SITE}/scoreboard?dates=${day}`);
  return (j.events || []).map((e) => game(e));
}

// ---- Summary (game centre) -------------------------------------------------------------

const STAT_KEYS = {
  minutes: "min",
  points: "pts",
  "fieldGoalsMade-fieldGoalsAttempted": ["fgm", "fga"],
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ["tpm", "tpa"],
  "freeThrowsMade-freeThrowsAttempted": ["ftm", "fta"],
  rebounds: "reb",
  offensiveRebounds: "oreb",
  defensiveRebounds: "dreb",
  assists: "ast",
  steals: "stl",
  blocks: "blk",
  turnovers: "to",
  fouls: "pf",
  plusMinus: "pm",
};

function statLine(keys, values) {
  const o = {};
  (keys || []).forEach((k, i) => {
    const m = STAT_KEYS[k];
    const v = values?.[i];
    if (!m) return;
    if (Array.isArray(m)) {
      const [a, b] = String(v ?? "").split("-");
      o[m[0]] = n(a) ?? 0;
      o[m[1]] = n(b) ?? 0;
    } else o[m] = n(String(v ?? "").replace("+", "")) ?? 0;
  });
  return o;
}

function playCat(p, typeText) {
  const t = typeText.toLowerCase();
  if (/free throw/.test(t)) return "ft";
  if (p.shootingPlay) return "shot";
  if (/substitution/.test(t)) return "sub";
  if (/timeout/.test(t)) return "timeout";
  if (/rebound/.test(t)) return "reb";
  if (/turnover|traveling|offensive charge|backcourt|double dribble|palming|3-second|shot clock|kicked ball|lane|discontinue|out of bounds/.test(t)) return "to";
  if (/foul|technical|flagrant/.test(t)) return "foul";
  if (/end period|end game|start period|jumpball|jump ball/.test(t)) return "period";
  return "other";
}

function clockSecs(c) {
  const s = String(c || "0");
  if (s.includes(":")) {
    const [m, x] = s.split(":");
    return (+m || 0) * 60 + (+x || 0);
  }
  return +s || 0;
}

export async function summary(id) {
  const s = await get(`${SITE}/summary?event=${id}`);
  const hc = s.header?.competitions?.[0] || {};
  const g = game({ id, shortName: "" }, hc);
  g.shotChartAvailable = !!hc.shotChartAvailable;

  const players = [];
  const byId = new Map();
  for (const tp of s.boxscore?.players || []) {
    const tid = String(tp.team?.id ?? "");
    const block = tp.statistics?.[0] || {};
    for (const a of block.athletes || []) {
      const ath = a.athlete || {};
      const st = statLine(block.keys, a.stats);
      const p = {
        id: String(ath.id),
        name: ath.displayName || "",
        short: ath.shortName || ath.displayName || "",
        jersey: ath.jersey || "",
        pos: ath.position?.abbreviation || "",
        teamId: tid,
        starter: !!a.starter,
        dnp: !!a.didNotPlay || (g.state === "post" && !(a.stats || []).length),
        reason: a.reason || "",
        ejected: !!a.ejected,
        hasStats: !!(a.stats || []).length,
        ...{ min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, pm: 0 },
        ...st,
      };
      p.gs = gameScore(p);
      players.push(p);
      byId.set(p.id, p);
    }
  }

  const teamStats = {};
  for (const t of s.boxscore?.teams || []) {
    const o = {};
    for (const x of t.statistics || []) o[x.name] = { label: x.label || x.abbreviation || x.name, value: x.displayValue };
    teamStats[String(t.team?.id)] = o;
  }

  const plays = (s.plays || []).map((p) => {
    const type = p.type?.text || "";
    const cx = p.coordinate?.x, cy = p.coordinate?.y;
    const hasXY = Number.isFinite(cx) && Number.isFinite(cy) && cx > -100 && cy > -100 && p.shootingPlay && !/free throw/i.test(type);
    return {
      id: String(p.id),
      seq: n(p.sequenceNumber) ?? 0,
      period: p.period?.number || 0,
      clock: p.clock?.displayValue || "",
      secLeft: clockSecs(p.clock?.displayValue),
      type: type.replace(/\s*\n\s*/g, " "),
      text: p.text || "",
      teamId: p.team?.id != null ? String(p.team.id) : "",
      home: n(p.homeScore) ?? 0,
      away: n(p.awayScore) ?? 0,
      scoring: !!p.scoringPlay,
      value: n(p.scoreValue) ?? 0,
      shooting: !!p.shootingPlay,
      attempted: n(p.pointsAttempted) ?? 0,
      x: hasXY ? cx : null,
      y: hasXY ? cy : null,
      athletes: (p.participants || []).map((x) => String(x.athlete?.id ?? "")).filter(Boolean),
      wallclock: p.wallclock || "",
      cat: playCat(p, type),
    };
  });
  plays.sort((a, b) => a.seq - b.seq);

  const winprob = (s.winprobability || []).map((w) => ({ playId: String(w.playId), home: n(w.homeWinPercentage) }));

  const injuries = (s.injuries || []).map((t) => ({
    teamId: String(t.team?.id ?? ""),
    list: (t.injuries || []).map((i) => ({ id: String(i.athlete?.id ?? ""), name: i.athlete?.displayName || "", status: i.status || i.type?.description || "", detail: i.details?.type || i.shortComment || "" })),
  }));

  const info = s.gameInfo || {};
  g.venue = info.venue?.fullName || g.venue;
  g.attendance = n(info.attendance) ?? g.attendance;
  g.officials = (info.officials || []).map((o) => o.displayName || o.fullName).filter(Boolean);

  return { game: g, players, byId, teamStats, plays, winprob, injuries, fetchedAt: Date.now() };
}

export function gameScore(p) {
  return +(p.pts + 0.4 * p.fgm - 0.7 * p.fga - 0.4 * (p.fta - p.ftm) + 0.7 * p.oreb + 0.3 * p.dreb + p.stl + 0.7 * p.ast + 0.7 * p.blk - 0.4 * p.pf - p.to).toFixed(1);
}

// Who is on the floor right now: starters, then apply every substitution in order.
// ESPN text: "X enters the game for Y"; participants[0] = in, [1] = out.
export function lineups(sum) {
  const on = {};
  const subs = [];
  for (const p of sum.players) {
    on[p.teamId] = on[p.teamId] || new Set();
    if (p.starter) on[p.teamId].add(p.id);
  }
  for (const pl of sum.plays) {
    if (pl.cat !== "sub") continue;
    const [inId, outId] = pl.athletes;
    const tid = pl.teamId || sum.byId.get(inId)?.teamId;
    if (!tid || !inId) continue;
    on[tid] = on[tid] || new Set();
    if (outId) on[tid].delete(outId);
    on[tid].delete(inId);
    on[tid].add(inId);
    // Guard against a missed/duplicated feed event: keep the five most recent entrants.
    while (on[tid].size > 5) on[tid].delete(on[tid].values().next().value);
    subs.push({ seq: pl.seq, playId: pl.id, period: pl.period, clock: pl.clock, teamId: tid, inId, outId });
  }
  return { on, subs };
}

// Current scoring run from play-by-play facts: points by the team that scored last,
// back to the opponent's last score.
export function currentRun(sum) {
  const sp = sum.plays.filter((p) => p.scoring && p.value > 0 && p.teamId);
  if (!sp.length) return null;
  const tid = sp[sp.length - 1].teamId;
  let pts = 0, opp = 0, i = sp.length - 1;
  for (; i >= 0 && sp[i].teamId === tid; i--) pts += sp[i].value;
  return { teamId: tid, pts, opp, since: sp[i + 1] };
}

// ---- Teams, rosters, athletes -------------------------------------------------------------

export async function teams() {
  const j = await get(`${SITE}/teams`);
  return (j.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => team(x.team));
}

export async function roster(teamId) {
  const j = await get(`${SITE}/teams/${teamId}/roster`);
  return (j.athletes || []).map((a) => ({
    id: String(a.id),
    name: a.displayName || a.fullName,
    short: a.shortName || "",
    jersey: a.jersey || "",
    pos: a.position?.abbreviation || "",
    height: a.displayHeight || "",
    weight: a.displayWeight || "",
    age: a.age ?? null,
    exp: a.experience?.years ?? null,
    college: a.college?.name || "",
    teamId: String(teamId),
    injury: a.injuries?.[0] ? { status: a.injuries[0].status || "", detail: a.injuries[0].details?.type || a.injuries[0].type?.description || "" } : null,
    status: a.status?.name || "",
  }));
}

export async function athlete(id) {
  const j = await get(`${WEB}/athletes/${id}`);
  const a = j.athlete || {};
  return {
    id: String(a.id),
    name: a.displayName || a.fullName || "",
    first: a.firstName || "",
    last: a.lastName || "",
    jersey: (a.displayJersey || a.jersey || "").replace("#", ""),
    pos: a.position?.displayName || "",
    posAbbr: a.position?.abbreviation || "",
    team: a.team ? { id: String(a.team.id), abbr: abbr(a.team.abbreviation), name: a.team.displayName || "", color: a.team.color ? "#" + a.team.color : null } : null,
    height: a.displayHeight || "",
    weight: a.displayWeight || "",
    age: a.age ?? null,
    dob: a.displayDOB || "",
    birthPlace: a.displayBirthPlace || "",
    college: a.college?.name || "",
    draft: a.displayDraft || "",
    exp: a.displayExperience || "",
    status: a.status?.name || "",
    seasonLabel: a.statsSummary?.displayName || "",
    season: (a.statsSummary?.statistics || []).map((s) => ({ abbr: s.abbreviation || s.shortDisplayName, name: s.displayName, value: s.displayValue, rank: s.rankDisplayValue || "" })),
  };
}

export async function gamelog(id) {
  const j = await get(`${WEB}/athletes/${id}/gamelog`);
  const names = j.names || [];
  const labels = j.labels || [];
  const meta = j.events || {};
  const seasons = (j.seasonTypes || []).map((st) => {
    const games = [];
    for (const c of st.categories || []) {
      if (c.type && c.type !== "event") continue;
      for (const ev of c.events || []) {
        const m = meta[ev.eventId] || {};
        const row = {};
        names.forEach((k, i) => (row[k] = ev.stats?.[i] ?? ""));
        games.push({
          eventId: String(ev.eventId),
          date: m.gameDate || "",
          atVs: m.atVs || "",
          opp: m.opponent ? { id: String(m.opponent.id), abbr: abbr(m.opponent.abbreviation), name: m.opponent.displayName || "" } : null,
          result: m.gameResult || "",
          score: m.score || "",
          stats: row,
        });
      }
    }
    games.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { name: st.displayName || "", games };
  });
  return { names, labels, seasons };
}
