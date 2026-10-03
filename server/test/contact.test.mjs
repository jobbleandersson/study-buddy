import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, startFakeResend, makeClient } from "./harness.mjs";

const TO = "inbox@example.com";
const good = { name: "Alva", email: "alva@example.com", message: "Hej! <b>Fin</b> sida." };

describe("POST /api/contact - email ON", () => {
  let server, client, fake;
  before(async () => {
    fake = await startFakeResend();
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", RESEND_API_URL: fake.url, CONTACT_TO: TO, CONTACT_PER_DAY: "3" });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); await fake.stop(); });

  test("a message is mailed to the contact address, with the sender as Reply-To and the text escaped", async () => {
    const { status, json } = await client.post("/api/contact", good);
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
    const mail = fake.mailsTo(TO).at(-1);
    assert.equal(mail.reply_to, good.email);
    assert.match(mail.subject, /Alva/);
    assert.match(mail.html, /&lt;b&gt;Fin&lt;\/b&gt;/);
    assert.doesNotMatch(mail.html, /<b>Fin/);
  });

  test("the hidden honeypot field gets {ok:true} and sends nothing", async () => {
    const before = fake.mails.length;
    const { status, json } = await client.post("/api/contact", { ...good, website: "http://spam.example" });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true });
    assert.equal(fake.mails.length, before);
  });

  test("a missing name, a bad email or an empty message is a 400 and sends nothing", async () => {
    const before = fake.mails.length;
    for (const body of [{ ...good, name: " " }, { ...good, email: "a@a" }, { ...good, message: "" }, { ...good, message: "x".repeat(5001) }]) {
      const { status } = await client.post("/api/contact", body);
      assert.equal(status, 400);
    }
    assert.equal(fake.mails.length, before);
  });

  test("a provider failure is a 502, not a false success", async () => {
    fake.failing = true;
    try {
      const { status, json } = await client.post("/api/contact", good);
      assert.equal(status, 502);
      assert.equal(json.error.code, "send_failed");
    } finally { fake.failing = false; }
  });

  test("the all-visitors daily cap stops sending once it's reached", async () => {
    // CONTACT_PER_DAY is 3 here, and the two earlier sends (one ok, one failed) used two of them.
    assert.equal((await client.post("/api/contact", good)).status, 200);
    const { status, json } = await client.post("/api/contact", good);
    assert.equal(status, 429);
    assert.equal(json.error.code, "contact_full");
  });
});

describe("POST /api/contact - email OFF", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("answers 503 email_off, so the page can offer the visitor's own mail app instead", async () => {
    const { status, json } = await client.post("/api/contact", good);
    assert.equal(status, 503);
    assert.equal(json.error.code, "email_off");
  });
});
