// GET /api/health/ai: does the AI really answer, and if not, why. A fake Anthropic stands in for the
// real one (ANTHROPIC_CHECK_URL, honoured only under NODE_ENV=test).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./harness.mjs";

async function fakeAnthropic(status, body) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      seen.push({ key: req.headers["x-api-key"], body: JSON.parse(raw || "{}") });
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}/v1/messages`, seen, stop: () => new Promise((r) => srv.close(r)) };
}

const health = async (server) => {
  const res = await fetch(`${server.baseUrl}/api/health/ai`);
  return { status: res.status, json: await res.json() };
};

describe("GET /api/health/ai", () => {
  test("no key: 503 no_key, without calling anyone", async () => {
    const server = await startServer({ ANTHROPIC_API_KEY: "" });
    try {
      const { status, json } = await health(server);
      assert.equal(status, 503);
      assert.equal(json.reason, "no_key");
    } finally { await server.stop(); }
  });

  test("a working key: 200, one tiny request, and the result is cached", async () => {
    const fake = await fakeAnthropic(200, { type: "message", content: [{ type: "text", text: "p" }] });
    const server = await startServer({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_CHECK_URL: fake.url });
    try {
      const a = await health(server);
      assert.equal(a.status, 200);
      assert.equal(a.json.ok, true);
      assert.equal(a.json.reason, null);
      await health(server);
      assert.equal(fake.seen.length, 1, "the second poll comes from the cache");
      assert.equal(fake.seen[0].key, "test-key");
      assert.equal(fake.seen[0].body.max_tokens, 1);
    } finally { await server.stop(); await fake.stop(); }
  });

  test("a rejected key and an empty account each say why", async () => {
    for (const [status, body, reason] of [
      [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "key_rejected"],
      [400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, "no_credit"],
      [529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "upstream_error"],
    ]) {
      const fake = await fakeAnthropic(status, body);
      const server = await startServer({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_CHECK_URL: fake.url });
      try {
        const r = await health(server);
        assert.equal(r.status, 503, reason);
        assert.equal(r.json.reason, reason);
      } finally { await server.stop(); await fake.stop(); }
    }
  });

  test("a busy key (429) still counts as working", async () => {
    const fake = await fakeAnthropic(429, { type: "error", error: { type: "rate_limit_error" } });
    const server = await startServer({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_CHECK_URL: fake.url });
    try {
      const r = await health(server);
      assert.equal(r.status, 200);
      assert.equal(r.json.reason, "rate_limited");
    } finally { await server.stop(); await fake.stop(); }
  });

  test("reachable without the site password, so an uptime monitor can use it", async () => {
    const server = await startServer({ ANTHROPIC_API_KEY: "", SITE_PASSWORD: "hemligt-lösen" });
    try {
      const r = await health(server);
      assert.equal(r.status, 503);
      assert.equal(r.json.reason, "no_key", "the gate let it through");
    } finally { await server.stop(); }
  });
});
