import { Live, getBoard, getSummary, watchGame, unwatchGame, freshness } from "../live.js";
import { esc, on, dayLabel, teamBadge, playerBadge, ago, avatar } from "../util.js";
import { gameCard, empty, skeleton, freshNote } from "../ui.js";
import { getFollows, liveLineFor } from "../notify.js";
import * as DB from "../supa.js";

export async function mount(el) {
  const watched = new Set();
  let recent = null;
  let lastRender = 0;

  function syncWatches(games) {
    // Live games poll; finished games are fetched once (long interval) for top performers.
    for (const g of games) {
      if (g.state !== "pre" && !watched.has(g.id)) {
        watchGame(g.id, "home");
        watched.add(g.id);
      }
    }
  }

  function line(p) {
    const parts = [`${p.pts} PTS`, `${p.reb} REB`, `${p.ast} AST`];
    if (p.stl >= 3) parts.push(`${p.stl} STL`);
    if (p.blk >= 3) parts.push(`${p.blk} BLK`);
    if (p.tpm >= 4) parts.push(`${p.tpm} 3PM`);
    return parts.join(" · ");
  }

  function render() {
    lastRender = Date.now();
    const day = Live.today;
    const b = getBoard(day);
    const games = b?.games || [];
    syncWatches(games);
    const live = games.filter((g) => g.state === "in");
    const pre = games.filter((g) => g.state === "pre");
    const post = games.filter((g) => g.state === "post");

    // Top performers across today's games (from box scores we have).
    const perf = [];
    const teamOf = {};
    for (const g of games) {
      teamOf[g.home.id] = g.home;
      teamOf[g.away.id] = g.away;
      const s = getSummary(g.id);
      if (!s) continue;
      for (const p of s.players) if (p.hasStats && !p.dnp) perf.push({ p, g });
    }
    perf.sort((a, b) => b.p.gs - a.p.gs);
    const sumsHave = games.filter((g) => g.state !== "pre").filter((g) => getSummary(g.id)).length;
    const sumsWant = games.filter((g) => g.state !== "pre").length;

    // Follows
    const fol = getFollows();
    const folPlayers = fol.filter((f) => f.kind === "player");
    const folTeams = new Set(fol.filter((f) => f.kind === "team").map((f) => f.ref_id));
    const folGames = games.filter((g) => folTeams.has(g.home.id) || folTeams.has(g.away.id));

    const f = freshness("board", day);
    el.innerHTML = `
    <div class="page home">
      <section class="hero">
        <div>
          <p class="eyebrow">${esc(dayLabel(day, { weekday: "long", month: "long", day: "numeric" }))} · US Eastern game day</p>
          <h1>${live.length ? `${live.length} game${live.length > 1 ? "s" : ""} live now` : games.length ? `${games.length} game${games.length > 1 ? "s" : ""} today` : "No games today"}</h1>
          <p class="sub">${freshNote(f, "Scores updated")} · <span class="tiny">${esc(Live.provider.name)}</span></p>
        </div>
        <a class="btn" href="#/games">Full schedule</a>
      </section>

      ${!b?.games && !b?.err ? `<div class="grid cards">${skeleton(4)}</div>` : ""}
      ${b?.err && !games.length ? empty("Scores are unavailable right now", `The data feed didn't respond (${esc(b.err)}). We'll keep retrying automatically.`) : ""}

      ${live.length ? `<section><h2 class="sec"><i class="dot live"></i>Live now</h2><div class="grid cards">${live.map((g) => gameCard(g, { big: true })).join("")}</div></section>` : ""}

      ${
        folPlayers.length || folGames.length
          ? `<section><h2 class="sec">Following</h2><div class="follow-strip">
          ${folPlayers
            .map((fp) => {
              const L = liveLineFor(fp.ref_id, fp.team_id);
              const p = L.player;
              const t = L.game ? (L.game.home.id === String(fp.team_id) ? L.game.home : L.game.away) : null;
              const status = !L.game ? "No game today" : L.game.state === "pre" ? `Tip ${new Date(L.game.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : p ? (p.dnp ? "Did not play" : line(p)) : L.game.state === "in" ? "Loading line…" : "—";
              return `<a class="fchip" href="#/player/${esc(fp.ref_id)}">${playerBadge({ name: fp.ref_name }, t)}<span><b>${esc(fp.ref_name)}</b><small>${esc(status)}${L.game?.state === "in" ? ` · ${esc(L.game.detail)}` : ""}</small></span></a>`;
            })
            .join("")}
          ${folGames.map((g) => gameCard(g)).join("")}
        </div></section>`
          : ""
      }

      <section>
        <h2 class="sec">Top performers today <span class="hint" title="Ranked by Game Score, a standard single-game rating built from the box score (points, shooting efficiency, rebounds, assists, steals, blocks, fouls, turnovers).">ⓘ Game Score</span></h2>
        ${
          perf.length
            ? `<div class="perf-list">${perf
                .slice(0, 8)
                .map(({ p, g }, i) => {
                  const t = teamOf[p.teamId];
                  return `<a class="perf" href="#/game/${g.id}/box"><span class="rank">${i + 1}</span>${playerBadge(p, t)}<span class="perf-name"><b>${esc(p.name)}</b><small>${teamBadge(t, "xs")} ${esc(g.away.abbr)} @ ${esc(g.home.abbr)} · ${g.state === "in" ? "Live" : "Final"}</small></span><span class="perf-line">${line(p)}<small>${p.fgm}-${p.fga} FG · GS ${p.gs}</small></span></a>`;
                })
                .join("")}</div>${sumsHave < sumsWant ? `<p class="tiny">Loading ${sumsWant - sumsHave} more box score${sumsWant - sumsHave > 1 ? "s" : ""}…</p>` : ""}`
            : `<p class="muted">${sumsWant ? "Loading box scores…" : "Top performers appear once games tip off."}</p>`
        }
      </section>

      ${pre.length ? `<section><h2 class="sec">Upcoming</h2><div class="grid cards">${pre.map((g) => gameCard(g)).join("")}</div></section>` : ""}
      ${post.length ? `<section><h2 class="sec">Final</h2><div class="grid cards">${post.map((g) => gameCard(g)).join("")}</div></section>` : ""}

      <section>
        <h2 class="sec">Community pulse</h2>
        ${
          !DB.enabled
            ? `<p class="muted">Discussions, reactions and live chat switch on once the community database is connected.</p>`
            : recent == null
            ? `<p class="muted">Loading…</p>`
            : recent.length
            ? `<div class="pulse">${recent
                .slice(0, 6)
                .map((c) => `<a class="pulse-item" href="#/game/${esc(c.game_id)}/${c.play_id ? "plays?play=" + esc(c.play_id) : "discussion"}">${avatar(c.profiles, "sm")}<span><b>${esc(c.profiles?.display_name || c.profiles?.username || "fan")}</b> ${esc(c.body.slice(0, 120))}<small>${ago(Date.parse(c.created_at))}</small></span></a>`)
                .join("")}</div>`
            : `<p class="muted">No discussions yet — open a live game and start one.</p>`
        }
      </section>

      <p class="source-note">Live data: ${esc(Live.provider.name)} — ${esc(Live.provider.note)} Times shown in your local time zone.</p>
    </div>`;
  }

  const offs = [
    on("board", (d) => d === Live.today && render()),
    on("summary", () => render()),
    on("follows", () => render()),
    on("tick", () => {
      if (Date.now() - lastRender > 5000) render();
    }),
  ];
  if (DB.enabled) DB.recentComments(6).then((r) => ((recent = r), render())).catch(() => ((recent = []), render()));
  render();

  return {
    title: "Home",
    destroy() {
      offs.forEach((o) => o());
      for (const id of watched) unwatchGame(id, "home");
    },
  };
}
