import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coerceStateShape, cleanSettings } from "../../js/lib/state-shape.js";

const DEFAULTS = {
  preset: "balanced", tutorVerbosity: "normal", sound: true, dailyGoal: 10, testHints: 2, adaptive: true,
  pomodoro: "off", font: "system", textSize: "m", voice: false, hpDate: null,
};

describe("coerceStateShape", () => {
  test("the blob that gave a white page on every screen comes out with the right types", () => {
    const s = coerceStateShape({ version: 7, assignments: "x", attempts: 5, srs: [], settings: null, exams: 3 });
    assert.deepEqual(s.assignments, []);
    assert.deepEqual(s.attempts, []);
    assert.deepEqual(s.srs, {});
    assert.deepEqual(s.sessions, {});
    assert.deepEqual(s.activity.daysStudied, []);
    assert.deepEqual(s.subjects, [], "missing: Studera and Framsteg read it as a list");
    assert.equal(s.exams, 3, "exams is re-derived later in finishMigrate, not here");
  });

  test("a set whose questions aren't a list gets an empty list; broken entries are dropped", () => {
    const s = coerceStateShape({
      assignments: [null, 4, { title: "no id" }, { id: "a", questions: "nope" }, { id: "b", questions: [{ id: "q" }, null, "x"] }],
      attempts: [null, { id: "t1", items: "bad" }, { id: "t2", items: [] }, "x"],
      srs: { q1: { dueAt: 1 }, q2: null, q3: 5 },
      sessions: { s1: { at: 1 }, s2: "x" },
      subjects: [{ id: "m", name: "Matte" }, null, { name: "no id" }],
    });
    assert.deepEqual(s.assignments.map((a) => [a.id, a.questions.length]), [["a", 0], ["b", 1]]);
    assert.deepEqual(s.attempts.map((a) => [a.id, a.items.length]), [["t1", 0], ["t2", 0]]);
    assert.deepEqual(Object.keys(s.srs), ["q1"]);
    assert.deepEqual(Object.keys(s.sessions), ["s1"]);
    assert.deepEqual(s.subjects.map((x) => x.id), ["m"]);
  });

  test("healthy data passes through untouched, objects and unknown fields included", () => {
    const set = { id: "a", questions: [{ id: "q", prompt: "p" }], extra: { kept: true } };
    const attempt = { id: "t", items: [{ questionId: "q" }] };
    const s = coerceStateShape({
      assignments: [set], attempts: [attempt], srs: { q: { dueAt: 1 } }, futureField: [1, 2],
      activity: { daysStudied: ["2026-11-01"], freezes: 2, bestStreak: 4, lastBackupAt: 5 },
    });
    assert.equal(s.assignments[0], set, "same object: nothing was wrong with it");
    assert.equal(s.attempts[0], attempt);
    assert.deepEqual(s.futureField, [1, 2]);
    assert.deepEqual(s.activity, { daysStudied: ["2026-11-01"], freezes: 2, bestStreak: 4, lastBackupAt: 5 });
  });

  test("activity: lists keep only day strings, counters become numbers", () => {
    const s = coerceStateShape({ activity: { daysStudied: "2026", frozenDays: [1, "2026-10-01"], freezes: "x", bestStreak: "3" } });
    assert.deepEqual(s.activity.daysStudied, []);
    assert.deepEqual(s.activity.frozenDays, ["2026-10-01"]);
    assert.equal(s.activity.freezes, 0);
    assert.equal(s.activity.bestStreak, 3);
  });

  test("profile, avatar, rules and tonight of the wrong type are reset", () => {
    const s = coerceStateShape({ profile: "x", avatar: 5, rules: "x", tonight: [] });
    assert.equal(s.profile, null);
    assert.equal(s.avatar, null);
    assert.deepEqual(s.rules, []);
    assert.deepEqual(s.tonight, {});
  });

  test("lastAnswers keeps only [time, 0|1] pairs (lib/history.js)", () => {
    const s = coerceStateShape({ lastAnswers: { a: [5, 1], b: [5, 2], c: "x", d: ["5", 0], e: [7, 0] } });
    assert.deepEqual(s.lastAnswers, { a: [5, 1], e: [7, 0] });
    assert.deepEqual(coerceStateShape({ lastAnswers: [1, 2] }).lastAnswers, {});
  });
});

describe("cleanSettings", () => {
  test("wrong types and unknown choices fall back to the default", () => {
    const s = cleanSettings({ preset: 5, textSize: "huge", font: null, pomodoro: 25, dailyGoal: "abc", testHints: [], sound: "yes", hpDate: "soon" }, DEFAULTS);
    assert.equal(s.preset, "balanced");
    assert.equal(s.textSize, "m");
    assert.equal(s.font, "system");
    assert.equal(s.pomodoro, "25", "a number from an older client is read as its string choice");
    assert.equal(s.dailyGoal, 10);
    assert.equal(s.testHints, 2);
    assert.equal(s.sound, true);
    assert.equal(s.hpDate, null);
  });

  test("numbers are clamped to their range, good values and unknown keys are kept", () => {
    const s = cleanSettings({ dailyGoal: 500, testHints: -3, textSize: "l", hpDate: "2027-04-10", rulePrompts: false }, DEFAULTS);
    assert.equal(s.dailyGoal, 100);
    assert.equal(s.testHints, 0);
    assert.equal(s.textSize, "l");
    assert.equal(s.hpDate, "2027-04-10");
    assert.equal(s.rulePrompts, false);
  });

  test("not an object at all gives the defaults", () => {
    assert.deepEqual(cleanSettings("x", DEFAULTS), DEFAULTS);
    assert.deepEqual(cleanSettings(null, DEFAULTS), DEFAULTS);
  });
});
