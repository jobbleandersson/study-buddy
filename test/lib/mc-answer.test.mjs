import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveMcAnswer } from "../../js/lib/mc-answer.js";

const CITIES = ["Berlin", "Rom", "Madrid", "Oslo", "Paris"];

describe("resolveMcAnswer", () => {
  test("answerIndex, as the prompt asks, wins", () => {
    assert.equal(resolveMcAnswer({ answerIndex: 2, answer: "Berlin" }, CITIES), 2);
    assert.equal(resolveMcAnswer({ answerIndex: 0 }, CITIES), 0);
  });

  test("the answer written as text, ignoring case and spaces", () => {
    assert.equal(resolveMcAnswer({ answer: "Paris" }, CITIES), 4);
    assert.equal(resolveMcAnswer({ answer: "  oslo " }, CITIES), 3);
  });

  test("the answer as a letter, in the forms models write it", () => {
    for (const [a, i] of [["C", 2], ["c", 2], ["C)", 2], ["c.", 2], ["(D)", 3], ["Option B", 1], ["Alternativ E", 4], ["svar A", 0]]) {
      assert.equal(resolveMcAnswer({ answer: a }, CITIES), i, a);
    }
  });

  test("a number, bare or in quotes, is the 0-based index", () => {
    assert.equal(resolveMcAnswer({ answer: 3 }, CITIES), 3);
    assert.equal(resolveMcAnswer({ answer: "1" }, CITIES), 1);
  });

  test("an option that is itself a letter keeps that meaning", () => {
    assert.equal(resolveMcAnswer({ answer: "B" }, ["A", "B", "C"]), 1);
    assert.equal(resolveMcAnswer({ answer: "C" }, ["C", "A", "B"]), 0, "the text 'C' is the first option, not the letter C");
  });

  test("what cannot be read is -1, never the first option", () => {
    assert.equal(resolveMcAnswer({}, CITIES), -1);
    assert.equal(resolveMcAnswer({ answer: "" }, CITIES), -1);
    assert.equal(resolveMcAnswer({ answer: "Lisbon" }, CITIES), -1);
    assert.equal(resolveMcAnswer({ answer: "K" }, CITIES), -1);
    assert.equal(resolveMcAnswer({ answerIndex: 9 }, CITIES), -1);
    assert.equal(resolveMcAnswer({ answerIndex: -1, answer: 7 }, CITIES), -1);
    assert.equal(resolveMcAnswer({ answer: "F" }, CITIES.slice(0, 3)), -1, "a letter past the options");
    assert.equal(resolveMcAnswer({ answer: { text: "Paris" } }, CITIES), -1);
    assert.equal(resolveMcAnswer(null, CITIES), -1);
  });

  test("an out-of-range answerIndex falls back to the written-out answer", () => {
    assert.equal(resolveMcAnswer({ answerIndex: 5, answer: "Oslo" }, CITIES), 3);
  });
});
