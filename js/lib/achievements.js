// Achievement/badge definitions and progress metrics — pure, no store import
// (same reasoning as mastery.js / grade.js: keep it framework-free so store.js
// can import it without a cycle).
//
// Two shapes:
//   - Five tiered TRACKS (streak / questions / sessions / mastery / perfect),
//     four thresholds each — a single metric crossed four times.
//   - A handful of one-off MILESTONES kept from the older badge set — things
//     that don't fit a tier ladder (breadth across subjects, a well-rounded
//     spread, a week of hitting the daily goal).
//
// Unlocking is permanent once the store records it, even if the underlying
// measurement later dips — a bad week shouldn't take a trophy back.

import { currentStreak, localDayKey, addDays } from "./activity.js";
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

const TRACKED = TRACKS.flatMap((track) =>
  track.tiers.map((target, i) => ({
    id: `${track.id}-${TIER_NAMES[i]}`,
    track: track.id,
    tier: TIER_NAMES[i],
    icon: track.icon,
    nameKey: track.nameKey,
    descKey: track.descKey,
    target,
  })));

/* ---------- milestone helpers (carried over from the old badge set) -------- */

/** How many distinct subjects have at least one recorded attempt item. */
function distinctSubjects(s) {
  const bySet = new Map((s.assignments || []).map((a) => [a.id, a.subjectId]));
  const byQuestion = new Map();
  for (const a of s.assignments || []) {
    for (const q of a.questions || []) byQuestion.set(q.id, a.subjectId);
  }
  const seen = new Set();
  for (const a of s.attempts || []) {
    if (bySet.get(a.assignmentId)) seen.add(bySet.get(a.assignmentId));
    for (const it of a.items || []) {
      const sid = byQuestion.get(it.questionId);
      if (sid) seen.add(sid);
    }
  }
  return seen.size;
}

/** Every subject with any studied topic → its mastery 0..1. */
function subjectMasteryValues(s) {
  const tm = masteryByTopic(s.attempts || []);
  const out = [];
  for (const sub of s.subjects || []) {
    const m = masteryForSubject(sub.id, s.assignments || [], tm);
    if (m != null) out.push(m);
  }
  return out;
}

/** Longest run of consecutive local days that hit the daily goal, ending
 *  today or yesterday (so the run is still "live"). */
function goalRun(s) {
  const days = new Set(s.activity?.goalDays || []);
  if (!days.size) return 0;
  const today = localDayKey();
  let cursor = days.has(today) ? today : addDays(today, -1);
  if (!days.has(cursor)) return 0;
  let n = 0;
  while (days.has(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}

/** One-off badges. `value(state)` gives current progress toward `target`;
 *  `binary` badges are all-or-nothing (no progress bar). tier "milestone"
 *  drives their neutral styling. */
export const MILESTONES = [
  { id: "subjects-3", tier: "milestone", icon: "flag", nameKey: "ach.ms.subjects3.name", descKey: "ach.ms.subjects3.desc",
    target: 3, value: distinctSubjects },
  { id: "subjects-5", tier: "milestone", icon: "flag", nameKey: "ach.ms.subjects5.name", descKey: "ach.ms.subjects5.desc",
    target: 5, value: distinctSubjects },
  { id: "well-rounded", tier: "milestone", icon: "target", nameKey: "ach.ms.wellRounded.name", descKey: "ach.ms.wellRounded.desc",
    target: 1, binary: true,
    value: (s) => { const ms = subjectMasteryValues(s); return ms.length >= 2 && ms.every((m) => m >= 0.6) ? 1 : 0; } },
  { id: "goal-week", tier: "milestone", icon: "flame", nameKey: "ach.ms.goalWeek.name", descKey: "ach.ms.goalWeek.desc",
    target: 7, value: goalRun },
];

/** Every badge, tiered tracks first then milestones. */
export const ACHIEVEMENTS = [...TRACKED, ...MILESTONES];

export const TRACK_META = Object.fromEntries(
  TRACKS.map((tr) => [tr.id, { icon: tr.icon, nameKey: tr.nameKey, descKey: tr.descKey }]));

/** Current value of every tiered track, from a raw store-state blob. Used both
 *  to detect newly-crossed thresholds and to draw progress bars for locked
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

/** Progress toward one badge (tracked or milestone), 0..target. */
export function achievementValue(def, state, metrics = achievementMetrics(state)) {
  const raw = def.track ? (metrics[def.track] ?? 0) : def.value(state);
  return Math.min(raw, def.target);
}

/** The first locked badge in list order, with its live progress — for the
 *  Progress / home "next up" teasers. null once everything is unlocked. */
export function nextAchievement(state) {
  const metrics = achievementMetrics(state);
  const unlocked = state.achievements || {};
  for (const def of ACHIEVEMENTS) {
    if (def.id in unlocked) continue;
    return { def, have: achievementValue(def, state, metrics), need: def.target };
  }
  return null;
}
