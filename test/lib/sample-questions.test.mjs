import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { blankQuestions, isUntouchedSample } from "../../js/lib/blank-questions.js";
import { weakSpotQuestions } from "../../js/lib/mastery.js";

describe("starter questions", () => {
  test("a new one is a sample until its question is rewritten", () => {
    const [q] = blankQuestions(1);
    assert.equal(isUntouchedSample(q), true);
    q.answer = 1;                       // a new answer alone does not make it the student's own
    assert.equal(isUntouchedSample(q), true);
    q.prompt = "Vad är 2 + 2?";
    assert.equal(isUntouchedSample(q), false);
  });

  test("questions that were never samples, and older sets without the mark, are real", () => {
    assert.equal(isUntouchedSample({ prompt: "Exempelfråga 1 — redigera mig" }), false);
    assert.equal(isUntouchedSample({ prompt: "Vad är fotosyntes?", sample: "Exempelfråga 1" }), false);
    assert.equal(isUntouchedSample(null), false);
  });

  test("weak spots never pick a sample, even on a topic that is weak", () => {
    const sample = { id: "s1", topic: "bråk", kind: "text", prompt: "Exempelfråga 1", sample: "Exempelfråga 1" };
    const real = { id: "r1", topic: "bråk", kind: "text", prompt: "Vad är 1/2 + 1/4?" };
    const attempts = [{ finishedAt: 1, items: [{ questionId: "r1", topic: "bråk", correct: false, firstTry: false }] }];
    const picked = weakSpotQuestions([{ id: "a", questions: [sample, real] }], attempts).map((w) => w.question.id);
    assert.deepEqual(picked, ["r1"], "the real question on the weak topic is picked, the sample is not");
  });
});
