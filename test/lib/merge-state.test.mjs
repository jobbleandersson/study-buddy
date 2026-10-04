import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeStates, looksLikeBackup } from "../../js/lib/merge-state.js";

const NOW = 1_800_000_000_000;
const set = (id, title, updatedAt) => ({ id, title, questions: [], ...(updatedAt ? { updatedAt } : {}) });

describe("mergeStates: sets and tests", () => {
  test("a set edited on this device after the server's copy keeps the edit", () => {
    const out = mergeStates({ assignments: [set("a", "Old", 100)] }, { assignments: [set("a", "Renamed", 200)] }, NOW);
    assert.deepEqual(out.assignments.map((a) => a.title), ["Renamed"]);
  });
  test("the server's newer copy wins over an older local one", () => {
    const out = mergeStates({ assignments: [set("a", "Server", 300)] }, { assignments: [set("a", "Local", 200)] }, NOW);
    assert.equal(out.assignments[0].title, "Server");
  });
  test("without stamps the server's copy stays, and sets only one side has are kept", () => {
    const out = mergeStates({ assignments: [set("a", "S")] }, { assignments: [set("a", "L"), set("b", "New")] }, NOW);
    assert.deepEqual(out.assignments.map((a) => [a.id, a.title]), [["a", "S"], ["b", "New"]]);
  });
  test("tests follow the same rule", () => {
    const out = mergeStates({ exams: [{ id: "e", date: "2026-10-05", updatedAt: 1 }] }, { exams: [{ id: "e", date: "2026-10-09", updatedAt: 2 }] }, NOW);
    assert.equal(out.exams[0].date, "2026-10-09");
  });
});

describe("mergeStates: settings", () => {
  test("the later settings change wins", () => {
    const out = mergeStates({ settings: { sound: true }, settingsAt: 10 }, { settings: { sound: false }, settingsAt: 20 }, NOW);
    assert.equal(out.settings.sound, false);
  });
  test("an untouched local side leaves the server's settings", () => {
    const out = mergeStates({ settings: { sound: true }, settingsAt: 10 }, { settings: { sound: false } }, NOW);
    assert.equal(out.settings.sound, true);
  });
});

describe("mergeStates: review schedule", () => {
  test("a miss on this device isn't undone by the server's older, longer run of hits", () => {
    const server = { srs: { q1: { reps: 4, dueAt: NOW + 9e8, reviewedAt: 100 } } };
    const local = { srs: { q1: { reps: 0, dueAt: NOW + 6e5, reviewedAt: 200 } } };
    assert.equal(mergeStates(server, local, NOW).srs.q1.reps, 0);
  });
  test("records from before reviewedAt still keep the one with more history", () => {
    const out = mergeStates({ srs: { q1: { reps: 1, dueAt: 5 } } }, { srs: { q1: { reps: 3, dueAt: 1 } } }, NOW);
    assert.equal(out.srs.q1.reps, 3);
  });
});

describe("mergeStates: in-progress sessions", () => {
  test("a session finished on this device doesn't come back from the server's older copy", () => {
    const server = { sessions: { a: { items: { q1: {} }, savedAt: NOW - 5000 } } };
    const local = { sessions: {}, sessionsCleared: { a: NOW - 1000 } };
    const out = mergeStates(server, local, NOW);
    assert.deepEqual(out.sessions, {});
    assert.equal(out.sessionsCleared.a, NOW - 1000);
  });
  test("a session saved again after it was cleared is kept", () => {
    const server = { sessions: { a: { items: {}, savedAt: NOW - 100 } }, sessionsCleared: { a: NOW - 1000 } };
    assert.ok(mergeStates(server, {}, NOW).sessions.a);
  });
  test("old marks are dropped after a month", () => {
    const out = mergeStates({ sessionsCleared: { a: NOW - 40 * 86400000 } }, {}, NOW);
    assert.deepEqual(out.sessionsCleared, {});
  });
  test("otherwise the session that got further wins", () => {
    const server = { sessions: { a: { items: { q1: {} }, savedAt: 1 } } };
    const local = { sessions: { a: { items: { q1: {}, q2: {} }, savedAt: 0 } } };
    assert.equal(Object.keys(mergeStates(server, local, NOW).sessions.a.items).length, 2);
  });
});

describe("mergeStates: streak freezes", () => {
  test("a freeze spent on one device stays spent", () => {
    const server = { activity: { freezes: 2, frozenDays: [] } };
    const local = { activity: { freezes: 1, frozenDays: ["2026-10-01"] } };
    assert.equal(mergeStates(server, local, NOW).activity.freezes, 1);
  });
});

describe("mergeStates: unions", () => {
  test("attempts from both sides are kept once, in order", () => {
    const out = mergeStates({ attempts: [{ id: "x", finishedAt: 2 }] }, { attempts: [{ id: "y", finishedAt: 1 }, { id: "x", finishedAt: 2 }] }, NOW);
    assert.deepEqual(out.attempts.map((a) => a.id), ["y", "x"]);
  });
  test("an array or junk on either side doesn't throw", () => {
    assert.doesNotThrow(() => mergeStates([1, 2], "x", NOW));
    assert.doesNotThrow(() => mergeStates({ srs: { q: null }, sessions: { a: null } }, { srs: { q: 5 } }, NOW));
  });
});

describe("looksLikeBackup", () => {
  test("a real export is accepted", () => {
    assert.equal(looksLikeBackup({ version: 7, assignments: [], attempts: [], subjects: [], settings: {} }), true);
  });
  test("a shared set, a library file, an array or junk are refused", () => {
    assert.equal(looksLikeBackup({ "studybuddy.set": 1, title: "X", questions: [{}] }), false);
    assert.equal(looksLikeBackup({ id: "lib-x", title: "X", questions: [] }), false);
    assert.equal(looksLikeBackup([{ assignments: [] }]), false);
    assert.equal(looksLikeBackup(null), false);
    assert.equal(looksLikeBackup({ assignments: [], attempts: [], settings: [] }), false);
  });
});
