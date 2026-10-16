// A burst of parallel password guesses: the failure limiter must count a guess from the moment it
// STARTS (before the bcrypt work), not when it has failed, or every guess in the burst is evaluated
// before the first one is counted. And the password-hashing pool must refuse work past its queue
// with a 503 instead of letting the wait grow. rate-limits.test.mjs covers the sequential cases.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `burst-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const tally = (rs) => rs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});

describe("parallel wrong passwords for one account", () => {
  let server;
  before(async () => { server = await startServer({ LOGIN_FAILS_PER_15MIN_PER_ACCOUNT: "10", LOGIN_FAILS_PER_15MIN_PER_IP: "0" }); });
  after(async () => { await server.stop(); });

  test("only the limit's worth is evaluated; the rest get a 429 with Retry-After", async () => {
    const email = uniqueEmail();
    await makeClient(server.baseUrl).post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const rs = await Promise.all(Array.from({ length: 40 }, () => makeClient(server.baseUrl).post("/api/auth/login", { email, password: "wrongpassword" })));
    assert.deepEqual(tally(rs), { 401: 10, 429: 30 });
    assert.ok(rs.filter((r) => r.status === 429).every((r) => r.json.error.code === "rate_limited" && r.res.headers.get("retry-after")));
    // The window stays full, so even the right password waits (same as the sequential case).
    const right = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: "correctpw1" });
    assert.equal(right.status, 429);
  });

  test("parallel logins that SUCCEED give their place back", async () => {
    const email = uniqueEmail();
    await makeClient(server.baseUrl).post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const ok = await Promise.all(Array.from({ length: 8 }, () => makeClient(server.baseUrl).post("/api/auth/login", { email, password: "correctpw1" })));
    assert.deepEqual(tally(ok), { 200: 8 });
    const bad = [];
    for (let i = 0; i < 11; i++) bad.push(await makeClient(server.baseUrl).post("/api/auth/login", { email, password: "wrongpassword" }));
    assert.deepEqual(tally(bad), { 401: 10, 429: 1 });   // all ten guesses still available
  });
});

describe("the password-hashing pool is bounded", () => {
  let server;
  before(async () => { server = await startServer({ PASSWORD_HASH_WORKERS: "1", PASSWORD_HASH_QUEUE: "2" }); });
  after(async () => { await server.stop(); });

  test("past the queue a login is refused at once with 503 busy, and the server recovers", async () => {
    const email = uniqueEmail();
    await makeClient(server.baseUrl).post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const rs = await Promise.all(Array.from({ length: 40 }, () => makeClient(server.baseUrl).post("/api/auth/login", { email, password: "wrongpassword" })));
    const t = tally(rs);
    assert.equal((t[401] || 0) + (t[503] || 0), 40, JSON.stringify(t));
    assert.ok(t[503] >= 1, `expected some 503s, got ${JSON.stringify(t)}`);
    assert.ok(t[401] >= 1);
    for (const r of rs.filter((x) => x.status === 503)) {
      assert.equal(r.json.error.code, "busy");
      assert.ok(r.res.headers.get("retry-after"));
    }
    // Once the queue has drained the same account signs in normally.
    const ok = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: "correctpw1" });
    assert.equal(ok.status, 200);
  });

  test("a refused signup creates no account, a later one works", async () => {
    const emails = Array.from({ length: 30 }, uniqueEmail);
    const rs = await Promise.all(emails.map((email) => makeClient(server.baseUrl).post("/api/auth/signup", { email, password: "correctpw1", consent: true })));
    const t = tally(rs);
    assert.equal((t[200] || 0) + (t[503] || 0), 30, JSON.stringify(t));
    assert.ok(t[503] >= 1);
    const made = server.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email IN (${emails.map(() => "?").join(",")})`).get(...emails).n;
    assert.equal(made, t[200]);
    const later = await makeClient(server.baseUrl).post("/api/auth/signup", { email: uniqueEmail(), password: "correctpw1", consent: true });
    assert.equal(later.status, 200);
  });
});
