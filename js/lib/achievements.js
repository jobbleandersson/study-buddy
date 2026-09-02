// Achievements. This round is streak milestones only, but the shape is built to
// extend — add a def with an `id`, a `need`, and (for non-streak ones later) a
// `check(state)` / `progress(state)` and the store's _checkAchievements() picks
// it up.
//
// Unlocks are recorded in state.achievements ({ id: unlockedAt }); 0 means
// "already true when the feature shipped" so it never triggers a toast.

import { currentStreak } from "./activity.js";

export const ACHIEVEMENTS = [
  { id: "streak-3",   emoji: "🔥", need: 3,   big: false },
  { id: "streak-7",   emoji: "⭐", need: 7,   big: true  },
  { id: "streak-30",  emoji: "⚡", need: 30,  big: true  },
  { id: "streak-100", emoji: "🏆", need: 100, big: true  },
];

/** `ach.streak7.title` / `ach.streak7.desc` */
export function titleKey(def) { return `ach.${def.id.replace("-", "")}.title`; }
export function descKey(def) { return `ach.${def.id.replace("-", "")}.desc`; }

/** One row per achievement for the Progress shelf: whether it's unlocked, and
 *  how close a locked one is (using best-ever streak so progress never regresses). */
export function achievementRows(state) {
  const streak = currentStreak(state.activity?.daysStudied || [], state.activity?.frozenDays || []);
  const best = Math.max(streak, state.activity?.bestStreak || 0);
  return ACHIEVEMENTS.map((def) => ({
    def,
    unlocked: !!state.achievements && def.id in state.achievements,
    have: Math.min(best, def.need),
    need: def.need,
  }));
}
