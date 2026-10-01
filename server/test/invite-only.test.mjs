import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const SIGNUP = (email) => ({ email, password: "a-good-password", consent: true });

describe("invite-only (INVITE_EMAILS set)", () => {
  let server;
  before(async () => { server = await startServer({ INVITE_EMAILS: "Me@Example.com, friend@example.com" }); });
  after(async () => { await server.stop(); });

  test("/api/health says so", async () => {
    const { json } = await makeClient(server.baseUrl).get("/api/health");
    assert.equal(json.inviteOnly, true);
  });

  test("an email not on the list can't sign up or sign in", async () => {
    const c = makeClient(server.baseUrl);
    const up = await c.post("/api/auth/signup", SIGNUP("stranger@example.com"));
    assert.equal(up.status, 403);
    assert.equal(up.json.error.code, "not_invited");
    assert.equal(c.cookie, null);
    const login = await c.post("/api/auth/login", { email: "stranger@example.com", password: "a-good-password" });
    assert.equal(login.status, 403);
    assert.equal(login.json.error.code, "not_invited");
  });

  test("an invited email signs up and signs in as normal, whatever its case", async () => {
    const c = makeClient(server.baseUrl);
    const up = await c.post("/api/auth/signup", SIGNUP("me@example.com"));
    assert.equal(up.status, 200);
    assert.equal((await c.get("/api/auth/me")).json.authed, true);
    assert.equal((await c.get("/api/state")).status, 200);

    const again = makeClient(server.baseUrl);
    assert.equal((await again.post("/api/auth/login", { email: "ME@example.com", password: "a-good-password" })).status, 200);
  });

  test("a session made before the list existed stops working for an email not on it", async () => {
    const now = Date.now();
    server.db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run("u-old", "old@example.com", "x", now);
    server.db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run("s-old", "u-old", now + 3600_000, now);
    const c = makeClient(server.baseUrl);
    c.cookie = "sb_session=s-old";
    assert.equal((await c.get("/api/auth/me")).json.authed, false);
    assert.equal((await c.get("/api/state")).status, 401);
  });

  test("the public practice pages and the sitemap are hidden", async () => {
    const ova = await fetch(`${server.baseUrl}/ova/ak9-matematik`, { redirect: "manual" });
    assert.equal(ova.status, 302);
    assert.equal(ova.headers.get("location"), "/");
    assert.equal((await fetch(`${server.baseUrl}/sitemap.xml`)).status, 404);
  });
});

describe("open (INVITE_EMAILS unset)", () => {
  let server;
  before(async () => { server = await startServer({ INVITE_EMAILS: "" }); });
  after(async () => { await server.stop(); });

  test("anyone can sign up, and the practice pages are served", async () => {
    const c = makeClient(server.baseUrl);
    assert.equal((await c.get("/api/health")).json.inviteOnly, false);
    assert.equal((await c.post("/api/auth/signup", SIGNUP("anyone@example.com"))).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/ova`)).status, 200);
  });
});
