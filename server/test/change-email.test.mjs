import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, startFakeResend, makeClient } from "./harness.mjs";

// Changing the address you sign in with: password now, a link to the new address, notices to the old one.

const email = () => `ce-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenIn = (mail) => mail.html.match(/new-email\?token=([0-9a-f]{64})/)?.[1];

describe("change email", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  async function account() {
    const addr = email();
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/signup", { email: addr, password: "oldpassword1", consent: true })).status, 200);
    return { addr, c };
  }
  async function ask(c, newEmail, password = "oldpassword1") {
    return c.post("/api/auth/change-email", { newEmail, password });
  }

  test("a signed-out request is a 401", async () => {
    const c = makeClient(server.baseUrl);
    assert.equal((await ask(c, email())).status, 401);
  });

  test("a bad address, the same address and a wrong password are refused", async () => {
    const { addr, c } = await account();
    assert.equal((await ask(c, "not-an-address")).status, 400);
    const same = await ask(c, addr);
    assert.equal(same.status, 400);
    assert.equal(same.json.error.code, "same_email");
    assert.equal((await ask(c, email(), "wrong-password")).status, 403);
  });

  test("nothing changes until the link is opened, and then the new address signs in", async () => {
    const { addr, c } = await account();
    const next = email();
    assert.equal((await ask(c, next)).status, 200);
    await sleep(300);
    const toNew = fake.mailsTo(next);
    assert.equal(toNew.length, 1);
    assert.equal(fake.mailsTo(addr).some((m) => /new email address was requested/i.test(m.subject)), true, "the old address is told");
    assert.equal((await c.get("/api/auth/me")).json.email, addr, "still the old address");

    const token = tokenIn(toNew[0]);
    assert.ok(token);
    const anon = makeClient(server.baseUrl);
    const done = await anon.post("/api/auth/confirm-email-change", { token });
    assert.equal(done.status, 200);
    assert.equal(done.json.email, next);
    assert.equal(done.json.signedIn, false, "the confirming browser had no session of this account");
    await sleep(300);
    assert.equal(fake.mailsTo(addr).some((m) => /address was changed/i.test(m.subject)), true, "the old address is told it happened");

    const fresh = makeClient(server.baseUrl);
    assert.equal((await fresh.post("/api/auth/login", { email: addr, password: "oldpassword1" })).status, 401);
    const login = await fresh.post("/api/auth/login", { email: next, password: "oldpassword1" });
    assert.equal(login.status, 200);
    assert.equal(login.json.emailVerified, true);
  });

  test("the link works once, and an old session ends unless it is the one confirming", async () => {
    const { addr, c } = await account();
    const other = makeClient(server.baseUrl);
    assert.equal((await other.post("/api/auth/login", { email: addr, password: "oldpassword1" })).status, 200);
    const next = email();
    await ask(c, next);
    await sleep(300);
    const token = tokenIn(fake.mailsTo(next)[0]);
    const first = await c.post("/api/auth/confirm-email-change", { token });
    assert.equal(first.status, 200);
    assert.equal(first.json.signedIn, true, "the signed-in browser keeps its session");
    assert.equal((await c.get("/api/auth/me")).json.email, next);
    assert.equal((await other.get("/api/auth/me")).json.authed, false, "the other device is signed out");
    assert.equal((await makeClient(server.baseUrl).post("/api/auth/confirm-email-change", { token })).status, 400, "a second use fails");
  });

  test("an address that already has an account gets the same reply and no mail", async () => {
    const a = await account();
    const b = await account();
    const known = await ask(a.c, b.addr);
    const free = await ask(a.c, email());
    assert.deepEqual(known.json, free.json);
    await sleep(300);
    assert.equal(fake.mailsTo(b.addr).filter((m) => /confirm your new email/i.test(m.subject)).length, 0);
  });

  test("an address taken between the request and the click is refused", async () => {
    const a = await account();
    const next = email();
    await ask(a.c, next);
    await sleep(300);
    const token = tokenIn(fake.mailsTo(next)[0]);
    const grabber = makeClient(server.baseUrl);
    assert.equal((await grabber.post("/api/auth/signup", { email: next, password: "otherpassword1", consent: true })).status, 200);
    assert.equal((await makeClient(server.baseUrl).post("/api/auth/confirm-email-change", { token })).status, 400);
    assert.equal((await a.c.get("/api/auth/me")).json.email, a.addr, "the account keeps its address");
  });

  test("a new request replaces the old link, and an expired link fails", async () => {
    const a = await account();
    const first = email(), second = email();
    await ask(a.c, first); await sleep(300);
    const t1 = tokenIn(fake.mailsTo(first)[0]);
    await ask(a.c, second); await sleep(300);
    assert.equal((await makeClient(server.baseUrl).post("/api/auth/confirm-email-change", { token: t1 })).status, 400);
    const t2 = tokenIn(fake.mailsTo(second)[0]);
    server.db.prepare("UPDATE email_change_tokens SET expires_at = ? WHERE token = ?").run(Date.now() - 1000, t2);
    assert.equal((await makeClient(server.baseUrl).post("/api/auth/confirm-email-change", { token: t2 })).status, 400);
  });

  test("a Google-only account cannot change it here", async () => {
    const addr = email();
    const id = crypto.randomUUID();
    server.db.prepare("INSERT INTO users (id, email, password_hash, google_sub, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, addr, "unusable-hash", "g-" + id, Date.now(), Date.now());
    server.db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run("sess-" + id, id, Date.now(), Date.now() + 3600_000);
    const c = makeClient(server.baseUrl);
    c.cookie = `sb_session=sess-${id}`;
    const r = await ask(c, email());
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "google_account");
  });

  test("five wrong passwords stop the guessing", async () => {
    const { c } = await account();
    let last;
    for (let i = 0; i < 6; i++) last = await ask(c, email(), "wrong-" + i);
    assert.equal(last.status, 429);
  });
});

describe("change email with email switched off", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });
  test("is a 501", async () => {
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email: email(), password: "oldpassword1", consent: true });
    assert.equal((await c.post("/api/auth/change-email", { newEmail: email(), password: "oldpassword1" })).status, 501);
  });
});

describe("a password reset or change cancels a pending change of address", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  async function pending() {
    const addr = email(), next = email();
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email: addr, password: "oldpassword1", consent: true });
    await c.post("/api/auth/change-email", { newEmail: next, password: "oldpassword1" });
    await sleep(300);
    return { addr, next, c, token: tokenIn(fake.mailsTo(next)[0]) };
  }

  test("resetting the password through the old address", async () => {
    const p = await pending();
    const anon = makeClient(server.baseUrl);
    await anon.post("/api/auth/forgot-password", { email: p.addr });
    const uid = server.db.prepare("SELECT id FROM users WHERE email = ?").get(p.addr).id;
    const reset = server.db.prepare("SELECT token FROM password_reset_tokens WHERE user_id = ?").get(uid).token;
    assert.equal((await anon.post("/api/auth/reset-password", { token: reset, password: "ownersnewpw1" })).status, 200);
    assert.equal((await makeClient(server.baseUrl).post("/api/auth/confirm-email-change", { token: p.token })).status, 400);
  });

  test("changing the password", async () => {
    const p = await pending();
    assert.equal((await p.c.post("/api/auth/change-password", { currentPassword: "oldpassword1", newPassword: "brandnewpw2" })).status, 200);
    assert.equal((await makeClient(server.baseUrl).post("/api/auth/confirm-email-change", { token: p.token })).status, 400);
  });
});
