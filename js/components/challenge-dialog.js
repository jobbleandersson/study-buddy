// "Challenge a friend" dialog, opened from a result: asks for a name to show
// the friend, builds the link, and offers Copy (everywhere) and Share (where
// the browser has a share sheet).

import { el, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { buildChallengeUrl, cleanName, getSavedName, saveName } from "../lib/challenge.js";

let open = false;

export function openChallengeDialog({ setId, title, correct, total }) {
  if (open) return;
  open = true;
  const returnFocusTo = document.activeElement;

  const nameInput = el("input", {
    id: "challenge-name", type: "text", maxlength: "24", autocomplete: "given-name",
    placeholder: t("challenge.namePlaceholder"), value: getSavedName(),
  });
  const linkInput = el("input", { id: "challenge-link", type: "text", readonly: true, "aria-label": t("challenge.linkLabel") });
  const error = el("p.challengedlg__error", { role: "alert", hidden: true }, t("challenge.needName"));

  const name = () => cleanName(nameInput.value);
  const url = () => buildChallengeUrl({ setId, name: name(), correct, total });
  function refreshLink() { linkInput.value = name() ? url() : ""; error.hidden = true; }
  nameInput.addEventListener("input", refreshLink);
  linkInput.addEventListener("focus", () => linkInput.select());

  // Returns false (and says why) when there's no name to put on the link.
  function ready() {
    if (name()) { saveName(name()); return true; }
    error.hidden = false;
    nameInput.focus();
    return false;
  }

  async function copy() {
    if (!ready()) return;
    linkInput.value = url();
    try {
      await navigator.clipboard.writeText(url());
      toast(t("challenge.copied"));
    } catch {
      linkInput.focus();   // clipboard blocked: the link is selected for a manual copy
    }
  }
  async function share() {
    if (!ready()) return;
    try {
      await navigator.share({
        title: t("challenge.dialogTitle"),
        text: t("challenge.shareText", { name: name(), score: correct, total, title }),
        url: url(),
      });
    } catch { /* cancelled */ }
  }

  function close() {
    open = false;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    returnFocusTo?.focus?.();
  }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

  const overlay = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": "challenge-title",
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    el("div.modal__card.challengedlg", {}, [
      el("h2.challengedlg__title", { id: "challenge-title" }, t("challenge.dialogTitle")),
      el("p.challengedlg__body", {}, t("challenge.dialogBody", { score: correct, total, title })),
      el("label.field", {}, [el("span", {}, t("challenge.nameLabel")), nameInput]),
      error,
      el("label.field", {}, [el("span", {}, t("challenge.linkLabel")), linkInput]),
      el("div.challengedlg__actions", {}, [
        el("button.btn.btn--ghost", { type: "button", onclick: close }, t("common.close")),
        el("button.btn" + (navigator.share ? ".btn--ghost" : ""), { type: "button", onclick: copy }, t("challenge.copy")),
        navigator.share ? el("button.btn", { type: "button", onclick: share }, t("challenge.share")) : null,
      ].filter(Boolean)),
    ]),
  ]);

  refreshLink();
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  (name() ? overlay.querySelector(".challengedlg__actions .btn:last-child") : nameInput).focus();
}
