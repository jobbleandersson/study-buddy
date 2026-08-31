// SM-2-lite spaced repetition. One record per question id:
//   { ease, intervalDays, dueAt (ms), reps, lapses }
// grade: "again" | "hard" | "good" | "easy"  (also accepts correct:boolean via fromCorrect)

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

export function dueLabel(rec, now = Date.now()) {
  if (isDue(rec, now)) return "due now";
  const days = Math.ceil((rec.dueAt - now) / DAY);
  if (days <= 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 30) return `in ${Math.round(days / 7)} wk`;
  return `in ${Math.round(days / 30)} mo`;
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
