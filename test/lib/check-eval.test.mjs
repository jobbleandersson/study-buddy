import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  EVAL_MODELS, costUsd, expectation, verdictFor, closeness, compareRuns, needsJudge, summarise, toCsv, flaggedText,
} from "../../js/lib/check-eval.js";

const [H, S] = EVAL_MODELS.map((m) => m.id);
const checked = (firstError, extra = {}) => ({
  result: {
    status: "checked", firstError, answerCorrect: firstError == null ? true : false,
    lines: [{ n: 1, text: "3x + 5 = 20" }, { n: 2, text: "3x = 15" }, { n: 3, text: "x = 5" }], ...extra,
  },
  ms: 4000, usage: { input_tokens: 2000, output_tokens: 1500 }, cost: 0.01,
});
const declined = (status = "unreadable") => ({ result: { status, firstError: null, lines: [] }, ms: 3000, usage: { input_tokens: 1500, output_tokens: 100 }, cost: 0.001 });
const failed = () => ({ error: "request failed", ms: 500 });

describe("expectation", () => {
  test("ok = every line follows, line = first wrong line, anything else = no key", () => {
    assert.deepEqual(expectation("ok"), { firstError: null });
    assert.deepEqual(expectation("line", "3"), { firstError: 3 });
    assert.deepEqual(expectation("line", 2.4), { firstError: 2 });
    for (const bad of [["", ""], ["line", ""], ["line", "   "], ["line", "0"], ["line", 0], ["line", null], ["x", 3], ["x", "-3x = 6"], [undefined, undefined]]) {
      assert.equal(expectation(...bad), null, JSON.stringify(bad));
    }
  });

  test("the wrong line can be given as what it says, which needs no line numbering", () => {
    assert.deepEqual(expectation("line", " -3x = 6 "), { firstError: 0, text: "-3x = 6" });
    assert.deepEqual(expectation("line", "x = 4.0"), { firstError: 0, text: "x = 4.0" });
    assert.deepEqual(expectation("line", "100"), { firstError: 0, text: "100" });    // three digits is text, not a line number
  });
});

describe("flaggedText", () => {
  test("the text of the line flagged as the first mistake, else empty", () => {
    assert.equal(flaggedText(checked(2).result), "3x = 15");
    assert.equal(flaggedText(checked(null).result), "");
    assert.equal(flaggedText(declined().result), "");
    assert.equal(flaggedText(null), "");
    assert.equal(flaggedText(checked(9).result), "");        // a number past the last line
  });
});

describe("the same line under a different number", () => {
  // The case that fooled the first version: the problem is line 1 for one model and not counted by the other.
  const lines = ["7 - 3x = 1", "-3x = 6", "x = -2"];
  const withProblem = { result: { status: "checked", firstError: 2, answerCorrect: false, lines: lines.map((text) => ({ text })) }, ms: 1, usage: {}, cost: 0 };
  const withoutProblem = { result: { status: "checked", firstError: 1, answerCorrect: false, lines: lines.slice(1).map((text) => ({ text })) }, ms: 1, usage: {}, cost: 0 };

  test("two models pointing at the same line agree even when they number it differently", () => {
    const cmp = compareRuns(withProblem, withoutProblem);
    assert.equal(cmp.disagree, false);
    assert.equal(needsJudge({ runs: { [H]: withProblem, [S]: withoutProblem } }), false);
  });

  test("a key given as the line's text matches either numbering; a key given as a number does not", () => {
    const byText = expectation("line", "-3x = 6");
    assert.equal(verdictFor(byText, withProblem), "correct");
    assert.equal(verdictFor(byText, withoutProblem), "correct");
    const byNumber = expectation("line", 2);
    assert.equal(verdictFor(byNumber, withProblem), "correct");
    assert.equal(verdictFor(byNumber, withoutProblem), "wrong_line");
  });

  test("a different line is still a different line, and a slightly different transcription still matches", () => {
    const other = { result: { status: "checked", firstError: 3, lines: lines.map((text) => ({ text })) } };
    assert.equal(verdictFor(expectation("line", "-3x = 6"), other), "wrong_line");
    assert.equal(compareRuns(withProblem, other).disagree, true);
    const misread = { result: { status: "checked", firstError: 2, lines: [{ text: "7 - 3x = 1" }, { text: "-3x = 6." }, { text: "x = -2" }] } };
    assert.equal(verdictFor(expectation("line", "-3x = 6"), misread), "correct");
  });

  test("with a text key, 'missed' and 'false flag' work as before", () => {
    assert.equal(verdictFor(expectation("line", "-3x = 6"), checked(null)), "missed");
    assert.equal(verdictFor(expectation("ok"), withProblem), "false_flag");
  });
});

