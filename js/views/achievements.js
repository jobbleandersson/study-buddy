// Achievements page: every badge, grouped by track, locked ones showing
// progress toward the next tier.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { ACHIEVEMENTS, achievementMetrics } from "../lib/achievements.js";
import { t, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

export function renderAchievements() {
  const metrics = achievementMetrics(store.state);
  const unlocked = store.unlockedAchievements;
  const unlockedCount = ACHIEVEMENTS.filter((a) => a.id in unlocked).length;

  const byTrack = new Map();
  for (const a of ACHIEVEMENTS) {
    if (!byTrack.has(a.track)) byTrack.set(a.track, []);
    byTrack.get(a.track).push(a);
  }

  const groups = [...byTrack.values()].map((defs) =>
    el("section.panel.achgroup", {}, [
      el("h3.achgroup__title", {}, [icon(ICONS[defs[0].icon] || ICONS.award, 18), t(defs[0].nameKey)]),
      el("div.achrow", {}, defs.map((def) => badge(def, metrics, unlocked))),
    ]));

  const pct = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);

  const node = el("div.achievements-page", {}, [
    homeButton({ grid: true }),
    el("div.achievements-head", {}, [
      el("h1", {}, t("ach.pageTitle")),
      el("p.note", {}, t("ach.subtitle", { unlocked: unlockedCount, total: ACHIEVEMENTS.length })),
      el("div.ach-summary__bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: pct } })]),
    ]),
    ...groups,
    el("a.btn.btn--ghost", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ]);

  requestAnimationFrame(() => {
    node.querySelectorAll("[data-w]").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  });

  return { title: t("ach.pageTitle"), node };
}

function badge(def, metrics, unlockedMap) {
  const isUnlocked = def.id in unlockedMap;
  const value = Math.min(metrics[def.track] ?? 0, def.target);
  const pct = Math.round((value / def.target) * 100);
  const stamp = unlockedMap[def.id];

  return el(`div.achbadge.achbadge--${def.tier}` + (isUnlocked ? ".achbadge--unlocked" : ""), {}, [
    el("div.achbadge__icon", {}, icon(ICONS[def.icon] || ICONS.award, 22)),
    el("div.achbadge__body", {}, [
      el("div.achbadge__top", {}, [
        el("span.achbadge__tiername", {}, t(`ach.tier.${def.tier}`)),
        isUnlocked ? el("span.achbadge__check", {}, icon(ICONS.check, 12)) : null,
      ].filter(Boolean)),
      el("p.achbadge__desc", {}, t(def.descKey, { n: def.target })),
      isUnlocked
        ? el("p.achbadge__unlockdate", {}, stamp ? t("ach.unlockedOn", { date: formatDate(stamp) }) : t("ach.unlockedEyebrow"))
        : el("div.achbadge__progress", {}, [
            el("div.achbadge__bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: pct } })]),
            el("span.achbadge__fraction", {}, `${value}/${def.target}`),
          ]),
    ]),
  ]);
}

function formatDate(ts) {
  const locale = getLang() === "sv" ? "sv-SE" : "en-GB";
  return new Date(ts).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}
