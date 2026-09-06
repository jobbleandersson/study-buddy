// Celebration for a newly unlocked achievement — queued so unlocking several
// at once (e.g. a session that both extends a streak and crosses a
// questions-answered tier) shows them one at a time instead of stacking
// illegibly. Appended straight to <body>, like dom.js's toast(), so it
// survives the navigation to the results page that normally follows the
// attempt that triggered it.

import { el, icon, ICONS } from "./dom.js";
import { celebrate } from "./confetti-helper.js";
import { playFanfare } from "./sound.js";
import { t } from "./i18n.js";

const TIER_RANK = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

export function showAchievementUnlocks(defs) {
  if (!defs || !defs.length) return;
  const queue = [...defs].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  showNext(queue);
}

function showNext(queue) {
  const def = queue.shift();
  if (!def) return;

  const overlay = el(`div.achtoast.achtoast--${def.tier}`, { role: "status" }, [
    el("div.achtoast__icon", {}, icon(ICONS[def.icon] || ICONS.award, 28)),
    el("div", {}, [
      el("p.achtoast__eyebrow", {}, t("ach.unlockedEyebrow")),
      el("p.achtoast__name", {}, `${t(`ach.tier.${def.tier}`)} · ${t(def.nameKey)}`),
      el("p.achtoast__desc", {}, t(def.descKey, { n: def.target })),
    ]),
  ]);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
  // The full flourish (confetti + fanfare) is saved for the two rarer tiers —
  // every unlock playing it would cheapen the moment it's meant to mark.
  if (def.tier === "gold" || def.tier === "platinum") { celebrate(); playFanfare(); }

  setTimeout(() => {
    overlay.classList.remove("show");
    setTimeout(() => { overlay.remove(); showNext(queue); }, 300);
  }, 3400);
}
