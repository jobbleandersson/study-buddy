import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const KEY = "test-admin-key-123";
const uniqueEmail = () => `review-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const good = { rating: 5, text: "Hjälpte mig plugga inför provet.", name: "Elin", context: "Elev, åk 9", lang: "sv", consent: true };

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

describe("reviews", () => {
  let server;
  before(async () => { server = await startServer({ REVIEW_ADMIN_KEY: KEY }); });
  after(async () => { await server.stop(); });

  test("sending a review requires a signed-in session", async () => {
    const { status } = await makeClient(server.baseUrl).post("/api/reviews", good);
    assert.equal(status, 401);
  });

  test("invalid input is rejected with a specific code", async () => {
    const c = await signedIn(server.baseUrl);
    const cases = [
      [{ rating: 0 }, "review_rating"], [{ rating: 4.5 }, "review_rating"],
      [{ text: "kort" }, "review_text"], [{ text: "x".repeat(601) }, "review_text"],
      [{ name: "" }, "review_name"], [{ name: "elin@example.com" }, "review_name"], [{ name: "Elin2009" }, "review_name"],
      [{ context: "x".repeat(61) }, "review_context"],
      [{ lang: "de" }, "review_lang"],
      [{ consent: false }, "review_consent"], [{ consent: "yes" }, "review_consent"],
    ];
    for (const [patch, code] of cases) {
      const { status, json } = await c.post("/api/reviews", { ...good, ...patch });
      assert.equal(status, 400, JSON.stringify(patch));
      assert.equal(json.error.code, code, JSON.stringify(patch));
    }
  });

  test("a new review is pending and not public until approved", async () => {
    const c = await signedIn(server.baseUrl);
    const sent = await c.post("/api/reviews", { ...good, name: "Pending Person" });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.status, "pending");

    const mine = await c.get("/api/reviews/mine");
    assert.equal(mine.json.review.status, "pending");
    assert.equal(mine.json.review.name, "Pending Person");

    const pub = await makeClient(server.baseUrl).get("/api/reviews");
    assert.ok(!pub.json.reviews.some((r) => r.name === "Pending Person"));
  });

  test("approving makes it public without any email or user id; rejecting hides it again", async () => {
    const c = await signedIn(server.baseUrl);
    await c.post("/api/reviews", { ...good, name: "Approve Me" });
    const a = admin(server.baseUrl);
    const queue = await a.get("/api/admin/reviews?status=pending");
    assert.equal(queue.status, 200);
    const item = queue.json.reviews.find((r) => r.name === "Approve Me");
    assert.ok(item);

    assert.equal((await a.post(`/api/admin/reviews/${item.id}`, { status: "approved" })).status, 200);
    const pub = await makeClient(server.baseUrl).get("/api/reviews");
    const shown = pub.json.reviews.find((r) => r.name === "Approve Me");
    assert.deepEqual(Object.keys(shown).sort(), ["context", "date", "lang", "name", "rating", "text"]);
    assert.match(shown.date, /^\d{4}-\d{2}-\d{2}$/);

    await a.post(`/api/admin/reviews/${item.id}`, { status: "rejected" });
    const after = await makeClient(server.baseUrl).get("/api/reviews");
    assert.ok(!after.json.reviews.some((r) => r.name === "Approve Me"));
  });

  test("editing an approved review sends it back to the queue", async () => {
    const c = await signedIn(server.baseUrl);
    await c.post("/api/reviews", { ...good, name: "Editor" });
    const a = admin(server.baseUrl);
    const { json } = await a.get("/api/admin/reviews?status=pending");
    const id = json.reviews.find((r) => r.name === "Editor").id;
    await a.post(`/api/admin/reviews/${id}`, { status: "approved" });

    await c.post("/api/reviews", { ...good, name: "Editor", text: "Ändrade min recension lite grann." });
    assert.equal((await c.get("/api/reviews/mine")).json.review.status, "pending");
    const pub = await makeClient(server.baseUrl).get("/api/reviews");
    assert.ok(!pub.json.reviews.some((r) => r.name === "Editor"));
    const count = server.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE display_name = 'Editor'").get().n;
    assert.equal(count, 1, "one review per account");
  });

  test("a student can take their review back", async () => {
    const c = await signedIn(server.baseUrl);
    await c.post("/api/reviews", good);
    assert.equal((await c.delete("/api/reviews/mine")).status, 200);
    assert.equal((await c.get("/api/reviews/mine")).json.review, null);
  });

  test("deleting the account deletes the review", async () => {
    const c = makeClient(server.baseUrl);
    const email = uniqueEmail();
    await c.post("/api/auth/signup", { email, password: "correctpw1", consent: true });
    await c.post("/api/reviews", { ...good, name: "Leaver" });
    await c.delete("/api/account", { password: "correctpw1" });
    const n = server.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE display_name = 'Leaver'").get().n;
    assert.equal(n, 0);
  });

  test("admin endpoints refuse a wrong or missing key", async () => {
    assert.equal((await admin(server.baseUrl, "wrong").get("/api/admin/reviews")).status, 403);
    assert.equal((await admin(server.baseUrl, "").get("/api/admin/reviews")).status, 403);
    assert.equal((await makeClient(server.baseUrl).post("/api/admin/reviews/x", { status: "approved" })).status, 403);
  });

  test("admin can delete a review, and bad ids or statuses are refused", async () => {
    const c = await signedIn(server.baseUrl);
    await c.post("/api/reviews", { ...good, name: "Deleted" });
    const a = admin(server.baseUrl);
    const id = (await a.get("/api/admin/reviews")).json.reviews.find((r) => r.name === "Deleted").id;
    assert.equal((await a.post(`/api/admin/reviews/${id}`, { status: "maybe" })).status, 400);
    assert.equal((await a.delete(`/api/admin/reviews/${id}`)).status, 200);
    assert.equal((await a.delete(`/api/admin/reviews/${id}`)).status, 404);
  });
});

describe("reviews without REVIEW_ADMIN_KEY", () => {
  let server;
  before(async () => { server = await startServer({ REVIEW_ADMIN_KEY: "" }); });
  after(async () => { await server.stop(); });

  test("the admin endpoints don't exist, even with some key", async () => {
    assert.equal((await admin(server.baseUrl, "anything").get("/api/admin/reviews")).status, 404);
  });
});
