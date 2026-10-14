import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, makeClient } from "./harness.mjs";
import { digestOf, avatarFrom } from "../src/state-digest.js";

// The class results and the friends leaderboard read a small summary saved with each state
// (src/state-digest.js) instead of parsing every member's whole state on every request.

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "library");
const first = JSON.parse(readFileSync(path.join(LIB, "index.json"), "utf8")).sets[0];
const SET = { id: first.id, ...JSON.parse(readFileSync(path.join(LIB, path.basename(first.file)), "utf8")) };
const [Q1, Q2, Q3] = SET.questions.map((q) => q.id);
assert.ok(Q3, "the first library set has at least three questions");

const email = () => `dg-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
async function account(baseUrl) {
  const c = makeClient(baseUrl);
  const r = await c.post("/api/auth/signup", { email: email(), password: "correctpw1", consent: true });
  assert.equal(r.status, 200);
  return c;
}
async function putState(c, blob) {
  const cur = await c.get("/api/state");
  assert.equal((await c.put("/api/state", { version: cur.json.version, blob })).status, 200);
}
const utcDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("digestOf", () => {
  test("keeps each question's latest answer, the attempts' sizes and the study days, and nothing else", () => {
    const d = digestOf({
      secret: "never copied", chats: ["private"],
      attempts: [
        { finishedAt: 100, items: [{ questionId: "a", firstTry: false }, { questionId: "b", correct: true }] },
        { finishedAt: 200, items: [{ questionId: "a", firstTry: true }] },
      ],
      activity: { daysStudied: ["2026-10-01", 5, "2026-10-02"], frozenDays: ["2026-10-03"] },
    });
    assert.deepEqual(d.answers, { a: [200, 1], b: [100, 1] });   // a: the later answer wins; b: no firstTry, falls back to correct
    assert.deepEqual(d.attempts, [[100, 2], [200, 1]]);
    assert.deepEqual(d.days, ["2026-10-01", "2026-10-02"]);
    assert.deepEqual(d.frozen, ["2026-10-03"]);
    assert.equal(JSON.stringify(d).includes("private"), false);
  });

  test("an odd state summarises as nothing done, and a question id like __proto__ stays plain data", () => {
    for (const odd of [null, undefined, "text", 5, [], { attempts: "no", activity: 3 }, { attempts: [null, 4, { items: "x" }] }]) {
      const d = digestOf(odd);
      assert.deepEqual(d.answers, {}, JSON.stringify(odd));
      assert.equal(d.avatar, null);
    }
    const d = digestOf({ attempts: [{ finishedAt: 1, items: [{ questionId: "__proto__", firstTry: true }] }] });
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(d.answers))), ["__proto__"]);
    assert.equal({}.polluted, undefined);
  });

  test("an answer at the same time as an earlier one in the list replaces it, as the app does", () => {
    const d = digestOf({ attempts: [
      { finishedAt: 50, items: [{ questionId: "q", firstTry: true }] },
      { finishedAt: 50, items: [{ questionId: "q", firstTry: false }] },
    ] });
    assert.deepEqual(d.answers.q, [50, 0]);
  });

  test("only a small webp/jpeg/png data URL is a picture", () => {
    assert.equal(avatarFrom({ avatar: "data:image/webp;base64,AAAA" }), "data:image/webp;base64,AAAA");
    assert.equal(avatarFrom({ avatar: "data:image/svg+xml;base64,AAAA" }), null);
    assert.equal(avatarFrom({ avatar: `data:image/png;base64,${"A".repeat(200_001)}` }), null);
  });
});

describe("class results and leaderboard from the summary", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  async function classWith(studentBlob) {
    const teacher = await account(server.baseUrl);
    const student = await account(server.baseUrl);
    const made = (await teacher.post("/api/classes", { name: "7A" })).json;
    assert.equal((await student.post("/api/classes/join", { code: made.code })).status, 200);
    assert.equal((await teacher.post(`/api/classes/${made.id}/assignments`, { setId: SET.id })).status, 200);
    if (studentBlob) await putState(student, studentBlob);
    const results = async () => (await teacher.get(`/api/classes/${made.id}/results`)).json.assignments[0];
    return { teacher, student, results };
  }

  test("known = last answer right first try; seen, lastAt and the topics follow", async () => {
    const { results } = await classWith({ attempts: [
      { finishedAt: 1000, items: [{ questionId: Q1, firstTry: false }, { questionId: Q2, firstTry: false }] },
      { finishedAt: 2000, items: [{ questionId: Q1, firstTry: true }] },
    ] });
    const a = await results();
    assert.equal(a.total, SET.questions.length);
    assert.deepEqual(a.students.map(({ seen, known, lastAt }) => ({ seen, known, lastAt })), [{ seen: 2, known: 1, lastAt: 2000 }]);
  });

  test("a student who never synced, or whose state is unreadable, shows as nothing done", async () => {
    const { results } = await classWith(null);
    assert.deepEqual((await results()).students.map(({ seen, known, lastAt }) => ({ seen, known, lastAt })), [{ seen: 0, known: 0, lastAt: null }]);
    const odd = await classWith({ attempts: "not a list", activity: 7 });
    assert.deepEqual((await odd.results()).students.map(({ seen, known }) => ({ seen, known })), [{ seen: 0, known: 0 }]);
  });

  test("a state saved before summaries existed (none stored) is summarised on first read, to the same answer", async () => {
    const { results } = await classWith({ attempts: [{ finishedAt: 3000, items: [{ questionId: Q3, firstTry: true }] }] });
    const before = await results();
    const saved = server.db.prepare("SELECT user_id AS userId, digest FROM state_blobs ORDER BY updated_at DESC LIMIT 1").get();
    assert.ok(saved.digest, "saving the state stored its summary");
    server.db.prepare("UPDATE state_blobs SET digest = NULL WHERE user_id = ?").run(saved.userId);
    assert.deepEqual(await results(), before);
    assert.equal(server.db.prepare("SELECT digest FROM state_blobs WHERE user_id = ?").get(saved.userId).digest, saved.digest, "rebuilt and stored again");
  });

  test("leaderboard: this week's answers and the streak come from the summary", async () => {
    const a = await account(server.baseUrl);
    const b = await account(server.baseUrl);
    const code = (await a.post("/api/friends/invite-code")).json.code;
    assert.equal((await b.post("/api/friends/redeem", { code })).status, 200);
    await putState(a, {
      attempts: [
        { finishedAt: Date.now(), items: [{ questionId: "x", firstTry: true }, { questionId: "y", firstTry: true }, { questionId: "z", firstTry: false }] },
        { finishedAt: Date.now() - 60 * 86_400_000, items: [{ questionId: "old", firstTry: true }] },
      ],
      activity: { daysStudied: [utcDay(0), utcDay(-1)], frozenDays: [] },
    });
    const mine = (await b.get("/api/friends/leaderboard")).json.entries.find((e) => !e.isMe);
    assert.equal(mine.questionsThisWeek, 3, "the old attempt is outside the week");
    assert.equal(mine.streak, 2);
    assert.equal(mine.synced, true);
  });
});
