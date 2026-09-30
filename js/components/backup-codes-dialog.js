// Shows a fresh batch of 2FA backup codes exactly once — used right after enrolling (from
// twofa-setup-dialog.js) and right after regenerating (from settings.js). Not closable until the
// "I've saved these" box is ticked, since these codes are never retrievable again afterward.
//
//   await backupCodesDialog(codes);   // resolves once the person closes it

import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t("common.copied")); return true; }
  catch { return false; }
}

export function backupCodesDialog(codes) {
  return new Promise((resolve) => {
    function close() {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve();
    }
    function onKey(e) { if (e.key === "Tab") e.stopPropagation(); }   // no Escape: must tick the box first

    const list = codes.join("\n");
    const codesArea = el("textarea", { readonly: true, rows: codes.length, style: { fontFamily: "monospace" } }, list);
    const savedCheck = el("input", { type: "checkbox" });
    const doneBtn = el("button.btn", { type: "button", disabled: true, onclick: close }, t("twofa.done"));
    savedCheck.addEventListener("change", () => { doneBtn.disabled = !savedCheck.checked; });

    const overlay = el("div.modal.confirmdlg", { role: "alertdialog", "aria-modal": "true", "aria-label": t("twofa.backupTitle") }, [
      el("div.modal__card.confirmdlg__card", {}, [
        el("p.confirmdlg__body", {}, t("twofa.backupTitle")),
        el("p.confirmdlg__note", {}, t("twofa.backupBody")),
        codesArea,
        el("button.btn.btn--ghost.btn--sm", {
          type: "button", style: { marginTop: "var(--s-2)" },
          onclick: async () => { if (!(await copyText(list))) { codesArea.focus(); codesArea.select(); } },
        }, [icon(ICONS.copy, 16), t("twofa.copyAll")]),
        el("label.auth__consent", { style: { marginTop: "var(--s-3)" } }, [savedCheck, el("span", {}, t("twofa.savedCheckbox"))]),
        el("div.confirmdlg__actions", {}, [doneBtn]),
      ]),
    ]);

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    savedCheck.focus();
  });
}
