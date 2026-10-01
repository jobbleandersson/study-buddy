import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractSetBrief, normalizeBrief, withSetId, pickMaterial, generationParams,
  COUNT_MIN, COUNT_MAX, COUNT_DEFAULT,
} from "../../js/lib/set-brief.js";
import { setCreationRules, solveChatSystem, studyChatSystem } from "../../js/prompts.js";

const MARKER = '[[MAKE_SET {"title":"Cellens delar","subject":"Biologi","topic":"cellens organeller","focus":"","level":"åk 8","count":8,"flashcards":false,"fromNotes":false}]]';

describe("extractSetBrief", () => {
  test("splits a reply into what the student reads and the proposed set", () => {
    const { text, brief } = extractSetBrief(`Bra, då gör jag ett set om cellen.\n${MARKER}`);
    assert.equal(text, "Bra, då gör jag ett set om cellen.");
    assert.deepEqual(brief, {
      title: "Cellens delar", subject: "Biologi", topic: "cellens organeller", focus: "", level: "åk 8",
      count: 8, flashcards: false, fromNotes: false,
    });
  });

  test("a reply with no marker is returned untouched, with no brief", () => {
    assert.deepEqual(extractSetBrief("Vill du att jag gör ett övningsset av det här?"), {
      text: "Vill du att jag gör ett övningsset av det här?", brief: null,
    });
    assert.deepEqual(extractSetBrief(""), { text: "", brief: null });
    assert.deepEqual(extractSetBrief(null), { text: "", brief: null });
  });

  test("a marker that is still streaming in is hidden, at every length, and gives no brief yet", () => {
    for (const tail of ["[[", "[[M", "[[MAKE_", "[[MAKE_SET", '[[MAKE_SET {"title":"Cel', '[[MAKE_SET {"title":"Cellen"}', MARKER.slice(0, -2)]) {
      const out = extractSetBrief(`Då gör jag det.\n${tail}`);
      assert.equal(out.text, "Då gör jag det.", JSON.stringify(tail));
      assert.equal(out.brief, null, JSON.stringify(tail));
    }
  });

  test("ordinary text that merely contains [[ is left alone", () => {
    assert.equal(extractSetBrief("Matrisen är [[1,2],[3,4]] och klar.").text, "Matrisen är [[1,2],[3,4]] och klar.");
    assert.equal(extractSetBrief("Se [[1]] och [[2]].").text, "Se [[1]] och [[2]].");
  });

  test("a marker with broken JSON is hidden, not shown as raw text", () => {
    const out = extractSetBrief('Okej.\n[[MAKE_SET {title: Cellen, count: }]]');
    assert.equal(out.text, "Okej.");
    assert.equal(out.brief, null);
  });

  test("only the first marker counts, and text after it is kept", () => {
    const out = extractSetBrief(`${MARKER}\nExtra rad.`);
    assert.equal(out.brief.title, "Cellens delar");
    assert.equal(out.text, "Extra rad.");
  });
});

describe("normalizeBrief: the model's words are clamped", () => {
  test("count is rounded and kept between 3 and 15; a missing one defaults", () => {
    assert.equal(normalizeBrief({ topic: "x", count: 1 }).count, COUNT_MIN);
    assert.equal(normalizeBrief({ topic: "x", count: 500 }).count, COUNT_MAX);
    assert.equal(normalizeBrief({ topic: "x", count: 7.6 }).count, 8);
    assert.equal(normalizeBrief({ topic: "x", count: "9" }).count, 9);
    assert.equal(normalizeBrief({ topic: "x" }).count, COUNT_DEFAULT);
    assert.equal(normalizeBrief({ topic: "x", count: "lots" }).count, COUNT_DEFAULT);
    assert.equal(normalizeBrief({ topic: "x", count: null }).count, COUNT_DEFAULT);
  });

  test("long strings are capped and whitespace collapsed", () => {
    const b = normalizeBrief({ title: "T".repeat(200), topic: "a\n\n  b", focus: "f".repeat(900), subject: "S".repeat(99), level: "L".repeat(99) });
    assert.equal(b.title.length, 60);
    assert.equal(b.topic, "a b");
    assert.equal(b.focus.length, 300);
    assert.equal(b.subject.length, 40);
    assert.equal(b.level.length, 40);
  });

  test("flags are real booleans: only true counts, never a truthy string", () => {
    assert.equal(normalizeBrief({ topic: "x", flashcards: "true", fromNotes: 1 }).flashcards, false);
    assert.equal(normalizeBrief({ topic: "x", flashcards: "true", fromNotes: 1 }).fromNotes, false);
    assert.equal(normalizeBrief({ topic: "x", flashcards: true, fromNotes: true }).flashcards, true);
  });

  test("a title with no topic, or a topic with no title, fills in the other", () => {
    assert.equal(normalizeBrief({ title: "Cellen" }).topic, "Cellen");
    assert.equal(normalizeBrief({ topic: "Fotosyntes och cellandning" }).title, "Fotosyntes och cellandning");
  });

  test("nothing to build from -> null; non-objects -> null", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { count: 8 }, { title: "  ", topic: "" }]) assert.equal(normalizeBrief(bad), null, JSON.stringify(bad));
  });

  test("markup in a field stays plain text (it is rendered with textContent, never as HTML)", () => {
    assert.equal(normalizeBrief({ topic: "<img src=x onerror=alert(1)>" }).topic, "<img src=x onerror=alert(1)>");
  });
});

