import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { segmentByLanguage } from "../../js/lib/lang-detect.js";
import { languageRuns } from "../../js/lib/speech.js";

const shape = (runs) => runs.map((r) => [r.code, r.text]);
const codes = (text, home = "sv") => segmentByLanguage(text, home).map((r) => r.code);

describe("segmentByLanguage: one language", () => {
  test("a Swedish text is one Swedish run, an English one one English run", () => {
    assert.deepEqual(shape(segmentByLanguage("Jag vill ha ett svar på det här.")), [["sv", "Jag vill ha ett svar på det här."]]);
    assert.deepEqual(codes("Choose the correct answer and read the text."), ["en"]);
  });

  test("German and French are recognised too", () => {
    assert.deepEqual(codes("Ich habe einen Hund und eine Katze."), ["de"]);
    assert.deepEqual(codes("Je suis allé à la maison avec mon ami."), ["fr"]);
  });

  test("text with no evidence at all (numbers, maths, names) stays in the home language", () => {
    assert.deepEqual(shape(segmentByLanguage("x = 4")), [["sv", "x = 4"]]);
    assert.deepEqual(shape(segmentByLanguage("x = 4", "en")), [["en", "x = 4"]]);
    assert.deepEqual(shape(segmentByLanguage("...")), [["sv", "..."]]);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(segmentByLanguage(""), []);
    assert.deepEqual(segmentByLanguage("   "), []);
    assert.deepEqual(segmentByLanguage(null), []);
  });
});

describe("segmentByLanguage: the language changes inside a text", () => {
  test("an English phrase inside a Swedish sentence gets its own run", () => {
    assert.deepEqual(shape(segmentByLanguage("Vad betyder how are you på svenska?")), [
      ["sv", "Vad betyder "], ["en", "how are you "], ["sv", "på svenska?"],
    ]);
  });

  test("a quoted foreign word is enough on its own, and the quotes stay with it", () => {
    assert.deepEqual(shape(segmentByLanguage('Vad betyder "perro" på svenska?')), [
      ["sv", "Vad betyder "], ["es", '"perro" '], ["sv", "på svenska?"],
    ]);
  });

  test("an English sentence followed by a Spanish one: the ¿ goes with the Spanish", () => {
    assert.deepEqual(shape(segmentByLanguage("The Spanish sentence is: ¿Dónde está la biblioteca?")), [
      ["en", "The Spanish sentence is: "], ["es", "¿Dónde está la biblioteca?"],
    ]);
  });

  test("a whole foreign sentence in the middle of a text gets its own run", () => {
    assert.deepEqual(shape(segmentByLanguage("Jag heter Lars. Thank you very much. Hej då.")), [
      ["sv", "Jag heter Lars. "], ["en", "Thank you very much. "], ["sv", "Hej då."],
    ]);
  });

  test("it works the other way round: a Swedish sentence in English text (home = en)", () => {
    assert.deepEqual(shape(segmentByLanguage("Set the scene. Jag vill ha svar på det.", "en")), [
      ["en", "Set the scene. "], ["sv", "Jag vill ha svar på det."],
    ]);
  });
});

describe("segmentByLanguage: it does not switch on thin evidence", () => {
  test("one stray foreign word inside a sentence does not change the voice", () => {
    assert.deepEqual(codes("Jag läste the Times igår"), ["sv"]);
    assert.deepEqual(codes("The word hund means dog.", "en"), ["en"]);
  });

  test("nor do two foreign words mid-sentence; a phrase of three does", () => {
    assert.deepEqual(codes("Jag sa you are där"), ["sv"]);
    assert.deepEqual(codes("Jag sa how are you där"), ["sv", "en", "sv"]);
  });

  test("Swedish 'hund' is only in the German list, so it alone must not make Swedish read as German", () => {
    assert.deepEqual(codes("En hund."), ["sv"]);
    assert.deepEqual(codes("Ich habe einen Hund."), ["de"]);      // with real German around it, it is German
  });

  test("a one-word foreign sentence between Swedish ones stays Swedish (too little to be sure)", () => {
    assert.deepEqual(codes("Jag heter Lars. Thank you. Hej då."), ["sv"]);
  });

  test("one letter is never evidence", () => {
    assert.deepEqual(codes("A. B. C."), ["sv"]);
    assert.deepEqual(codes("Svara med a eller b."), ["sv"]);
  });

  test("a spelling only one language uses is strong evidence by itself", () => {
    assert.deepEqual(codes("Jag vet. ¿Dónde? Nej."), ["sv", "es", "sv"]);
    assert.deepEqual(codes("Straße", "sv"), ["de"]);
  });
});

describe("segmentByLanguage: the runs are the text", () => {
  const SAMPLES = [
    "Vad betyder how are you på svenska?",
    'Vad betyder "perro" på svenska?',
    "The Spanish sentence is: ¿Dónde está la biblioteca?",
    "Jag heter Lars. Thank you very much. Hej då.",
    "Ich habe einen Hund und eine Katze. Det var allt.",
    "  leading space, 12 + 3 = 15 (och trailing)  ",
    "Hola, ¿cómo estás? Jag mår bra, tack.",
  ];

  test("joined together they are exactly the original, so nothing is dropped or repeated", () => {
    for (const s of SAMPLES) assert.equal(segmentByLanguage(s).map((r) => r.text).join(""), s, s);
  });

  test("neighbouring runs are always in different languages, and none is empty", () => {
    for (const s of SAMPLES) {
      const runs = segmentByLanguage(s);
      runs.forEach((r, i) => {
        assert.ok(r.text.length > 0, s);
        if (i) assert.notEqual(r.code, runs[i - 1].code, s);
      });
    }
  });
});

describe("languageRuns: which runs use the student's own voice", () => {
  test("the interface language has bcp null; any other carries the locale to find a voice for", () => {
    assert.deepEqual(languageRuns("Vad betyder how are you på svenska?", "sv"), [
      { text: "Vad betyder ", bcp: null }, { text: "how are you ", bcp: "en-GB" }, { text: "på svenska?", bcp: null },
    ]);
    assert.deepEqual(languageRuns('Vad betyder "perro" på svenska?', "sv").map((r) => r.bcp), [null, "es-ES", null]);
  });

  test("with an English interface, Swedish is the foreign language", () => {
    assert.deepEqual(languageRuns("Set the scene. Jag vill ha svar på det.", "en").map((r) => r.bcp), [null, "sv-SE"]);
  });

  test("a text wholly in another language than the interface has no run for the student's voice", () => {
    assert.deepEqual(languageRuns("Choose the correct answer and read the text.", "sv"), [
      { text: "Choose the correct answer and read the text.", bcp: "en-GB" },
    ]);
  });
});
