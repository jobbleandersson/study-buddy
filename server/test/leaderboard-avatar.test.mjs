import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

const uniqueEmail = () => `lb-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const PIC = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

async function signedIn(baseUrl) {
  const c = makeClient(baseUrl);
  await c.post("/api/auth/signup", { email: uniqueEmail(), password: "correctpw1", consent: true });
  return c;
}

/** Two accounts that are friends. */
async function friends(baseUrl) {
  const a = await signedIn(baseUrl);
  const b = await signedIn(baseUrl);
  const { json } = await a.post("/api/friends/invite-code");
  const redeemed = await b.post("/api/friends/redeem", { code: json.code });
  assert.equal(redeemed.status, 200);
  return { a, b };
}

/** Sync a state blob for `c`, bumping the version the way the app does. */
async function putState(c, blob) {
  const cur = await c.get("/api/state");
  const res = await c.put("/api/state", { version: cur.json.version, blob });
  assert.equal(res.status, 200);
}

const theirEntry = async (viewer) => (await viewer.get("/api/friends/leaderboard")).json.entries.find((e) => !e.isMe);
const myEntry = async (viewer) => (await viewer.get("/api/friends/leaderboard")).json.entries.find((e) => e.isMe);

describe("leaderboard profile pictures", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("a friend's picture comes back on the leaderboard, and so does your own", async () => {
    const { a, b } = await friends(server.baseUrl);
    await putState(a, { avatar: PIC, attempts: [] });
    await putState(b, { avatar: PIC.replace("UklG", "UklH"), attempts: [] });
    assert.equal((await theirEntry(b)).avatar, PIC);
    assert.equal((await myEntry(b)).avatar, PIC.replace("UklG", "UklH"));
  });

  test("no picture, or no synced state at all, is null — never missing or an empty string", async () => {
    const { a, b } = await friends(server.baseUrl);
    assert.equal((await theirEntry(b)).synced, false);
    assert.equal((await theirEntry(b)).avatar, null);
    await putState(a, { attempts: [] });
    assert.equal((await theirEntry(b)).avatar, null);
  });

  test("anything that isn't a small webp/jpeg/png data URL is dropped, not forwarded to friends", async () => {
    const { a, b } = await friends(server.baseUrl);
    const bad = [
      "javascript:alert(1)",
      "https://example.com/tracker.png",
      "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
      "data:text/html;base64,PHNjcmlwdD4=",
      'data:image/png;base64,AAAA" onerror="alert(1)',
      `data:image/png;base64,${"A".repeat(200_001)}`,
      12345,
      { src: PIC },
      ["x"],
    ];
    for (const avatar of bad) {
      await putState(a, { avatar, attempts: [] });
      assert.equal((await theirEntry(b)).avatar, null, JSON.stringify(avatar).slice(0, 60));
    }
  });

  test("someone who isn't your friend never appears, picture or not", async () => {
    const { a } = await friends(server.baseUrl);
    const stranger = await signedIn(server.baseUrl);
    await putState(stranger, { avatar: PIC, attempts: [] });
    const entries = (await a.get("/api/friends/leaderboard")).json.entries;
    assert.equal(entries.length, 2, "just you and your one friend");
    assert.ok(entries.every((e) => e.avatar === null), "the stranger's picture is nowhere in the response");
  });
});
