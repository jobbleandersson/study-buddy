import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const KEY = "test-admin-key-feedback";
const email = () => `fb-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function account(baseUrl) {
  const c = makeClient(baseUrl);
  const r = await c.post("/api/auth/signup", { email: email(), password: "correctpw1", consent: true });
  assert.equal(r.status, 200);
  return c;
}

function admin(baseUrl, key = KEY) {
  const call = async (method, p, body) => {
    const res = await fetch(`${baseUrl}${p}`, {
      method, headers: { "x-admin-key": key, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), delete: (p) => call("DELETE", p) };
}

const idea = (over = {}) => ({ kind: "idea", message: "Det vore bra med en mörk skärm för natten.", mood: 4, context: "button", route: "/progress?token=secret", lang: "sv", version: "studify-v300", browser: "Chrome 130 · Android", ...over });

describe("sending feedback", () => {
  let server, c;
  before(async () => { server = await startServer({ REVIEW_ADMIN_KEY: KEY, FEEDBACK_PER_HOUR_PER_USER: "100" }); c = await account(server.baseUrl); });
  after(async () => { await server.stop(); });

  test("signed-out callers get 401", async () => {
    assert.equal((await makeClient(server.baseUrl).post("/api/feedback", idea())).status, 401);
    assert.equal((await makeClient(server.baseUrl).get("/api/feedback/mine")).status, 401);
  });

  test("a message is stored with the page (without its query string), and shows up under the sender's own", async () => {
    const r = await c.post("/api/feedback", idea());
    assert.equal(r.status, 200);
    assert.ok(r.json.id);
    const row = server.db.prepare("SELECT * FROM feedback WHERE id = ?").get(r.json.id);
    assert.equal(row.route, "/progress");
    assert.equal(row.status, "new");
    assert.equal(row.mood, 4);
    assert.ok(row.user_id);
    const mine = await c.get("/api/feedback/mine");
    assert.equal(mine.json.feedback[0].id, r.json.id);
    assert.equal(mine.json.feedback[0].reply, "");
  });

  test("the kind, the mood and the length are checked", async () => {
    for (const [body, code] of [
      [idea({ kind: "rant" }), "feedback_kind"],
      [idea({ mood: 6 }), "feedback_mood"],
      [idea({ mood: "x" }), "feedback_mood"],
      [idea({ mood: null, message: "ok" }), "feedback_text"],
      [idea({ message: "x".repeat(2001) }), "feedback_text"],
    ]) {
      const r = await c.post("/api/feedback", body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(r.json.error.code, code);
    }
  });

  test("a mood tap alone needs no words", async () => {
    const r = await c.post("/api/feedback", { kind: "other", mood: 2, context: "after-session", message: "" });
    assert.equal(r.status, 200);
    assert.equal(server.db.prepare("SELECT context, mood, message FROM feedback WHERE id = ?").get(r.json.id).context, "after-session");
  });

  test("an unknown context becomes 'button'; the same words sent twice in a row are stored once", async () => {
    const message = `Samma ord ${Date.now()}`;
    const a = await c.post("/api/feedback", { kind: "idea", message, context: "elsewhere" });
    const b = await c.post("/api/feedback", { kind: "idea", message, context: "elsewhere" });
    assert.equal(a.json.id, b.json.id);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE message = ?").get(message).n, 1);
    assert.equal(server.db.prepare("SELECT context FROM feedback WHERE id = ?").get(a.json.id).context, "button");
  });

  test("'send without my account' stores no user, and it is not in the sender's list", async () => {
    const message = `Anonymt ${Date.now()}`;
    const r = await c.post("/api/feedback", { kind: "problem", message, anonymous: true });
    assert.equal(r.status, 200);
    assert.equal(server.db.prepare("SELECT user_id FROM feedback WHERE id = ?").get(r.json.id).user_id, null);
    const mine = await c.get("/api/feedback/mine");
    assert.equal(mine.json.feedback.some((f) => f.id === r.json.id), false);
  });

  test("a sender can take back their own, and nobody else's", async () => {
    const other = await account(server.baseUrl);
    const mineId = (await c.post("/api/feedback", idea({ message: `Ta tillbaka ${Date.now()}` }))).json.id;
    assert.equal((await other.delete(`/api/feedback/mine/${mineId}`)).status, 404);
    assert.equal((await c.delete(`/api/feedback/mine/${mineId}`)).status, 200);
    assert.equal(server.db.prepare("SELECT 1 FROM feedback WHERE id = ?").get(mineId), undefined);
  });

  test("deleting the account deletes the feedback that was linked to it", async () => {
    const gone = await account(server.baseUrl);
    const sent = await gone.post("/api/feedback", idea({ message: `Försvinner ${Date.now()}` }));
    const kept = await gone.post("/api/feedback", { kind: "other", message: `Anonymt kvar ${Date.now()}`, anonymous: true });
    assert.equal((await gone.delete("/api/account", { password: "correctpw1" })).status, 200);
    assert.equal(server.db.prepare("SELECT 1 FROM feedback WHERE id = ?").get(sent.json.id), undefined);
    assert.ok(server.db.prepare("SELECT 1 FROM feedback WHERE id = ?").get(kept.json.id), "an anonymous message has no owner to delete it");
  });
});

describe("feedback limits", () => {
  test("one account can send only so many an hour", async () => {
    const server = await startServer({ FEEDBACK_PER_HOUR_PER_USER: "3" });
    try {
      const c = await account(server.baseUrl);
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await c.post("/api/feedback", idea({ message: `Meddelande nummer ${i} ${Date.now()}` }))).status);
      assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    } finally { await server.stop(); }
  });
});

describe("the feedback inbox", () => {
  let server, a, adm;
  before(async () => {
    server = await startServer({ REVIEW_ADMIN_KEY: KEY, FEEDBACK_PER_HOUR_PER_USER: "100" });
    adm = admin(server.baseUrl);
    a = await account(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test("needs the admin key; with none configured the endpoint does not exist", async () => {
    assert.equal((await admin(server.baseUrl, "wrong").get("/api/admin/feedback")).status, 403);
    assert.equal((await fetch(server.baseUrl + "/api/admin/feedback")).status, 403);
    const bare = await startServer();
    try { assert.equal((await admin(bare.baseUrl).get("/api/admin/feedback")).status, 404); } finally { await bare.stop(); }
  });

  test("lists what was sent with counts and the mood of the last 30 days, and never says who sent it", async () => {
    await a.post("/api/feedback", idea({ message: "Mer övningar i historia tack", mood: 5 }));
    await a.post("/api/feedback", { kind: "problem", message: "Knappen fungerar inte på min telefon", mood: 1, anonymous: true });
    const r = await adm.get("/api/admin/feedback");
    assert.equal(r.status, 200);
    assert.ok(r.json.counts.new >= 2);
    assert.ok(r.json.byKind.idea >= 1 && r.json.byKind.problem >= 1);
    assert.equal(r.json.mood.last30days.n, 2);
    assert.equal(r.json.mood.last30days.average, 3);
    assert.equal(r.json.mood.last30days.byMood["5"], 1);
    const text = JSON.stringify(r.json);
    assert.equal(/user_id|userId|@example\.com/.test(text), false, "no id or address in the inbox");
    const linked = r.json.feedback.find((f) => f.message.startsWith("Mer övningar"));
    const anon = r.json.feedback.find((f) => f.message.startsWith("Knappen"));
    assert.equal(linked.linked, true);
    assert.equal(anon.linked, false);
  });

  test("filters by status and kind", async () => {
    const onlyProblems = await adm.get("/api/admin/feedback?kind=problem");
    assert.ok(onlyProblems.json.feedback.length >= 1 && onlyProblems.json.feedback.every((f) => f.kind === "problem"));
    const done = await adm.get("/api/admin/feedback?status=done");
    assert.equal(done.json.feedback.length, 0);
  });

  test("a status and a reply reach the sender; an anonymous sender cannot be answered", async () => {
    const sent = await a.post("/api/feedback", idea({ message: `Svara mig ${Date.now()}` }));
    const post = await adm.post(`/api/admin/feedback/${sent.json.id}`, { status: "planned", reply: "Bra idé, vi planerar det till nästa månad." });
    assert.equal(post.status, 200);
    const mine = (await a.get("/api/feedback/mine")).json.feedback.find((f) => f.id === sent.json.id);
    assert.equal(mine.status, "planned");
    assert.equal(mine.reply, "Bra idé, vi planerar det till nästa månad.");
    assert.ok(mine.repliedAt > 0);

    const anon = await a.post("/api/feedback", { kind: "idea", message: `Anonym fråga ${Date.now()}`, anonymous: true });
    const refused = await adm.post(`/api/admin/feedback/${anon.json.id}`, { reply: "Hej!" });
    assert.equal(refused.status, 400);
    assert.equal((await adm.post(`/api/admin/feedback/${anon.json.id}`, { status: "seen" })).status, 200, "it can still be sorted");
  });

  test("unknown statuses, over-long replies and unknown ids are refused", async () => {
    const sent = await a.post("/api/feedback", idea({ message: `Fel input ${Date.now()}` }));
    assert.equal((await adm.post(`/api/admin/feedback/${sent.json.id}`, { status: "maybe" })).status, 400);
    assert.equal((await adm.post(`/api/admin/feedback/${sent.json.id}`, { reply: "x".repeat(501) })).status, 400);
    assert.equal((await adm.post(`/api/admin/feedback/${sent.json.id}`, { reply: 5 })).status, 400);
    assert.equal((await adm.post("/api/admin/feedback/nope", { status: "seen" })).status, 404);
    assert.equal((await adm.delete("/api/admin/feedback/nope")).status, 404);
  });

  test("a reply can be taken back, and a message removed", async () => {
    const sent = await a.post("/api/feedback", idea({ message: `Ta bort ${Date.now()}` }));
    await adm.post(`/api/admin/feedback/${sent.json.id}`, { reply: "Tack!" });
    await adm.post(`/api/admin/feedback/${sent.json.id}`, { reply: "" });
    const mine = (await a.get("/api/feedback/mine")).json.feedback.find((f) => f.id === sent.json.id);
    assert.equal(mine.reply, "");
    assert.equal(mine.repliedAt, null);
    assert.equal((await adm.delete(`/api/admin/feedback/${sent.json.id}`)).status, 200);
    assert.equal((await a.get("/api/feedback/mine")).json.feedback.some((f) => f.id === sent.json.id), false);
  });
});
