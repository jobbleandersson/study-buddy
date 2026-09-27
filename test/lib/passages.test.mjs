import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { derivePassages, passageFor, stimulusText, passageContext } from "../../js/lib/passages.js";

const TEXT1 = "Letzten Sommer sind meine Familie und ich für zwei Wochen nach Österreich gefahren. Wir haben die Berge besucht.";
const TEXT2 = "Was mir am besten gefallen hat, war das Essen. Kaiserschmarrn ist ein süßer Pfannkuchen mit Rosinen.";
const qs = [
  { id: "q1", prompt: `Läs texten: "${TEXT1}"\n\nNär gjorde familjen resan?` },
  { id: "q2", prompt: "Samma text. Hur länge var de i Österrike?" },
  { id: "q3", prompt: "Samma text. Vad besökte de?" },
  { id: "q4", prompt: `Fortsättning: "${TEXT2}"\n\nVad tyckte skribenten bäst om?` },
  { id: "q5", prompt: 'Samma text. Vad är "Kaiserschmarrn" enligt texten?' },
  { id: "q6", prompt: "Vad heter Österrikes huvudstad?" },
];

describe("derivePassages", () => {
  test("the opening question carries its own text; the 'Samma text' follow-ups get it", () => {
    const p = derivePassages(qs);
    assert.equal(p[0], null);
    assert.equal(p[1], TEXT1);
    assert.equal(p[2], TEXT1);
  });

  test("a continuation shows the earlier text, and later follow-ups get both parts", () => {
    const p = derivePassages(qs);
    assert.equal(p[3], TEXT1);
    assert.equal(p[4], `${TEXT1}\n\n${TEXT2}`);
  });

  test("an unrelated question gets nothing", () => {
    assert.equal(derivePassages(qs)[5], null);
  });

  test("a new opener replaces the old text", () => {
    const NEW = "Ein ganz anderer Text über Hunde, der lang genug ist, um als Text zu zählen, ja.";
    const p = derivePassages([...qs, { id: "q7", prompt: `Läs texten: "${NEW}"\n\nVad handlar den om?` }, { id: "q8", prompt: "Samma text. Vem?" }]);
    assert.equal(p[7], NEW);
  });

  test("English and other 'same text' wordings are recognised", () => {
    const en = [
      { id: "a", prompt: 'Read the text: "It was a cold, grey morning and the whole town was still asleep under the fog."\n\nWhat was the weather like?' },
      { id: "b", prompt: "Same text. Who was awake?" },
      { id: "c", prompt: "Same passage: why was it quiet?" },
    ];
    const p = derivePassages(en);
    assert.match(p[1], /cold, grey morning/);
    assert.match(p[2], /cold, grey morning/);
  });

  test("'Läs texten igen' and 'Read the text again' count as follow-ups", () => {
    const sv = [
      { id: "a", prompt: `Läs texten: "${TEXT1}"\n\nVad?` },
      { id: "b", prompt: "Läs texten igen.\n\nHur var vädret?" },
      { id: "c", prompt: "Läs texten (se ovan).\n\nVad är huvudtanken?" },
      { id: "d", prompt: "Läs texten igen (se föregående fråga).\n\nVilket argument?" },
      { id: "e", prompt: "Read the text again. Who wrote it?" },
    ];
    assert.deepEqual(derivePassages(sv).slice(1), [TEXT1, TEXT1, TEXT1, TEXT1]);
  });

  test("a question that just says 'enligt texten' is trusted only after an explicit follow-up", () => {
    const withFollow = [
      { id: "a", prompt: `Läs texten: "${TEXT1}"\n\nVad?` },
      { id: "b", prompt: "Samma text. Vem?" },
      { id: "c", prompt: "På vilka två sätt gör de det, enligt texten?" },
    ];
    assert.equal(derivePassages(withFollow)[2], TEXT1);
    const without = [withFollow[0], withFollow[2]];
    assert.equal(derivePassages(without)[1], null);
  });

  test("an essay question that only mentions 'en text' is not given the passage", () => {
    const qs2 = [
      { id: "a", prompt: `Läs texten: "${TEXT1}"\n\nVad?` },
      { id: "b", prompt: "Samma text. Vem?" },
      { id: "c", prompt: `Läs texten: "${TEXT2}"\n\nVad?` },
      { id: "d", prompt: "En elev skriver en utredande text om skolmat. Vad bör texten INTE göra?" },
    ];
    assert.equal(derivePassages(qs2)[3], null);
  });

  test("a follow-up with no text before it gets null rather than nonsense", () => {
    assert.deepEqual(derivePassages([{ id: "a", prompt: "Samma text. Vad?" }]), [null]);
  });

  test("copes with missing input", () => {
    assert.deepEqual(derivePassages(undefined), []);
    assert.deepEqual(derivePassages([{ id: "a" }, null]), [null, null]);
  });
});

describe("passageFor", () => {
  const set = { id: "s", questions: qs };
  test("finds the text by question id, wherever the question is shown", () => {
    assert.equal(passageFor(set, qs[2]), TEXT1);
    assert.equal(passageFor(set, { ...qs[2] }), TEXT1);
    assert.equal(passageFor(set, qs[0]), null);
  });

  test("a question with its own stimulus is left to that", () => {
    const withStim = { id: "q2", prompt: "Samma text. Vad?", stimulus: { body: "x" } };
    assert.equal(passageFor({ questions: [qs[0], withStim] }, withStim), null);
  });

  test("unknown questions and missing sets give null", () => {
    assert.equal(passageFor(set, { id: "nope" }), null);
    assert.equal(passageFor(null, qs[1]), null);
  });

  test("notices when the set's questions change", () => {
    const list = qs.slice();
    assert.equal(passageFor({ questions: list }, qs[1]), TEXT1);
    list.splice(0, 1);
    assert.equal(passageFor({ questions: list }, qs[1]), null);
  });
});

describe("stimulusText and passageContext", () => {
  test("a passage stimulus, with its title", () => {
    assert.equal(stimulusText({ stimulus: { title: "Tåg", body: "Texten här." } }), "Tåg\nTexten här.");
  });

  test("KVA columns, NOG statements and a figure description", () => {
    assert.match(stimulusText({ stimulus: { quantities: ["x+1", "x-1"], given: "x > 0" } }), /Quantity I: x\+1\nQuantity II: x-1\nGiven: x > 0/);
    assert.equal(stimulusText({ stimulus: { statements: ["(1) a", "(2) b"] } }), "(1) a\n(2) b");
    assert.equal(stimulusText({ figure: { alt: "Ett stapeldiagram" } }), "Figure: Ett stapeldiagram");
  });

  test("passageContext prefers the question's own stimulus, else the shared text", () => {
    const set = { id: "s", questions: qs };
    assert.equal(passageContext(set, qs[1]), TEXT1);
    assert.equal(passageContext(set, { id: "z", stimulus: { body: "Egen" } }), "Egen");
    assert.equal(passageContext(set, qs[5]), "");
  });
});
