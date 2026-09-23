import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { estimatedGrade, gradeRank } from "../../js/lib/grade.js";

describe("grade.estimatedGrade", () => {
  test("boundaries map to the documented letters", () => {
    assert.equal(estimatedGrade(0).letter, "F");
    assert.equal(estimatedGrade(0.39).letter, "F");
    assert.equal(estimatedGrade(0.40).letter, "E");
    assert.equal(estimatedGrade(0.54).letter, "E");
    assert.equal(estimatedGrade(0.55).letter, "D");
    assert.equal(estimatedGrade(0.69).letter, "D");
    assert.equal(estimatedGrade(0.70).letter, "C");
    assert.equal(estimatedGrade(0.84).letter, "C");
    assert.equal(estimatedGrade(0.85).letter, "B");
    assert.equal(estimatedGrade(0.94).letter, "B");
    assert.equal(estimatedGrade(0.95).letter, "A");
    assert.equal(estimatedGrade(1.0).letter, "A");
  });

  test("tiers are low/mid/high as documented", () => {
    assert.equal(estimatedGrade(0.1).tier, "low");
    assert.equal(estimatedGrade(0.6).tier, "mid");
    assert.equal(estimatedGrade(0.99).tier, "high");
  });
});

describe("grade.gradeRank", () => {
  test("ranks F through A in increasing order", () => {
    const ranks = ["F", "E", "D", "C", "B", "A"].map(gradeRank);
    for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] > ranks[i - 1]);
  });
});
