// Player profile: bio, season averages, game log, and live tracking when their team is playing.
import { cached, provider, Live, getBoard, getSummary, watchGame, findGame } from "../live.js";
import { esc, on, playerBadge, teamBadge, shortDate, pct } from "../util.js";
import { empty, stateChip } from "../ui.js";
import { isFollowing, toggleFollow } from "../notify.js";

export async function mount(el, params) {
  const id = params.id;
  let a = null, log = null, err = null;
  let unwatch = null;
  let liveGameId = null;
  let teams = [];

  async function load() {
    try {
      [a, teams] = await Promise.all([cached("ath:" + id, 6 * 3600e3, () => provider.athlete(id)), cached("teams", 864e5, provider.teams)]);
    } catch (e) {
      err = e.message;
    }
    render();
    try {
      log = await cached("log:" + id, 15 * 60e3, () => provider.gamelog(id));
    } catch {
      log = { seasons: [], failed: true };
    }
    render();
  }

  function teamObj() {
    if (!a?.team) return null;
    return teams.find((t) => t.id === a.team.id) || { ...a.team, color: a.team.color || "#555" };
  }

  function todaysGame() {
    const t = a?.team;
    if (!t) return null;
    return (getBoard(Live.today)?.games || []).find((g) => g.home.id === t.id || g.away.id === t.id) || null;
  }

  function syncLive() {
    const g = todaysGame();
    const want = g && g.state !== "pre" ? g.id : null;
    if (want !== liveGameId) {
      unwatch?.();
      unwatch = want ? watchGame(want, "player") : null;
      liveGameId = want;
    }
  }

  function liveCard() {
    const g = todaysGame();
    const t = teamObj();
    if (!g) return `<div class="panel"><h3>Today</h3><p class="muted">${esc(t?.abbr || "Team")} doesn't play today.</p></div>`;
    const opp = g.home.id === t?.id ? g.away : g.home;
    if (g.state === "pre") return `<div class="panel"><h3>Today</h3><p>${g.home.id === t?.id ? "vs" : "@"} ${teamBadge(opp, "xs")} <b>${esc(opp.name)}</b> · tips ${new Date(g.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p><p class="tiny">Live tracking starts automatically at tip-off.</p></div>`;
    const sum = getSummary(g.id);
    const p = sum?.byId.get(id);
    const L = sum ? provider.lineups(sum) : null;
    const onFloor = L && p ? L.on[p.teamId]?.has(id) : false;
    const mine = sum ? sum.plays.filter((x) => x.athletes.includes(id)).slice(-6).reverse() : [];
    const stat = (v, l) => `<div class="bigstat"><b>${v}</b><small>${l}</small></div>`;
    return `<div class="panel live-track ${g.state}">
      <div class="lt-head"><h3>${g.state === "in" ? "Live tracker" : "Today's game"}</h3>${stateChip(g)} <a href="#/game/${g.id}">${esc(g.away.abbr)} ${g.away.score ?? ""} – ${g.home.score ?? ""} ${esc(g.home.abbr)} · ${esc(g.detail)} →</a></div>
      ${
        !sum
          ? `<p class="muted">Loading live box score…</p>`
          : !p
          ? `<p class="muted">Not in the box score for this game.</p>`
          : p.dnp
          ? `<p class="muted">Did not play${p.reason ? ` — ${esc(p.reason)}` : ""}.</p>`
          : `${g.state === "in" ? `<p class="${onFloor ? "on-floor" : "off-floor"}">${onFloor ? "● On the floor now" : "○ On the bench"}</p>` : ""}
        <div class="bigstats">${stat(p.pts, "PTS")}${stat(p.reb, "REB")}${stat(p.ast, "AST")}${stat(p.stl, "STL")}${stat(p.blk, "BLK")}${stat(p.min, "MIN")}</div>
        <p class="tiny">FG ${p.fgm}-${p.fga} (${pct(p.fgm, p.fga, 0)}%) · 3PT ${p.tpm}-${p.tpa} · FT ${p.ftm}-${p.fta} · TO ${p.to} · PF ${p.pf} · +/- ${p.pm > 0 ? "+" : ""}${p.pm}</p>
        ${mine.length ? `<h4 class="subhead">Recent involvement</h4><ol class="plays compact">${mine.map((x) => `<li class="play ${x.scoring ? "scoring" : ""}"><a href="#/game/${g.id}/plays?play=${x.id}"><span class="pl-clock">${x.period <= 4 ? "Q" + x.period : "OT"}<b>${esc(x.clock)}</b></span><span class="pl-text">${esc(x.text)}</span></a></li>`).join("")}</ol>` : ""}`
      }
    </div>`;
  }

  function render() {
    if (err && !a) {
      el.innerHTML = `<div class="page">${empty("Player unavailable", esc(err))}</div>`;
      return;
    }
    if (!a) {
      el.innerHTML = `<div class="page"><div class="sk sk-head"></div><div class="sk sk-block"></div></div>`;
      return;
    }
    syncLive();
    const t = teamObj();
    const following = isFollowing("player", id);
    const season = log?.seasons.find((s) => /regular/i.test(s.name) && s.games.length) || log?.seasons.find((s) => s.games.length);
    const games = season?.games.slice(0, 10) || [];
    const N = (g, k) => parseFloat(g.stats[k]) || 0;
    const maxPts = Math.max(10, ...games.map((g) => N(g, "points")));
    const bio = [
      ["Position", a.pos],
      ["Height", a.height],
      ["Weight", a.weight],
      ["Age", a.age],
      ["Born", a.birthPlace],
      ["College", a.college],
      ["Draft", a.draft],
      ["Experience", a.exp],
      ["Status", a.status],
    ].filter(([, v]) => v != null && v !== "");
    el.innerHTML = `<div class="page player">
      <section class="phero" style="--tc:${esc(t?.color || "#555")}">
        ${playerBadge({ name: a.name, jersey: a.jersey }, t, "xl")}
        <div class="ph-main">
          <p class="eyebrow">${t ? `${teamBadge(t, "xs")} ${esc(t.name)}` : "Free agent"} ${a.jersey ? "· #" + esc(a.jersey) : ""} ${a.posAbbr ? "· " + esc(a.posAbbr) : ""}</p>
          <h1>${esc(a.name)}</h1>
          <button class="btn ${following ? "ghost" : ""}" data-follow>${following ? "★ Following" : "☆ Follow"}</button>
          <small class="tiny">Follow to get milestone alerts (20/30/40 points, double-doubles…) while the app is open.</small>
        </div>
      </section>
      <div class="grid two">
        <div>
          ${liveCard()}
          <div class="panel"><h3>${esc(a.seasonLabel || "Season averages")}</h3>
            ${a.season.length ? `<div class="bigstats">${a.season.map((s) => `<div class="bigstat"><b>${esc(s.value)}</b><small>${esc(s.abbr)}</small>${s.rank ? `<em>${esc(s.rank)}</em>` : ""}</div>`).join("")}</div><p class="tiny">League rank shown under each average where the feed provides it.</p>` : `<p class="muted">No season averages yet.</p>`}
          </div>
        </div>
        <div class="panel"><h3>Bio</h3><dl class="kv">${bio.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
      </div>
      <div class="panel">
        <h3>Last ${games.length || 10} games ${season ? `<span class="hint">${esc(season.name)}</span>` : ""}</h3>
        ${
          log == null
            ? `<p class="muted">Loading game log…</p>`
            : !games.length
            ? `<p class="muted">${log.failed ? "Game log unavailable right now." : "No games played yet this season."}</p>`
            : `<div class="trend">${[...games].reverse().map((g) => `<a href="#/game/${g.eventId}/box" title="${esc(shortDate(g.date))} ${esc(g.atVs)} ${esc(g.opp?.abbr || "")}: ${N(g, "points")} pts"><i style="height:${(N(g, "points") / maxPts) * 100}%"></i><small>${N(g, "points")}</small></a>`).join("")}</div>
          <div class="tablewrap"><table class="box log"><thead><tr><th>Date</th><th>Opp</th><th>Result</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>FG</th><th>3PT</th><th>FT</th></tr></thead><tbody>
          ${games
            .map((g) => {
              const s = g.stats;
              return `<tr><th><a href="#/game/${g.eventId}/box">${esc(shortDate(g.date))}</a></th><td>${esc(g.atVs)} ${esc(g.opp?.abbr || "")}</td><td class="${g.result === "W" ? "good" : g.result === "L" ? "bad" : ""}">${esc(g.result)} ${esc(g.score)}</td><td>${esc(s.minutes)}</td><td><b>${esc(s.points)}</b></td><td>${esc(s.totalRebounds)}</td><td>${esc(s.assists)}</td><td>${esc(s.steals)}</td><td>${esc(s.blocks)}</td><td>${esc(s.turnovers)}</td><td>${esc(s["fieldGoalsMade-fieldGoalsAttempted"])}</td><td>${esc(s["threePointFieldGoalsMade-threePointFieldGoalsAttempted"])}</td><td>${esc(s["freeThrowsMade-freeThrowsAttempted"])}</td></tr>`;
            })
            .join("")}
          </tbody></table></div>`
        }
      </div>
    </div>`;
    document.title = a.name + " · NBA Live";
  }

  el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-follow]") && a) {
      await toggleFollow({ kind: "player", ref_id: id, ref_name: a.name, team_id: a.team?.id || null });
      render();
    }
  });

  let last = 0;
  const offs = [
    on("summary", ({ id: gid }) => gid === liveGameId && render()),
    on("board", () => {
      const g = todaysGame();
      if (g && (g.id !== liveGameId || Date.now() - last > 10000)) {
        last = Date.now();
        render();
      }
    }),
    on("follows", render),
  ];
  load();
  render();
  return {
    title: "Player",
    destroy() {
      offs.forEach((o) => o());
      unwatch?.();
    },
  };
}
