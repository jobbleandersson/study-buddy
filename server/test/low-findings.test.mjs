import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, makeClient } from "./harness.mjs";

// The low-severity server findings of the 2026-10 audit: B-02 (a student id that is not a string), B-21
// (graceful shutdown) and B-25 (response headers and what /api/health/ai says).

const email = () => `low-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function account(baseUrl) {
  const c = makeClient(baseUrl);
  const r = await c.post("/api/auth/signup", { email: email(), password: "correctpw1", consent: true });
  assert.equal(r.status, 200);
  return c;
}

describe("POST /api/assigned with a student id that is not a string (B-02)", () => {
  let server, c;
  before(async () => { server = await startServer(); c = await account(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("an object, an array or a number is a 400, not a 500 that mails the owner", async () => {
    const doc = { title: "x", subject: "y", questions: [] };
    for (const studentUserId of [{}, [1], ["a"], 123, true]) {
      const r = await c.post("/api/assigned", { studentUserId, doc });
      assert.equal(r.status, 400, JSON.stringify(studentUserId));
    }
    assert.equal(server.logLines.join("").includes("error on POST /api/assigned"), false, "nothing was logged as a server error");
  });

  test("a string for somebody the caller is not linked to is still 403, and a missing one 400", async () => {
    const doc = { title: "x", subject: "y", questions: [] };
    assert.equal((await c.post("/api/assigned", { studentUserId: "nobody", doc })).status, 403);
    assert.equal((await c.post("/api/assigned", { doc })).status, 400);
  });
});

describe("response headers (B-25)", () => {
  let server, c;
  before(async () => { server = await startServer({ ANTHROPIC_API_KEY: "" }); c = await account(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("the framework is not announced, on the API or on a page", async () => {
    for (const p of ["/api/health", "/"]) {
      const res = await fetch(server.baseUrl + p);
      assert.equal(res.headers.get("x-powered-by"), null, p);
    }
  });

  test("a Permissions-Policy switches off what the app never uses and leaves the microphone to itself", async () => {
    const pp = (await fetch(server.baseUrl + "/api/health")).headers.get("permissions-policy");
    assert.match(pp, /camera=\(\)/);
    assert.match(pp, /geolocation=\(\)/);
    assert.match(pp, /microphone=\(self\)/, "the tutor's voice input still works");
  });

  test("private JSON is no-store", async () => {
    for (const p of ["/api/state", "/api/auth/me"]) {
      const r = await c.get(p);
      assert.equal(r.headers.get("cache-control"), "no-store", p);
    }
    const unknown = await c.get("/api/no-such-thing");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get("cache-control"), "no-store");
  });

  test("/api/health/ai says whether the AI works and when it was checked, not why it does not", async () => {
    const res = await fetch(server.baseUrl + "/api/health/ai");
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.deepEqual(Object.keys(json).sort(), ["checkedAt", "ok"]);
    assert.equal(json.ok, false);
  });

  test("/api/health keeps the fields the uptime monitor and the client read", async () => {
    const json = await (await fetch(server.baseUrl + "/api/health")).json();
    assert.equal(json.ok, true);
    for (const key of ["keyConfigured", "emailConfigured", "messagesRequireAuth", "siteLocked", "unlocked", "version"]) {
      assert.ok(key in json, key);
    }
  });
});

// SIGTERM cannot be caught on Windows (Node ends the process at once), so these run where the server runs.
const POSIX = { skip: process.platform === "win32" && "SIGTERM cannot be handled on Windows" };

/** Starts a POST that has sent only half its body, so the server has a request in flight. */
function halfRequest(baseUrl) {
  const full = '{"email":"a@b.se"}';
  const req = http.request(baseUrl + "/api/waitlist/premium", { method: "POST", agent: false, headers: { "content-type": "application/json", "content-length": String(full.length) } });
  const status = new Promise((resolve, reject) => {
    req.on("response", (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
  });
  status.catch(() => {});
  req.write(full.slice(0, 9));
  return { finish: () => req.end(full.slice(9)), status, abort: () => req.destroy() };
}

describe("graceful shutdown (B-21)", () => {
  test("SIGTERM lets a running request finish, refuses new ones, then exits cleanly", POSIX, async () => {
    const server = await startServer();
    try {
      const inflight = halfRequest(server.baseUrl);
      await wait(200);
      server.signal("SIGTERM");
      await wait(300);
      const stillRunning = await Promise.race([server.exited.then(() => false), wait(50).then(() => true)]);
      assert.equal(stillRunning, true, "the process waits for the request in flight");
      await assert.rejects(fetch(server.baseUrl + "/api/health"), "no new connections are accepted");
      inflight.finish();
      assert.ok([200, 400, 429].includes(await inflight.status), "the request in flight was answered");
      const exit = await server.exited;
      assert.equal(exit.code, 0);
      assert.match(server.logLines.join(""), /shut down cleanly/);
    } finally { await server.stop(); }
  });

  test("a request that never finishes cannot hold the shutdown past SHUTDOWN_GRACE_MS", POSIX, async () => {
    const server = await startServer({ SHUTDOWN_GRACE_MS: "300" });
    try {
      const stuck = halfRequest(server.baseUrl);
      await wait(200);
      const t0 = Date.now();
      server.signal("SIGTERM");
      const exit = await Promise.race([server.exited, wait(5000).then(() => null)]);
      assert.ok(exit, "the server exited by itself");
      assert.equal(exit.code, 1);
      assert.ok(Date.now() - t0 < 3000, "close to the grace period, not forever");
      assert.match(server.logLines.join(""), /grace ran out/);
      stuck.abort();
    } finally { await server.stop(); }
  });
});
