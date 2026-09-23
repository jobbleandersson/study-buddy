import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeAnswer, tokenize, heuristic } from "../../js/lib/answer-match.js";

describe("answer-match.normalizeAnswer", () => {
  test("keeps å/ä/ö intact while lowercasing", () => {
    assert.equal(normalizeAnswer("Fotosyntes Är Bra"), "fotosyntes är bra");
    assert.equal(normalizeAnswer("ÅNGMASKINEN"), "ångmaskinen");
  });

  test("strips trailing sentence punctuation", () => {
    assert.equal(normalizeAnswer("Det är rätt."), "det är rätt");
    assert.equal(normalizeAnswer("Vad då?!"), "vad då");
  });

  test("collapses internal whitespace and trims", () => {
    assert.equal(normalizeAnswer("  hej   där  "), "hej där");
  });

  test("normalizes curly quotes to straight ones", () => {
    assert.equal(normalizeAnswer("‘hej’"), "'hej'");
    assert.equal(normalizeAnswer("“hej”"), '"hej"');
  });

  test("removes thousands spaces in numbers", () => {
    assert.equal(normalizeAnswer("2 880"), "2880");
  });

  test("converts a Swedish decimal comma to a dot in numeric tokens", () => {
    assert.equal(normalizeAnswer("0,5"), "0.5");
  });

  test("leaves a real prose comma alone", () => {
    assert.equal(normalizeAnswer("Rom, Italien"), "rom, italien");
  });

  test("handles null/undefined without throwing", () => {
    assert.equal(normalizeAnswer(undefined), "");
    assert.equal(normalizeAnswer(null), "");
  });
});

describe("answer-match.tokenize", () => {
  test("keeps å/ä/ö-containing words as whole tokens", () => {
    assert.deepEqual(tokenize("fotosyntesen är viktig"), ["fotosyntesen", "viktig"]);
  });

  test("drops words of length <= 3", () => {
    assert.deepEqual(tokenize("en två stora hus"), ["stora"]);
  });
});

describe("answer-match.heuristic", () => {
  test("an empty model answer is always marked wrong", () => {
    assert.equal(heuristic("anything", "").correct, false);
    assert.equal(heuristic("anything", null).correct, false);
  });

  test("short model answers (<=3 words) require an exact normalized match", () => {
    assert.equal(heuristic("19", "19").correct, true);
    assert.equal(heuristic("19.0", "19").correct, false);
    assert.equal(heuristic("12 Ω", "12 Ω").correct, true);
    assert.equal(heuristic("20", "19").correct, false);
  });

  test("long model answers use keyword overlap, tolerating rephrasing", () => {
    const model = "Växter omvandlar ljusenergi till kemisk energi genom fotosyntes i sina blad";
    const good = heuristic("Fotosyntes gör att växter omvandlar ljusenergi till kemisk energi", model);
    assert.equal(good.correct, true);
    const bad = heuristic("Vet inte", model);
    assert.equal(bad.correct, false);
  });

  test("a long model answer with an unrelated long answer is rejected even though it isn't short", () => {
    const model = "Växter omvandlar ljusenergi till kemisk energi genom fotosyntes i sina blad";
    const out = heuristic("Detta handlar om helt andra saker som inte alls är relaterade till frågan", model);
    assert.equal(out.correct, false);
  });
});
