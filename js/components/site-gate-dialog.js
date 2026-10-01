// The site password prompt, shown from the front page while the server has a SITE_PASSWORD (see
// server/src/gate.js). A right answer sets a year-long cookie, so a device is only asked once; then the
// page reloads into `next` so the whole app boots unlocked. Same focus-trapped modal pattern as
// twofa-setup-dialog.js.
//
//   openSiteGate("#/library");   // where to land after unlocking; defaults to the home menu

import { store } from "../store.js";
import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

/** Is this visitor still outside? (The server says so in /api/health; see store.siteLocked.) */
export const siteIsLocked = () => store.siteLocked && !store.siteUnlocked;

export function openSiteGate(next = "#/") {
  if (document.querySelector(".sitegate")) return;
  const input = el("input", { type: "password", autocomplete: "current-password", "aria-label": t("gate.label"), required: true });
  const err = el("p.note.note--warn", { hidden: true, role: "alert" });
  const submit = el("button.btn", { type: "submit" }, t("gate.submit"));
  const cancel = el("button.btn.btn--ghost", { type: "button", onclick: () => close() }, t("common.cancel"));
  let busy = false;

  const overlay = el("div.modal.confirmdlg.sitegate", { role: "dialog", "aria-modal": "true", "aria-label": t("gate.title") }, [
    el("form.modal__card.confirmdlg__card", { onsubmit: onSubmit }, [
      el("p.confirmdlg__body", {}, t("gate.title")),
      el("p.confirmdlg__note", {}, t("gate.body")),
      el("label.field", {}, [el("span", {}, t("gate.label")), input]),
      err,
      el("div.confirmdlg__actions", {}, [cancel, submit]),
    ]),
  ]);

  function close() {
    if (busy) return;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const password = input.value;
    if (!password || busy) { input.focus(); return; }
    busy = true; submit.disabled = true; cancel.disabled = true; err.hidden = true;
    submit.textContent = t("gate.opening");
    try {
      await store.unlockSite(password);
      // Hash first, then reload: the next boot sees the cookie and goes straight to `next`.
      location.hash = /^#\//.test(next) ? next : "#/";
      location.reload();
    } catch (ex) {
      busy = false; submit.disabled = false; cancel.disabled = false;
      submit.textContent = t("gate.submit");
      err.textContent = ex.message || t("login.somethingWrong");
      err.hidden = false;
      input.select();
      input.focus();
    }
  }

  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  input.focus();
}
