import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { firstSentence } from "../../js/lib/text.js";

describe("text.firstSentence", () => {
  test("returns the first sentence, dropping the rest", () => {
    assert.equal(firstSentence("Först. Sedan mer."), "Först.");
    assert.equal(firstSentence("Ask. Then! Continue?"), "Ask.");
  });

  test("does not include the whitespace after the punctuation", () => {
    assert.equal(firstSentence("Hej.   Då."), "Hej.");
  });

  test("! and ? end a sentence too", () => {
    assert.equal(firstSentence("Vänta! Vad menar du?"), "Vänta!");
    assert.equal(firstSentence("Vad då? Jag förstår inte."), "Vad då?");
  });

  test("repeated punctuation (an ellipsis) only splits after the last mark", () => {
    assert.equal(firstSentence("Vänta... Vad då?"), "Vänta...");
  });

  test("text with no sentence-ending punctuation at all is returned whole", () => {
    assert.equal(firstSentence("Ingen punkt här"), "Ingen punkt här");
  });

  test("a single sentence with no trailing whitespace (end of string) is returned whole", () => {
    assert.equal(firstSentence("Hello there!"), "Hello there!");
  });

  test("punctuation with no following whitespace mid-string (not a sentence break) does not split", () => {
    assert.equal(firstSentence("abc.def ghi"), "abc.def ghi");
  });

  test("a decimal number or abbreviation is not mistaken for a sentence end when nothing follows it", () => {
    assert.equal(firstSentence("Pi är 3.14 ungefär"), "Pi är 3.14 ungefär");
  });

  test("empty and nullish input", () => {
    assert.equal(firstSentence(""), "");
    assert.equal(firstSentence(null), "");
    assert.equal(firstSentence(undefined), "");
  });

  test("matches the same real explanation text ruleHint() works with", () => {
    const text = "Att subtrahera ett negativt tal är samma sak som att addera: $-7-(-2)=-5$.";
    assert.equal(firstSentence(text), "Att subtrahera ett negativt tal är samma sak som att addera: $-7-(-2)=-5$.");
  });
});
