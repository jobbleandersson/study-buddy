import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const KEY = "test-admin-key-ai-reports";
const uniqueEmail = () => `aireport-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const good = { where: "tutor", reason: "wrong", content: "Svaret är 5.", prompt: "Vad är 2 + 2?", note: "Det ska vara 4." };

async function signedIn(baseUrl) {
  const c = makeClient(baseUrl);
  await c.post("/api/auth/signup", { email: uniqueEmail(), password: "correctpw1", consent: true });
  return c;
}

function admin(baseUrl, key = KEY) {
  const call = async (method, p, body) => {
    const res = await fetch(`${baseUrl}${p}`, {
      method, headers: { "content-type": "application/json", "x-admin-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), delete: (p) => call("DELETE", p) };
}

describe("ai reports", () => {
  let server;
  before(async () => { server = await startServer({ REVIEW_ADMIN_KEY: KEY }); });
  after(async () => { await server.stop(); });

  test("reporting needs a signed-in session", async () => {
    const { status } = await makeClient(server.baseUrl).post("/api/ai-reports", good);
    assert.equal(status, 401);
  });

  test("invalid input is rejected with a specific code", async () => {
    const c = await signedIn(server.baseUrl);
    const cases = [
      [{ where: "chat" }, "ai_report_where"], [{ where: undefined }, "ai_report_where"],
      [{ reason: "boring" }, "ai_report_reason"], [{ reason: undefined }, "ai_report_reason"],
      [{ content: "   " }, "ai_report_content"], [{ content: undefined }, "ai_report_content"],
    ];
    for (const [patch, code] of cases) {
      const { status, json } = await c.post("/api/ai-reports", { ...good, ...patch });
      assert.equal(status, 400, JSON.stringify(patch));
      assert.equal(json.error.code, code, JSON.stringify(patch));
    }
  });

  test("a report lands in the open queue, without who sent it, and long text is cut to the limits", async () => {
    const c = await signedIn(server.baseUrl);
    const long = { ...good, where: "solve", reason: "harmful", content: "x".repeat(5000), prompt: "p".repeat(1500), note: "n".repeat(700) };
    assert.equal((await c.post("/api/ai-reports", long)).status, 200);
    const { status, json } = await admin(server.baseUrl).get("/api/admin/ai-reports");
    assert.equal(status, 200);
    const r = json.reports.find((x) => x.where === "solve" && x.reason === "harmful");
    assert.ok(r, "the report is in the open list");
    assert.equal(r.status, "open");
    assert.equal(r.content.length, 4000);
    assert.equal(r.prompt.length, 1000);
    assert.equal(r.note.length, 500);
    assert.equal(r.user_id, undefined);
    assert.equal(r.email, undefined);
    assert.ok(json.counts.open >= 1);
  });

  test("the admin queue needs the key", async () => {
    assert.equal((await admin(server.baseUrl, "wrong-key").get("/api/admin/ai-reports")).status, 403);
    const res = await fetch(`${server.baseUrl}/api/admin/ai-reports`);
    assert.equal(res.status, 403);
  });

  test("marking handled moves it between the lists; delete removes it", async () => {
    const c = await signedIn(server.baseUrl);
    await c.post("/api/ai-reports", { ...good, note: "move me" });
    const a = admin(server.baseUrl);
    const id = (await a.get("/api/admin/ai-reports")).json.reports.find((x) => x.note === "move me").id;
    assert.equal((await a.post(`/api/admin/ai-reports/${id}`, { status: "handled" })).status, 200);
    assert.ok(!(await a.get("/api/admin/ai-reports")).json.reports.some((x) => x.id === id));
    assert.ok((await a.get("/api/admin/ai-reports?status=handled")).json.reports.some((x) => x.id === id));
    assert.equal((await a.post(`/api/admin/ai-reports/${id}`, { status: "nope" })).status, 400);
    assert.equal((await a.delete(`/api/admin/ai-reports/${id}`)).status, 200);
    assert.equal((await a.delete(`/api/admin/ai-reports/${id}`)).status, 404);
  });

  test("a deleted account takes its reports with it", async () => {
    const c = await signedIn(server.baseUrl);
    await c.post("/api/ai-reports", { ...good, note: "gone with the account" });
    const del = await c.delete("/api/account", { password: "correctpw1" });
    assert.equal(del.status, 200, JSON.stringify(del.json));
    const all = [...(await admin(server.baseUrl).get("/api/admin/ai-reports")).json.reports,
      ...(await admin(server.baseUrl).get("/api/admin/ai-reports?status=handled")).json.reports];
    assert.ok(!all.some((x) => x.note === "gone with the account"));
  });
});