describe("verdictFor: one model against the answer key", () => {
  test("every line correct: pointing at nothing is right, pointing at a line is a false flag", () => {
    const key = expectation("ok");
    assert.equal(verdictFor(key, checked(null)), "correct");
    assert.equal(verdictFor(key, checked(2)), "false_flag");
  });

  test("a real mistake on line 2: right line, missed, or the wrong line", () => {
    const key = expectation("line", 2);
    assert.equal(verdictFor(key, checked(2)), "correct");
    assert.equal(verdictFor(key, checked(null)), "missed");
    assert.equal(verdictFor(key, checked(3)), "wrong_line");
    assert.equal(verdictFor(key, checked(1)), "wrong_line");
  });

  test("without a key a result is just 'no_key'; a decline or a failure is reported even then", () => {
    assert.equal(verdictFor(null, checked(2)), "no_key");
    assert.equal(verdictFor(null, declined()), "abstained");
    assert.equal(verdictFor(expectation("ok"), declined("not_working")), "abstained");
    assert.equal(verdictFor(expectation("ok"), failed()), "error");
    assert.equal(verdictFor(expectation("ok"), undefined), "pending");
  });
});

describe("compareRuns: would the student have been told something different?", () => {
  test("same first error = agree; different line or one says all fine = disagree", () => {
    assert.equal(compareRuns(checked(2), checked(2)).disagree, false);
    assert.equal(compareRuns(checked(null), checked(null)).disagree, false);
    assert.equal(compareRuns(checked(2), checked(3)).disagree, true);
    assert.equal(compareRuns(checked(null), checked(2)).disagree, true);
  });

  test("one declining to judge while the other judged is a disagreement; both declining is not", () => {
    assert.equal(compareRuns(declined(), checked(2)).disagree, true);
    assert.equal(compareRuns(declined(), declined()).disagree, false);
    assert.equal(compareRuns(declined("unreadable"), declined("not_working")).disagree, true);
  });

  test("a run that failed cannot be compared", () => {
    assert.equal(compareRuns(failed(), checked(2)), null);
    assert.equal(compareRuns(checked(2), undefined), null);
  });

  test("the final answer verdict and the line count are reported separately", () => {
    const a = checked(2, { answerCorrect: true });
    const b = checked(2, { answerCorrect: false, lines: [{ text: "x" }] });
    const cmp = compareRuns(a, b);
    assert.equal(cmp.disagree, false);          // same line pointed at
    assert.equal(cmp.sameAnswer, false);
    assert.equal(cmp.lineDelta, -2);
  });
});

describe("closeness", () => {
  test("ignores spacing, case and the different dash and times characters", () => {
    assert.equal(closeness("3x + 5 = 20", "3X+5=20"), 1);
    assert.equal(closeness("x − 4", "x - 4"), 1);
    assert.equal(closeness("2 × 3", "2*3"), 1);
  });
  test("is lower for different text, 0 against nothing, 1 for two empties", () => {
    assert.ok(closeness("x = 5", "x = 7") < 1);
    assert.ok(closeness("x = 5", "x = 7") > 0.5);
    assert.equal(closeness("abc", ""), 0);
    assert.equal(closeness("", ""), 1);
  });
});

describe("needsJudge", () => {
  test("only when both ran and disagree", () => {
    assert.equal(needsJudge({ runs: { [H]: checked(2), [S]: checked(3) } }), true);
    assert.equal(needsJudge({ runs: { [H]: checked(2), [S]: checked(2) } }), false);
    assert.equal(needsJudge({ runs: { [H]: checked(2) } }), false);
    assert.equal(needsJudge({ runs: { [H]: failed(), [S]: checked(2) } }), false);
    assert.equal(needsJudge({}), false);
  });
});

describe("costUsd", () => {
  test("Sonnet 5 and Haiku 5.5 are priced like the server prices them", () => {
    // 2,000 in + 1,500 out
    assert.ok(Math.abs(costUsd(S, { input_tokens: 2000, output_tokens: 1500 }) - (2000 * 2 + 1500 * 10) / 1e6) < 1e-12);
    assert.ok(Math.abs(costUsd(H, { input_tokens: 2000, output_tokens: 1500 }) - (2000 * 0.1 + 1500 * 0.5) / 1e6) < 1e-12);
  });
  test("Haiku 5.5 switches to its higher rate above a 100K-token prompt", () => {
    assert.ok(Math.abs(costUsd(H, { input_tokens: 200_000, output_tokens: 1000 }) - (200_000 * 0.5 + 1000 * 2.5) / 1e6) < 1e-9);
  });
  test("an unknown model or missing usage costs 0 rather than throwing", () => {
    assert.equal(costUsd("nope", { input_tokens: 5, output_tokens: 5 }), 0);
    assert.equal(costUsd(S, null), 0);
    assert.equal(costUsd(S, {}), 0);
  });
  test("Haiku is far cheaper than Sonnet for the same call", () => {
    const u = { input_tokens: 2500, output_tokens: 1500 };
    assert.ok(costUsd(S, u) > 15 * costUsd(H, u));
  });
});

