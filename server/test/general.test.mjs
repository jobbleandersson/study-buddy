import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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

describe("canonical host redirect", () => {
  let server;
  const raw = (p, init = {}) => fetch(`${server.baseUrl}${p}`, { redirect: "manual", ...init });
  after(async () => { if (server) await server.stop(); });

  test("off by default: pages are served on whatever host they're asked for", async () => {
    server = await startServer({ CANONICAL_HOST: "" });
    assert.equal((await raw("/")).status, 200);
    await server.stop(); server = null;
  });

  test("when set, page loads on another host 301 to the same path on the canonical one", async () => {
    server = await startServer({ CANONICAL_HOST: "pluggera.se" });
    for (const p of ["/", "/ova/ak9-matematik?x=1", "/sitemap.xml"]) {
      const res = await raw(p);
      assert.equal(res.status, 301, p);
      assert.equal(res.headers.get("location"), `https://pluggera.se${p}`);
    }
  });

  test("API calls and non-GET requests are never redirected", async () => {
    assert.equal((await raw("/api/health")).status, 200);
    assert.notEqual((await raw("/", { method: "POST" })).status, 301);
  });

  test("a request already on the canonical host is served normally", async () => {
    // fetch() won't send a custom Host header, so this one goes through node:http directly.
    const status = await new Promise((resolve, reject) => {
      http.get(`${server.baseUrl}/`, { headers: { host: "pluggera.se" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
    });
    assert.equal(status, 200);
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
