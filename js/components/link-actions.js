// A link to hand to someone: shown in a box they can select, with Copy, and Share where the device has a share sheet
// (phones). Used for a class's join link and a student's invitation for a parent or teacher.

import { el, toast, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { codeField } from "./set-ui.js";

/** `url` is the whole link; `title` and `text` are what a share sheet shows with it. */
export function linkBox(url, { title, text }) {
  const input = el("input", {
    type: "text", readOnly: true, value: url, spellcheck: false, autocomplete: "off",
    "aria-label": t("join.linkLabel"),
    onfocus: (e) => e.target.select(),
  });
  input.classList.add("set-code__input--link");

  const copy = el("button.btn.btn--sm", { type: "button" }, [icon(ICONS.copy, 15), t("join.copy")]);
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); toast(t("join.copied")); }
    catch { input.focus(); input.select(); }   // clipboard blocked: the link is selected for a manual copy
  });

  const share = typeof navigator !== "undefined" && navigator.share
    ? el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: async () => {
        try { await navigator.share({ title, text, url }); } catch { /* cancelled */ }
      } }, [icon(ICONS.share, 15), t("join.share")])
    : null;

  return el("div.set-linkbox", {}, [codeField(input, copy), share]);
}
