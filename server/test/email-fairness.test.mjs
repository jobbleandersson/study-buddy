import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, startFakeResend } from "./harness.mjs";

// Verification and reset mail can be triggered by anyone, on a mail plan with a small daily budget. One
// requester must not be able to use the day up for everybody (new students get no verification mail,
// nobody gets a reset), nor mail strangers over and over.

const email = () => `ef-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const VERIFY = "Bekräfta din e-post för PluggEra · Confirm your email for PluggEra";
const RESET = "Återställ ditt lösenord på PluggEra · Reset your PluggEra password";
const settle = () => new Promise((r) => setTimeout(r, 400));   // mail is sent after the response
const count = (fake, subject, to) => fake.mails.filter((m) => m.subject === subject && (!to || m.to === to)).length;
async function signup(baseUrl, addr = email()) {
  const c = makeClient(baseUrl);
  const r = await c.post("/api/auth/signup", { email: addr, password: "correctpw1", consent: true });
  assert.equal(r.status, 200);
  return { c, addr };
}

describe("per requester and per address", () => {
  let fake, server;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({
      RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url,
      MAIL_VERIFY_PER_DAY_PER_IP: "3", MAIL_VERIFY_PER_HOUR_PER_ADDRESS: "2",
      MAIL_RESET_PER_DAY_PER_IP: "2", MAIL_RESET_PER_HOUR_PER_ADDRESS: "2",
    });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("one requester gets at most 3 verification mails; every account is still made", async () => {
    const made = [];
    for (let i = 0; i < 6; i++) made.push(await signup(server.baseUrl));
    await settle();
    assert.equal(count(fake, VERIFY), 3);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email IN (" + made.map(() => "?").join(",") + ")").get(...made.map((m) => m.addr)).n, 6);
    // The student whose mail was held back can ask for it again, but the requester's allowance is spent: a clear 429.
    const last = made[5];
    const again = await last.c.post("/api/auth/verify-email/resend");
    assert.equal(again.status, 429);
    assert.equal(again.json.error.code, "too_many_mails");
  });

  test("password reset: the same reply for everyone, a limit per address and per requester", async () => {
    const accounts = [];
    for (let i = 0; i < 3; i++) { const a = await signup(server.baseUrl); a.c.clearCookie(); accounts.push(a); }
    const askReset = async (addr) => {
      server.db.prepare("DELETE FROM password_reset_tokens").run();   // skip the 2-minute wait between mails to one address
      const r = await makeClient(server.baseUrl).post("/api/auth/forgot-password", { email: addr });
      assert.deepEqual([r.status, r.json], [200, { ok: true }], "always the same answer");
    };
    await askReset(accounts[0].addr);
    await askReset(accounts[0].addr);
    await askReset(accounts[0].addr);   // third for this address: per-address limit is 2
    await settle();
    assert.equal(count(fake, RESET, accounts[0].addr), 2);
    await askReset(accounts[1].addr);   // third reset mail from this requester: per-requester limit is 2
    await askReset("nobody-" + email());
    await settle();
    assert.equal(count(fake, RESET), 2, "the requester's allowance of 2 is used up");
  });
});

describe("the recipient's allowance", () => {
  let fake, server;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url, FLY_APP_NAME: "test", MAIL_VERIFY_PER_HOUR_PER_ADDRESS: "1", MAIL_RESET_PER_HOUR_PER_ADDRESS: "1", MAIL_RESET_PER_DAY_PER_IP: "2" });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("'send the link again' is a 429 once the address has had its mail this hour", async () => {
    const { c } = await signup(server.baseUrl);   // the signup mail is that address's one
    const again = await c.post("/api/auth/verify-email/resend");
    assert.equal(again.status, 429);
    assert.equal(again.json.error.code, "too_many_mails");
  });

  test("a requester that is over its limit does not use up the victim's allowance", async () => {
    const victim = await signup(server.baseUrl); victim.c.clearCookie();
    const others = [];
    for (let i = 0; i < 2; i++) { const o = await signup(server.baseUrl); o.c.clearCookie(); others.push(o); }
    const ask = async (addr, ip) => {
      server.db.prepare("DELETE FROM password_reset_tokens").run();   // skip the 2-minute wait between mails to one address
      await fetch(server.baseUrl + "/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": ip }, body: JSON.stringify({ email: addr }) });
    };
    await ask(others[0].addr, "10.0.0.1"); await ask(others[1].addr, "10.0.0.1");   // requester A's 2 resets are spent
    for (let i = 0; i < 5; i++) await ask(victim.addr, "10.0.0.1");                  // refused for A: must not count against the victim
    await ask(victim.addr, "10.0.0.2");                                              // requester B, within its limit
    await settle();
    assert.equal(count(fake, RESET, victim.addr), 1, "the victim's allowance was not used by the refused requests");
  });
});

describe("a flood of one kind of mail does not starve another", () => {
  let fake, server;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({
      RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url, EMAIL_DAILY_BUDGET: "20",
      MAIL_VERIFY_PER_DAY_PER_IP: "0", MAIL_VERIFY_PER_HOUR_PER_ADDRESS: "0", MAIL_RESET_PER_DAY_PER_IP: "0", MAIL_RESET_PER_HOUR_PER_ADDRESS: "0",
    });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("after verification mail has used its share, resets still use theirs", async () => {
    const accounts = [];
    for (let i = 0; i < 14; i++) { const a = await signup(server.baseUrl); a.c.clearCookie(); accounts.push(a); }
    await settle();
    assert.equal(count(fake, VERIFY), 6, "30% of a budget of 20");
    for (const a of accounts.slice(0, 9)) {
      server.db.prepare("DELETE FROM password_reset_tokens").run();
      await makeClient(server.baseUrl).post("/api/auth/forgot-password", { email: a.addr });
      await settle();
    }
    assert.equal(count(fake, RESET), 7, "35% of 20; they used to share one counter and only 4 would have gone out");
  });
});
