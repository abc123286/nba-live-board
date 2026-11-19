import { Live, getBoard, watchDay, freshness, cached, provider } from "../live.js";
import { esc, on, dayLabel, shiftDay, etDay } from "../util.js";
import { gameCard, empty, skeleton, freshNote } from "../ui.js";

export async function mount(el, params, query) {
  let day = /^\d{8}$/.test(query.date || "") ? query.date : Live.today;
  let teamFilter = query.team || "";
  let unwatch = watchDay(day);
  let teams = [];
  cached("teams", 864e5, provider.teams).then((t) => ((teams = t.sort((a, b) => a.name.localeCompare(b.name))), render())).catch(() => {});
  let lastRender = 0;

  function go(d) {
    day = d;
    unwatch();
    unwatch = watchDay(day);
    history.replaceState(null, "", `#/games?date=${day}${teamFilter ? "&team=" + teamFilter : ""}`);
    render();
  }

  function render() {
    lastRender = Date.now();
    const b = getBoard(day);
    let games = b?.games || [];
    if (teamFilter) games = games.filter((g) => g.home.id === teamFilter || g.away.id === teamFilter);
    const strip = [];
    for (let i = -3; i <= 3; i++) strip.push(shiftDay(day, i));
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    const groups = [
      ["Live", games.filter((g) => g.state === "in")],
      ["Upcoming", games.filter((g) => g.state === "pre")],
      ["Final", games.filter((g) => g.state === "post")],
    ];
    el.innerHTML = `
    <div class="page">
      <header class="page-head">
        <h1>Games</h1>
        <div class="row gap">
          <input type="date" id="pick" value="${iso}" aria-label="Pick a date">
          <select id="team" aria-label="Filter by team"><option value="">All teams</option>${teams.map((t) => `<option value="${t.id}" ${t.id === teamFilter ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        </div>
      </header>
      <div class="daystrip">
        <button class="iconbtn" data-shift="-7" aria-label="Previous week">‹</button>
        ${strip.map((d) => `<button class="day ${d === day ? "on" : ""} ${d === Live.today ? "today" : ""}" data-day="${d}"><small>${esc(dayLabel(d, { weekday: "short" }))}</small><b>${esc(dayLabel(d, { day: "numeric" }))}</b><small>${esc(dayLabel(d, { month: "short" }))}</small></button>`).join("")}
        <button class="iconbtn" data-shift="7" aria-label="Next week">›</button>
        ${day !== Live.today ? `<button class="btn ghost sm" data-day="${Live.today}">Today</button>` : ""}
      </div>
      <p class="sub">${esc(dayLabel(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))} · ${freshNote(freshness("board", day))}</p>
      ${!b?.games && !b?.err ? `<div class="grid cards">${skeleton(6)}</div>` : ""}
      ${b?.err && !b.games ? empty("Schedule unavailable", `The data feed didn't respond (${esc(b.err)}). Retrying automatically.`) : ""}
      ${b?.games && !games.length ? empty(teamFilter ? "No game for this team on this date" : "No games scheduled", "Try another date.") : ""}
      ${groups.filter(([, list]) => list.length).map(([label, list]) => `<section><h2 class="sec">${label === "Live" ? '<i class="dot live"></i>' : ""}${label} <span class="count">${list.length}</span></h2><div class="grid cards">${list.map((g) => gameCard(g)).join("")}</div></section>`).join("")}
    </div>`;
  }

  el.addEventListener("click", (e) => {
    const d = e.target.closest("[data-day]");
    if (d) return go(d.dataset.day);
    const s = e.target.closest("[data-shift]");
    if (s) go(shiftDay(day, +s.dataset.shift));
  });
  el.addEventListener("change", (e) => {
    if (e.target.id === "pick" && e.target.value) go(e.target.value.replace(/-/g, ""));
    if (e.target.id === "team") {
      teamFilter = e.target.value;
      go(day);
    }
  });

  const offs = [
    on("board", (d) => d === day && !el.contains(document.activeElement?.tagName === "SELECT" ? document.activeElement : null) && render()),
    on("tick", () => Date.now() - lastRender > 5000 && !(document.activeElement && el.contains(document.activeElement) && /SELECT|INPUT/.test(document.activeElement.tagName)) && render()),
  ];
  render();
  return {
    title: "Games",
    destroy() {
      unwatch();
      offs.forEach((o) => o());
    },
  };
}