describe("summarise", () => {
  const cases = [
    { name: "a", expected: expectation("ok"), runs: { [H]: checked(null), [S]: checked(null) } },                  // both right
    { name: "b", expected: expectation("line", 2), runs: { [H]: checked(null), [S]: checked(2) }, judge: S },      // Haiku missed it
    { name: "c", expected: expectation("ok"), runs: { [H]: checked(3), [S]: checked(null) }, judge: S },           // Haiku false flag
    { name: "d", expected: null, runs: { [H]: checked(2), [S]: checked(2) } },                                      // no key, agree
    { name: "e", expected: expectation("line", 1), runs: { [H]: declined(), [S]: checked(1) } },                    // Haiku declined
    { name: "f", expected: expectation("ok"), runs: { [H]: failed() } },                                            // half run
  ];
  const s = summarise(cases);

  test("per-model counts follow the verdicts", () => {
    const h = s.models[H], so = s.models[S];
    assert.equal(h.ran, 6); assert.equal(so.ran, 5);
    assert.equal(h.scored, 3); assert.equal(h.correct, 1); assert.equal(h.missed, 1); assert.equal(h.falseFlags, 1);
    assert.equal(h.abstained, 1); assert.equal(h.errors, 1);
    assert.equal(so.scored, 4); assert.equal(so.correct, 4); assert.equal(so.falseFlags, 0);
  });

  test("agreement counts only photos both models completed; each disagreement is judged or not", () => {
    assert.equal(s.agreement.comparable, 5);
    assert.equal(s.agreement.same, 2);                  // a and d
    assert.equal(s.disagreements, 3);                   // b, c, e
    assert.equal(s.judged[S], 2);
    assert.equal(s.judged.unjudged, 1);                 // e has no judge yet
    assert.equal(s.finished, 5);
  });

  test("cost and time add up per model, and tokens sum input + output", () => {
    assert.ok(Math.abs(s.models[H].cost - 0.01 * 4 - 0.001 - 0) < 1e-12);   // 4 checked + 1 declined; the failed run has no cost
    assert.equal(s.models[S].tokens, 5 * 3500);
    assert.equal(s.models[H].msTotal, 4000 * 4 + 3000 + 500);
  });

  test("an empty list is all zeros", () => {
    const e = summarise([]);
    assert.equal(e.cases, 0); assert.equal(e.models[H].ran, 0); assert.equal(e.disagreements, 0); assert.equal(e.agreement.comparable, 0);
  });
});

describe("toCsv", () => {
  test("one header row, one row per photo, with the key, verdicts and judgement", () => {
    const csv = toCsv([{ name: "page1.jpg", expected: expectation("line", 2), judge: "both", runs: { [H]: checked(2), [S]: checked(3) } }]);
    const [head, row] = csv.split("\n");
    assert.match(head, /^photo,answer_key,Haiku 5\.5 status,/);
    assert.match(head, /models_disagree,who_was_right$/);
    assert.match(row, /^page1\.jpg,line 2,checked,2,3x = 15,correct,4\.0,0\.0100,checked,3,x = 5,wrong_line,4\.0,0\.0100,yes,both$/);
    assert.match(head, /Haiku 5\.5 flagged_line/);
  });

  test("a text key is written as the line's text", () => {
    const row = toCsv([{ name: "p.jpg", expected: expectation("line", "-3x = 6"), runs: {} }]).split("\n")[1];
    assert.ok(row.startsWith("p.jpg,line -3x = 6,"));
  });

  test("quotes and commas in a file name or error are escaped", () => {
    const csv = toCsv([{ name: 'a "b", c.jpg', expected: null, runs: { [H]: failed(), [S]: failed() } }]);
    const row = csv.split("\n")[1];
    assert.ok(row.startsWith('"a ""b"", c.jpg",'));
    assert.match(row, /error: request failed/);
  });

  test("a photo that has not run yet has empty cells and no verdict", () => {
    const row = toCsv([{ name: "x.jpg", expected: null, runs: {} }]).split("\n")[1];
    // name, key, then per model: status, first_error, flagged_line, verdict, seconds, usd; then disagree, judge
    assert.equal(row, ["x.jpg", "", "", "", "", "pending", "", "", "", "", "", "pending", "", "", "", ""].join(","));
  });
});
