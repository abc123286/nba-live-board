import { Live, getBoard } from "../live.js";
import { esc, on, ago, avatar, teamBadge } from "../util.js";
import { empty } from "../ui.js";
import * as DB from "../supa.js";

export async function mount(el) {
  let recent = null, err = null;
  async function load() {
    if (!DB.enabled) return render();
    try {
      recent = await DB.recentComments(40);
    } catch (e) {
      err = e.message;
      recent = [];
    }
    render();
  }
  function render() {
    const games = getBoard(Live.today)?.games || [];
    const rooms = [...games.filter((g) => g.state === "in"), ...games.filter((g) => g.state === "pre"), ...games.filter((g) => g.state === "post")];
    const gname = (gid) => {
      const g = games.find((x) => x.id === gid);
      return g ? `${g.away.abbr} @ ${g.home.abbr}` : "Game " + gid;
    };
    el.innerHTML = `<div class="page">
      <header class="page-head"><h1>Community</h1><p class="sub">Live chat rooms, game threads and play-by-play reactions.</p></header>
      ${!DB.enabled ? `<div class="panel notice"><h3>Community is almost ready</h3><p>Discussions, reactions, likes and live chat run on the community database, which hasn't been connected yet. Scores, stats and player tracking work already.</p></div>` : ""}
      <section><h2 class="sec">Game rooms today</h2>
        ${rooms.length ? `<div class="rooms">${rooms.map((g) => `<a class="room ${g.state}" href="#/game/${g.id}/discussion">${teamBadge(g.away, "xs")}${teamBadge(g.home, "xs")}<span><b>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</b><small>${g.state === "in" ? "Live · " + esc(g.detail) : g.state === "pre" ? "Opens at tip-off · chat now" : "Final · " + (g.away.score ?? "") + "–" + (g.home.score ?? "")}</small></span>${g.state === "in" ? '<i class="dot live"></i>' : ""}</a>`).join("")}</div>` : `<p class="muted">No games today.</p>`}
      </section>
      <section><h2 class="sec">Latest discussions</h2>
        ${
          !DB.enabled
            ? ""
            : recent == null
            ? `<p class="muted">Loading…</p>`
            : err
            ? `<p class="bad">${esc(err)}</p>`
            : recent.length
            ? `<div class="pulse">${recent.map((c) => `<a class="pulse-item" href="#/game/${esc(c.game_id)}/${c.play_id ? "plays?play=" + esc(c.play_id) : "discussion"}">${avatar(c.profiles, "sm")}<span><b>${esc(c.profiles?.display_name || c.profiles?.username || "fan")}</b> <small>on ${esc(gname(c.game_id))}${c.play_id ? " · a play" : ""} · ${ago(Date.parse(c.created_at))}</small><br>${esc(c.body.slice(0, 200))}</span></a>`).join("")}</div>`
            : empty("No discussions yet", "Open a game and start the first thread.")
        }
      </section>
      <section class="panel"><h3>House rules</h3><ul class="facts"><li>Be respectful — no harassment, hate or spam.</li><li>Use the Report button on anything that breaks the rules; moderators review reports.</li><li>Posting is rate-limited to keep live chats readable.</li><li>NBA Live is not a betting service. Any predictions are just for fun, with no real money.</li></ul></section>
    </div>`;
  }
  const offs = [on("board", (d) => d === Live.today && render()), on("auth", load)];
  render();
  load();
  return { title: "Community", destroy: () => offs.forEach((o) => o()) };
}
