import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, makeClient, startFakeResend } from "./harness.mjs";
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

  /** Signs up, enables 2FA, and hands back the secret for the tests that need
   *  it. Ends signed out (a fresh client) so each test starts from a clean login.
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
    // step -1 sits at the very edge of the server's ±1 window, so if a 30s boundary ticks over
    // between generating the code and the server checking it, it falls out — retry once with a
    // freshly generated code rather than flake (about a one-in-thousands timing coincidence).
    let confirm = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret, { step: -1 }) });
    if (confirm.status === 400) confirm = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret, { step: -1 }) });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
    client.clearCookie();
    return { email, secret };
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

  test("confirm with the right password and code turns 2FA on", async () => {
    const email = await signup();
    const { json: { secret } } = await client.post("/api/auth/2fa/setup");
    const { status, json } = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret) });
    assert.equal(status, 200);
    assert.equal(json.backupCodes, undefined);

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

  test("there are no backup codes: enrolment returns none and a code-shaped string never signs in", async () => {
    const { email, secret } = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    const guess = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: "AAAAA-11111" });
    assert.equal(guess.status, 401);
    const real = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: codeFor(secret) });
    assert.equal(real.status, 200);
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

  test("the backup-code regenerate route no longer exists", async () => {
    const { email, secret } = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: codeFor(secret) });
    const res = await client.post("/api/auth/2fa/backup-codes/regenerate", { password: PASSWORD });
    assert.notEqual(res.status, 200);
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

  test("account deletion removes any pending challenge and leftover legacy backup rows", async () => {
    const { email, secret} = await enrolled();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: codeFor(secret) });
    const userId = server.db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;

    await client.delete("/api/account", { password: PASSWORD });

    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM totp_backup_codes WHERE user_id = ?").get(userId).n, 0);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM twofa_challenges WHERE user_id = ?").get(userId).n, 0);
  });
});

describe("two-factor authentication: email method", () => {
  let server, client, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); await fake.stop(); });

  async function signup() {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: PASSWORD, consent: true });
    // Signup mails its verification link without waiting for it (best-effort, routes/auth.js), so it
    // can land after the response. Wait for it here: otherwise a test that counts this address's mail
    // can see it arrive mid-test, and lastCode() can pick it up instead of the 2FA code.
    for (let i = 0; i < 100 && fake.mailsTo(email).length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    return email;
  }
  const row = (email) => server.db.prepare(
    "SELECT id, twofa_method AS method, totp_secret AS secret, totp_enabled_at AS enabledAt FROM users WHERE email = ?").get(email);
  const challengeRow = (id) => server.db.prepare("SELECT attempts, used_at AS usedAt, resends FROM twofa_challenges WHERE id = ?").get(id);

  /** Signs up and turns email 2FA on, ending signed out. */
  async function enrolled() {
    const email = await signup();
    const setup = await client.post("/api/auth/2fa/setup", { method: "email", password: PASSWORD });
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    const confirm = await client.post("/api/auth/2fa/confirm", { method: "email", challenge: setup.json.challenge, code: fake.lastCode(email) });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
    client.clearCookie();
    return { email };
  }
  async function loginChallenge(email) {
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    assert.equal(login.json.twoFactorRequired, true);
    return login.json;
  }
  const otherThan = (code) => (code === "000000" ? "111111" : "000000");

  test("setup mails a code, needs the password, and turns nothing on by itself", async () => {
    const email = await signup();
    const before = fake.mailsTo(email).length;
    const wrong = await client.post("/api/auth/2fa/setup", { method: "email", password: "wrongpassword1" });
    assert.equal(wrong.status, 403);
    assert.equal(fake.mailsTo(email).length, before, "a wrong password must not send anything");

    const setup = await client.post("/api/auth/2fa/setup", { method: "email", password: PASSWORD });
    assert.equal(setup.status, 200);
    assert.equal(setup.json.method, "email");
    assert.match(fake.lastCode(email), /^\d{6}$/);
    assert.equal(row(email).enabledAt, null);
    const mail = fake.mailsTo(email).at(-1);
    assert.ok(!/\d{6}/.test(mail.subject), "the code must not be in the subject line");
  });

  test("confirming with the emailed code turns email 2FA on and returns no backup codes", async () => {
    const email = await signup();
    const setup = await client.post("/api/auth/2fa/setup", { method: "email", password: PASSWORD });
    const confirm = await client.post("/api/auth/2fa/confirm", { method: "email", challenge: setup.json.challenge, code: fake.lastCode(email) });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.json.backupCodes, undefined);
    const r = row(email);
    assert.equal(r.method, "email");
    assert.equal(r.secret, null);
    const me = await client.get("/api/auth/me");
    assert.equal(me.json.totpEnabled, true);
    assert.equal(me.json.twofaMethod, "email");

    const again = await client.post("/api/auth/2fa/setup", { method: "email", password: PASSWORD });
    assert.equal(again.status, 400);
    assert.equal(again.json.error.code, "twofa_already_on");
  });

  test("a wrong enrolment code is rejected, and five of them burn the challenge", async () => {
    const email = await signup();
    const setup = await client.post("/api/auth/2fa/setup", { method: "email", password: PASSWORD });
    const real = fake.lastCode(email);
    for (let i = 0; i < 5; i++) {
      const r = await client.post("/api/auth/2fa/confirm", { method: "email", challenge: setup.json.challenge, code: otherThan(real) });
      assert.equal(r.status, 400);
    }
    const late = await client.post("/api/auth/2fa/confirm", { method: "email", challenge: setup.json.challenge, code: real });
    assert.equal(late.status, 400, "the right code is no use once the attempts are spent");
    assert.equal(row(email).enabledAt, null);
  });

  test("signing in mails a code; the code (not just the password) opens a session", async () => {
    const { email } = await enrolled();
    const sent = fake.mailsTo(email).length;
    const ch = await loginChallenge(email);
    assert.equal(ch.method, "email");
    assert.equal(ch.emailSent, true);
    assert.equal(fake.mailsTo(email).length, sent + 1);
    assert.equal(client.cookie, null);

    const { status, json } = await client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: fake.lastCode(email) });
    assert.equal(status, 200);
    assert.equal(json.twofaMethod, "email");
    assert.equal((await client.get("/api/auth/me")).json.authed, true);
  });

  test("a wrong code can be retried; five wrong ones kill the challenge", async () => {
    const { email } = await enrolled();
    const ch = await loginChallenge(email);
    const real = fake.lastCode(email);
    const first = await client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: otherThan(real) });
    assert.equal(first.status, 401);
    const ok = await client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: real });
    assert.equal(ok.status, 200);

    client.clearCookie();
    const ch2 = await loginChallenge(email);
    const real2 = fake.lastCode(email);
    for (let i = 0; i < 5; i++) await client.post("/api/auth/2fa/verify", { challenge: ch2.challenge, code: otherThan(real2) });
    const dead = await client.post("/api/auth/2fa/verify", { challenge: ch2.challenge, code: real2 });
    assert.equal(dead.status, 401);
    assert.equal(dead.json.error.code, "twofa_restart");
  });

  test("a burst of parallel guesses can never exceed the attempt cap", async () => {
    const { email } = await enrolled();
    const ch = await loginChallenge(email);
    const real = fake.lastCode(email);
    await Promise.all(Array.from({ length: 15 }, () => client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: otherThan(real) })));
    assert.ok(challengeRow(ch.challenge).attempts <= 5);
  });

  test("two parallel submits of the right code: exactly one signs in", async () => {
    const { email } = await enrolled();
    const ch = await loginChallenge(email);
    const code = fake.lastCode(email);
    const [a, b] = await Promise.all([
      client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code }),
      client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 401]);
  });

  test("if the mail can't be sent, sign-in still gets a challenge, and a resend works once the provider recovers", async () => {
    const { email } = await enrolled();
    fake.failing = true;
    let ch;
    try {
      ch = await loginChallenge(email);
      assert.equal(ch.emailSent, false);
    } finally { fake.failing = false; }
    const resend = await client.post("/api/auth/2fa/resend", { challenge: ch.challenge });
    assert.equal(resend.status, 200);
    const signedIn = await client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: fake.lastCode(email) });
    assert.equal(signedIn.status, 200);
  });


  test("resending replaces the code: the old one stops working, the new one works", async () => {
    const { email } = await enrolled();
    const ch = await loginChallenge(email);
    const first = fake.lastCode(email);
    const resend = await client.post("/api/auth/2fa/resend", { challenge: ch.challenge });
    assert.equal(resend.status, 200);
    const second = fake.lastCode(email);
    if (second !== first) {
      assert.equal((await client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: first })).status, 401);
    }
    assert.equal((await client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: second })).status, 200);
  });

  test("a failed resend reports 502 and counts nothing", async () => {
    const { email } = await enrolled();
    const ch = await loginChallenge(email);
    fake.failing = true;
    try {
      const r = await client.post("/api/auth/2fa/resend", { challenge: ch.challenge });
      assert.equal(r.status, 502);
      assert.equal(challengeRow(ch.challenge).resends, 0);
    } finally { fake.failing = false; }
  });

  test("an enrolment challenge cannot be redeemed as a sign-in, nor a sign-in challenge as an enrolment", async () => {
    const email = await signup();
    const setup = await client.post("/api/auth/2fa/setup", { method: "email", password: PASSWORD });
    const enrollCode = fake.lastCode(email);
    const asLogin = await makeClient(server.baseUrl).post("/api/auth/2fa/verify", { challenge: setup.json.challenge, code: enrollCode });
    assert.equal(asLogin.status, 401);
    assert.equal(asLogin.json.error.code, "twofa_restart");

    const other = makeClient(server.baseUrl);
    const otherEmail = uniqueEmail();
    await other.post("/api/auth/signup", { email: otherEmail, password: PASSWORD, consent: true });
    const otherSetup = await other.post("/api/auth/2fa/setup", { method: "email", password: PASSWORD });
    await other.post("/api/auth/2fa/confirm", { method: "email", challenge: otherSetup.json.challenge, code: fake.lastCode(otherEmail) });
    const ch = await makeClient(server.baseUrl).post("/api/auth/login", { email: otherEmail, password: PASSWORD });
    const loginCode = fake.lastCode(otherEmail);
    const asEnroll = await client.post("/api/auth/2fa/confirm", { method: "email", challenge: ch.json.challenge, code: loginCode });
    assert.equal(asEnroll.status, 400);
    assert.equal(row(email).enabledAt, null);
  });

  test("turning it off clears the method and any pending challenge", async () => {
    const { email } = await enrolled();
    const ch = await loginChallenge(email);
    await client.post("/api/auth/2fa/verify", { challenge: ch.challenge, code: fake.lastCode(email) });
    const pending = await makeClient(server.baseUrl).post("/api/auth/login", { email, password: PASSWORD });
    const off = await client.post("/api/auth/2fa/disable", { password: PASSWORD });
    assert.equal(off.status, 200);
    const r = row(email);
    assert.equal(r.method, null);
    assert.equal(r.enabledAt, null);
    const after = await makeClient(server.baseUrl).post("/api/auth/2fa/verify", { challenge: pending.json.challenge, code: "123456" });
    assert.equal(after.json.error.code, "twofa_restart");
  });

  test("resetting the password signs an email-2FA account straight in (same inbox, no second code)", async () => {
    const { email } = await enrolled();
    const userId = row(email).id;
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    server.db.prepare("INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, token, now + 3600_000, now);
    const reset = await client.post("/api/auth/reset-password", { token, password: "brandnewpw1" });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.twoFactorRequired, undefined);
    assert.equal((await client.get("/api/auth/me")).json.authed, true);
  });

  test("an authenticator-app account sends no mail at sign-in, and a pre-method row still counts as TOTP", async () => {
    const email = await signup();
    const setup = await client.post("/api/auth/2fa/setup");
    assert.equal(setup.json.method, "totp");
    const secret = setup.json.secret;
    const confirm = await client.post("/api/auth/2fa/confirm", { password: PASSWORD, secret, code: codeFor(secret, { step: -1 }) });
    assert.equal(confirm.json.method, "totp");
    client.clearCookie();
    server.db.prepare("UPDATE users SET twofa_method = NULL WHERE email = ?").run(email);   // what an old row looks like

    const codeMails = () => fake.mailsTo(email).filter((m) => />\d{6}</.test(m.html)).length;   // the async "2FA turned on" notice can land late, so count only mails carrying a code
    const sent = codeMails();
    const login = await client.post("/api/auth/login", { email, password: PASSWORD });
    assert.equal(login.json.method, "totp");
    assert.equal(codeMails(), sent);
    assert.equal((await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: codeFor(secret, { step: 0 }) })).status, 200);
  });
});
