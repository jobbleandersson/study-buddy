import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const KEY = "test-admin-key-errors";

function admin(baseUrl, key = KEY) {
  const call = async (method, p) => {
    const res = await fetch(`${baseUrl}${p}`, { method, headers: { "x-admin-key": key } });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { get: (p) => call("GET", p), delete: (p) => call("DELETE", p) };
}

const report = (over = {}) => ({
  kind: "error", message: "TypeError: x is undefined", source: "/js/views/hp.js:12:5",
  stack: "TypeError: x is undefined\n    at paint (/js/views/hp.js:12:5)", route: "/hp",
  version: "studify-v242", browser: "Chrome 129 · Android", ...over,
});

describe("client error reports", () => {
  let server, client;
  before(async () => {
    server = await startServer({ REVIEW_ADMIN_KEY: KEY });
    client = makeClient(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("the same error is one row with a count, a different one is a new row", async () => {
    const message = `TypeError: once-${Date.now()}`;
    assert.equal((await client.post("/api/client-errors", report({ message }))).status, 204);
    assert.equal((await client.post("/api/client-errors", report({ message, route: "/hp/xyz" }))).status, 204);
    assert.equal((await client.post("/api/client-errors", report({ message, source: "/js/views/other.js:1:1" }))).status, 204);
    const { json } = await admin(server.baseUrl).get("/api/admin/client-errors");
    const mine = json.errors.filter((e) => e.message === message);
    assert.equal(mine.length, 2);
    const twice = mine.find((e) => e.source === "/js/views/hp.js:12:5");
    assert.equal(twice.count, 2);
    assert.equal(twice.route, "/hp/xyz", "the latest occurrence's page");
    assert.equal(twice.version, "studify-v242");
  });

  test("a query string never reaches the database, and long fields are cut", async () => {
    const message = `Leak-${Date.now()} ${"x".repeat(400)}`;
    await client.post("/api/client-errors", report({ message, route: "/verify?token=secret-token-123" }));
    const { json } = await admin(server.baseUrl).get("/api/admin/client-errors");
    const row = json.errors.find((e) => e.message.startsWith(message.slice(0, 20)));
    assert.equal(row.route, "/verify");
    assert.equal(row.message.length, 300);
    assert.ok(!JSON.stringify(row).includes("secret-token-123"));
  });

  test("a report without a known kind or a message is refused", async () => {
    assert.equal((await client.post("/api/client-errors", report({ kind: "nonsense" }))).status, 400);
    assert.equal((await client.post("/api/client-errors", report({ message: "   " }))).status, 400);
    assert.equal((await client.post("/api/client-errors", {})).status, 400);
  });

  test("the list needs the admin key, and a fixed error can be removed", async () => {
    assert.equal((await admin(server.baseUrl, "wrong-key").get("/api/admin/client-errors")).status, 403);
    assert.equal((await fetch(`${server.baseUrl}/api/admin/client-errors`)).status, 403);
    const message = `Fixed-${Date.now()}`;
    await client.post("/api/client-errors", report({ message }));
    const a = admin(server.baseUrl);
    const row = (await a.get("/api/admin/client-errors")).json.errors.find((e) => e.message === message);
    assert.equal((await a.delete(`/api/admin/client-errors/${row.id}`)).status, 200);
    assert.ok(!(await a.get("/api/admin/client-errors")).json.errors.some((e) => e.message === message));
    assert.equal((await a.delete(`/api/admin/client-errors/${row.id}`)).status, 404);
  });
});

describe("client error reports without an admin key set", () => {
  let server;
  before(async () => { server = await startServer({}); });
  after(async () => { await server.stop(); });

  test("reports are still accepted, but the list doesn't exist", async () => {
    assert.equal((await makeClient(server.baseUrl).post("/api/client-errors", report())).status, 204);
    assert.equal((await admin(server.baseUrl).get("/api/admin/client-errors")).status, 404);
  });
});
