// Dagens fråga: the class's spread can't be read off answer by answer, and accounts added to the
// class at the last minute don't count toward the threshold that unlocks it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const PASSWORD = "correctpw1";
const email = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const utcDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe("daily question spread", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  async function account(p) {
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email: email(p), password: PASSWORD, consent: true });
    return c;
  }

  /** A class with `established` students who joined long ago and `fresh` who joined just now,
   *  today's question, and everyone answered (all pick option 1). */
  async function classWithAnswers({ established, fresh }) {
    const teacher = await account("teacher");
    const cls = (await teacher.post("/api/classes", { name: "Ma1c" })).json;
    const students = [];
    for (let i = 0; i < established + fresh; i++) {
      const s = await account("student");
      assert.equal((await s.post("/api/classes/join", { code: cls.code })).status, 200);
      students.push(s);
    }
    // The first `established` joined two weeks ago.
    const rows = server.db.prepare("SELECT student_user_id FROM class_members WHERE class_id = ? ORDER BY joined_at").all(cls.id);
    for (const r of rows.slice(0, established)) {
      server.db.prepare("UPDATE class_members SET joined_at = ? WHERE class_id = ? AND student_user_id = ?").run(Date.now() - 14 * 86400000, cls.id, r.student_user_id);
    }
    const put = await teacher.put(`/api/classes/${cls.id}/daily`, { day: utcDay(), prompt: "2 + 2?", choices: ["3", "4", "5"], answer: 1 });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    for (const s of students) {
      const items = (await s.get(`/api/my-daily?day=${utcDay()}`)).json.items;
      const r = await s.post(`/api/my-daily/${items[0].id}/answer`, { choice: 1 });
      assert.equal(r.status, 200);
      assert.equal(r.json.result.spread, null, "no live spread for students either");
      assert.equal(r.json.result.closed, false);
    }
    return { teacher, cls, dailyId: put.json.id, students };
  }

  test("while the day is open the teacher sees how many answered, never the spread", async () => {
    const { teacher, cls } = await classWithAnswers({ established: 5, fresh: 0 });
    const item = (await teacher.get(`/api/classes/${cls.id}/daily`)).json.items[0];
    assert.equal(item.answered, 5);
    assert.equal(item.spread, null);
    assert.equal(item.closed, false);
  });

  test("once the day is over the spread shows, and no more answers are taken", async () => {
    const { teacher, cls, dailyId } = await classWithAnswers({ established: 5, fresh: 0 });
    server.db.prepare("UPDATE class_daily SET day = ? WHERE id = ?").run(utcDay(-1), dailyId);
    const item = (await teacher.get(`/api/classes/${cls.id}/daily`)).json.items.find((x) => x.id === dailyId);
    assert.equal(item.closed, true);
    assert.deepEqual(item.spread.pct, [0, 100, 0]);

    const late = await account("late");
    await late.post("/api/classes/join", { code: cls.code });
    const r = await late.post(`/api/my-daily/${dailyId}/answer`, { choice: 0 });
    assert.equal(r.status, 403);
  });

  test("accounts that joined just before the question don't count toward the threshold", async () => {
    const { teacher, cls, dailyId } = await classWithAnswers({ established: 2, fresh: 3 });
    server.db.prepare("UPDATE class_daily SET day = ? WHERE id = ?").run(utcDay(-1), dailyId);
    const item = (await teacher.get(`/api/classes/${cls.id}/daily`)).json.items.find((x) => x.id === dailyId);
    assert.equal(item.closed, true);
    assert.equal(item.spread, null, "2 established answers are not enough, however many fresh ones there are");
  });
});
