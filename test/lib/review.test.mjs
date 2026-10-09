import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reviewItems, parseVerdicts, flaggedIndexes } from "../../js/lib/review.js";

const mc = { kind: "mc", prompt: "Vad är 3 · 4?", choices: ["7", "12", "14", "34"], answer: 1 };
const cloze = { kind: "cloze", prompt: "She {{has lived|lived}} here since 2015." };
const text = { kind: "text", prompt: "Vad bildas vid neutralisation?", answer: "Ett salt och vatten." };

describe("review", () => {
  test("the reviewer never sees a multiple-choice key; a cloze carries its answers, text its model answer", () => {
    const [a, b, c] = reviewItems([mc, cloze, text]);
    assert.equal(a.answer, undefined);
    assert.deepEqual(a.choices, mc.choices);
    assert.equal(b.answer, undefined);
    assert.match(b.prompt, /\{\{has lived\|lived\}\}/);
    assert.equal(c.answer, "Ett salt och vatten.");
    assert.deepEqual([a.i, b.i, c.i], [0, 1, 2]);
  });

  test("a blind answer that differs from the key, or any verdict but ok, is flagged", () => {
    const flagged = flaggedIndexes([mc, cloze, text], [
      { i: 0, answer: 2, verdict: "ok" },   // solved differently from the key
      { i: 1, verdict: "wrong", problem: "'lived' gives a wrong sentence" },
      { i: 2, verdict: "ok" },
    ]);
    assert.deepEqual(flagged, [0, 1]);
    assert.deepEqual(flaggedIndexes([mc], [{ i: 0, answer: 1, verdict: "ok" }]), []);
    assert.deepEqual(flaggedIndexes([mc], [{ i: 0, answer: 1, verdict: "unclear" }]), [0]);
  });

  test("a reply that judges too few questions is no review at all", () => {
    assert.equal(flaggedIndexes([mc, cloze, text], [{ i: 0, answer: 1, verdict: "ok" }]), null);
    assert.equal(flaggedIndexes([mc], null), null);
    // a skipped question is kept, not dropped
    assert.deepEqual(flaggedIndexes([mc, cloze, text], [{ i: 0, answer: 1, verdict: "ok" }, { i: 2, verdict: "ok" }]), []);
  });

  test("the verdict array is read out of a reply with prose or fences around it", () => {
    assert.deepEqual(parseVerdicts('Här är granskningen:\n```json\n[{"i":0,"answer":1,"verdict":"ok"}]\n```'), [{ i: 0, answer: 1, verdict: "ok" }]);
    assert.equal(parseVerdicts("no json here"), null);
    assert.equal(parseVerdicts("[not json]"), null);
  });
});
