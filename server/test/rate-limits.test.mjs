// The main suites all disable every attemptLimit via env (see harness.mjs) so
// they can hammer the server without tripping unrelated 429s. This file is
// the one place that deliberately turns limits back on, tight, to exercise
// the 429 path itself.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, startFakeResend } from "./harness.mjs";
import { totpAt } from "../src/totp.js";

const uniqueEmail = () => `ratelimit-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("signup rate limiting", () => {
  let server, client;
  before(async () => {
    server = await startServer({ SIGNUPS_PER_HOUR_PER_IP: "3" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("every signup attempt counts, success or not, and the 4th is blocked with Retry-After", async () => {
    for (let i = 0; i < 3; i++) {
      const { status } = await client.post("/api/auth/signup", { email: uniqueEmail(), password: "longenough", consent: true });
      assert.equal(status, 200);
    }
    const { status, json, res } = await client.post("/api/auth/signup", { email: uniqueEmail(), password: "longenough", consent: true });
    assert.equal(status, 429);
    assert.equal(json.error.code, "rate_limited");
    assert.ok(res.headers.get("retry-after"));
  });
});

describe("login failure rate limiting: per account", () => {
  let server, client;
  before(async () => {
    server = await startServer({ LOGIN_FAILS_PER_15MIN_PER_ACCOUNT: "3", LOGIN_FAILS_PER_15MIN_PER_IP: "0" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("only wrong passwords count - a successful login never trips the limit", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();
    for (let i = 0; i < 5; i++) {
      const { status } = await client.post("/api/auth/login", { email, password: "correctpw1" });
      assert.equal(status, 200);
    }
  });

  test("the 4th wrong password in a row for one account is blocked, a different account is unaffected", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    client.clearCookie();

    for (let i = 0; i < 3; i++) {
      const { status } = await client.post("/api/auth/login", { email, password: "wrongpassword" });
      assert.equal(status, 401);
    }
    const blocked = await client.post("/api/auth/login", { email, password: "wrongpassword" });
    assert.equal(blocked.status, 429);

    // A second, unrelated account on the same IP must not be affected - the
    // tight limit here is per-account, only the generous per-IP one (disabled
    // above) would have caught this.
    const otherEmail = uniqueEmail();
    await client.post("/api/auth/signup", { email: otherEmail, password: "correctpw1", consent: true });
    client.clearCookie();
    const other = await client.post("/api/auth/login", { email: otherEmail, password: "wrongpassword" });
    assert.equal(other.status, 401);
  });
});

describe("Google sign-in rate limiting: 401s count", () => {
  let server, client;
  before(async () => {
    server = await startServer({
      GOOGLE_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
      GOOGLE_SIGNIN_FAILS_PER_MIN_PER_IP: "3",
    });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("a syntactically invalid credential fails fast with 401 (no Google network call), and 3/min trips the 4th", async () => {
    for (let i = 0; i < 3; i++) {
      const { status, json } = await client.post("/api/auth/google", { credential: "not-a-jwt", consent: true });
      assert.equal(status, 401);
      assert.equal(json.error.code, "google_invalid");
    }
    const blocked = await client.post("/api/auth/google", { credential: "not-a-jwt", consent: true });
    assert.equal(blocked.status, 429);
  });
});

describe("Google sign-in rate limiting: a non-401/403 response never counts", () => {
  let server, client;
  before(async () => {
    // No GOOGLE_CLIENT_ID at all - every call short-circuits to 501 before
    // ever looking at the credential, which is a deterministic, network-free
    // way to see that a status outside [401, 403] never fills the bucket.
    server = await startServer({ GOOGLE_SIGNIN_FAILS_PER_MIN_PER_IP: "3" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("many 501s in a row never trip the limiter", async () => {
    for (let i = 0; i < 10; i++) {
      const { status, json } = await client.post("/api/auth/google", { credential: "anything", consent: true });
      assert.equal(status, 501);
      assert.equal(json.error.code, "google_not_configured");
    }
  });
});

describe("2FA verify rate limiting: minting a fresh challenge doesn't reset the account's budget", () => {
  let server, client;
  before(async () => {
    server = await startServer({ TWOFA_FAILS_PER_15MIN_PER_ACCOUNT: "3", TWOFA_FAILS_PER_15MIN_PER_IP: "0", RESEND_API_KEY: "dummy-test-key" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("wrong codes across several separately-minted challenges for one account still add up to the same limit", async () => {
    const email = `ratelimit-2fa-${Date.now()}@example.com`;
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const { json: { secret } } = await client.post("/api/auth/2fa/setup");
    const counter = Math.floor(Date.now() / 1000 / 30) + 1;
    await client.post("/api/auth/2fa/confirm", { password: "correctpw1", secret, code: totpAt(secret, counter) });
    client.clearCookie();

    // Three wrong guesses, each against its OWN freshly-minted challenge (a correct password
    // always mints a new one) — an attacker who already knows the password would do exactly this
    // to try to dodge a per-challenge limiter. The account-resolved key must still catch it.
    for (let i = 0; i < 3; i++) {
      const login = await client.post("/api/auth/login", { email, password: "correctpw1" });
      const { status } = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: "000000" });
      assert.equal(status, 401);
    }
    const login = await client.post("/api/auth/login", { email, password: "correctpw1" });
    const blocked = await client.post("/api/auth/2fa/verify", { challenge: login.json.challenge, code: "000000" });
    assert.equal(blocked.status, 429);
  });
});

describe("2FA management rate limiting: password re-entry", () => {
  let server, client;
  before(async () => {
    server = await startServer({ TWOFA_PASSWORD_FAILS_PER_15MIN_PER_ACCOUNT: "3", RESEND_API_KEY: "dummy-test-key" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("wrong passwords confirming a setup add up, a right one doesn't count", async () => {
    const email = `ratelimit-2fapw-${Date.now()}@example.com`;
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const { json: { secret } } = await client.post("/api/auth/2fa/setup");

    for (let i = 0; i < 3; i++) {
      const { status } = await client.post("/api/auth/2fa/confirm", { password: "wrongpassword1", secret, code: "000000" });
      assert.equal(status, 403);
    }
    const blocked = await client.post("/api/auth/2fa/confirm", { password: "wrongpassword1", secret, code: "000000" });
    assert.equal(blocked.status, 429);
  });
});

describe("set-password rate limiting: bad Google credentials", () => {
  let server, client;
  before(async () => {
    server = await startServer({
      GOOGLE_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
      SET_PASSWORD_FAILS_PER_15MIN_PER_ACCOUNT: "3",
    });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("repeated bad credentials on a Google-linked account trip the limit", async () => {
    const email = `ratelimit-setpw-${Date.now()}@example.com`;
    const now = Date.now();
    const id = "id-" + now;
    server.db.prepare(
      "INSERT INTO users (id, email, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, email, "unusable-hash", "google-sub-ratelimit", now);
    server.db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run("sess-" + now, id, now + 3600_000, now);
    client.cookie = "sb_session=sess-" + now;

    for (let i = 0; i < 3; i++) {
      const { status } = await client.post("/api/auth/set-password", { credential: "not-a-real-jwt", password: "newpassword1" });
      assert.equal(status, 401);
    }
    const blocked = await client.post("/api/auth/set-password", { credential: "not-a-real-jwt", password: "newpassword1" });
    assert.equal(blocked.status, 429);
  });
});

describe("email 2FA rate limiting", () => {
  let server, client, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({
      RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url,
      TWOFA_EMAIL_COOLDOWN_SEC: "60", TWOFA_EMAIL_SENDS_PER_DAY_PER_ACCOUNT: "3", TWOFA_EMAIL_RESENDS: "1",
      TWOFA_RESEND_PER_HOUR_PER_IP: "4",
    });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); await fake.stop(); });

  const PW = "correctpw1";
  async function enroll(email) {
    await client.post("/api/auth/signup", { email, password: PW, consent: true });
    const setup = await client.post("/api/auth/2fa/setup", { method: "email", password: PW });
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    const confirm = await client.post("/api/auth/2fa/confirm", { method: "email", challenge: setup.json.challenge, code: fake.lastCode(email) });
    assert.equal(confirm.status, 200);
    client.clearCookie();
  }

  test("a second sign-in inside the cooldown reuses the live challenge and sends no second mail", async () => {
    const email = `ratelimit-email2fa-${Date.now()}@example.com`;
    await enroll(email);
    const sent = fake.mailsTo(email).length;
    const a = await client.post("/api/auth/login", { email, password: PW });
    const b = await client.post("/api/auth/login", { email, password: PW });
    assert.equal(a.json.challenge, b.json.challenge);
    assert.equal(b.json.emailSent, true);
    assert.equal(fake.mailsTo(email).length, sent + 1);
  });

  test("re-sending inside the cooldown is refused, with the seconds left", async () => {
    const email = `ratelimit-email2fa-resend-${Date.now()}@example.com`;
    await enroll(email);
    const ch = await client.post("/api/auth/login", { email, password: PW });
    const tooSoon = await client.post("/api/auth/2fa/resend", { challenge: ch.json.challenge });
    assert.equal(tooSoon.status, 429);
    assert.equal(tooSoon.json.error.code, "twofa_cooldown");
    assert.ok(tooSoon.json.error.cooldownSec > 0);
  });

  test("once the daily cap on codes is spent, sign-in still returns a challenge — but with no code sent", async () => {
    const email = `ratelimit-email2fa-day-${Date.now()}@example.com`;
    await enroll(email);   // enrolment used 1 of the 3 daily codes
    server.db.prepare("UPDATE twofa_challenges SET last_sent_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);   // age out the cooldown
    const second = await client.post("/api/auth/login", { email, password: PW });   // code 2
    assert.equal(second.json.emailSent, true);
    server.db.prepare("UPDATE twofa_challenges SET last_sent_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
    const third = await client.post("/api/auth/login", { email, password: PW });    // code 3
    assert.equal(third.json.emailSent, true);
    server.db.prepare("UPDATE twofa_challenges SET last_sent_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
    const capped = await client.post("/api/auth/login", { email, password: PW });   // over the cap
    assert.equal(capped.status, 200);
    assert.equal(capped.json.twoFactorRequired, true);
    assert.equal(capped.json.emailSent, false);
  });

  test("the resend route is limited per IP", async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await client.post("/api/auth/2fa/resend", { challenge: "nope" });
    assert.equal(last.status, 429);
  });
});

describe("site password rate limiting: only wrong guesses count", () => {
  let server;
  before(async () => { server = await startServer({ SITE_PASSWORD: "right-one", SITE_GATE_FAILS_PER_15MIN_PER_IP: "3" }); });
  after(async () => { await server.stop(); });

  const guess = (password) => fetch(`${server.baseUrl}/api/gate`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
  });

  test("three wrong guesses, then even the right password waits", async () => {
    // A correct entry in between uses none of the allowance up.
    assert.equal((await guess("right-one")).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await guess("wrong-" + i)).status, 401);
    const blocked = await guess("right-one");
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));
  });
});
