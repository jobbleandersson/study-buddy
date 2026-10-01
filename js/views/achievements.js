// Achievements page: an overview (how many you've unlocked, by tier, and the
// one you're closest to), then one card per tiered track — its four medals as
// a ladder, in the track's own colour — then the one-off milestones.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { ACHIEVEMENTS, MILESTONES, TIER_NAMES, achievementMetrics, achievementValue, nextAchievement } from "../lib/achievements.js";
import { t, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { shareCard, tierEmoji } from "../lib/share-card.js";

// Each track and milestone wears one colour — the same bright hues as the
// home page's tiles, so the app reads as one palette.
const TRACK_COLORS = {
  streak: "#FF7426", questions: "#7650FF", sessions: "#0FA3C2",
  mastery: "#22A35A", perfect: "#EE3D86", hp: "#3AA4E6",
};
const MILESTONE_COLORS = ["#0FA3C2", "#7650FF", "#22A35A", "#FF7426"];

export function renderAchievements() {
  const metrics = achievementMetrics(store.state);
  const unlocked = store.unlockedAchievements;
  const unlockedCount = ACHIEVEMENTS.filter((a) => a.id in unlocked).length;
  const pct = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);

  // Tiered tracks — keep list order, one card per track.
  const byTrack = new Map();
  for (const a of ACHIEVEMENTS) {
    if (!a.track) continue;
    if (!byTrack.has(a.track)) byTrack.set(a.track, []);
    byTrack.get(a.track).push(a);
  }

  const node = el("div.achievements-page", {}, [
    homeButton({ grid: true }),
    el("header.achievements-head", {}, [
      el("h1", {}, t("ach.pageTitle")),
      el("p.note", {}, t("ach.pageLede")),
    ]),
    overview(unlocked, unlockedCount, pct),
    el("div.ach-tracks", {}, [...byTrack.values()].map((defs) => trackCard(defs, metrics, unlocked))),
    MILESTONES.length ? el("section.ach-milestones", {}, [
      el("h2.ach-sectitle", {}, [icon(ICONS.trophy, 18), t("ach.milestonesTitle")]),
      el("div.ach-msgrid", {}, MILESTONES.map((def, i) => milestoneCard(def, metrics, unlocked, MILESTONE_COLORS[i % MILESTONE_COLORS.length]))),
    ]) : null,
    el("a.btn.btn--ghost.pageback", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
  ].filter(Boolean));

  // Bars grow in from 0 once the page is on screen.
  requestAnimationFrame(() => {
    node.querySelectorAll("[data-w]").forEach((f) => { f.style.width = `${f.dataset.w}%`; });
  });

  return { title: t("ach.pageTitle"), node };
}

/** The top band: a ring for the share unlocked, a count per tier, and the
 *  badge you're closest to. */
function overview(unlocked, unlockedCount, pct) {
  const count = (tier) => ACHIEVEMENTS.filter((a) => a.tier === tier && a.id in unlocked).length;
  const next = nextAchievement(store.state);
  const nextColor = next ? (next.def.track ? TRACK_COLORS[next.def.track] : MILESTONE_COLORS[0]) : null;
  const nextPct = next ? Math.min(100, Math.round((next.have / next.need) * 100)) : 0;

  return el("section.ach-overview", {}, [
    el("div.ach-ring", {
      style: { "--p": String(pct) }, role: "img",
      "aria-label": t("ach.subtitle", { unlocked: unlockedCount, total: ACHIEVEMENTS.length }),
    }, [
      el("div.ach-ring__inner", { "aria-hidden": "true" }, [
        el("strong", {}, String(unlockedCount)),
        el("span", {}, t("ach.ofTotal", { total: ACHIEVEMENTS.length })),
      ]),
    ]),
    el("div.ach-overview__tiers", {}, [
      ...TIER_NAMES.map((tier) => el(`div.ach-tiercount.ach-tiercount--${tier}`, {}, [
        el("span.ach-tiercount__medal", { "aria-hidden": "true" }, icon(ICONS.award, 16)),
        el("b", {}, String(count(tier))),
        el("small", {}, t(`ach.tier.${tier}`)),
      ])),
      el("div.ach-tiercount.ach-tiercount--milestone", {}, [
        el("span.ach-tiercount__medal", { "aria-hidden": "true" }, icon(ICONS.trophy, 16)),
        el("b", {}, String(count("milestone"))),
        el("small", {}, t("ach.milestonesTitle")),
      ]),
    ]),
    next ? el("div.ach-next", { style: { "--c": nextColor } }, [
      el("span.ach-next__icon", { "aria-hidden": "true" }, icon(ICONS[next.def.icon] || ICONS.award, 20)),
      el("div.ach-next__body", {}, [
        el("p.ach-next__eyebrow", {}, t("ach.nextUp")),
        el("strong.ach-next__name", {},
          `${next.def.track ? t(`ach.tier.${next.def.tier}`) + " · " : ""}${t(next.def.nameKey)}`),
        el("p.ach-next__desc", {}, t(next.def.descKey, { n: next.need })),
        el("div.ach-bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: nextPct } })]),
        el("span.ach-next__frac", {}, `${next.have} / ${next.need}`),
      ]),
    ]) : el("div.ach-next", { style: { "--c": MILESTONE_COLORS[2] } }, [
      el("span.ach-next__icon", { "aria-hidden": "true" }, icon(ICONS.check, 20)),
      el("div.ach-next__body", {}, [el("strong.ach-next__name", {}, t("ach.teaserAllDone"))]),
    ]),
  ]);
}

/** One track: its four tiers as medals on a line, coloured as you earn them,
 *  and the bar toward the next. */
function trackCard(defs, metrics, unlocked) {
  const track = defs[0].track;
  const value = metrics[track] ?? 0;
  const earned = defs.filter((d) => d.id in unlocked).length;
  const nextIdx = defs.findIndex((d) => !(d.id in unlocked));
  const next = nextIdx === -1 ? null : defs[nextIdx];

  // How far along the line the fill reaches: medal i sits at i/(n-1).
  const prevTarget = nextIdx > 0 ? defs[nextIdx - 1].target : 0;
  const part = next ? Math.max(0, Math.min(1, (value - prevTarget) / (next.target - prevTarget))) : 0;
  const fill = !next ? 100 : nextIdx === 0 ? 0 : Math.round(((nextIdx - 1 + part) / (defs.length - 1)) * 100);
  const toNext = next ? Math.min(100, Math.round((Math.min(value, next.target) / next.target) * 100)) : 100;

  return el("section.ach-track", { style: { "--c": TRACK_COLORS[track] || "var(--brand)" } }, [
    el("div.ach-track__head", {}, [
      el("span.ach-track__icon", { "aria-hidden": "true" }, icon(ICONS[defs[0].icon] || ICONS.award, 20)),
      el("div.ach-track__title", {}, [
        el("h2", {}, t(defs[0].nameKey)),
        el("p", {}, next ? t(next.descKey, { n: next.target }) : t("ach.trackDone")),
      ]),
      el("span.ach-track__count", {}, t("ach.tiersEarned", { n: earned, total: defs.length })),
    ]),
    el("div.ach-ladder", { style: { "--fill": String(fill / 100) } }, defs.map((def, i) => medal(def, unlocked, i === nextIdx))),
    next ? el("div.ach-track__foot", {}, [
      el("div.ach-bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: toNext } })]),
      el("span", {}, t("ach.toTier", { have: Math.min(value, next.target), need: next.target, tier: t(`ach.tier.${next.tier}`) })),
    ]) : null,
  ].filter(Boolean));
}

/** A tier medal. Earned ones are metal, and a tap shares them. */
function medal(def, unlocked, isNext) {
  const stamp = unlocked[def.id];
  const isEarned = def.id in unlocked;
  const tier = t(`ach.tier.${def.tier}`);
  const desc = t(def.descKey, { n: def.target });
  const label = isEarned
    ? `${tier}: ${desc} — ${stamp ? t("ach.unlockedOn", { date: formatDate(stamp) }) : t("ach.unlockedEyebrow")}. ${t("share.shareButton")}`
    : `${tier}: ${desc} — ${t("ach.locked")}`;
  const face = el("span.ach-medal__face", {}, [
    icon(ICONS[def.icon] || ICONS.award, 20),
    isEarned ? el("span.ach-medal__check", {}, icon(ICONS.check, 10)) : null,
  ].filter(Boolean));
  const text = el("span.ach-medal__text", {}, [el("b", {}, tier), el("small", {}, String(def.target))]);
  const cls = `.ach-medal.ach-medal--${def.tier}` + (isEarned ? ".is-earned" : "") + (isNext ? ".is-next" : "");
  return isEarned
    ? el("button" + cls, {
        type: "button", title: label, "aria-label": label,
        onclick: () => shareCard({
          tone: def.tier, emoji: tierEmoji(def.tier), tag: t("share.badgeTag"),
          headline: t(def.nameKey), caption: desc, filename: "pluggera-badge.png",
        }),
      }, [face, text])
    : el("div" + cls, { title: label, role: "img", "aria-label": label }, [face, text]);
}

/** A one-off milestone, in its own colour once earned. */
function milestoneCard(def, metrics, unlocked, color) {
  const isEarned = def.id in unlocked;
  const stamp = unlocked[def.id];
  const value = achievementValue(def, store.state, metrics);
  const pct = Math.round((value / def.target) * 100);
  const desc = t(def.descKey, { n: def.target });
  return el("article.ach-ms" + (isEarned ? ".is-earned" : ""), { style: { "--c": color } }, [
    el("span.ach-ms__icon", { "aria-hidden": "true" }, icon(ICONS[def.icon] || ICONS.award, 20)),
    el("div.ach-ms__body", {}, [
      el("div.ach-ms__top", {}, [
        el("strong", {}, t(def.nameKey)),
        isEarned ? el("button.iconbtn.iconbtn--sm.ach-ms__share", {
          type: "button", "aria-label": t("share.shareButton"), title: t("share.shareButton"),
          onclick: () => shareCard({
            tone: "brand", emoji: "🎯", tag: t("share.badgeTag"),
            headline: t(def.nameKey), caption: desc, filename: "pluggera-badge.png",
          }),
        }, [icon(ICONS.share, 13)]) : null,
      ].filter(Boolean)),
      el("p", {}, desc),
      isEarned
        ? el("span.ach-ms__done", {}, [icon(ICONS.check, 12), stamp ? t("ach.unlockedOn", { date: formatDate(stamp) }) : t("ach.unlockedEyebrow")])
        : def.binary
        ? el("span.ach-ms__frac", {}, t("ach.notYet"))
        : el("div.ach-ms__progress", {}, [
            el("div.ach-bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: pct } })]),
            el("span.ach-ms__frac", {}, `${value}/${def.target}`),
          ]),
    ]),
  ]);
}

function formatDate(ts) {
  const locale = getLang() === "sv" ? "sv-SE" : "en-GB";
  return new Date(ts).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}
