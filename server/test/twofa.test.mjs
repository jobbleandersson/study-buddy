import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, makeClient } from "./harness.mjs";
import { totpAt } from "../src/totp.js";

const uniqueEmail = () => `twofa-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const PASSWORD = "correctpw1";

function codeFor(secret, { at = Date.now(), step = 1 } = {}) {
  return totpAt(secret, Math.floor(at / 1000 / 30) + step);
}

describe("two-factor authentication", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  async function signup() {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: PASSWORD, consent: true });
    return email;
  }

  /** Signs up, enables 2FA, and hands back the secret + backup codes for the tests that need
   *  them. Ends signed out (a fresh client) so each test starts from a clean login.
   *
   *  Uses step: -1 (the oldest counter verifyTotp's ±1 window still accepts) to confirm, not the
   *  default step: 1 — the replay guard's `afterCounter` is genuinely a real per-account value
   *  set the instant this call lands, and a test calling codeFor(secret) again moments later
   *  (same 30s wall-clock window, no real time elapsed) needs a *later* counter still inside that
   *  window to avoid colliding with the one enrollment itself just consumed. */
  async function enrolled() {
    const email = await signup();
    const setup = await client.post("/api/auth/2fa/setup");
    const secret = setup.json.secret;
    const confirm = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret, { step: -1 }) });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
    const backupCodes = confirm.json.backupCodes;
    client.clearCookie();
    return { email, secret, backupCodes };
  }

  test("setup returns a fresh secret and otpauth link, unpersisted", async () => {
    const email = await signup();
    const { status, json } = await client.post("/api/auth/2fa/setup");
    assert.equal(status, 200);
    assert.match(json.secret, /^[A-Z2-7]+$/);
    assert.match(json.otpauthUri, /^otpauth:\/\/totp\//);
    const row = server.db.prepare("SELECT totp_secret FROM users WHERE email = ?").get(email);
    assert.equal(row.totp_secret, null);   // setup alone never writes anything
  });

  test("confirm rejects the wrong password", async () => {
    await signup();
    const { json: { secret } } = await client.post("/api/auth/2fa/setup");
    const { status, json } = await client.post("/api/auth/2fa/confirm", { password: "wrongpassword1", secret, code: codeFor(secret) });
    assert.equal(status, 403);
    assert.equal(json.error.code, "confirm_mismatch");
  });

  test("confirm rejects a wrong code", async () => {
    await signup();
    const { json: { secret } } = await client.post("/api/auth/2fa/setup");
    const { status } = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: "000000" });
    assert.equal(status, 400);
  });

  test("confirm with the right password and code turns 2FA on and returns 10 backup codes", async () => {
    const email = await signup();
    const { json: { secret } } = await client.post("/api/auth/2fa/setup");
    const { status, json } = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret) });
    assert.equal(status, 200);
    assert.equal(json.backupCodes.length, 10);
    for (const c of json.backupCodes) assert.match(c, /^[0-9A-F]{5}-[0-9A-F]{5}$/);

    const row = server.db.prepare("SELECT totp_enabled_at FROM users WHERE email = ?").get(email);
    assert.ok(row.totp_enabled_at > 0);
    const me = await client.get("/api/auth/me");
    assert.equal(me.json.totpEnabled, true);
  });

  test("logging in with the right password now returns a challenge instead of a session", async () => {
    const { email } = await enrolled();
    const { status, json, res } = await client.post("/api/auth/login", { email, password: PASSWORD });
    assert.equal(status, 200);
    assert.equal(json.twoFactorRequired, true);
    assert.ok(json.challenge);
    assert.equal(res.headers.getSetCookie().length, 0);   // no session yet
  });

  test("the right TOTP code at the challenge signs in", async () => {
    const { email, secret } = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    const { status, json, res } = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: codeFor(secret) });
    assert.equal(status, 200);
    assert.equal(json.email, email);
    assert.ok(res.headers.getSetCookie().length > 0);
    const me = await client.get("/api/auth/me");
    assert.equal(me.json.authed, true);
  });

  test("a wrong code can be retried with the challenge still alive", async () => {
    const { email, secret } = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    const bad = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: "000000" });
    assert.equal(bad.status, 401);
    const good = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: codeFor(secret) });
    assert.equal(good.status, 200);
  });

  test("the same TOTP code cannot be replayed a second time", async () => {
    const { email, secret } = await enrolled();
    const code = codeFor(secret);
    const login1 = await client.post("/api/auth/login", { email, password: PASSWORD });
    const first = await client.post("/api/auth/2fa/verify", { challenge: login1.json.challenge, code });
    assert.equal(first.status, 200);

    const login2 = await client.post("/api/auth/login", { email, password: PASSWORD });
    const second = await client.post("/api/auth/2fa/verify", { challenge: login2.json.challenge, code });
    assert.equal(second.status, 401);
  });

  test("a backup code signs in once, then is rejected on reuse", async () => {
    const { email, backupCodes } = await enrolled();
    const login1 = await client.post("/api/auth/login", { email, password: PASSWORD });
    const first = await client.post("/api/auth/2fa/verify", { challenge: login1.json.challenge, code: backupCodes[0] });
    assert.equal(first.status, 200);

    const login2 = await client.post("/api/auth/login", { email, password: PASSWORD });
    const second = await client.post("/api/auth/2fa/verify", { challenge: login2.json.challenge, code: backupCodes[0] });
    assert.equal(second.status, 401);
  });

  test("two concurrent verifies with the same challenge and code: exactly one 200", async () => {
    const { email, secret } = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    const code = codeFor(secret);
    const [a, b] = await Promise.all([
      client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code }),
      client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 401]);
  });

  test("an expired challenge is rejected", async () => {
    const { email } = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    server.db.prepare("UPDATE twofa_challenges SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, login.json.challenge);
    const { status } = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: "123456" });
    assert.equal(status, 401);
  });

  test("disabling 2FA needs the password, revokes other sessions, but keeps the acting one", async () => {
    const { email, secret } = await enrolled();
    // Each successful TOTP check ratchets the account's accepted-counter watermark forward, and
    // the ±1-step window only ever spans 3 distinct counters at a time — so two independent
    // logins in the same test must use *ascending* steps (enrolled() already used -1) or the
    // second would look like a replay of something older than what's already been accepted.
    const login1 = await client.post("/api/auth/login", { email, password: PASSWORD });
    await client.post("/api/auth/2fa/verify", { challenge: login1.json.challenge, code: codeFor(secret, { step: 0 }) });
    const thisCookie = client.cookie;

    const other = makeClient(server.baseUrl);
    const login2 = await other.post("/api/auth/login", { email, password: PASSWORD });
    const otherVerify = await other.post("/api/auth/2fa/verify", { challenge: login2.json.challenge, code: codeFor(secret, { step: 1 }) });
    assert.equal(otherVerify.status, 200, JSON.stringify(otherVerify.json));
    assert.equal((await other.get("/api/auth/me")).json.authed, true);

    const wrongPw = await client.post("/api/auth/2fa/disable", { password: "wrongpassword1" });
    assert.equal(wrongPw.status, 403);

    const disable = await client.post("/api/auth/2fa/disable", { password: PASSWORD });
    assert.equal(disable.status, 200);
    assert.equal(client.cookie, thisCookie, "disable's response sets no new cookie of its own");

    assert.equal((await client.get("/api/auth/me")).json.authed, true, "the acting session must survive its own disable call");
    assert.equal((await other.get("/api/auth/me")).json.authed, false, "every other session must be revoked");

    const row = server.db.prepare("SELECT totp_secret, totp_enabled_at FROM users WHERE email = ?").get(email);
    assert.equal(row.totp_secret, null);
    assert.equal(row.totp_enabled_at, null);

    // 2FA is off now: a plain login signs straight in.
    const freshLogin = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: PASSWORD });
    assert.equal(freshLogin.json.twoFactorRequired, undefined);
  });

  test("regenerating backup codes invalidates the old ones", async () => {
    const { email, secret, backupCodes } = await enrolled();
    const login1 = await client.post("/api/auth/login", { email, password: PASSWORD });
    await client.post("/api/auth/2fa/verify", { challenge: login1.json.challenge, code: codeFor(secret) });

    const regen = await client.post("/api/auth/2fa/backup-codes/regenerate", { password: PASSWORD });
    assert.equal(regen.status, 200);
    assert.equal(regen.json.backupCodes.length, 10);
    assert.notDeepEqual(regen.json.backupCodes, backupCodes);

    const login2 = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: PASSWORD });
    const oldStillDead = await makeClient(server.baseUrl).post("/api/auth/2fa/verify", { challenge: login2.json.challenge, code: backupCodes[1] });
    assert.equal(oldStillDead.status, 401);

    const login3 = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: PASSWORD });
    const newWorks = await makeClient(server.baseUrl).post("/api/auth/2fa/verify", { challenge: login3.json.challenge, code: regen.json.backupCodes[1] });
    assert.equal(newWorks.status, 200);
  });

  test("resetting the password on a 2FA account gates on a code too, but the new password is already live", async () => {
    const { email, secret } = await enrolled();
    const userId = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    server.db.prepare("INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, token, now + 3600_000, now);

    const reset = await client.post("/api/auth/reset-password", { token, password: "brandnewpw1" });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.twoFactorRequired, true);
    assert.equal(client.cookie, null, "no session yet — the 2FA step is still pending");

    // The new password is live and the account isn't locked out: finishing the challenge signs in.
    const verify = await client.post("/api/auth/2fa/verify", { challenge: reset.json.challenge, code: codeFor(secret) });
    assert.equal(verify.status, 200);

    // The old password no longer works.
    const oldPw = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: PASSWORD });
    assert.equal(oldPw.status, 401);
  });

  test("account deletion removes backup codes and any pending challenge", async () => {
    const { email, secret, backupCodes } = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: codeFor(secret) });
    const userId = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;

    await client.delete("/api/account", { password: PASSWORD });

    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM totp_backup_codes WHERE user_id = ?").get(userId).n, 0);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM twofa_challenges WHERE user_id = ?").get(userId).n, 0);
  });
});
