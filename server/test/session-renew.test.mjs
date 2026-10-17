import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

// A session lasts 30 days from its last use, never more than 90 days from sign-in.

const DAY = 86_400_000;
const email = () => `sr-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("session renewal", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  async function signedIn() {
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/signup", { email: email(), password: "correctpw1", consent: true })).status, 200);
    const sid = c.cookie.split("=")[1];
    return { c, sid };
  }
  const row = (sid) => server.db.prepare("SELECT expires_at AS e, created_at AS c FROM sessions WHERE id = ?").get(sid);

  test("a session used after a few days is pushed out to 30 days from now, and the cookie is renewed", async () => {
    const { c, sid } = await signedIn();
    server.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(Date.now() + 10 * DAY, sid);
    const r = await c.get("/api/auth/me");
    assert.equal(r.json.authed, true);
    const e = row(sid).e;
    assert.ok(Math.abs(e - (Date.now() + 30 * DAY)) < 60_000, "30 days from now");
    assert.match(r.res.headers.getSetCookie().join(";"), /sb_session=/);
  });

  test("it is not rewritten on every request: within a day of the last push nothing changes", async () => {
    const { c, sid } = await signedIn();
    const before = row(sid).e;
    const r = await c.get("/api/auth/me");
    assert.equal(r.json.authed, true);
    assert.equal(row(sid).e, before);
    assert.equal(r.res.headers.getSetCookie().length, 0);
  });

  test("an API request that needs a session renews it too", async () => {
    const { c, sid } = await signedIn();
    server.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(Date.now() + 5 * DAY, sid);
    assert.equal((await c.get("/api/state")).status, 200);
    assert.ok(row(sid).e > Date.now() + 29 * DAY);
  });

  test("never past 90 days from sign-in", async () => {
    const { c, sid } = await signedIn();
    server.db.prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?").run(Date.now() - 80 * DAY, Date.now() + 2 * DAY, sid);
    await c.get("/api/auth/me");
    const { e, c: started } = row(sid);
    assert.equal(e, started + 90 * DAY);
  });

  test("an expired session is not revived", async () => {
    const { c, sid } = await signedIn();
    server.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, sid);
    assert.equal((await c.get("/api/auth/me")).json.authed, false);
    assert.ok(row(sid).e < Date.now());
  });
});
