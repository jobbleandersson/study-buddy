// "Kolla min uträkning" — cleaning what the model returns. Pure, so it can be
// tested without a browser or a key. The model's JSON is never trusted for its
// shape: every field is checked, trimmed and capped before the view sees it.

export const MAX_LINES = 20;
export const MAX_HINTS = 3;

const STATUSES = ["checked", "unreadable", "not_working"];

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * @returns {{
 *   status: "checked"|"unreadable"|"not_working", reason: string, problem: string,
 *   lines: {n:number, text:string, ok:boolean|null, note:string}[], unclear: string,
 *   firstError: number|null, answerCorrect: boolean|null, praise: string,
 *   hints: string[], solution: string, allGood: boolean }}
 * `firstError` is the 1-based number of the flagged line in `lines`, or null.
 */
export function normalizeCheck(raw) {
  const j = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  let status = STATUSES.includes(j.status) ? j.status : "checked";

  // Keep the model's own numbering next to each line while we clean the list,
  // because `firstError` refers to it and dropping an empty line shifts positions.
  const cleaned = [];
  (Array.isArray(j.lines) ? j.lines : []).slice(0, MAX_LINES).forEach((l, i) => {
    const text = str(l?.text, 300);
    if (!text) return;
    cleaned.push({
      origN: Number.isInteger(l?.n) ? l.n : i + 1,
      text,
      ok: l?.ok === true ? true : l?.ok === false ? false : null,
      note: str(l?.note, 300),
    });
  });
  const lines = cleaned.map((l, i) => ({ n: i + 1, text: l.text, ok: l.ok, note: l.note }));

  // Which line is the first that doesn't follow? Trust `firstError` when it points
  // at a real line; otherwise fall back to the first line the model marked not ok.
  let firstError = null;
  if (status === "checked" && lines.length) {
    const byOrig = cleaned.findIndex((l) => l.origN === j.firstError);
    if (Number.isInteger(j.firstError) && byOrig >= 0) firstError = byOrig + 1;
    else if (Number.isInteger(j.firstError) && j.firstError >= 1 && j.firstError <= lines.length) firstError = j.firstError;
    else {
      const bad = lines.findIndex((l) => l.ok === false);
      if (bad >= 0) firstError = bad + 1;
    }
  }
  // One line is flagged, and the ones before it follow.
  lines.forEach((l) => {
    if (firstError == null) { if (l.ok === false) l.ok = null; return; }
    if (l.n < firstError) l.ok = true;
    else if (l.n === firstError) l.ok = false;
    else l.ok = null;                     // after the slip: not judged
  });

  const hints = (Array.isArray(j.hints) ? j.hints : []).map((h) => str(h, 400)).filter(Boolean).slice(0, MAX_HINTS);

  // A "checked" answer with nothing to show can't be checked at all.
  let reason = str(j.reason, 400);
  if (status === "checked" && !lines.length) { status = "unreadable"; reason = reason || ""; }

  return {
    status,
    reason,
    problem: str(j.problem, 400),
    lines,
    unclear: str(j.unclear, 300),
    firstError,
    answerCorrect: j.answerCorrect === true ? true : j.answerCorrect === false ? false : null,
    praise: str(j.praise, 300),
    hints: firstError == null ? [] : hints,
    solution: str(j.solution, 3000),
    allGood: status === "checked" && lines.length > 0 && firstError == null,
  };
}

/**
 * "About 1 in n of this month's allowance": what one check cost, as a share of
 * the whole budget, rounded so it reads as an estimate. null when either
 * number is missing (signed out, or an unmetered server).
 */
export function budgetShare(tokens, limit) {
  if (!(tokens > 0) || !(limit > 0)) return null;
  const n = limit / tokens;
  if (n < 2) return 1;
  return n >= 25 ? Math.round(n / 5) * 5 : Math.round(n);
}
