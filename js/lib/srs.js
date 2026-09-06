// SM-2-lite spaced repetition. One record per question id:
//   { ease, intervalDays, dueAt (ms), reps, lapses }
// grade: "again" | "hard" | "good" | "easy"  (also accepts correct:boolean via fromCorrect)

import { t, relativeDay } from "./i18n.js";
import { localDayKey } from "./activity.js";

const DAY = 86400000;

export function fresh() {
  return { ease: 2.4, intervalDays: 0, dueAt: Date.now(), reps: 0, lapses: 0 };
}

export function fromCorrect(correct, hintsUsed = 0) {
  if (!correct) return "again";
  if (hintsUsed >= 2) return "hard";
  if (hintsUsed === 1) return "good";
  return "easy";
}

export function review(rec, grade, now = Date.now()) {
  const r = { ...(rec || fresh()) };
  const q = { again: 0, hard: 1, good: 2, easy: 3 }[grade] ?? 2;

  if (q === 0) {
    r.reps = 0;
    r.lapses += 1;
    r.intervalDays = 0;
    r.ease = Math.max(1.3, r.ease - 0.2);
    r.dueAt = now + 10 * 60 * 1000; // 10 min — same session retry
    return r;
  }

  r.ease = clamp(r.ease + (q === 1 ? -0.15 : q === 3 ? 0.15 : 0), 1.3, 3.0);
  r.reps += 1;
  if (r.reps === 1) r.intervalDays = q === 1 ? 1 : 2;
  else if (r.reps === 2) r.intervalDays = q === 1 ? 3 : 6;
  else r.intervalDays = Math.round(r.intervalDays * r.ease * (q === 1 ? 0.8 : q === 3 ? 1.3 : 1));
  r.intervalDays = clamp(r.intervalDays, 1, 365);
  r.dueAt = now + r.intervalDays * DAY;
  return r;
}

export function isDue(rec, now = Date.now()) {
  return !rec || rec.dueAt <= now;
}

/** Reuses the same phrasing as due dates, so both lists read alike.
 *  Note: a record due in ~10 minutes (a just-missed question) still formats as
 *  "Tomorrow" here — that's deliberate, so the due list and the review list
 *  read alike. summarizeSchedule() sidesteps it by bucketing those separately. */
export function dueLabel(rec, now = Date.now()) {
  if (isDue(rec, now)) return t("date.dueNow");
  const days = Math.ceil((rec.dueAt - now) / DAY);
  const target = new Date(now + days * DAY);
  return relativeDay(localDayKey(target), new Date(now));
}

/** What a finished session did to the review schedule, for the results screen.
 *  Pure — reads the already-updated srs map. A wrong answer ("again") comes
 *  back in ~10 minutes (intervalDays 0); those are bucketed as `relearn` and
 *  kept out of `nextRec`, so the headline never reads "Tomorrow" for a
 *  same-day retry. `firstTime` is a heuristic (fresh-looking record), not an
 *  exact "was this brand new" — that isn't recoverable at render time. */
export function summarizeSchedule(items, srs, now = Date.now()) {
  let scheduled = 0, firstTime = 0, relearn = 0, soon = 0, later = 0;
  let nextRec = null;
  for (const it of items || []) {
    const rec = srs[it.questionId];
    if (!rec) continue;
    scheduled++;
    if (rec.reps <= 1 && rec.lapses === 0) firstTime++;
    if (rec.intervalDays === 0) { relearn++; continue; }
    const days = Math.ceil((rec.dueAt - now) / DAY);
    if (days <= 2) soon++; else later++;
    if (!nextRec || rec.dueAt < nextRec.dueAt) nextRec = rec;
  }
  return { scheduled, firstTime, relearn, soon, later, nextRec, relearnOnly: !nextRec && relearn > 0 };
}

/**
 * A rough recall forecast for a just-finished attempt — for the results
 * screen's "what you'll still remember" curve. Model: one item's recall at
 * t days ≈ 0.9^(t / interval), since the SRS interval is roughly the point
 * where recall dips by design. `held` assumes every item due inside the
 * window gets its scheduled review (which lengthens its interval), and is
 * never worse than `decayed`. Deliberately an estimate — always captioned
 * as one. Returns null with fewer than 3 scheduled items (nothing to say).
 */
export function retentionForecast(items, srs, { horizonDays = 14, now = Date.now() } = {}) {
  const recs = (items || []).map((it) => srs[it.questionId]).filter(Boolean);
  if (recs.length < 3) return null;

  const H = Math.max(2, Math.min(60, Math.round(horizonDays)));
  let decaySum = 0, holdSum = 0, reviewsInWindow = 0;
  const reviewFracs = [];

  for (const r of recs) {
    const iv = Math.max(1, r.intervalDays || 1);
    const decayed = Math.pow(0.9, H / iv);
    decaySum += decayed;

    const dueInDays = (r.dueAt - now) / DAY;
    if (dueInDays <= H) {
      reviewsInWindow++;
      reviewFracs.push(Math.max(0, Math.min(1, dueInDays / H)));
      const after = Math.max(0, H - Math.max(0, dueInDays));
      holdSum += Math.pow(0.9, after / (iv * 2.2));       // fresh, then slower decay
    } else {
      holdSum += decayed;
    }
  }

  const n = recs.length;
  return {
    scheduled: n,
    reviewsInWindow,
    reviewFracs: reviewFracs.sort((a, b) => a - b),
    horizonDays: H,
    now: 0.95,                                  // just practised
    decayed: decaySum / n,
    held: Math.max(decaySum, holdSum) / n,      // never below "do nothing"
  };
}

/** A one-glance reason a question is back, from its record. "" when there's
 *  nothing worth saying (a normal, on-track review) — callers skip empties.
 *  Priority: a lapse not yet recovered is the most useful thing to flag. */
export function reviewReason(rec, now = Date.now()) {
  if (!rec) return "";
  const overdueDays = Math.floor((now - rec.dueAt) / DAY);
  if (rec.lapses > 0 && rec.reps <= 2) return t("srs.reasonMissed");
  if (overdueDays >= 7) return t("srs.reasonOverdue");
  if (rec.reps <= 1) return t("srs.reasonFirst");
  if (rec.reps >= 4) return t("srs.reasonSolid");
  return "";
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