describe("withSetId", () => {
  test("writes the created set's id into the marker, and it survives a round trip", () => {
    const raw = `Då kör vi.\n${MARKER}`;
    const marked = withSetId(raw, "a1b2");
    assert.ok(marked.startsWith("Då kör vi.\n[[MAKE_SET "));
    assert.equal(extractSetBrief(marked).brief.setId, "a1b2");
    assert.equal(extractSetBrief(marked).brief.title, "Cellens delar");
    assert.equal(extractSetBrief(marked).text, "Då kör vi.");
  });

  test("a reply without a marker, or with a broken one, is returned unchanged", () => {
    assert.equal(withSetId("Hej", "x"), "Hej");
    assert.equal(withSetId("[[MAKE_SET {oops}]]", "x"), "[[MAKE_SET {oops}]]");
  });

  test("a $ in the id or text cannot corrupt the replacement", () => {
    assert.equal(extractSetBrief(withSetId(MARKER, "$&$1")).brief.setId, "$&$1");
  });
});

describe("pickMaterial", () => {
  const long = "Cellen är livets minsta enhet. ".repeat(20);

  test("attached material wins", () => {
    assert.equal(pickMaterial({ brief: { fromNotes: false }, material: { text: "bilagan" }, messages: [] }), "bilagan");
  });

  test("with fromNotes, the longest pasted passage is used - not a short question", () => {
    const messages = [
      { role: "user", content: "gör ett set av mina anteckningar" },
      { role: "assistant", content: "x".repeat(900) },
      { role: "user", content: long },
      { role: "user", content: "ok" },
    ];
    assert.equal(pickMaterial({ brief: { fromNotes: true }, messages }), long.slice(0, 8000));
  });

  test("an assistant message is never taken as the student's notes", () => {
    assert.equal(pickMaterial({ brief: { fromNotes: true }, messages: [{ role: "assistant", content: long }] }), "");
  });

  test("without fromNotes, or with only short messages, there is no material", () => {
    assert.equal(pickMaterial({ brief: { fromNotes: false }, messages: [{ role: "user", content: long }] }), "");
    assert.equal(pickMaterial({ brief: { fromNotes: true }, messages: [{ role: "user", content: "kort" }] }), "");
  });

  test("a message with an image reads its text part", () => {
    const content = [{ type: "image", source: {} }, { type: "text", text: long }];
    assert.equal(pickMaterial({ brief: { fromNotes: true }, messages: [{ role: "user", content }] }), long.slice(0, 8000));
  });

  test("a very long paste is cut to the notes limit", () => {
    assert.equal(pickMaterial({ brief: { fromNotes: true }, messages: [{ role: "user", content: "a".repeat(20000) }] }).length, 8000);
  });
});

describe("generationParams", () => {
  const brief = normalizeBrief({ title: "Cellens delar", subject: "Biologi", topic: "cellens organeller", focus: "mest förståelsefrågor", level: "åk 8", count: 10, flashcards: true });

  test("maps the brief onto generateAssignment's arguments", () => {
    const p = generationParams(brief, "anteckningar");
    assert.equal(p.count, 10);
    assert.equal(p.gradeHint, "åk 8");
    assert.equal(p.preferFlashcards, true);
    assert.equal(p.material, "anteckningar");
  });

  test("the topic carries the subject, title and the student's extra wish", () => {
    const { topic } = generationParams(brief);
    assert.match(topic, /^cellens organeller/);
    assert.match(topic, /Working title: Cellens delar/);
    assert.match(topic, /mest förståelsefrågor/);
    assert.match(topic, /School subject: Biologi/);
  });

  test("an empty brief field adds no empty line", () => {
    const { topic } = generationParams(normalizeBrief({ topic: "bara ämnet" }));
    assert.equal(topic, "bara ämnet");
  });
});

describe("the system prompts", () => {
  test("both the default persona and every study mode carry the set rules", () => {
    const rules = setCreationRules();
    assert.ok(solveChatSystem().includes(rules));
    for (const mode of [null, "quiz", "explain", "summarise", "debate"]) assert.ok(studyChatSystem(mode).includes(rules), String(mode));
  });

  test("they ask questions before creating, and offer a set only once and only when it helps", () => {
    const r = setCreationRules();
    assert.match(r, /do NOT create it straight away/);
    assert.match(r, /First ask 2-4 short questions/);
    assert.match(r, /Never write the marker before the student has answered/);
    assert.match(r, /Offer ONCE/);
    assert.match(r, /single homework problem/);
  });

  test("the marker shape in the prompt is one the parser accepts", () => {
    const example = setCreationRules().match(/\[\[MAKE_SET [^\n]*\]\]/)[0];
    const { brief, text } = extractSetBrief(example);
    assert.equal(text, "");
    assert.ok(brief && brief.count === 8 && brief.title === "short title");
  });
});
