import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `resend-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("POST /api/auth/verify-email/resend - email ON", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "dummy-test-key" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("requires a signed-in session", async () => {
    client.clearCookie();
    const { status, json } = await client.post("/api/auth/verify-email/resend", {});
    assert.equal(status, 401);
    assert.equal(json.error.code, "not_authenticated");
  });

  test("a provider that refuses the message surfaces as 502 email_send_failed, not a silent ok", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const { status, json } = await client.post("/api/auth/verify-email/resend", {});
    // The dummy RESEND_API_KEY is rejected by the real provider (or blocked at
    // this sandbox's network edge) - either way sendEmail() returns false, and
    // the route must not report success for a message that never went out.
    assert.equal(status, 502);
    assert.equal(json.error.code, "email_send_failed");
  });

  test("an already-verified account is told so, not offered another resend", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    // Confirmed (here directly: the database holds only the link's hash, and this server's mail goes nowhere).
    server.db.prepare("UPDATE users SET email_verified_at = ? WHERE email = ?").run(Date.now(), email);

    const { status, json } = await client.post("/api/auth/verify-email/resend", {});
    assert.equal(status, 400);
    assert.equal(json.error.code, "already_verified");
  });
});

describe("POST /api/auth/verify-email/resend - email OFF", () => {
  let server, client;
  before(async () => { server = await startServer({ RESEND_API_KEY: "" }); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("answers 501 email_not_configured rather than trying to send anything", async () => {
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    const { status, json } = await client.post("/api/auth/verify-email/resend", {});
    assert.equal(status, 501);
    assert.equal(json.error.code, "email_not_configured");
  });
});
