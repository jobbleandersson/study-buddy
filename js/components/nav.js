// Shared "back to the home menu" control, shown at the top of every sub-screen
// (not on the home menu itself). On screens where leaving mid-task matters —
// a running study session — pass { confirm: true } for an "are you sure?".

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function homeButton({ confirm: needConfirm = false, grid = false } = {}) {
  return el("a.homebtn", {
    href: "#/",
    "aria-label": t("nav.home"),
    // In a CSS grid parent the default stretch would blow it full-width.
    style: grid ? { justifySelf: "start" } : null,
    onclick: needConfirm
      ? (e) => {
          e.preventDefault();
          if (window.confirm(t("nav.leaveConfirm"))) location.hash = "#/";
        }
      : null,
  }, [icon(ICONS.back, 15), t("nav.home")]);
}
