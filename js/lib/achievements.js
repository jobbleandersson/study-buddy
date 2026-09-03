// Achievements. Each def is { id, emoji, big, check(state), progress(state) }.
// `check` decides whether it's earned right now; `progress` gives {have, need}
// for the locked line. The store's _checkAchievements() records new unlocks in
// state.achievements ({ id: unlockedAt }); 0 means "already true when the
// feature shipped" so it never triggers a toast.

import { currentStreak, localDayKey, addDays } from "./activity.js";
import { masteryByTopic, masteryForSubject } from "./mastery.js";

/* ---------- shared derivations ---------- */

const streakOf = (s) => currentStreak(s.activity?.daysStudied || [], s.activity?.frozenDays || []);
const bestStreakOf = (s) => Math.max(streakOf(s), s.activity?.bestStreak || 0);

function totalAnswered(s) {
  let n = 0;
  for (const a of s.attempts || []) n += Array.isArray(a.items) ? a.items.length : 0;
  return n;
}

/** subjectId -> mastery 0..1, only for subjects that have any studied topic. */
function subjectMastery(s) {
  const tm = masteryByTopic(s.attempts || []);
  const out = {};
  for (const sub of s.subjects || []) {
    const m = masteryForSubject(sub.id, s.assignments || [], tm);
    if (m != null) out[sub.id] = m;
  }
  return out;
}

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

/** Longest run of consecutive local days that hit the daily goal, ending today
 *  or yesterday (so the run is still "live"). */
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

const streakDef = (need, emoji, big) => ({
  id: `streak-${need}`, emoji, big,
  check: (s) => streakOf(s) >= need,
  progress: (s) => ({ have: Math.min(bestStreakOf(s), need), need }),
});

const volumeDef = (need, emoji, big) => ({
  id: `q-${need}`, emoji, big,
  check: (s) => totalAnswered(s) >= need,
  progress: (s) => ({ have: Math.min(totalAnswered(s), need), need }),
});

/* ---------- the list ---------- */

export const ACHIEVEMENTS = [
  streakDef(3, "🔥", false),
  streakDef(7, "⭐", true),
  streakDef(30, "⚡", true),
  streakDef(100, "🏆", true),

  volumeDef(50, "✏️", false),
  volumeDef(250, "📚", true),
  volumeDef(1000, "🎓", true),

  {
    id: "subj-80", emoji: "🎯", big: true,
    check: (s) => Object.values(subjectMastery(s)).some((m) => m >= 0.8),
    progress: (s) => ({ have: Math.round(Math.max(0, ...Object.values(subjectMastery(s))) * 100), need: 80 }),
  },
  {
    id: "subj-100", emoji: "💎", big: true,
    check: (s) => Object.values(subjectMastery(s)).some((m) => m >= 0.995),
    progress: (s) => ({ have: Math.round(Math.max(0, ...Object.values(subjectMastery(s))) * 100), need: 100 }),
  },
  {
    id: "all-60", emoji: "🌈", big: true,
    check: (s) => {
      const ms = Object.values(subjectMastery(s));
      return ms.length >= 2 && ms.every((m) => m >= 0.6);
    },
    progress: (s) => {
      const ms = Object.values(subjectMastery(s));
      return { have: ms.filter((m) => m >= 0.6).length, need: Math.max(2, ms.length) };
    },
  },

  {
    id: "goal-week", emoji: "📅", big: true,
    check: (s) => goalRun(s) >= 7,
    progress: (s) => ({ have: Math.min(goalRun(s), 7), need: 7 }),
  },
  {
    id: "subj-3", emoji: "🧭", big: false,
    check: (s) => distinctSubjects(s) >= 3,
    progress: (s) => ({ have: Math.min(distinctSubjects(s), 3), need: 3 }),
  },
  {
    id: "subj-5", emoji: "🗺️", big: true,
    check: (s) => distinctSubjects(s) >= 5,
    progress: (s) => ({ have: Math.min(distinctSubjects(s), 5), need: 5 }),
  },
  {
    id: "first-review", emoji: "🔁", big: false,
    check: (s) => (s.attempts || []).some((a) => a.isReview),
    progress: (s) => ({ have: (s.attempts || []).some((a) => a.isReview) ? 1 : 0, need: 1 }),
  },
  {
    id: "first-freeze", emoji: "🛡️", big: false,
    check: (s) => (s.activity?.frozenDays || []).length > 0,
    progress: (s) => ({ have: Math.min((s.activity?.frozenDays || []).length, 1), need: 1 }),
  },
];

/** `ach.streak7.title` / `ach.streak7.desc` — dashes stripped. */
export function titleKey(def) { return `ach.${def.id.replace(/-/g, "")}.title`; }
export function descKey(def) { return `ach.${def.id.replace(/-/g, "")}.desc`; }

/** One row per achievement for the Progress shelf. */
export function achievementRows(state) {
  return ACHIEVEMENTS.map((def) => {
    const p = def.progress(state);
    return {
      def,
      unlocked: !!state.achievements && def.id in state.achievements,
      have: p.have,
      need: p.need,
    };
  });
}
