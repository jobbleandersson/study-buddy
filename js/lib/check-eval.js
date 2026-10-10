// Scoring for the "Kolla min uträkning" model comparison (views/check-eval.js): the same photo goes to two
// models and this decides, per photo and across all of them, whether the cheaper one can do the job.
//
// What decides it is not how the two differ on a transcription (they will, in punctuation) but the three
// things a student would feel: did it point at the right line, did it flag correct work as wrong (a false
// "this line is wrong" costs trust), did it miss a real slip. So a photo can carry an answer key
// ("all correct" or "first error on line 3"), and where the models disagree you judge which one was right.
//
// Pure: no DOM, store or network, so it can be unit-tested. A case looks like
//   { id, name, expected: null | { firstError: null | n }, judge: null | modelId | "both" | "neither",
//     runs: { [modelId]: { result, error, ms, usage, cost } } }
// where `result` is what checkWorking() returned (lib/check.js normalizeCheck + usage).

/** The two models compared, cheapest first. The ids are what the proxy accepts. */
export const EVAL_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
];

// USD per million tokens - a copy of server/src/usage.js PRICE_PER_MTOK for these two models, so the tool can
// show what a run cost without a round trip. If the server's prices change, change them here too.
const PRICE_PER_MTOK = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, long: { from: 100_000, in: 0.5, out: 2.5 } },
};

/** Dollars for one request's `usage` ({ input_tokens, output_tokens } as Anthropic returns it). */
export function costUsd(model, usage) {
  const p = PRICE_PER_MTOK[model];
  if (!p || !usage) return 0;
  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const rate = p.long && input > p.long.from ? p.long : p;
  return (input * rate.in + output * rate.out) / 1e6;
}

/** Two flagged lines count as the same line when they read alike (handwriting transcribes a touch differently). */
export const SAME_LINE = 0.8;

/** What the person says the right answer is: kind "" = don't know, "ok" = every line follows, "line" = the
 *  first line that doesn't follow, given as a line NUMBER ("2") or, better, as what the line SAYS ("-3x = 6").
 *  Text is better because models disagree on whether the problem itself is line 1 - they point at the same
 *  line and number it differently. Returns null when there is no answer key. */
export function expectation(kind, value) {
  if (kind === "ok") return { firstError: null };
  if (kind !== "line") return null;
  if (typeof value === "number") {
    const n = Math.round(value);
    return Number.isFinite(n) && n >= 1 ? { firstError: n } : null;
  }
  const v = String(value ?? "").trim();
  if (/^\d{1,2}$/.test(v)) { const n = Number(v); return n >= 1 ? { firstError: n } : null; }
  return v ? { firstError: 0, text: v } : null;            // firstError 0 = "no number; match by the text"
}

/** The text of the line a result flagged as the first mistake ("" when it flagged none). */
export function flaggedText(r) {
  return r && r.status === "checked" && r.firstError != null ? String(r.lines?.[r.firstError - 1]?.text ?? "") : "";
}

/** One model's run against the answer key. */
export function verdictFor(expected, run) {
  if (!run) return "pending";
  if (run.error || !run.result) return "error";
  const r = run.result;
  if (r.status !== "checked") return "abstained";          // "unreadable" / "not_working": it declined to judge
  if (!expected) return "no_key";
  if (expected.firstError == null) return r.firstError == null ? "correct" : "false_flag";
  if (r.firstError == null) return "missed";
  if (expected.text) return closeness(flaggedText(r), expected.text) >= SAME_LINE ? "correct" : "wrong_line";
  return r.firstError === expected.firstError ? "correct" : "wrong_line";
}

const squash = (s) => String(s ?? "").toLowerCase().replace(/[−–—]/g, "-").replace(/[×·]/g, "*").replace(/\s+/g, "");

