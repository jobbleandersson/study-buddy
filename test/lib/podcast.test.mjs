import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseScript, estimateMinutes, scriptKey, loadScript, saveScript, MIN_LINES, MAX_LINES, MAX_CACHED } from "../../js/lib/podcast.js";

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const lines = (n) => Array.from({ length: n }, (_, i) => ({ who: i % 2 ? "S" : "A", text: `Rad ${i}` }));

describe("parseScript", () => {
  test("reads { title, lines } and keeps the speakers", () => {
    const s = parseScript({ title: "Om vikingatiden", lines: lines(6) });
    assert.equal(s.title, "Om vikingatiden");
    assert.equal(s.lines.length, 6);
    assert.deepEqual(s.lines.slice(0, 2).map((l) => l.who), ["A", "S"]);
  });

  test("accepts a bare array and speaker names in different spellings", () => {
    const s = parseScript([{ who: "Alex", text: "a" }, { who: "Sam", text: "b" }, { who: "alex", text: "c" }, { who: "S", text: "d" }]);
    assert.deepEqual(s.lines.map((l) => l.who), ["A", "S", "A", "S"]);
  });

  test("lines with no speaker alternate", () => {
    const s = parseScript(["ett", "två", "tre", "fyra"]);
    assert.deepEqual(s.lines.map((l) => l.who), ["A", "S", "A", "S"]);
  });

  test("strips markdown so it is not read out, and drops empty lines", () => {
    const s = parseScript({ lines: [{ who: "A", text: "**Fet** och _kursiv_ och `kod`" }, { who: "S", text: "   " }, ...lines(4)] });
    assert.equal(s.lines[0].text, "Fet och kursiv och kod");
    assert.equal(s.lines.length, 5);
  });

  test("too short, or not a script at all, throws", () => {
    assert.throws(() => parseScript({ lines: lines(MIN_LINES - 1) }));
    assert.throws(() => parseScript({ nope: true }));
    assert.throws(() => parseScript(null));
  });

  test("caps the number of lines and the length of each", () => {
    const s = parseScript({ lines: [...lines(60), { who: "A", text: "x".repeat(2000) }] });
    assert.equal(s.lines.length, MAX_LINES);
    const long = parseScript({ lines: [{ who: "A", text: "x".repeat(2000) }, ...lines(4)] });
    assert.ok(long.lines[0].text.length <= 400);
  });
});

describe("estimateMinutes", () => {
  test("about 150 words a minute, never less than one", () => {
    assert.equal(estimateMinutes([{ text: "kort" }]), 1);
    assert.equal(estimateMinutes([{ text: "ord ".repeat(600) }]), 4);
    assert.equal(estimateMinutes([]), 1);
  });
});

describe("script cache", () => {
  const set = { id: "s1", title: "Vikingatiden", questions: [{ prompt: "Vilket år?" }, { prompt: "Vem?" }] };

  test("the key changes when the set's content or the language changes", () => {
    const k = scriptKey(set);
    assert.equal(scriptKey({ ...set, questions: [...set.questions] }), k);
    assert.notEqual(scriptKey({ ...set, title: "Annat" }), k);
    assert.notEqual(scriptKey({ ...set, questions: [{ prompt: "Vilket år?" }] }), k);
    assert.notEqual(scriptKey(set, "en"), k);
  });

  test("saves and loads a script, and a corrupt entry reads as missing", () => {
    const s = mem();
    const script = parseScript({ title: "T", lines: lines(5) });
    assert.equal(loadScript("a", s), null);
    saveScript("a", script, s, 1);
    assert.equal(loadScript("a", s).lines.length, 5);
    s.setItem("studify.talks.v1", "{oops");
    assert.equal(loadScript("a", s), null);
  });

  test("keeps only the most recent few", () => {
    const s = mem();
    const script = parseScript({ lines: lines(5) });
    for (let i = 0; i < MAX_CACHED + 3; i++) saveScript(`k${i}`, script, s, i + 1);
    assert.equal(loadScript("k0", s), null);
    assert.ok(loadScript(`k${MAX_CACHED + 2}`, s));
  });
});
