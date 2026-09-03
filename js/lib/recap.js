// A once-a-week "here's how last week went" summary, derived entirely from
// existing state — no new tracking.

import { localDayKey, addDays, daysBetween } from "./activity.js";
import { masteryByTopic, masteryForSubject } from "./mastery.js";

/** ISO week key, e.g. "2026-W36". Weeks start Monday. */
export function isoWeek(dayKey = localDayKey()) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = (date.getDay() + 6) % 7;            // Mon=0
  date.setDate(date.getDate() - day + 3);         // nearest Thursday
  const firstThu = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * `{ days, questions, minutes, topSubject, topicsUp }` for the last 7 days, or
 * `null` when there's nothing worth showing.
 */
export function weeklyRecap(state) {
  const today = localDayKey();
  const since = addDays(today, -7);
  const recent = (state.attempts || []).filter(
    (a) => a.finishedAt && localDayKey(new Date(a.finishedAt)) > since
  );
  if (!recent.length) return null;

  const days = new Set((state.activity?.daysStudied || []).filter((d) => d > since && d <= today)).size;
  let questions = 0, ms = 0;
  for (const a of recent) {
    questions += (a.items || []).length;
    if (a.startedAt && a.finishedAt) ms += Math.max(0, a.finishedAt - a.startedAt);
  }

  // Mastery movement over the week: compare "before this week" to "now".
  const older = (state.attempts || []).filter((a) => a.finishedAt && localDayKey(new Date(a.finishedAt)) <= since);
  const tmBefore = masteryByTopic(older);
  const tmNow = masteryByTopic(state.attempts || []);
  let topicsUp = 0;
  for (const topic of new Set(Object.keys(tmNow))) {
    if ((tmNow[topic] ?? 0) - (tmBefore[topic] ?? 0) > 0.03) topicsUp++;
  }

  // Strongest subject right now.
  let topSubject = null, best = -1;
  for (const sub of state.subjects || []) {
    const m = masteryForSubject(sub.id, state.assignments || [], tmNow);
    if (m != null && m > best) { best = m; topSubject = sub.name; }
  }

  return { days, questions, minutes: Math.round(ms / 60000), topSubject, topicsUp };
}
