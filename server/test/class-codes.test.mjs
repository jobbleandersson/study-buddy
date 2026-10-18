import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

// A class code: a joiner sees the teacher by name (never the whole e-mail address), and a teacher can replace the code.

const email = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("class codes", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  async function account(prefix) {
    const addr = email(prefix);
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/signup", { email: addr, password: "correctpw1", consent: true })).status, 200);
    return { addr, c };
  }

  test("a student sees the teacher by a shortened address, or the first name once there is one", async () => {
    const teacher = await account("teacher");
    const student = await account("student");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 7A" })).json;
    assert.equal((await student.c.post("/api/classes/join", { code: cls.code })).status, 200);

    const mine = (await student.c.get("/api/classes")).json.member[0];
    assert.equal(mine.teacherEmail, undefined, "the e-mail field is gone");
    assert.ok(mine.teacherName, "there is a name to show");
    assert.equal(JSON.stringify(mine).includes(teacher.addr), false, "the whole address is not in the answer");
    assert.match(mine.teacherName, /@example\.com$/);

    // with a first name on the teacher's profile, that is what is shown
    const cur = await teacher.c.get("/api/state");
    assert.equal((await teacher.c.put("/api/state", { version: cur.json.version, blob: { profile: { name: "Elsa" } } })).status, 200);
    assert.equal((await student.c.get("/api/classes")).json.member[0].teacherName, "Elsa");
  });

  test("a new code replaces the old one at once; students already in stay", async () => {
    const teacher = await account("teacher");
    const student = await account("student");
    const late = await account("late");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 8B" })).json;
    assert.equal((await student.c.post("/api/classes/join", { code: cls.code })).status, 200);

    const fresh = await teacher.c.post(`/api/classes/${cls.id}/new-code`);
    assert.equal(fresh.status, 200);
    assert.match(fresh.json.code, /^[A-Z2-9]{6}$/);
    assert.notEqual(fresh.json.code, cls.code);

    assert.equal((await late.c.post("/api/classes/join", { code: cls.code })).status, 400, "the old code no longer works");
    assert.equal((await late.c.post("/api/classes/join", { code: fresh.json.code })).status, 200, "the new one does");
    assert.equal((await student.c.get("/api/classes")).json.member.length, 1, "the first student is still in");
    assert.equal((await teacher.c.get(`/api/classes/${cls.id}`)).json.code, fresh.json.code);
  });

  test("only the class's teacher can replace its code", async () => {
    const teacher = await account("teacher");
    const other = await account("other");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 9C" })).json;
    assert.equal((await other.c.post(`/api/classes/${cls.id}/new-code`)).status, 404);
    assert.equal((await makeClient(server.baseUrl).post(`/api/classes/${cls.id}/new-code`)).status, 401);
  });
});
