import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, startFakeResend, makeClient } from "./harness.mjs";
import { isPlausibleEmail } from "../src/emailCheck.js";

// The basics of an account: an address that could receive mail, changing the password, signing out the
// other devices, and telling a Google-only address that it has no password to reset.

const email = () => `ab-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("isPlausibleEmail", () => {
  test("accepts ordinary addresses", () => {
    for (const a of ["anna@example.com", "anna.svensson+skola@skola.stockholm.se", "a@b.se", "åsa@exempel.se"]) assert.equal(isPlausibleEmail(a), true, a);
  });
  test("turns away what cannot be an address", () => {
    const tooLong = `${"a".repeat(250)}@x.se`;
    for (const a of ["", "anna", "@example.com", "anna@", "anna@example", "anna@@example.com", "a@b@c.se", "an na@example.com",
      "anna@exa mple.com", "anna@.com", "anna@example..com", "anna@example.c", ".anna@example.com", "anna.@example.com", "<a>@example.com", "a\u0000b@example.com", "a\\b@example.com", tooLong]) {
      assert.equal(isPlausibleEmail(a), false, JSON.stringify(a));
    }
    assert.equal(isPlausibleEmail(null), false);
  });
});

describe("signup checks the address", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("a made-up address is a 400 and no account", async () => {
    const c = makeClient(server.baseUrl);
    for (const bad of ["a@b", "nobody@", "x y@example.com"]) {
      const r = await c.post("/api/auth/signup", { email: bad, password: "correctpw1", consent: true });
      assert.equal(r.status, 400, bad);
    }
    assert.equal((await c.post("/api/auth/signup", { email: email(), password: "correctpw1", consent: true })).status, 200);
  });
});

describe("change password and sign out other devices", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  async function twoDevices() {
    const addr = email();
    const a = makeClient(server.baseUrl);
    assert.equal((await a.post("/api/auth/signup", { email: addr, password: "oldpassword1", consent: true })).status, 200);
    const b = makeClient(server.baseUrl);
    assert.equal((await b.post("/api/auth/login", { email: addr, password: "oldpassword1" })).status, 200);
    return { addr, a, b };
  }

  test("a signed-out request is a 401", async () => {
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/change-password", { currentPassword: "x", newPassword: "newpassword1" })).status, 401);
    assert.equal((await c.post("/api/auth/logout-others")).status, 401);
  });

  test("the wrong current password changes nothing", async () => {
    const { addr, a } = await twoDevices();
    const r = await a.post("/api/auth/change-password", { currentPassword: "not-it-at-all", newPassword: "newpassword1" });
    assert.equal(r.status, 403);
    const fresh = makeClient(server.baseUrl);
    assert.equal((await fresh.post("/api/auth/login", { email: addr, password: "oldpassword1" })).status, 200);
  });

  test("a short new password is a 400", async () => {
    const { a } = await twoDevices();
    assert.equal((await a.post("/api/auth/change-password", { currentPassword: "oldpassword1", newPassword: "short" })).status, 400);
  });

  test("changing it signs out the other devices, keeps this one, and the new password is the one that works", async () => {
    const { addr, a, b } = await twoDevices();
    const r = await a.post("/api/auth/change-password", { currentPassword: "oldpassword1", newPassword: "brandnewpw2" });
    assert.equal(r.status, 200);
    assert.equal((await a.get("/api/auth/me")).json.authed, true, "this device stays signed in");
    assert.equal((await b.get("/api/auth/me")).json.authed, false, "the other device is signed out");
    const fresh = makeClient(server.baseUrl);
    assert.equal((await fresh.post("/api/auth/login", { email: addr, password: "oldpassword1" })).status, 401);
    assert.equal((await fresh.post("/api/auth/login", { email: addr, password: "brandnewpw2" })).status, 200);
  });

  test("the owner is told by mail", async () => {
    const { addr, a } = await twoDevices();
    await a.post("/api/auth/change-password", { currentPassword: "oldpassword1", newPassword: "brandnewpw2" });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(fake.mailsTo(addr).some((m) => /password was changed/i.test(m.subject)));
  });

  test("a reset link mailed earlier stops working", async () => {
    const { addr, a } = await twoDevices();
    const anon = makeClient(server.baseUrl);
    await anon.post("/api/auth/forgot-password", { email: addr });
    const uid = server.db.prepare("SELECT id FROM users WHERE email = ?").get(addr).id;
    const token = server.db.prepare("SELECT token FROM password_reset_tokens WHERE user_id = ?").get(uid).token;
    await a.post("/api/auth/change-password", { currentPassword: "oldpassword1", newPassword: "brandnewpw2" });
    assert.equal((await anon.post("/api/auth/reset-password", { token, password: "attackerpw99" })).status, 400);
  });

  test("an account without a password is a 400", async () => {
    const addr = email();
    const id = crypto.randomUUID();
    server.db.prepare("INSERT INTO users (id, email, password_hash, google_sub, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, addr, "unusable-hash", "g-sub-" + id, Date.now(), Date.now());
    server.db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run("sess-" + id, id, Date.now(), Date.now() + 3600_000);
    const c = makeClient(server.baseUrl);
    c.cookie = `sb_session=sess-${id}`;
    const r = await c.post("/api/auth/change-password", { currentPassword: "whatever1", newPassword: "brandnewpw2" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "no_password");
  });

  test("five wrong current passwords stop the guessing", async () => {
    const { a } = await twoDevices();
    let last;
    for (let i = 0; i < 6; i++) last = await a.post("/api/auth/change-password", { currentPassword: "wrong-" + i, newPassword: "brandnewpw2" });
    assert.equal(last.status, 429);
  });

  test("sign out other devices keeps only this one", async () => {
    const { a, b } = await twoDevices();
    const r = await a.post("/api/auth/logout-others");
    assert.equal(r.status, 200);
    assert.equal(r.json.signedOut, 1);
    assert.equal((await a.get("/api/auth/me")).json.authed, true);
    assert.equal((await b.get("/api/auth/me")).json.authed, false);
  });
});

describe("forgot password for an address that signs in with Google", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("gets a mail saying so, and the reply is the same as for any address", async () => {
    const addr = email();
    server.db.prepare("INSERT INTO users (id, email, password_hash, google_sub, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), addr, "unusable-hash", "g-sub-" + addr, Date.now(), Date.now());
    const c = makeClient(server.baseUrl);
    const known = await c.post("/api/auth/forgot-password", { email: addr });
    const unknown = await c.post("/api/auth/forgot-password", { email: email() });
    assert.deepEqual(known.json, unknown.json);
    await new Promise((r) => setTimeout(r, 300));
    const mails = fake.mailsTo(addr);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /Google/);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM password_reset_tokens").get().n, 0);
  });
});
