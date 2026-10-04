// The audit's server fixes: Google sign-in and two-step sign-in, a squatter's second factor on
// password reset, the private practice pages, a malformed friend state, and what the AI proxy accepts.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { startServer, makeClient } from "./harness.mjs";
import { totpAt } from "../src/totp.js";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const KID = "hardening-kid";
const PASSWORD = "correctpw1";
const uniqueEmail = (p = "hard") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64url = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function googleToken({ sub, email }) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "RS256", kid: KID }));
  const p = b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub, email, email_verified: true, iat: now, exp: now + 3600 }));
  return `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey))}`;
}
const codeFor = (secret, step = -1) => totpAt(secret, Math.floor(Date.now() / 1000 / 30) + step);

async function turnOnTotp(client) {
  const { json: { secret } } = await client.post("/api/auth/2fa/setup");
  let r = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret) });
  if (r.status === 400) r = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return secret;
}

describe("Google sign-in and two-step sign-in", () => {
  let server, jwks;
  before(async () => {
    jwks = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] }));
    });
    await new Promise((r) => jwks.listen(0, "127.0.0.1", r));
    server = await startServer({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_JWKS_URL: `http://127.0.0.1:${jwks.address().port}/certs` });
  });
  after(async () => { await server.stop(); await new Promise((r) => jwks.close(r)); });

  test("an account with an authenticator is not linked (or stripped of it) by a Google sign-in", async () => {
    const email = uniqueEmail("g-link");
    const owner = makeClient(server.baseUrl);
    await owner.post("/api/auth/signup", { email, password: PASSWORD, consent: true });
    await turnOnTotp(owner);

    const attacker = makeClient(server.baseUrl);
    const r = await attacker.post("/api/auth/google", { credential: googleToken({ sub: "g-attacker-1", email }) });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "google_link_twofa");
    assert.equal(attacker.cookie, null, "no session");
    const row = server.db.prepare("SELECT google_sub, totp_enabled_at FROM users WHERE email = ?").get(email);
    assert.equal(row.google_sub, null);
    assert.ok(row.totp_enabled_at, "the authenticator stays on");
    assert.equal((await owner.post("/api/auth/login", { email, password: PASSWORD })).json.twoFactorRequired, true);
  });

  test("a Google account that later turned on two-step sign-in still has to give the code", async () => {
    const email = uniqueEmail("g-hybrid");
    const sub = `g-hybrid-${Math.random()}`;
    const me = makeClient(server.baseUrl);
    assert.equal((await me.post("/api/auth/google", { credential: googleToken({ sub, email }), consent: true })).status, 200);
    assert.equal((await me.post("/api/auth/set-password", { credential: googleToken({ sub, email }), password: PASSWORD })).status, 200);
    const secret = await turnOnTotp(me);

    const later = makeClient(server.baseUrl);
    const r = await later.post("/api/auth/google", { credential: googleToken({ sub, email }) });
    assert.equal(r.status, 200);
    assert.equal(r.json.twoFactorRequired, true);
    assert.equal(r.json.method, "totp");
    assert.equal(later.cookie, null, "no session before the code");
    const v = await later.post("/api/auth/2fa/verify", { challenge: r.json.challenge, code: codeFor(secret, 0) });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.ok(later.cookie);
  });
});

describe("password reset on an address someone else registered", () => {
  let server;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); });
  after(async () => { await server.stop(); });

  function resetToken(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    server.db.prepare("INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, token, now + 3_600_000, now);
    return token;
  }

  test("the squatter's authenticator doesn't lock the real owner out", async () => {
    const email = uniqueEmail("squat");
    const squatter = makeClient(server.baseUrl);
    await squatter.post("/api/auth/signup", { email, password: PASSWORD, consent: true });   // never verified
    await turnOnTotp(squatter);
    const { id } = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email);

    const owner = makeClient(server.baseUrl);
    const r = await owner.post("/api/auth/reset-password", { token: resetToken(id), password: "ownerspw12" });
    assert.equal(r.status, 200);
    assert.ok(!r.json.twoFactorRequired, "signed in directly");
    assert.ok(owner.cookie);
    assert.equal(server.db.prepare("SELECT totp_enabled_at FROM users WHERE id = ?").get(id).totp_enabled_at, null);
  });

  test("a verified account's authenticator still guards a reset", async () => {
    const email = uniqueEmail("verified");
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email, password: PASSWORD, consent: true });
    server.db.prepare("UPDATE users SET email_verified_at = ? WHERE email = ?").run(Date.now(), email);
    await turnOnTotp(c);
    const { id } = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    const r = await makeClient(server.baseUrl).post("/api/auth/reset-password", { token: resetToken(id), password: "newpasswd12" });
    assert.equal(r.json.twoFactorRequired, true);
  });
});

describe("smaller server fixes", () => {
  let server;
  before(async () => { server = await startServer({ SITE_PASSWORD: "", ANTHROPIC_API_KEY: "dummy-key" }); });
  after(async () => { await server.stop(); });

  test("a malformed saved state doesn't break the leaderboard", async () => {
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email: uniqueEmail("lb"), password: PASSWORD, consent: true });
    assert.equal((await c.put("/api/state", { version: 0, blob: { attempts: 1, activity: { daysStudied: 5 } } })).status, 200);
    const r = await c.get("/api/friends/leaderboard");
    assert.equal(r.status, 200);
    assert.equal(r.json.entries[0].questionsThisWeek, 0);
  });

  test("the AI proxy refuses content the app never sends (a PDF by URL)", async () => {
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email: uniqueEmail("ai"), password: PASSWORD, consent: true });
    const r = await c.post("/api/messages", {
      model: "claude-haiku-4-5", max_tokens: 100,
      messages: [{ role: "user", content: [{ type: "document", source: { type: "url", url: "https://example.com/big.pdf" } }] }],
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "bad_content");
  });
});

describe("the private site's practice pages", () => {
  let server;
  before(async () => { server = await startServer({ SITE_PASSWORD: "hardening-pw" }); });
  after(async () => { await server.stop(); });

  test("upper-case paths are hidden too", async () => {
    for (const p of ["/OVA", "/Ova/ak9-matematik"]) {
      const r = await fetch(`${server.baseUrl}${p}`, { redirect: "manual" });
      assert.equal(r.status, 302, p);
    }
    assert.equal((await fetch(`${server.baseUrl}/SITEMAP.XML`)).status, 404);
  });
});
