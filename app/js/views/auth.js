// Sign in / register / forgot password / set new password.
import * as DB from "../supa.js";
import { esc, toast } from "../util.js";

const COPY = {
  login: ["Welcome back", "Sign in to comment, react, chat and sync your follows."],
  register: ["Create your account", "Free. Pick a username fans will see."],
  forgot: ["Reset your password", "We'll email you a link to choose a new one."],
  reset: ["Choose a new password", "At least 8 characters."],
};

export async function mount(el, params) {
  let mode = params.mode;
  let busy = false;
  let msg = "";

  function render() {
    const [h, sub] = COPY[mode];
    if (!DB.enabled) {
      el.innerHTML = `<div class="page narrow"><div class="panel auth"><h1>${h}</h1><p>Accounts switch on once the community database is connected. Until then you can still follow players and teams on this device — they'll sync when you sign up.</p><a class="btn" href="#/">Back to scores</a></div></div>`;
      return;
    }
    if (DB.Auth.user && mode !== "reset") {
      el.innerHTML = `<div class="page narrow"><div class="panel auth"><h1>You're signed in</h1><p>as <b>${esc(DB.Auth.profile?.username || DB.Auth.user.email)}</b>.</p><a class="btn" href="#/profile">Go to profile</a></div></div>`;
      return;
    }
    const f = (name, label, type = "text", extra = "") => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${extra} required></label>`;
    el.innerHTML = `<div class="page narrow"><form class="panel auth" data-form novalidate>
      <h1>${h}</h1><p class="sub">${sub}</p>
      ${mode === "register" ? f("username", "Username", "text", 'autocomplete="username" pattern="[A-Za-z0-9_]{3,20}" maxlength="20" placeholder="3–20 letters, numbers or _"') : ""}
      ${mode !== "reset" ? f("email", "Email", "email", 'autocomplete="email"') : ""}
      ${mode === "login" || mode === "register" || mode === "reset" ? f("password", mode === "reset" ? "New password" : "Password", "password", `minlength="8" autocomplete="${mode === "login" ? "current-password" : "new-password"}"`) : ""}
      ${msg ? `<p class="form-msg">${msg}</p>` : ""}
      <button class="btn wide" ${busy ? "disabled" : ""}>${busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Save password"}</button>
      <div class="auth-links">
        ${mode === "login" ? `<a href="#/forgot">Forgot password?</a><a href="#/register">New here? Create an account</a>` : ""}
        ${mode === "register" ? `<a href="#/login">Already have an account? Sign in</a>` : ""}
        ${mode === "forgot" ? `<a href="#/login">Back to sign in</a>` : ""}
      </div>
    </form></div>`;
  }

  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    busy = true;
    msg = "";
    render();
    try {
      if (mode === "login") {
        await DB.signIn(fd);
        toast("Signed in", "good");
        location.hash = "#/";
      } else if (mode === "register") {
        const r = await DB.signUp(fd);
        if (r?.session) {
          toast("Account created — welcome!", "good");
          location.hash = "#/profile";
        } else msg = `Check <b>${esc(fd.email)}</b> for a confirmation link to finish signing up.`;
      } else if (mode === "forgot") {
        await DB.sendReset(fd.email);
        msg = "If that email has an account, a reset link is on its way.";
      } else if (mode === "reset") {
        if (!DB.Auth.user) throw new Error("Open the reset link from your email first — it signs you in for this step.");
        await DB.updatePassword(fd.password);
        toast("Password updated", "good");
        location.hash = "#/profile";
      }
    } catch (err) {
      msg = `<span class="bad">${esc(err.message)}</span>`;
    }
    busy = false;
    if (el.isConnected) render();
  });

  render();
  return {
    title: COPY[mode][0],
    navigate(p) {
      mode = p.mode;
      msg = "";
      render();
    },
  };
}
