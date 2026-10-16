import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";
import { parentViewOf } from "../src/parent-view.js";
import { masteryByTopic, masteryForSubject } from "../../js/lib/mastery.js";
import { dueQuestions } from "../../js/lib/library.js";
import { currentStreak } from "../../js/lib/activity.js";

// A linked parent or teacher is handed what the progress page draws, not the student's whole state.

const SECRET = "Mitt hemliga svar om min kompis";
const state = () => ({
  settings: { sound: true },
  profile: { name: "Elsa", level: "åk 9", mood: "stressad" },
  avatar: "data:image/png;base64,AAAA",
  rules: [{ id: "r1", text: SECRET }],
  subjects: [{ id: "s1", name: "Historia" }],
  assignments: [{
    id: "a1", subjectId: "s1", title: "Rom", sourceSummary: SECRET,
    questions: [
      { id: "q1", topic: "Romarriket", prompt: SECRET, answer: SECRET, explanation: SECRET },
      { id: "q2", topic: "Republiken", prompt: "p", answer: "a" },
    ],
  }],
  attempts: [
    { id: "t1", finishedAt: 1000, items: [{ questionId: "q1", topic: "Romarriket", correct: true, firstTry: true, answerText: SECRET }, { questionId: "q2", topic: "Republiken", correct: false }] },
    { id: "t2", finishedAt: 2000, items: [{ questionId: "q1", topic: "Romarriket", correct: true, firstTry: false, appealed: true }] },
  ],
  srs: { q1: { dueAt: Date.now() - 1000, reps: 3, ease: 2.5, reviewedAt: 1 }, other: { dueAt: 1 } },
  activity: { daysStudied: ["2026-10-01", "2026-10-02", "not a day"], frozenDays: [] },
  sessions: { a1: { items: { q1: { text: SECRET } } } },
  tonight: { days: { x: { done: {} } } },
});

describe("parentViewOf", () => {
  test("keeps nothing a parent should not read", () => {
    const text = JSON.stringify(parentViewOf(state()));
    for (const leak of [SECRET, "Elsa", "stressad", "Romarriket", "Republiken", "Rom\"", "base64", "rules", "profile", "sessions", "tonight", "settings"]) {
      assert.equal(text.includes(leak), false, leak);
    }
  });
  test("the numbers the page draws come out the same as from the whole state", () => {
    const whole = state(), thin = parentViewOf(whole);
    const tmW = masteryByTopic(whole.attempts), tmT = masteryByTopic(thin.attempts);
    assert.equal(masteryForSubject("s1", thin.assignments, tmT), masteryForSubject("s1", whole.assignments, tmW));
    assert.equal(dueQuestions(thin.assignments, thin.srs).length, dueQuestions(whole.assignments, whole.srs).length);
    assert.equal(currentStreak(thin.activity.daysStudied, thin.activity.frozenDays, "2026-10-02"), 2);
    assert.equal(thin.attempts.length, 2);
    assert.equal(thin.attempts.slice(-20).reduce((n, a) => n + a.items.filter((i) => i.appealed).length, 0), 1);
    assert.deepEqual(thin.subjects, [{ id: "s1", name: "Historia" }]);
  });
  test("odd input does not throw", () => {
    assert.equal(parentViewOf(null), null);
    assert.doesNotThrow(() => parentViewOf({ attempts: "x", assignments: [null, 3, { id: 5 }], srs: [], subjects: {}, activity: 7 }));
  });
});

describe("GET /api/parent/students/:id/state", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("a linked parent gets the thin view", async () => {
    const mk = async () => {
      const c = makeClient(server.baseUrl);
      const email = `pv-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
      assert.equal((await c.post("/api/auth/signup", { email, password: "correctpw1", consent: true })).status, 200);
      return { c, id: server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id };
    };
    const student = await mk(), parent = await mk();
    const cur = await student.c.get("/api/state");
    assert.equal((await student.c.put("/api/state", { version: cur.json.version, blob: state() })).status, 200);
    const { code } = (await student.c.post("/api/links/invite-code")).json;
    assert.equal((await parent.c.post("/api/links/redeem", { code })).status, 200);

    const r = await parent.c.get(`/api/parent/students/${student.id}/state`);
    assert.equal(r.status, 200);
    assert.equal(JSON.stringify(r.json).includes(SECRET), false);
    assert.equal(r.json.blob.attempts.length, 2);
  });
});
