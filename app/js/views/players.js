// Player directory: every active roster, searchable, filterable by team and position.
import { cached, provider, Live, getBoard } from "../live.js";
import { esc, on, playerBadge, teamBadge, debounce } from "../util.js";
import { empty, skeleton } from "../ui.js";
import { isFollowing } from "../notify.js";

const POS = [["", "All"], ["G", "Guards"], ["F", "Forwards"], ["C", "Centers"]];

export async function mount(el, params, query) {
  let teams = [];
  let players = null;
  let loaded = 0;
  let err = null;
  const st = { q: query.q || "", team: query.team || "", pos: "", following: false, limit: 60 };

  el.innerHTML = `<div class="page">
    <header class="page-head"><h1>Players</h1><p class="sub" data-count></p></header>
    <div class="filters sticky">
      <input type="search" placeholder="Search players" value="${esc(st.q)}" data-q aria-label="Search players">
      <select data-team aria-label="Team"><option value="">All teams</option></select>
      <div class="seg">${POS.map(([v, l]) => `<button data-pos="${v}" class="${st.pos === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <label class="toggle"><input type="checkbox" data-fol> Following</label>
    </div>
    <div data-list><div class="grid players">${skeleton(12, "sk-player")}</div></div>
  </div>`;
  const $list = el.querySelector("[data-list]");

  async function load() {
    try {
      teams = await cached("teams", 864e5, provider.teams);
      teams.sort((a, b) => a.name.localeCompare(b.name));
      const sel = el.querySelector("[data-team]");
      sel.innerHTML = `<option value="">All teams</option>` + teams.map((t) => `<option value="${t.id}" ${t.id === st.team ? "selected" : ""}>${esc(t.name)}</option>`).join("");
      players = [];
      // fetch rosters a few at a time
      const queue = [...teams];
      const worker = async () => {
        while (queue.length) {
          const t = queue.shift();
          try {
            const r = await cached("roster:" + t.id, 12 * 3600e3, () => provider.roster(t.id));
            players.push(...r);
          } catch {}
          loaded++;
          render();
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    } catch (e) {
      err = e.message;
    }
    render();
  }

  function render() {
    const tById = Object.fromEntries(teams.map((t) => [t.id, t]));
    el.querySelector("[data-count]").textContent = players ? `${players.length} players${loaded < teams.length ? ` · loading rosters ${loaded}/${teams.length}` : ""}` : "";
    if (err && !players?.length) {
      $list.innerHTML = empty("Couldn't load players", esc(err));
      return;
    }
    if (!players) return;
    const liveTeams = new Set();
    for (const g of getBoard(Live.today)?.games || []) if (g.state === "in") (liveTeams.add(g.home.id), liveTeams.add(g.away.id));
    const q = st.q.trim().toLowerCase();
    let list = players.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!st.team || p.teamId === st.team) && (!st.pos || p.pos.includes(st.pos)) && (!st.following || isFollowing("player", p.id)));
    list.sort((a, b) => (liveTeams.has(b.teamId) - liveTeams.has(a.teamId)) || a.name.localeCompare(b.name));
    const shown = list.slice(0, st.limit);
    $list.innerHTML = list.length
      ? `<div class="grid players">${shown
          .map((p) => {
            const t = tById[p.teamId];
            return `<a class="pcard" href="#/player/${p.id}" style="--tc:${esc(t?.color || "#555")}">
            ${playerBadge(p, t, "lg")}
            <span class="pc-name"><b>${esc(p.name)}</b><small>${teamBadge(t, "xs")} ${esc(t?.abbr || "")} · ${esc(p.pos)}${p.jersey ? " · #" + esc(p.jersey) : ""}</small></span>
            <span class="pc-tags">${liveTeams.has(p.teamId) ? `<span class="chip live"><i class="dot"></i>Live</span>` : ""}${p.injury ? `<span class="chip ${/out/i.test(p.injury.status) ? "bad" : "warn"}" title="${esc(p.injury.detail)}">${esc(p.injury.status)}</span>` : ""}${isFollowing("player", p.id) ? `<span class="chip">★</span>` : ""}</span>
          </a>`;
          })
          .join("")}</div>${list.length > shown.length ? `<button class="btn ghost wide" data-more>Show more (${list.length - shown.length})</button>` : ""}`
      : players.length
      ? empty("No players match", "Try a different name, team or position.")
      : `<div class="grid players">${skeleton(12, "sk-player")}</div>`;
  }

  const rerender = debounce(render, 120);
  el.addEventListener("input", (e) => {
    if (e.target.matches("[data-q]")) {
      st.q = e.target.value;
      st.limit = 60;
      rerender();
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.matches("[data-team]")) st.team = e.target.value;
    if (e.target.matches("[data-fol]")) st.following = e.target.checked;
    st.limit = 60;
    render();
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.pos != null) {
      st.pos = b.dataset.pos;
      el.querySelectorAll("[data-pos]").forEach((x) => x.classList.toggle("on", x === b));
      render();
    }
    if (b.dataset.more != null) {
      st.limit += 60;
      render();
    }
  });
  const offs = [on("follows", render)];
  load();
  return { title: "Players", destroy: () => offs.forEach((o) => o()) };
}
