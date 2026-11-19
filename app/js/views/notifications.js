import { esc, on, ago } from "../util.js";
import { getInbox, markAllRead, clearInbox } from "../notify.js";
import { empty } from "../ui.js";

const ICON = { milestone: "🏀", game: "⏱", reply: "💬" };

export async function mount(el) {
  function render() {
    const list = getInbox();
    el.innerHTML = `<div class="page narrow">
      <header class="page-head"><h1>Notifications</h1>${list.length ? `<div class="row gap"><button class="btn ghost sm" data-read>Mark all read</button><button class="btn ghost sm" data-clear>Clear</button></div>` : ""}</header>
      ${
        list.length
          ? `<ul class="inbox">${list.map((n) => `<li class="${n.read ? "" : "unread"}"><a href="${esc(n.link || "#/")}"><span class="ib-icon">${ICON[n.kind] || "•"}</span><span><b>${esc(n.title)}</b>${n.body ? `<small>${esc(n.body)}</small>` : ""}</span><time>${ago(n.at)}</time></a></li>`).join("")}</ul>`
          : empty("You're all caught up", 'Follow players and teams to get live alerts. <a href="#/profile">Notification settings</a>')
      }
    </div>`;
  }
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-read]")) markAllRead();
    if (e.target.closest("[data-clear]")) clearInbox();
  });
  const off = on("inbox", render);
  render();
  // Opening the inbox marks everything read after a moment.
  const t = setTimeout(markAllRead, 2500);
  return { title: "Notifications", destroy: () => (off(), clearTimeout(t)) };
}
