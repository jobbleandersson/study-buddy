import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

// Sweep findings B1 (bad input answered 500 and mailed the owner), S3 (bcrypt reads 72 bytes). S5 is in
// sweep-email-change.test.mjs (it opens the database in-process).

describe("bad input is a 400, not a server error (B1)", () => {
  let server, client;
  before(async () => {
    server = await startServer();
    client = makeClient(server.baseUrl);
    const r = await client.post("/api/auth/signup", { email: `hyg-${Date.now()}@example.com`, password: "longenough1", consent: true });
    assert.equal(r.status, 200);
  });
  after(async () => { await server.stop(); });

  test("a calendar-impossible day that matches YYYY-MM-DD", async () => {
    const r = await client.get("/api/my-daily?day=2026-13-99");
    assert.equal(r.status, 400);
  });

  test("a class assignment due on 2026-13-45", async () => {
    const c = await client.post("/api/classes", { name: "9B" });
    assert.equal(c.status, 200);
    const r = await client.post(`/api/classes/${c.json.class?.id ?? c.json.id}/assignments`, { setId: "lib-bio7-djur", dueAt: "2026-13-45" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.message, "That date isn't valid.", "turned away for the date, not the set");
  });

  test("broken %-encoding in a path", async () => {
    const r = await client.get("/api/classes/%ff");
    assert.equal(r.status, 400);
    assert.equal(r.json?.error?.code, "bad_request");
  });

  test("none of them was logged as a server error", () => {
    assert.equal(/error on GET \/api\/classes\/%ff|RangeError|URIError/.test(server.logLines.join("")), false);
  });
});

describe("new passwords stop at 72 bytes (S3)", async () => {
  const { passwordProblem } = await import("../src/passwordRules.js");
  test("72 ASCII characters are fine, 73 are too long", () => {
    assert.equal(passwordProblem("a1".repeat(36)), null);
    assert.equal(passwordProblem("a1".repeat(36) + "x"), "Password is too long.");
  });
  test("counted in bytes: 37 'ö' are 74 bytes", () => {
    assert.equal(passwordProblem("ö".repeat(37)), "Password is too long.");
  });
});
