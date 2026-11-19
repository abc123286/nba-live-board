import * as DB from "../supa.js";
import { cached, provider } from "../live.js";
import { esc, on, avatar, teamBadge, toast, store } from "../util.js";
import { getFollows, toggleFollow } from "../notify.js";
import { setTheme } from "../ui.js";

const COLORS = ["#ff6a2b", "#e63946", "#2a9d8f", "#3a86ff", "#8338ec", "#ffbe0b", "#06d6a0", "#ef476f"];
const PREF_LABELS = [
  ["game_start", "Tip-off for teams I follow"],
  ["game_final", "Final scores for teams I follow"],
  ["close_game", "Close games in the last 3 minutes"],
  ["milestones", "Milestones for players I follow (20/30/40 pts, double-doubles…)"],
  ["replies", "Replies to my comments"],
  ["browser_push", "Also show system notifications when the app is in the background"],
];

export async function mount(el) {
  let teams = [];
  let prefs = { ...DB.DEFAULT_PREFS, ...store.get("prefs", {}) };
  cached("teams", 864e5, provider.teams).then((t) => ((teams = t.sort((a, b) => a.name.localeCompare(b.name))), render())).catch(() => {});
  DB.getPrefs().then((p) => ((prefs = p), render())).catch(() => {});

  function render() {
    const P = DB.Auth.profile;
    const fol = getFollows();
    const tById = Object.fromEntries(teams.map((t) => [t.id, t]));
    const theme = document.documentElement.dataset.theme;
    el.innerHTML = `<div class="page narrow">
      <header class="page-head"><h1>Profile</h1></header>
      ${
        P
          ? `<section class="panel me">
          ${avatar(P, "xl")}
          <div><h2>${esc(P.display_name || P.username)}</h2><p class="sub">@${esc(P.username)} · ${esc(DB.Auth.user?.email || "")}</p></div>
          <form class="grid form" data-profile>
            <label class="field"><span>Display name</span><input name="display_name" maxlength="40" value="${esc(P.display_name || "")}"></label>
            <label class="field"><span>Favourite team</span><select name="favourite_team"><option value="">—</option>${teams.map((t) => `<option value="${t.id}" ${P.favourite_team === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
            <div class="field"><span>Avatar colour</span><div class="swatches">${COLORS.map((c) => `<button type="button" class="sw ${P.avatar_color === c ? "on" : ""}" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join("")}</div></div>
            <button class="btn">Save profile</button>
          </form>
        </section>`
          : `<section class="panel"><h2>You're browsing as a guest</h2><p>${DB.enabled ? "Sign in to comment, react, chat, and keep your follows and alert settings in sync across devices." : "Accounts switch on once the community database is connected. Follows and settings are saved on this device meanwhile."}</p>${DB.enabled ? `<div class="row gap"><a class="btn" href="#/login">Sign in</a><a class="btn ghost" href="#/register">Create account</a></div>` : ""}</section>`
      }

      <section class="panel"><h3>Following</h3>
        ${
          fol.length
            ? `<ul class="follows">${fol
                .map((f) => {
                  const t = tById[f.kind === "team" ? f.ref_id : f.team_id];
                  return `<li>${f.kind === "team" ? teamBadge(t) : teamBadge(t, "xs")}<a href="${f.kind === "player" ? "#/player/" + esc(f.ref_id) : "#/games?team=" + esc(f.ref_id)}">${esc(f.ref_name || t?.name || f.ref_id)}</a><small>${f.kind}</small><button class="btn ghost sm" data-unfollow="${esc(f.kind)}:${esc(f.ref_id)}">Unfollow</button></li>`;
                })
                .join("")}</ul>`
            : `<p class="muted">Follow players from their profile, or teams below.</p>`
        }
        <div class="row gap"><select data-addteam aria-label="Follow a team"><option value="">Follow a team…</option>${teams.filter((t) => !fol.some((f) => f.kind === "team" && f.ref_id === t.id)).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></div>
      </section>

      <section class="panel"><h3>Notifications</h3>
        <p class="tiny">Alerts are checked live while NBA Live is open (on this device). Replies are stored on the server and waiting for you when you come back.</p>
        <div class="prefs">${PREF_LABELS.map(([k, l]) => `<label class="toggle row"><input type="checkbox" data-pref="${k}" ${prefs[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
        ${"Notification" in window && Notification.permission !== "granted" ? `<button class="btn ghost sm" data-perm>Allow system notifications</button>` : ""}
      </section>

      <section class="panel"><h3>Appearance</h3>
        <div class="seg"><button data-theme="dark" class="${theme === "dark" ? "on" : ""}">Dark</button><button data-theme="light" class="${theme === "light" ? "on" : ""}">Light</button></div>
      </section>

      ${P ? `<section class="panel"><button class="btn ghost" data-signout>Sign out</button></section>` : ""}
      <p class="source-note">Scores & stats: ESPN public feed (unofficial). NBA Live is an independent fan app, not affiliated with the NBA or its teams.</p>
    </div>`;
  }

  let pickedColor = null;
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.color) {
      pickedColor = b.dataset.color;
      el.querySelectorAll(".sw").forEach((x) => x.classList.toggle("on", x === b));
    }
    if (b.dataset.unfollow) {
      const [kind, ref] = b.dataset.unfollow.split(":");
      const f = getFollows().find((x) => x.kind === kind && x.ref_id === ref);
      if (f) await toggleFollow(f);
      render();
    }
    if (b.dataset.theme) {
      setTheme(b.dataset.theme);
      render();
    }
    if (b.dataset.perm != null) {
      const r = await Notification.requestPermission();
      toast(r === "granted" ? "System notifications allowed" : "Notifications stay in-app only");
      render();
    }
    if (b.dataset.signout != null) {
      await DB.signOut();
      toast("Signed out");
      render();
    }
  });
  el.addEventListener("change", async (e) => {
    if (e.target.dataset.pref) {
      prefs[e.target.dataset.pref] = e.target.checked;
      try {
        prefs = await DB.savePrefs(prefs);
      } catch (err) {
        toast(esc(err.message), "bad");
      }
    }
    if (e.target.matches("[data-addteam]") && e.target.value) {
      const t = teams.find((x) => x.id === e.target.value);
      await toggleFollow({ kind: "team", ref_id: t.id, ref_name: t.name });
      render();
    }
  });
  el.addEventListener("submit", async (e) => {
    if (!e.target.matches("[data-profile]")) return;
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await DB.updateProfile({ ...fd, ...(pickedColor ? { avatar_color: pickedColor } : {}) });
      toast("Profile saved", "good");
    } catch (err) {
      toast(esc(err.message), "bad");
    }
  });
  const offs = [on("auth", render), on("follows", render)];
  render();
  return { title: "Profile", destroy: () => offs.forEach((o) => o()) };
}
