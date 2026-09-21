// Dagens fråga: one multiple-choice question a day, from a teacher to a class.
//
// Pure rules (validation, what a teacher may see, the class streak) live here,
// away from the database, so they can be tested on their own — the routes in
// routes/class-daily.js only fetch rows and hand them to these.
//
// What the teacher sees is deliberately thin: how many answered and how the
// answers were spread, never who chose what. Below MIN_SHOWN answers even the
// spread is held back — in a class of two, a spread names names.

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 5;
export const MAX_PROMPT = 300;
export const MAX_CHOICE = 120;
export const MAX_EXPLANATION = 300;
export const MAX_QUESTIONS_PER_CLASS = 200;
export const MIN_SHOWN = 3;

/** "YYYY-MM-DD" and a real calendar day. */
export function validDay(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

export function addDays(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Control characters out (line breaks stay in prompts), runs of spaces folded, length capped.
const clean = (s, max, { lines = false } = {}) => String(s ?? "")
  .replace(/\r\n?/g, "\n")
  .replace(lines ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/ ?\n ?/g, "\n")
  .trim()
  .slice(0, max);

/**
 * Check what a teacher sent for one day's question.
 * `today` is the server's own day, only used to bound how far off the day can be.
 * → { value: { day, prompt, choices, answer, explanation } } or { error }.
 */
export function validateDaily(body, today) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (!validDay(b.day)) return { error: "Pick a valid day." };
  if (b.day < addDays(today, -2) || b.day > addDays(today, 60)) return { error: "Pick a day within the next two months." };

  const prompt = clean(b.prompt, MAX_PROMPT, { lines: true });
  if (!prompt) return { error: "Write the question." };

  const raw = Array.isArray(b.choices) ? b.choices : [];
  if (raw.length < MIN_CHOICES || raw.length > MAX_CHOICES) return { error: `Give between ${MIN_CHOICES} and ${MAX_CHOICES} options.` };
  const choices = raw.map((c) => clean(c, MAX_CHOICE));
  if (choices.some((c) => !c)) return { error: "Fill in every option, or remove the empty ones." };
  const seen = new Set(choices.map((c) => c.toLowerCase()));
  if (seen.size !== choices.length) return { error: "Each option must be different." };

  if (!Number.isInteger(b.answer) || b.answer < 0 || b.answer >= choices.length) return { error: "Mark which option is correct." };

  const explanation = clean(b.explanation, MAX_EXPLANATION, { lines: true });
  return { value: { day: b.day, prompt, choices, answer: b.answer, explanation } };
}

/** Per-option answer counts from rows of { choice, n }. */
export function countsFrom(rows, nChoices) {
  const counts = new Array(nChoices).fill(0);
  for (const r of rows || []) if (Number.isInteger(r.choice) && r.choice >= 0 && r.choice < nChoices) counts[r.choice] += r.n;
  return counts;
}

/** The spread as whole percentages of those who answered — or null while too few have. */
export function shownSpread(counts, minShown = MIN_SHOWN) {
  const answered = counts.reduce((a, b) => a + b, 0);
  if (answered < minShown) return null;
  const pct = counts.map((n) => Math.round((100 * n) / answered));
  return { counts, pct, answered };
}

/**
 * How many question days in a row the class has kept up, counting a day once at
 * least `threshold` of its members answered. Days with no question are skipped
 * (the teacher didn't post at the weekend); a day that had one and fell short
 * ends the run. Today, if still short, is treated as not over yet.
 * `days` is [{ day, answered, members }].
 */
export function classStreak(days, today, { threshold = 0.5 } = {}) {
  const list = (days || []).filter((d) => d.day <= today).sort((a, b) => (a.day < b.day ? 1 : -1));
  const good = (d) => d.members > 0 && d.answered / d.members >= threshold;
  if (list[0]?.day === today && !good(list[0])) list.shift();
  let n = 0;
  for (const d of list) { if (!good(d)) break; n++; }
  return n;
}
