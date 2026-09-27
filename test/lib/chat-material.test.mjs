import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { materialFromSet, materialFromText, materialSystemBlock, extractSourceRefs, MATERIAL_MAX_CHARS } from "../../js/lib/chat-material.js";

const set = {
  id: "s1", title: "Cellandning", sourceSummary: "Kapitel 3 om cellandning.",
  questions: [
    { kind: "mc", topic: "glykolys", prompt: "Var sker glykolysen?", choices: ["Cytoplasman", "Kärnan"], answer: 0, explanation: "Den sker utanför mitokondrien." },
    { kind: "text", topic: "atp", prompt: "Vad står ATP för?", answer: "Adenosintrifosfat" },
    { kind: "cloze", topic: "atp", prompt: "Cellen bildar {{ATP|energi}} i mitokondrien." },
  ],
};

describe("materialFromSet", () => {
  test("numbers every question and includes its answer and explanation", () => {
    const m = materialFromSet(set);
    assert.equal(m.kind, "set");
    assert.equal(m.count, 3);
    assert.equal(m.used, 3);
    assert.match(m.text, /^Cellandning\nKapitel 3 om cellandning\.\nÄmnen: glykolys, atp/);
    assert.match(m.text, /F1 \(glykolys\): Var sker glykolysen\? \| Svar: Cytoplasman \| Förklaring: Den sker utanför mitokondrien\./);
    assert.match(m.text, /F2 \(atp\): Vad står ATP för\? \| Svar: Adenosintrifosfat/);
  });

  test("a cloze question shows its answer in place of the blank", () => {
    assert.match(materialFromSet(set).text, /F3 \(atp\): Cellen bildar ATP i mitokondrien\./);
  });

  test("stops at the size limit and says how many questions fit", () => {
    const big = { title: "Stor", questions: Array.from({ length: 200 }, (_, i) => ({ kind: "text", prompt: `Fråga nummer ${i} med lite text runtomkring den`, answer: "svar" })) };
    const m = materialFromSet(big);
    assert.ok(m.text.length <= MATERIAL_MAX_CHARS);
    assert.ok(m.used > 10 && m.used < 200);
    assert.equal(m.count, 200);
    assert.ok(!m.text.includes(`F${m.used + 1}:`));
  });

  test("copes with an empty or missing set", () => {
    assert.equal(materialFromSet({ title: "Tom", questions: [] }).used, 0);
    assert.equal(materialFromSet(undefined).count, 0);
  });
});

describe("materialFromText", () => {
  test("cleans whitespace, caps the length and flags a cut", () => {
    const m = materialFromText("anteckningar.txt", "rad   ett\n\n\n\nrad två");
    assert.equal(m.text, "rad ett\n\nrad två");
    assert.equal(m.cut, false);
    const long = materialFromText("stor.pdf", "x".repeat(MATERIAL_MAX_CHARS + 50));
    assert.equal(long.text.length, MATERIAL_MAX_CHARS);
    assert.equal(long.cut, true);
  });
});

describe("materialSystemBlock", () => {
  test("empty without material", () => {
    assert.equal(materialSystemBlock(null), "");
    assert.equal(materialSystemBlock({ text: "" }), "");
  });

  test("a set asks for [F4] references; a file does not", () => {
    const setBlock = materialSystemBlock(materialFromSet(set));
    assert.match(setBlock, /\[F4\]/);
    assert.match(setBlock, /<material>\nCellandning/);
    assert.match(setBlock, /<\/material>$/);
    assert.ok(!materialSystemBlock(materialFromText("a.txt", "hej")).includes("[F4]"));
  });
});

describe("extractSourceRefs", () => {
  test("removes the markers and lists the questions, once each and in order", () => {
    const r = extractSourceRefs("Glykolysen sker i cytoplasman [F1]. ATP är energi [F7][F2] [F1].");
    assert.equal(r.text, "Glykolysen sker i cytoplasman. ATP är energi.");
    assert.deepEqual(r.refs, [1, 2, 7]);
  });

  test("drops numbers beyond what the assistant was shown", () => {
    assert.deepEqual(extractSourceRefs("Ja [F2] och [F99]", 5).refs, [2]);
    assert.equal(extractSourceRefs("Ja [F99]", 5).text, "Ja");
  });

  test("hides a marker that is still being streamed", () => {
    assert.equal(extractSourceRefs("Det stämmer [F").text, "Det stämmer");
    assert.equal(extractSourceRefs("Det stämmer [F1").text, "Det stämmer");
    assert.equal(extractSourceRefs("Ett [hakparentes] stannar").text, "Ett [hakparentes] stannar");
  });

  test("text without markers is unchanged", () => {
    assert.deepEqual(extractSourceRefs("Inget här."), { text: "Inget här.", refs: [] });
  });
});