/** 0..1 closeness of two strings (1 = identical once spacing, case and dash variants are ignored). */
export function closeness(a, b) {
  const x = squash(a), y = squash(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

const transcript = (r) => (r.lines || []).map((l) => l.text).join("\n");

/** How two models' answers on the same photo relate. `null` unless both produced a result. */
export function compareRuns(a, b) {
  if (!a?.result || !b?.result) return null;
  const x = a.result, y = b.result;
  const sameStatus = x.status === y.status;
  // The same line, whatever number each model gave it: they disagree on whether the problem is line 1.
  const sameLine = (a, b) => a.firstError === b.firstError || closeness(flaggedText(a), flaggedText(b)) >= SAME_LINE;
  const sameFirstError = x.status === "checked" && y.status === "checked"
    ? (x.firstError == null || y.firstError == null ? x.firstError === y.firstError : sameLine(x, y))
    : sameStatus;
  return {
    sameStatus,
    sameFirstError,
    // "Disagree" means the student would have been told something different about their working.
    disagree: !sameStatus || !sameFirstError,
    sameAnswer: x.answerCorrect === y.answerCorrect,
    lineDelta: (y.lines || []).length - (x.lines || []).length,
    transcription: closeness(transcript(x), transcript(y)),
  };
}

/** Does a case need a human to say who was right? Only when the models disagree. */
export function needsJudge(c, ids = EVAL_MODELS.map((m) => m.id)) {
  const cmp = compareRuns(c.runs?.[ids[0]], c.runs?.[ids[1]]);
  return !!cmp && cmp.disagree;
}

const blank = () => ({
  ran: 0, errors: 0, abstained: 0, scored: 0, correct: 0, falseFlags: 0, missed: 0, wrongLine: 0,
  msTotal: 0, cost: 0, tokens: 0,
});

/** Everything the summary panel shows. */
export function summarise(cases, ids = EVAL_MODELS.map((m) => m.id)) {
  const models = Object.fromEntries(ids.map((id) => [id, blank()]));
  const out = {
    cases: cases.length, finished: 0, models,
    agreement: { comparable: 0, same: 0 }, disagreements: 0,
    judged: { [ids[0]]: 0, [ids[1]]: 0, both: 0, neither: 0, unjudged: 0 },
  };
  for (const c of cases) {
    const runs = ids.map((id) => c.runs?.[id]);
    if (runs.every(Boolean)) out.finished += 1;
    ids.forEach((id, i) => {
      const run = runs[i];
      if (!run) return;
      const m = models[id];
      m.ran += 1;
      m.msTotal += run.ms || 0;
      m.cost += run.cost || 0;
      m.tokens += (Number(run.usage?.input_tokens) || 0) + (Number(run.usage?.output_tokens) || 0);
      const v = verdictFor(c.expected, run);
      if (v === "error") m.errors += 1;
      else if (v === "abstained") m.abstained += 1;
      else if (v !== "no_key" && v !== "pending") {
        m.scored += 1;
        if (v === "correct") m.correct += 1;
        else if (v === "false_flag") m.falseFlags += 1;
        else if (v === "missed") m.missed += 1;
        else if (v === "wrong_line") m.wrongLine += 1;
      }
    });
    const cmp = compareRuns(runs[0], runs[1]);
    if (cmp) {
      out.agreement.comparable += 1;
      if (!cmp.disagree) out.agreement.same += 1;
      else {
        out.disagreements += 1;
        const j = c.judge;
        if (j === ids[0] || j === ids[1] || j === "both" || j === "neither") out.judged[j] += 1;
        else out.judged.unjudged += 1;
      }
    }
  }
  return out;
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per photo, for a spreadsheet. */
export function toCsv(cases, models = EVAL_MODELS) {
  const head = ["photo", "answer_key"];
  for (const m of models) head.push(`${m.label} status`, `${m.label} first_error`, `${m.label} flagged_line`, `${m.label} verdict`, `${m.label} seconds`, `${m.label} usd`);
  head.push("models_disagree", "who_was_right");
  const rows = cases.map((c) => {
    const key = !c.expected ? "" : c.expected.firstError == null ? "all correct" : `line ${c.expected.text || c.expected.firstError}`;
    const cells = [c.name, key];
    for (const m of models) {
      const run = c.runs?.[m.id];
      const r = run?.result;
      cells.push(
        run?.error ? `error: ${run.error}` : r?.status || "",
        r?.status === "checked" ? (r.firstError == null ? "none" : r.firstError) : "",
        flaggedText(r),
        verdictFor(c.expected, run),
        run?.ms != null ? (run.ms / 1000).toFixed(1) : "",
        run?.cost != null ? run.cost.toFixed(4) : "",
      );
    }
    const cmp = compareRuns(c.runs?.[models[0].id], c.runs?.[models[1].id]);
    cells.push(cmp ? (cmp.disagree ? "yes" : "no") : "", c.judge || "");
    return cells;
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}
