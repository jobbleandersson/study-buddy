// Sign in / create an account. Optional — StudyBuddy works fully signed out;
// this only turns on syncing the same library across devices.

import { store } from "../store.js";
import { el, toast, icon, ICONS } from "../lib/dom.js";

export function renderLogin() {
  let mode = "login"; // | "signup"

  const emailInput = el("input", { type: "email", autocomplete: "email", placeholder: "you@example.com" });
  const passInput = el("input", { type: "password", placeholder: "••••••••" });
  const errorNote = el("p.note.note--warn", { style: { display: "none" } });
  const submitBtn = el("button.btn", { type: "submit" }, "Sign in");
  const toggleBtn = el("button.btn.btn--ghost.btn--sm", { type: "button" }, "");

  function paintMode() {
    submitBtn.textContent = mode === "login" ? "Sign in" : "Create account";
    toggleBtn.textContent = mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in";
    passInput.autocomplete = mode === "login" ? "current-password" : "new-password";
    passInput.placeholder = mode === "login" ? "••••••••" : "At least 8 characters";
  }

  toggleBtn.addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    errorNote.style.display = "none";
    paintMode();
  });

  async function submit(e) {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) return;

    submitBtn.disabled = true;
    errorNote.style.display = "none";
    try {
      if (mode === "login") await store.login(email, password);
      else await store.signup(email, password);
      toast(mode === "login" ? "Signed in — syncing is on" : "Account created — syncing is on");
      location.hash = "#/settings";
    } catch (err) {
      errorNote.textContent = err.message || "Something went wrong.";
      errorNote.style.display = "";
    } finally {
      submitBtn.disabled = false;
    }
  }
  paintMode();

  const form = el("form", { onsubmit: submit }, [
    el("label.field", {}, [el("span", {}, "Email"), emailInput]),
    el("label.field", {}, [el("span", {}, "Password"), passInput]),
    errorNote,
    el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } }, [submitBtn, toggleBtn]),
  ]);

  const node = el("div.settings", {}, [
    el("h1", {}, "Account"),
    el("section.panel", {}, [
      el("p.note", { style: { margin: "0 0 16px" } },
        "Sign in to sync your library and progress across devices. Fully optional — StudyBuddy keeps working locally if you skip this."),
      form,
    ]),
    !store.proxyUp && el("p.note", {}, "The backend server isn't reachable right now — signing in won't work until it is."),
    el("a.btn.btn--ghost", { href: "#/settings" }, [icon(ICONS.back, 16), "Back to settings"]),
  ]);

  return { title: "Sign in", node };
}
