// Achievements page: every badge, tiered tracks grouped by track then a
// "Milestones" group for the one-off badges. Locked ones show progress.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { ACHIEVEMENTS, MILESTONES, achievementMetrics, achievementValue } from "../lib/achievements.js";
import { t, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

export function renderAchievements() {
  const metrics = achievementMetrics(store.state);
  const unlocked = store.unlockedAchievements;
  const unlockedCount = ACHIEVEMENTS.filter((a) => a.id in unlocked).length;

  // Tiered tracks — keep list order, one group per track.
  const byTrack = new Map();
  for (const a of ACHIEVEMENTS) {
    if (!a.track) continue;
    if (!byTrack.has(a.track)) byTrack.set(a.track, []);
    byTrack.get(a.track).push(a);
  }

  const trackGroups = [...byTrack.values()].map((defs) =>
    el("section.panel.achgroup", {}, [
      el("h3.achgroup__title", {}, [icon(ICONS[defs[0].icon] || ICONS.award, 18), t(defs[0].nameKey)]),
      el("div.achrow", {}, defs.map((def) => badge(def, metrics, unlocked))),
    ]));

  const milestoneGroup = MILESTONES.length ? el("section.panel.achgroup", {}, [
    el("h3.achgroup__title", {}, [icon(ICONS.trophy, 18), t("ach.milestonesTitle")]),
    el("div.achrow", {}, MILESTONES.map((def) => badge(def, metrics, unlocked))),
  ]) : null;

  const pct = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);

  const node = el("div.achievements-page", {}, [
    homeButton({ grid: true }),
    el("div.achievements-head", {}, [
      el("h1", {}, t("ach.pageTitle")),
      el("p.note", {}, t("ach.subtitle", { unlocked: unlockedCount, total: ACHIEVEMENTS.length })),
      el("div.ach-summary__bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: pct } })]),
    ]),
    ...trackGroups,
    milestoneGroup,
    el("a.btn.btn--ghost", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ].filter(Boolean));

  requestAnimationFrame(() => {
    node.querySelectorAll("[data-w]").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  });

  return { title: t("ach.pageTitle"), node };
}

function badge(def, metrics, unlockedMap) {
  const isUnlocked = def.id in unlockedMap;
  const value = achievementValue(def, store.state, metrics);
  const pct = Math.round((value / def.target) * 100);
  const stamp = unlockedMap[def.id];
  // Tracked badges are one of four tiers → show the tier. Milestones each have
  // their own name → show that instead of a generic "Milestone" four times.
  const tierLabel = def.track ? t(`ach.tier.${def.tier}`) : t(def.nameKey);

  return el(`div.achbadge.achbadge--${def.tier}` + (isUnlocked ? ".achbadge--unlocked" : ""), {}, [
    el("div.achbadge__icon", {}, icon(ICONS[def.icon] || ICONS.award, 22)),
    el("div.achbadge__body", {}, [
      el("div.achbadge__top", {}, [
        el("span.achbadge__tiername", {}, tierLabel),
        isUnlocked ? el("span.achbadge__check", {}, icon(ICONS.check, 12)) : null,
      ].filter(Boolean)),
      el("p.achbadge__desc", {}, t(def.descKey, { n: def.target })),
      isUnlocked
        ? el("p.achbadge__unlockdate", {}, stamp ? t("ach.unlockedOn", { date: formatDate(stamp) }) : t("ach.unlockedEyebrow"))
        : def.binary
        ? el("p.achbadge__unlockdate", {}, t("ach.notYet"))
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
