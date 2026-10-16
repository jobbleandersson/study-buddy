import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

// The codes one person hands to another (a student's code for a parent, a friend code). One account must
// not be able to write rows without limit: a loop of requests from one signed-in student could fill the
// disk that holds everybody's study data.

const email = () => `cd-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
async function account(baseUrl) {
  const c = makeClient(baseUrl);
  assert.equal((await c.post("/api/auth/signup", { email: email(), password: "correctpw1", consent: true })).status, 200);
  return c;
}
const rows = (server, table, col, id) => server.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(id).n;
const userId = (server, c, addr) => server.db.prepare("SELECT id FROM users ORDER BY created_at DESC LIMIT 1").get().id;

describe("a student's code for a parent or teacher", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("asking again gives the same live code, not another row", async () => {
    const student = await account(server.baseUrl);
    const id = userId(server);
    const first = (await student.post("/api/links/invite-code")).json;
    const second = (await student.post("/api/links/invite-code")).json;
    assert.equal(second.code, first.code);
    assert.equal(second.expiresAt, first.expiresAt);
    assert.equal(rows(server, "invite_codes", "student_user_id", id), 1);
  });

  test("a thousand requests still leave one row", async () => {
    const student = await account(server.baseUrl);
    const id = userId(server);
    await Promise.all(Array.from({ length: 50 }, async () => { for (let i = 0; i < 20; i++) await student.post("/api/links/invite-code"); }));
    assert.equal(rows(server, "invite_codes", "student_user_id", id), 1);
  });

  test("once the code is used, the next ask is a new code, and the redeem flow still works", async () => {
    const student = await account(server.baseUrl);
    const parent = await account(server.baseUrl);
    const first = (await student.post("/api/links/invite-code")).json;
    assert.equal((await parent.post("/api/links/redeem", { code: first.code })).status, 200);
    const next = (await student.post("/api/links/invite-code")).json;
    assert.notEqual(next.code, first.code);
  });

  test("a code that has expired is replaced by a new one", async () => {
    const student = await account(server.baseUrl);
    const id = userId(server);
    const first = (await student.post("/api/links/invite-code")).json;
    server.db.prepare("UPDATE invite_codes SET expires_at = ? WHERE student_user_id = ?").run(Date.now() - 1000, id);
    const next = (await student.post("/api/links/invite-code")).json;
    assert.notEqual(next.code, first.code);
  });
});

describe("a friend code", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("is reused the same way, and a friend can still redeem it", async () => {
    const a = await account(server.baseUrl);
    const id = userId(server);
    const b = await account(server.baseUrl);
    const first = (await a.post("/api/friends/invite-code")).json;
    for (let i = 0; i < 20; i++) assert.equal((await a.post("/api/friends/invite-code")).json.code, first.code);
    assert.equal(rows(server, "friend_codes", "user_id", id), 1);
    assert.equal((await b.post("/api/friends/redeem", { code: first.code })).status, 200);
  });
});

describe("how many new codes one account can make in an hour", () => {
  let server;
  before(async () => { server = await startServer({ CODES_PER_HOUR_PER_USER: "2" }); });
  after(async () => { await server.stop(); });

  test("the third new code is a 429; a code that is still live is always given out", async () => {
    const student = await account(server.baseUrl);
    const id = userId(server);
    const expire = () => server.db.prepare("UPDATE invite_codes SET expires_at = ? WHERE student_user_id = ?").run(Date.now() - 1000, id);
    assert.equal((await student.post("/api/links/invite-code")).status, 200);   // new 1
    expire();
    assert.equal((await student.post("/api/links/invite-code")).status, 200);   // new 2
    expire();
    const blocked = await student.post("/api/links/invite-code");               // would be new 3
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, "too_many_codes");
    assert.ok(blocked.headers.get("retry-after"));
    // Another account is not affected, and its own live code is returned even at its limit.
    const other = await account(server.baseUrl);
    assert.equal((await other.post("/api/links/invite-code")).status, 200);
    assert.equal((await other.post("/api/links/invite-code")).status, 200);
  });
});

describe("the clean-up", () => {
  let server;
  before(async () => { server = await startServer({ SWEEP_EVERY_MS: "200" }); });
  after(async () => { await server.stop(); });

  test("removes expired and used codes, and page views older than 90 days, but not recent ones", async () => {
    const student = await account(server.baseUrl);
    const id = userId(server);
    const code = (await student.post("/api/links/invite-code")).json.code;   // live: stays
    const DAY = 86_400_000, now = Date.now();
    server.db.prepare("INSERT INTO invite_codes (id, student_user_id, code, expires_at, created_at) VALUES ('old1', ?, 'ZZZZZ2', ?, ?)").run(id, now - 5000, now - 9000);
    const view = server.db.prepare("INSERT INTO page_views (id, path, created_at) VALUES (?, '/', ?)");
    view.run("pv-old", now - 100 * DAY);
    view.run("pv-recent", now - 10 * DAY);
    await new Promise((r) => setTimeout(r, 900));
    const left = (sql, ...a) => server.db.prepare(sql).get(...a).n;
    assert.equal(left("SELECT COUNT(*) AS n FROM invite_codes WHERE id = 'old1'"), 0);
    assert.equal(left("SELECT COUNT(*) AS n FROM invite_codes WHERE code = ?", code), 1, "the live code stays");
    assert.equal(left("SELECT COUNT(*) AS n FROM page_views WHERE id = 'pv-old'"), 0);
    assert.equal(left("SELECT COUNT(*) AS n FROM page_views WHERE id = 'pv-recent'"), 1);
  });
});
