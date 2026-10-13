// The badge closest to unlocking, as the home page's achievements panel and the
// Progress page's trophy card show it: its icon on a chip in the tier's metal
// (like the home shortcut tiles' chips), a slim bar in that metal with the count
// beside it, and the tier and what it takes. A gold "collection complete" once
// everything is unlocked.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { nextAchievement } from "../lib/achievements.js";

export function achNext() {
  const next = nextAchievement(store.state);
  const chip = (iconName) => el("span.ach-next__ic", { "aria-hidden": "true" }, icon(ICONS[iconName] || ICONS.award, 18));
  const meter = (pct, count = null) => el("div.ach-next__meter", {}, [
    el("div.ach-next__bar", {}, [el("i", { style: { width: `${pct}%` } })]),
    count ? el("span.ach-next__count", {}, count) : null,
  ]);
  if (!next) {
    return el("div.ach-next.ach-next--gold", {}, [
      chip("trophy"),
      el("div.ach-next__body", {}, [
        el("strong.ach-next__name", {}, t("menu.achAllDone")),
        meter(100),
      ]),
    ]);
  }
  return el(`div.ach-next.ach-next--${next.def.tier}`, {}, [
    chip(next.def.icon),
    el("div.ach-next__body", {}, [
      el("strong.ach-next__name", {}, t(next.def.nameKey)),
      meter(Math.min(100, Math.round((next.have / next.need) * 100)), `${next.have}/${next.need}`),
      el("p.ach-next__desc", {}, [
        el("span.ach-next__tier", {}, t(`ach.tier.${next.def.tier}`)),
        ` · ${t(next.def.descKey, { n: next.need })}`,
      ]),
    ]),
  ]);
}
