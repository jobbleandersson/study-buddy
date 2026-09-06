// Achievement/badge definitions and progress metrics — pure, no store import
// (same reasoning as mastery.js / grade.js: keep it framework-free so store.js
// can import it without a cycle).
//
// Five tracks, four tiers each. A track is a single metric with four
// thresholds; unlocking a tier is permanent once the store records it (see
// store._checkAchievements) even if the metric itself later dips — "subjects
// mastered" is a live measurement, not a running total, so without that
// permanence a bad week could take a badge back, which isn't how an
// achievement is meant to work.

import { currentStreak } from "./activity.js";
import { masteryByTopic, masteryForSubject } from "./mastery.js";
import { estimatedGrade, gradeRank } from "./grade.js";

export const TIER_NAMES = ["bronze", "silver", "gold", "platinum"];

const TRACKS = [
  { id: "streak",    icon: "flame",      nameKey: "ach.track.streak",    descKey: "ach.desc.streak",    tiers: [3, 7, 30, 100] },
  { id: "questions", icon: "book",       nameKey: "ach.track.questions", descKey: "ach.desc.questions", tiers: [25, 100, 500, 2000] },
  { id: "sessions",  icon: "check",      nameKey: "ach.track.sessions",  descKey: "ach.desc.sessions",  tiers: [5, 20, 75, 250] },
  { id: "mastery",   icon: "chart",      nameKey: "ach.track.mastery",   descKey: "ach.desc.mastery",   tiers: [1, 2, 4, 6] },
  { id: "perfect",   icon: "graduation", nameKey: "ach.track.perfect",   descKey: "ach.desc.perfect",   tiers: [1, 5, 15, 50] },
];

export const ACHIEVEMENTS = TRACKS.flatMap((track) =>
  track.tiers.map((target, i) => ({
    id: `${track.id}-${TIER_NAMES[i]}`,
    track: track.id,
    tier: TIER_NAMES[i],
    icon: track.icon,
    nameKey: track.nameKey,
    descKey: track.descKey,
    target,
  })));

export const TRACK_META = Object.fromEntries(
  TRACKS.map((tr) => [tr.id, { icon: tr.icon, nameKey: tr.nameKey, descKey: tr.descKey }]));

/** Current value of every track, from a raw store-state blob. Used both to
 *  detect newly-crossed thresholds and to draw progress bars for locked
 *  badges. Tolerant of a partial state (the store's silent init pass). */
export function achievementMetrics(state) {
  const attempts = state.attempts || [];
  const subjects = state.subjects || [];
  const assignments = state.assignments || [];
  const days = state.activity?.daysStudied || [];
  const frozen = state.activity?.frozenDays || [];

  const streak = Math.max(currentStreak(days, frozen), state.activity?.bestStreak || 0);
  const questions = attempts.reduce((n, a) => n + (Array.isArray(a.items) ? a.items.length : 0), 0);
  const perfect = attempts.filter((a) => a.wasTest && a.scorePct === 100).length;

  const tm = masteryByTopic(attempts);
  const cOrBetter = gradeRank("C");
  const mastery = subjects.filter((s) => {
    const m = masteryForSubject(s.id, assignments, tm);
    return m != null && gradeRank(estimatedGrade(m).letter) >= cOrBetter;
  }).length;

  return { streak, questions, sessions: attempts.length, mastery, perfect };
}

/** The lowest-tier locked badge, with its live progress — for the Progress
 *  page's "next up" teaser. null once every badge is unlocked. */
export function nextAchievement(state) {
  const metrics = achievementMetrics(state);
  const unlocked = state.achievements || {};
  for (const def of ACHIEVEMENTS) {
    if (def.id in unlocked) continue;
    const have = Math.min(metrics[def.track] ?? 0, def.target);
    return { def, have, need: def.target };
  }
  return null;
}
