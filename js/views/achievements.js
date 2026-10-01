// Achievements page: every badge, tiered tracks grouped by track then a
// "Milestones" group for the one-off badges. Locked ones show progress.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { ACHIEVEMENTS, MILESTONES, TIER_NAMES, achievementMetrics, achievementValue, nextAchievement } from "../lib/achievements.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { shareCard, tierEmoji } from "../lib/share-card.js";

// A badge wears the colour of what it is: its tier's metal (bronze, silver,
// gold, platinum) — locked ones softly, earned ones in full. Milestones have
// no tier, so they take the brand blue.
const colorOf = (def) => (def.track ? `var(--ach-${def.tier})` : "var(--brand)");

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

  // Show every earned tier plus the next one you're working toward; fold the
  // rest of the ladder behind a per-track toggle. Day one that's one card per
  // track instead of four, and the "1/30 … 1/100" cards you can't act on yet
  // don't bury the one that's close.
  const trackGroups = [...byTrack.values()].map((defs) => {
    const firstLocked = defs.findIndex((d) => !(d.id in unlocked));
    const cutoff = firstLocked === -1 ? defs.length : firstLocked + 1;
    const shown = defs.slice(0, cutoff);
    const rest = defs.slice(cutoff);
    return el("section.panel.achgroup", {}, [
      el("h3.achgroup__title", {}, [
        el("span.achgroup__ic", { "aria-hidden": "true" }, icon(ICONS[defs[0].icon] || ICONS.award, 18)),
        t(defs[0].nameKey),
      ]),
      el("div.achrow", {}, shown.map((def, i) => badge(def, metrics, unlocked, i === firstLocked))),
      rest.length ? el("details.achgroup__more", {}, [
        el("summary", {}, plural(rest.length, "ach.showTiersOne", "ach.showTiersMany")),
        el("div.achrow", { style: { marginTop: "var(--s-3)" } }, rest.map((def) => badge(def, metrics, unlocked))),
      ]) : null,
    ].filter(Boolean));
  });

  const next = nextAchievement(store.state);
  const heroPct = next ? Math.min(100, Math.round((next.have / next.need) * 100)) : 0;
  const hero = next ? el("section.ach-hero", { style: { "--c": colorOf(next.def) } }, [
    el("div.ach-hero__icon", {}, icon(ICONS[next.def.icon] || ICONS.award, 24)),
    el("div.ach-hero__body", {}, [
      el("p.ach-hero__eyebrow", {}, t("ach.nextUp")),
      el("strong.ach-hero__name", {},
        `${next.def.track ? t(`ach.tier.${next.def.tier}`) + " · " : ""}${t(next.def.nameKey)}`),
      el("p.ach-hero__desc", {}, t(next.def.descKey, { n: next.need })),
      el("div.ach-hero__bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: heroPct } })]),
      el("span.note", {}, `${next.have} / ${next.need}`),
    ]),
  ]) : null;

  const milestoneGroup = MILESTONES.length ? el("section.panel.achgroup", {}, [
    el("h3.achgroup__title", {}, [el("span.achgroup__ic", { "aria-hidden": "true" }, icon(ICONS.trophy, 18)), t("ach.milestonesTitle")]),
    el("div.achrow", {}, MILESTONES.map((def) => badge(def, metrics, unlocked))),
  ]) : null;

  const pct = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);
  const tierCount = (tier) => ACHIEVEMENTS.filter((a) => a.tier === tier && a.id in unlocked).length;

  // The board's head: a ring for how many are unlocked, a count per metal,
  // and the "Next up" card beside them.
  const overview = el("section.ach-overview", {}, [
    el("div.ach-ring", {
      style: { "--p": String(pct) }, role: "img",
      "aria-label": t("ach.subtitle", { unlocked: unlockedCount, total: ACHIEVEMENTS.length }),
    }, [
      el("div.ach-ring__inner", { "aria-hidden": "true" }, [
        el("strong", {}, String(unlockedCount)),
        el("span", {}, t("ach.ofTotal", { total: ACHIEVEMENTS.length })),
      ]),
    ]),
    el("div.ach-tiers", {}, [
      ...TIER_NAMES.map((tier) => el(`div.ach-tiercount.ach-tiercount--${tier}`, { style: { "--m": `var(--ach-${tier})` } }, [
        el("span.ach-tiercount__medal", { "aria-hidden": "true" }, icon(ICONS.award, 15)),
        el("b", {}, String(tierCount(tier))),
        el("small", {}, t(`ach.tier.${tier}`)),
      ])),
      el("div.ach-tiercount.ach-tiercount--milestone", { style: { "--m": "var(--brand)" } }, [
        el("span.ach-tiercount__medal", { "aria-hidden": "true" }, icon(ICONS.trophy, 15)),
        el("b", {}, String(tierCount("milestone"))),
        el("small", {}, t("ach.milestonesTitle")),
      ]),
    ]),
    hero,
  ].filter(Boolean));

  const node = el("div.achievements-page", {}, [
    homeButton({ grid: true }),
    el("div.achievements-head", {}, [
      el("h1", {}, t("ach.pageTitle")),
      el("p.note", {}, t("ach.pageLede")),
    ]),
    overview,
    ...trackGroups,
    milestoneGroup,
    el("a.btn.btn--ghost.pageback", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ].filter(Boolean));

  requestAnimationFrame(() => {
    node.querySelectorAll("[data-w]").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  });

  return { title: t("ach.pageTitle"), node };
}

function badge(def, metrics, unlockedMap, isNext = false) {
  const isUnlocked = def.id in unlockedMap;
  const value = achievementValue(def, store.state, metrics);
  const pct = Math.round((value / def.target) * 100);
  const stamp = unlockedMap[def.id];
  // Tracked badges are one of four tiers → show the tier. Milestones each have
  // their own name → show that instead of a generic "Milestone" four times.
  const tierLabel = def.track ? t(`ach.tier.${def.tier}`) : t(def.nameKey);

  const shareBtn = isUnlocked ? el("button.iconbtn.iconbtn--sm.achbadge__share", {
    type: "button", "aria-label": t("share.shareButton"), title: t("share.shareButton"),
    onclick: (e) => {
      e.stopPropagation();
      shareCard({
        tone: def.track ? def.tier : "brand",
        emoji: def.track ? tierEmoji(def.tier) : "🎯",
        tag: t("share.badgeTag"),
        headline: t(def.nameKey),
        caption: t(def.descKey, { n: def.target }),
        filename: "pluggera-badge.png",
      });
    },
  }, [icon(ICONS.share, 13)]) : null;

  return el(`div.achbadge.achbadge--${def.tier}` + (isUnlocked ? ".achbadge--unlocked" : "") + (isNext ? ".achbadge--next" : ""),
    { style: { "--c": colorOf(def) } }, [
    el("div.achbadge__icon", {}, icon(ICONS[def.icon] || ICONS.award, 22)),
    el("div.achbadge__body", {}, [
      el("div.achbadge__top", {}, [
        el("span.achbadge__tiername", {}, tierLabel),
        isUnlocked ? el("span.achbadge__check", {}, icon(ICONS.check, 12)) : null,
        shareBtn,
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
