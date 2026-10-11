import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CHECK_REVIEW_SYSTEM, reviewInput, parseReview, reviewAgrees, disagreementNote } from "../../js/lib/check-review.js";

const result = (firstError, extra = {}) => ({
  status: "checked", problem: "Solve 7 - 3x = 1", firstError, answerCorrect: firstError == null,
  lines: [{ n: 1, text: "7 - 3x = 1" }, { n: 2, text: "-3x = 6" }, { n: 3, text: "x = -2" }], ...extra,
});

describe("reviewInput: the reviewer sees the lines, never the verdict", () => {
  test("numbers the first pass's lines and includes the problem", () => {
    const s = reviewInput(result(2));
    assert.match(s, /The problem:\n"""\nSolve 7 - 3x = 1\n"""/);
    assert.match(s, /1\. 7 - 3x = 1\n2\. -3x = 6\n3\. x = -2/);
  });

  test("leaks nothing about which line the first pass flagged, or its notes and hints", () => {
    const s = reviewInput(result(2, { lines: [{ text: "7 - 3x = 1", ok: true }, { text: "-3x = 6", ok: false, note: "Här svänger det" }, { text: "x = -2" }], hints: ["tänk på tecknet"] }));
    assert.doesNotMatch(s, /firstError|ok|false|svänger|tecknet|hint/i);
  });

  test("a problem typed by the student wins over the first pass's reading of it", () => {
    assert.match(reviewInput(result(2), { problem: "7 − 3x = 1 (typed)" }), /7 − 3x = 1 \(typed\)/);
  });

  test("with no problem known it says the problem is on the page", () => {
    assert.match(reviewInput(result(null, { problem: "" })), /on the page/);
  });

  test("the system prompt asks for a blind recomputation and the numbering it was given", () => {
    assert.match(CHECK_REVIEW_SYSTEM, /judge those lines yourself, from scratch/);
    assert.match(CHECK_REVIEW_SYSTEM, /using the numbering you were given/);
    assert.match(CHECK_REVIEW_SYSTEM, /Recompute every step/);
  });
});

describe("parseReview", () => {
  test("reads a clean reply", () => {
    assert.deepEqual(parseReview('{"steps":[],"firstError":2,"answerCorrect":false,"misread":[3],"why":"Tecknet byts."}', 3),
      { firstError: 2, answerCorrect: false, misread: [3], why: "Tecknet byts." });
  });

  test("reads a reply wrapped in prose or a code fence", () => {
    assert.equal(parseReview('Sure:\n```json\n{"firstError": null, "answerCorrect": true}\n```', 3).firstError, null);
  });

  test("a line number given as a string still counts", () => {
    assert.equal(parseReview('{"firstError":"2"}', 3).firstError, 2);
  });

  test("an unusable reply is null: not JSON, no firstError, a line past the end, a non-whole line", () => {
    for (const bad of ["", "no", "[1,2]", '{"answerCorrect":true}', '{"firstError":7}', '{"firstError":0}', '{"firstError":1.5}', '{"firstError":"x"}', "{broken"]) {
      assert.equal(parseReview(bad, 3), null, bad);
    }
  });

  test("odd field values are tidied rather than trusted", () => {
    const r = parseReview('{"firstError":null,"answerCorrect":"yes","misread":["2","x",0],"why":5}', 3);
    assert.deepEqual(r, { firstError: null, answerCorrect: null, misread: [2], why: "" });
  });
});

describe("reviewAgrees", () => {
  test("same line, or both 'every line follows' = agree", () => {
    assert.equal(reviewAgrees(result(2), { firstError: 2 }), true);
    assert.equal(reviewAgrees(result(null), { firstError: null }), true);
  });

  test("a different line, or one sees a slip the other doesn't = disagree", () => {
    assert.equal(reviewAgrees(result(2), { firstError: 3 }), false);
    assert.equal(reviewAgrees(result(null), { firstError: 2 }), false);
    assert.equal(reviewAgrees(result(2), { firstError: null }), false);
  });

  test("no usable review never overrules the first pass", () => {
    assert.equal(reviewAgrees(result(2), null), true);
  });
});

describe("disagreementNote", () => {
  test("names both conclusions with the line's text, the reviewer's reason and any misread lines", () => {
    const s = disagreementNote(result(null), { firstError: 2, why: "−3x ska vara −6.", misread: [3] });
    assert.match(s, /One concluded that every line follows\./);
    assert.match(s, /The other concluded that line 2 is the first that does not follow \("-3x = 6"\) - −3x ska vara −6\. /);
    assert.doesNotMatch(s, /\.\./);
    assert.match(s, /line 3 may have been misread/);
    assert.match(s, /Either of them may be right, or neither\./);
  });

  test("works without a reason or misread lines", () => {
    const s = disagreementNote(result(2), { firstError: null, why: "", misread: [] });
    assert.match(s, /One concluded that line 2 is the first/);
    assert.match(s, /The other concluded that every line follows\./);
    assert.doesNotMatch(s, /misread/);
  });
});
