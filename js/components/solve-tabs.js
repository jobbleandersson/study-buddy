// The two ways into "Lös": ask about a problem (the chat), or have your own
// written working checked (a photo of the notebook page). Both live under
// #/solve, so the sidebar's "Lös" stays highlighted on either.

import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function solveTabs(active) {
  const tab = (key, href, label) => el("a.solvetab" + (active === key ? ".is-active" : ""), {
    href, "aria-current": active === key ? "page" : null,
  }, label);
  return el("nav.solvetabs", { "aria-label": t("solve.tabsLabel") }, [
    tab("help", "#/solve", t("solve.tabHelp")),
    tab("check", "#/solve?mode=check", t("solve.tabCheck")),
  ]);
}
