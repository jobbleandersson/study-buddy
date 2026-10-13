import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, startFakeResend } from "./harness.mjs";
import { reportServerError, routeLabel, _resetAlerts } from "../src/alerts.js";

const OWNER = "owner@example.com";
const uniqueEmail = () => `alert-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const review = { rating: 4, text: "Hjälpte mig plugga inför provet.", name: "Elin", context: "Elev, åk 9", lang: "sv", consent: true };

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(25); }
  return fn();
}

describe("reportServerError (rate limiting)", () => {
  const HOUR = 60 * 60_000;
  const t0 = Date.parse("2026-10-14T10:00:00Z");
  let sent, clock;
  const send = (m) => { sent.push(m); return Promise.resolve(true); };
  const report = (where, message, extra = {}) => reportServerError({ where, err: new Error(message), send, now: () => clock, enabled: true, ...extra });

  beforeEach(() => { _resetAlerts(); sent = []; clock = t0; delete process.env.ALERT_ERRORS_PER_DAY; });

  test("the first error mails; the same error on the same route within the hour does not", () => {
    assert.equal(report("POST /api/state", "boom"), "sent");
    assert.equal(report("POST /api/state", "boom"), "suppressed");
    assert.equal(report("POST /api/state", "boom"), "suppressed");
    assert.equal(sent.length, 1);
  });

  test("an hour later it mails again and says how many it held back", () => {
    report("POST /api/state", "boom");
    report("POST /api/state", "boom");
    report("POST /api/state", "boom");
    clock = t0 + HOUR + 1;
    assert.equal(report("POST /api/state", "boom"), "sent");
    assert.equal(sent[1].suppressed, 2);
  });

  test("a different message or a different route is its own error", () => {
    assert.equal(report("POST /api/state", "boom"), "sent");
    assert.equal(report("POST /api/state", "another thing"), "sent");
    assert.equal(report("GET /api/friends/leaderboard", "boom"), "sent");
    assert.equal(sent.length, 3);
  });

  test("at most ALERT_ERRORS_PER_DAY mails a day, then they start over at midnight UTC", () => {
    process.env.ALERT_ERRORS_PER_DAY = "2";
    assert.equal(report("a", "1"), "sent");
    assert.equal(report("b", "2"), "sent");
    assert.equal(report("c", "3"), "suppressed");
    clock = Date.parse("2026-10-15T00:00:01Z");
    assert.equal(report("c", "3"), "sent");
  });

  test("ALERT_ERRORS_PER_DAY=0 and email being off both mean nothing is sent", () => {
    process.env.ALERT_ERRORS_PER_DAY = "0";
    assert.equal(report("a", "1"), "off");
    delete process.env.ALERT_ERRORS_PER_DAY;
    assert.equal(report("a", "1", { enabled: false }), "off");
    assert.equal(sent.length, 0);
  });

  test("a mail carries the message and the top of the stack, nothing else", () => {
    report("POST /api/state", "boom");
    assert.deepEqual(Object.keys(sent[0]).sort(), ["at", "message", "stack", "suppressed", "where"]);
    assert.match(sent[0].stack, /boom/);
    assert.ok(sent[0].stack.split("\n").length <= 8);
  });

  test("a mailer that throws or rejects never surfaces", () => {
    assert.equal(report("a", "1", { send: () => { throw new Error("mailer down"); } }), "off");
    assert.equal(report("b", "2", { send: () => Promise.reject(new Error("mailer down")) }), "sent");
  });
});

test("routeLabel drops the query string and replaces ids", () => {
  assert.equal(routeLabel("post", "/api/reviews?token=secret"), "POST /api/reviews");
  assert.equal(routeLabel("GET", "/api/admin/reviews/0a1b2c3d-4e5f"), "GET /api/admin/reviews/:id");
  assert.equal(routeLabel("DELETE", "/api/friends/abc"), "DELETE /api/friends/abc");
});

describe("alert emails from a running server", () => {
  let server, fake;
  const owner = () => fake.mailsTo(OWNER);
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url, ALERT_EMAIL: OWNER, PUBLIC_URL: "https://pluggera.test" });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  async function signedIn() {
    const c = makeClient(server.baseUrl);
    const email = uniqueEmail();
    await c.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    return { c, email };
  }

  test("a new review mails the owner with the review and a link to the queue", async () => {
    const { c } = await signedIn();
    assert.equal((await c.post("/api/reviews", review)).status, 200);
    const mail = await waitFor(() => owner()[0]);
    assert.ok(mail, "the owner got a mail");
    assert.match(mail.subject, /ny recension/);
    assert.match(mail.subject, /4\/5/);
    assert.match(mail.html, /Hjälpte mig plugga inför provet\./);
    assert.match(mail.html, /Elin/);
    assert.match(mail.html, /★★★★☆/);
    assert.match(mail.html, /https:\/\/pluggera\.test\/#\/admin\/reviews/);
  });

  test("the mail never contains the student's email address or anything from their account", async () => {
    const before = owner().length;
    const { c, email } = await signedIn();
    await c.post("/api/reviews", { ...review, name: "Sofia" });
    await waitFor(() => owner().length > before);
    const mail = owner()[owner().length - 1];
    assert.ok(!mail.html.includes(email));
    assert.ok(!mail.html.includes(email.split("@")[0]));
  });

  test("what the student typed is escaped in the mail", async () => {
    const before = owner().length;
    const { c } = await signedIn();
    await c.post("/api/reviews", { ...review, text: 'Bra <script>alert("x")</script> & mer', context: "<b>åk 9</b>" });
    await waitFor(() => owner().length > before);
    const html = owner()[owner().length - 1].html;
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<b>åk 9</b>"));
    assert.match(html, /&lt;script&gt;/);
  });

  test("changing a review mails again, as a changed review", async () => {
    const { c } = await signedIn();
    const base = owner().length;
    await c.post("/api/reviews", review);
    await waitFor(() => owner().length > base);          // the first review's mail has landed...
    assert.match(owner()[owner().length - 1].subject, /ny recension/);
    const n = owner().length;                             // ...so the next one to arrive is the change
    await c.post("/api/reviews", { ...review, rating: 2, text: "Ändrade mig, nu lite sämre." });
    await waitFor(() => owner().length > n);
    assert.match(owner()[owner().length - 1].subject, /ändrad recension/);
  });

  test("a rejected review (bad input) sends no mail", async () => {
    const { c } = await signedIn();
    const n = owner().length;
    assert.equal((await c.post("/api/reviews", { ...review, rating: 0 })).status, 400);
    await sleep(300);
    assert.equal(owner().length, n);
  });

  test("a mail provider that is down does not break sending a review", async () => {
    const { c } = await signedIn();
    fake.failing = true;
    try {
      const res = await c.post("/api/reviews", review);
      assert.equal(res.status, 200);
      assert.equal(res.json.status, "pending");
    } finally { fake.failing = false; }
  });
});

describe("a server error mails the owner, once", () => {
  let server, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url, ALERT_EMAIL: OWNER });
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("a real 500 (the reviews table is gone) mails the route and the error, and repeats do not mail again", async () => {
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email: uniqueEmail(), password: "correctpw1", consent: true });
    server.db.exec("DROP TABLE reviews");

    const first = await c.post("/api/reviews", review);
    assert.equal(first.status, 500);
    assert.equal(first.json.error.code, "server_error");

    const mail = await waitFor(() => fake.mailsTo(OWNER)[0]);
    assert.ok(mail, "the owner got a mail");
    assert.match(mail.subject, /serverfel/);
    assert.match(mail.subject, /POST \/api\/reviews/);
    assert.match(mail.html, /no such table/);

    assert.equal((await c.post("/api/reviews", review)).status, 500);
    assert.equal((await c.post("/api/reviews", review)).status, 500);
    await sleep(400);
    assert.equal(fake.mailsTo(OWNER).length, 1, "the same error is mailed once an hour, not every time");
  });

  test("a bad request (a 400) is not a server error and sends nothing", async () => {
    const before = fake.mailsTo(OWNER).length;
    const c = makeClient(server.baseUrl);
    await c.post("/api/auth/signup", { email: uniqueEmail(), password: "correctpw1", consent: true });
    assert.equal((await c.post("/api/reviews", { ...review, rating: 0 })).status, 400);
    await sleep(300);
    assert.equal(fake.mailsTo(OWNER).length, before);
  });
});
