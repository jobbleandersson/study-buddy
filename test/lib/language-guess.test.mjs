import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { guessLang, openerFits } from "../../js/lib/language-guess.js";

const SV_Q = "I vilken ordning bör inledningen gå fram?";
const EN_OPENER = "Picture an hourglass: how does the introduction narrow as it moves toward your question?";
const SV_OPENER = "Tänk dig ett timglas: hur smalnar inledningen av när den närmar sig din frågeställning?";

describe("language guess", () => {
  test("Swedish and English sentences", () => {
    assert.equal(guessLang(SV_Q), "sv");
    assert.equal(guessLang(SV_OPENER), "sv");
    assert.equal(guessLang(EN_OPENER), "en");
    assert.equal(guessLang("What is the capital of France and why does it matter?"), "en");
    assert.equal(guessLang("Vad är huvudstaden i Frankrike?"), "sv");
  });

  test("too short, numbers and mixed texts are unknown", () => {
    assert.equal(guessLang(""), null);
    assert.equal(guessLang(undefined), null);
    assert.equal(guessLang("3/4 + 1/8 = ?"), null);
    assert.equal(guessLang("Photosynthesis"), null);
    assert.equal(guessLang("Vad betyder the apple?"), null);
  });

  test("an English opener does not stand under a Swedish question, nor the other way round", () => {
    assert.equal(openerFits(EN_OPENER, SV_Q), false);
    assert.equal(openerFits(SV_OPENER, "Which of these is a prime number, and how do you know?"), false);
  });

  test("a matching opener stays, and so does one when either side is unclear", () => {
    assert.equal(openerFits(SV_OPENER, SV_Q), true);
    assert.equal(openerFits(EN_OPENER, "Which of these is a prime number, and how do you know?"), true);
    assert.equal(openerFits(EN_OPENER, "3/4 + 1/8 = ?"), true);
    assert.equal(openerFits("Börja med nyckelordet.", "Photosynthesis"), true);
    assert.equal(openerFits(undefined, SV_Q), true);
  });
});
