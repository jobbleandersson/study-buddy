import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

describe("security headers", () => {
  let server, client;
  before(async () => { server = await startServer(); client = makeClient(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("the CSP allows Google's Sign-In button stylesheet, script and iframe", async () => {
    const { res } = await client.get("/api/health");
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp, "expected a Content-Security-Policy header");
    assert.match(csp, /style-src[^;]*https:\/\/accounts\.google\.com\/gsi\/style/);
    assert.match(csp, /script-src[^;]*https:\/\/accounts\.google\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/accounts\.google\.com/);
  });

  test("basic hardening headers are present even on an API response", async () => {
    const { res } = await client.get("/api/health");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
  });

  test("server/ and deploy-config paths are never served statically", async () => {
    for (const p of ["/server/package.json", "/Dockerfile", "/.dockerignore", "//server/package.json", "/%73erver/package.json"]) {
      const res = await fetch(`${server.baseUrl}${p}`);
      assert.equal(res.status, 404, `expected ${p} to be blocked`);
    }
  });
});

describe("GET /api/health", () => {
  let server, client;
  after(async () => { if (server) await server.stop(); });

  test("reports whether email and Google sign-in are configured", async () => {
    server = await startServer({ RESEND_API_KEY: "dummy-test-key", GOOGLE_CLIENT_ID: "some-client-id" });
    client = makeClient(server.baseUrl);
    const { status, json } = await client.get("/api/health");
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.emailConfigured, true);
    assert.equal(json.googleClientId, "some-client-id");
  });
});
