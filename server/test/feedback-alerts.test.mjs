import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, startFakeResend } from "./harness.mjs";
import { reportNewFeedback, _resetAlerts } from "../src/alerts.js";

const OWNER = "owner@example.com";
const KEEP_MS = 30 * 24 * 60 * 60_000;   // the same 30 days as FEEDBACK_RESOLVED_KEEP_MS in sweep.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniqueEmail = () => `fbalert-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(25); }
  return fn();
}

describe("reportNewFeedback (batching and caps)", () => {
  const MIN = 60_000;
  const t0 = Date.parse("2026-10-21T10:00:00Z");
  let sent, clock, timers;
  const send = (m) => { sent.push(m); return Promise.resolve(true); };
  const schedule = (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; };
  const report = (kind) => reportNewFeedback({ kind, send, now: () => clock, enabled: true, schedule });

  beforeEach(() => {
    _resetAlerts(); sent = []; clock = t0; timers = [];
    delete process.env.FEEDBACK_ALERT_MINUTES; delete process.env.FEEDBACK_ALERTS_PER_DAY;
  });

  test("the first feedback after a quiet spell mails at once", () => {
    assert.equal(report("idea"), "sent");
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].counts, { idea: 1, problem: 0, praise: 0, other: 0 });
    assert.equal(sent[0].total, 1);
  });

  test("more within the window wait, and go out together when it ends", () => {
    report("idea");
    clock = t0 + 5 * MIN;
    assert.equal(report("problem"), "queued");
    assert.equal(report("problem"), "queued");
    assert.equal(report("praise"), "queued");
    assert.equal(sent.length, 1, "nothing more yet");
    assert.equal(timers.length, 1, "one timer, not one per message");
    assert.equal(timers[0].ms, 25 * MIN, "it fires when 30 minutes have passed since the last mail");
    clock = t0 + 30 * MIN;
    timers[0].fn();
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].counts, { idea: 0, problem: 2, praise: 1, other: 0 });
    assert.equal(sent[1].total, 3);
  });

  test("an unknown kind is counted as other", () => {
    report("whatever");
    assert.equal(sent[0].counts.other, 1);
  });

  test("FEEDBACK_ALERT_MINUTES=0 turns the mails off", () => {
    process.env.FEEDBACK_ALERT_MINUTES = "0";
    assert.equal(report("idea"), "off");
    assert.equal(sent.length, 0);
  });

  test("with email off nothing is sent", () => {
    assert.equal(reportNewFeedback({ kind: "idea", send, now: () => clock, enabled: false, schedule }), "off");
    assert.equal(sent.length, 0);
  });

  test("at most FEEDBACK_ALERTS_PER_DAY a day; what is over waits for the next mail", () => {
    process.env.FEEDBACK_ALERT_MINUTES = "1";
    process.env.FEEDBACK_ALERTS_PER_DAY = "2";
    report("idea");
    clock += 2 * MIN; report("idea");
    clock += 2 * MIN; assert.equal(report("problem"), "queued");
    assert.equal(sent.length, 2);
    clock = t0 + 24 * 60 * MIN + MIN;   // the next day
    assert.equal(report("praise"), "sent");
    assert.equal(sent.length, 3);
    assert.equal(sent[2].total, 2, "the one that waited comes with the new one");
  });

  test("a failing mailer never throws into the caller", () => {
    assert.doesNotThrow(() => reportNewFeedback({ kind: "idea", send: () => { throw new Error("boom"); }, now: () => clock, enabled: true, schedule }));
    assert.doesNotThrow(() => reportNewFeedback({ kind: "idea", send: () => Promise.reject(new Error("boom")), now: () => clock + 99 * MIN, enabled: true, schedule }));
  });
});

describe("the mail the owner gets", () => {
  let server, fake, c;
  const owner = () => fake.mailsTo(OWNER);

  before(async () => {
    _resetAlerts();
    fake = await startFakeResend();
    server = await startServer({
      RESEND_API_KEY: "test-key", RESEND_API_URL: fake.url, ALERT_EMAIL: OWNER, PUBLIC_URL: "https://pluggera.test",
      FEEDBACK_PER_HOUR_PER_USER: "100", FEEDBACK_ALERT_MINUTES: "30",
    });
    c = makeClient(server.baseUrl);
    const r = await c.post("/api/auth/signup", { email: uniqueEmail(), password: "correctpw1", consent: true });
    assert.equal(r.status, 200);
    fake.mails.length = 0;   // the welcome mail
  });
  after(async () => { await server.stop(); await fake.stop(); _resetAlerts(); });

  test("feedback mails the owner with a link to the inbox", async () => {
    const r = await c.post("/api/feedback", { kind: "idea", message: "Fler övningar i historia för åk 8 tack", mood: 4 });
    assert.equal(r.status, 200);
    const mail = await waitFor(() => owner()[0]);
    assert.ok(mail, "the owner got a mail");
    assert.match(mail.subject, /ny feedback/);
    assert.match(mail.html, /1 idé/);
    assert.match(mail.html, /https:\/\/pluggera\.test\/#\/admin\/feedback/);
  });

  test("the mail never carries what the student wrote, nor who they are", async () => {
    const mail = owner()[0];
    assert.ok(!mail.html.includes("historia"), "no message text");
    assert.ok(!mail.html.includes("åk 8"));
    assert.ok(!/@example\.com/.test(mail.html.replace(OWNER, "")), "no student email");
  });

  test("a second one right after is held back, not mailed again", async () => {
    await c.post("/api/feedback", { kind: "problem", message: "Knappen Nästa fastnar på min telefon" });
    await sleep(300);
    assert.equal(owner().length, 1);
  });

  test("a rejected send (bad input) mails nothing", async () => {
    _resetAlerts(); fake.mails.length = 0;
    assert.equal((await c.post("/api/feedback", { kind: "rant", message: "x" })).status, 400);
    await sleep(300);
    assert.equal(owner().length, 0);
  });
});

describe("feedback is kept until it is dealt with", () => {
  let server;
  before(async () => { server = await startServer({ SWEEP_EVERY_MS: "200" }); });
  after(async () => { await server.stop(); });

  test("resolved feedback goes 30 days after it was resolved; the rest stays", async () => {
    const now = Date.now();
    const old = now - KEEP_MS - 24 * 60 * 60_000;
    const recent = now - 24 * 60 * 60_000;
    const ins = server.db.prepare("INSERT INTO feedback (id, user_id, kind, message, status, created_at, updated_at) VALUES (?, NULL, 'idea', ?, ?, ?, ?)");
    for (const [id, status, at] of [
      ["keep-new-old", "new", old], ["keep-seen-old", "seen", old], ["keep-planned-old", "planned", old],
      ["drop-done-old", "done", old], ["drop-declined-old", "declined", old],
      ["keep-done-recent", "done", recent], ["keep-declined-recent", "declined", recent],
    ]) ins.run(id, id, status, old, at);
    server.db.prepare("INSERT INTO feedback_images (feedback_id, n, media_type, data) VALUES ('drop-done-old', 0, 'image/png', x'89504e47')").run();

    await sleep(900);

    const left = server.db.prepare("SELECT id FROM feedback WHERE id LIKE 'keep-%' OR id LIKE 'drop-%' ORDER BY id").all().map((r) => r.id);
    assert.deepEqual(left, ["keep-declined-recent", "keep-done-recent", "keep-new-old", "keep-planned-old", "keep-seen-old"]);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM feedback_images WHERE feedback_id = 'drop-done-old'").get().n, 0, "its screenshots go with it");
  });
});
