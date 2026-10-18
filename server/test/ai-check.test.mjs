// GET /api/health/ai: does the AI really answer. The public answer is ok + when it was checked; WHY it failed
// (checkAi's reason) goes to the owner in the alert mail, not to whoever asks, so the reasons are tested on
// checkAi itself further down. A fake Anthropic stands in for the real one (ANTHROPIC_CHECK_URL, honoured
// only under NODE_ENV=test).
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
  test("no key: 503, without calling anyone", async () => {
    const server = await startServer({ ANTHROPIC_API_KEY: "" });
    try {
      const { status, json } = await health(server);
      assert.equal(status, 503);
      assert.equal(json.ok, false);
      assert.equal("reason" in json, false, "the reason is not public");
    } finally { await server.stop(); }
  });

  test("a working key: 200, one tiny request, and the result is cached", async () => {
    const fake = await fakeAnthropic(200, { type: "message", content: [{ type: "text", text: "p" }] });
    const server = await startServer({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_CHECK_URL: fake.url });
    try {
      const a = await health(server);
      assert.equal(a.status, 200);
      assert.equal(a.json.ok, true);
      assert.deepEqual(Object.keys(a.json).sort(), ["checkedAt", "ok"]);
      await health(server);
      assert.equal(fake.seen.length, 1, "the second poll comes from the cache");
      assert.equal(fake.seen[0].key, "test-key");
      assert.equal(fake.seen[0].body.max_tokens, 1);
    } finally { await server.stop(); await fake.stop(); }
  });

  test("a rejected key and an empty account are each a 503", async () => {
    for (const [status, body, label] of [
      [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "key_rejected"],
      [400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, "no_credit"],
      [529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "upstream_error"],
    ]) {
      const fake = await fakeAnthropic(status, body);
      const server = await startServer({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_CHECK_URL: fake.url });
      try {
        const r = await health(server);
        assert.equal(r.status, 503, label);
        assert.equal("reason" in r.json, false, label);
      } finally { await server.stop(); await fake.stop(); }
    }
  });

  test("a busy key (429) still counts as working", async () => {
    const fake = await fakeAnthropic(429, { type: "error", error: { type: "rate_limit_error" } });
    const server = await startServer({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_CHECK_URL: fake.url });
    try {
      const r = await health(server);
      assert.equal(r.status, 200);
      assert.equal(r.json.ok, true);
    } finally { await server.stop(); await fake.stop(); }
  });

  test("reachable without the site password, so an uptime monitor can use it", async () => {
    const server = await startServer({ ANTHROPIC_API_KEY: "", SITE_PASSWORD: "hemligt-lösen" });
    try {
      const r = await health(server);
      assert.equal(r.status, 503, "the gate let it through (503 is the AI check, not the gate's 403)");
      assert.equal(r.json.ok, false);
    } finally { await server.stop(); }
  });
});

describe("checkAi's reasons, which the owner's alert mail carries", () => {
  test("each failure is told apart", async () => {
    let status = 200, body = {};
    const srv = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); }); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    process.env.NODE_ENV = "test";
    process.env.ANTHROPIC_CHECK_URL = `http://127.0.0.1:${srv.address().port}/v1/messages`;
    const { checkAi } = await import("../src/ai-check.js");
    try {
      process.env.ANTHROPIC_API_KEY = "";
      assert.equal((await checkAi({ fresh: true })).reason, "no_key");
      process.env.ANTHROPIC_API_KEY = "test-key";
      for (const [s, b, reason, ok] of [
        [200, { type: "message" }, null, true],
        [401, { error: { type: "authentication_error" } }, "key_rejected", false],
        [400, { error: { message: "Your credit balance is too low" } }, "no_credit", false],
        [429, { error: { type: "rate_limit_error" } }, "rate_limited", true],
        [529, { error: { type: "overloaded_error" } }, "upstream_error", false],
      ]) {
        status = s; body = b;
        const r = await checkAi({ fresh: true });
        assert.equal(r.reason, reason, String(s));
        assert.equal(r.ok, ok, String(s));
      }
    } finally { await new Promise((r) => srv.close(r)); srv.closeAllConnections?.(); }
  });
});
