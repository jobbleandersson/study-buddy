import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";
import { digestOf } from "../src/state-digest.js";
import { jsonDepth, MAX_STATE_DEPTH } from "../src/json-depth.js";

// What a saved study state may contain and how often it may be saved. The state is whatever the browser
// sent, and saving, summarising and reading it all run on the one thread every other request shares.

const DAY = 86_400_000;
const email = () => `sb-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
async function account(baseUrl) {
  const c = makeClient(baseUrl);
  const r = await c.post("/api/auth/signup", { email: email(), password: "correctpw1", consent: true });
  assert.equal(r.status, 200);
  return c;
}
async function putRaw(baseUrl, c, text) {
  const res = await fetch(`${baseUrl}/api/state`, { method: "PUT", headers: { "content-type": "application/json", cookie: c.cookie }, body: text });
  let json = null; try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}
const stateText = (version, blob) => JSON.stringify({ version, blob });
const dayKey = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describe("jsonDepth", () => {
  test("counts nesting of objects and arrays and ignores brackets inside strings", () => {
    assert.equal(jsonDepth(Buffer.from('{"a":[1,{"b":2}]}')), 3);
    assert.equal(jsonDepth(Buffer.from('{"a":"[[[[ {{{{ ]]]]"}')), 1);
    assert.equal(jsonDepth(Buffer.from('{"a":"quote \\" then [[[["}')), 1);   // an escaped quote does not end the string
    assert.equal(jsonDepth(Buffer.from("5")), 0);
  });
  test("stops early once the limit is passed", () => {
    const deep = Buffer.from("[".repeat(100_000));
    assert.ok(jsonDepth(deep, MAX_STATE_DEPTH) > MAX_STATE_DEPTH);
  });
});

describe("digestOf is bounded", () => {
  test("study days: real dates only, none in the far future, no repeats, at most 1,500", () => {
    const many = Array.from({ length: 5000 }, (_, i) => dayKey(-i));
    const d = digestOf({ activity: { daysStudied: [...many, "not a day", "2026-13-45x", dayKey(30), dayKey(-1)], frozenDays: [dayKey(5), dayKey(0)] } });
    assert.equal(d.days.length, 1500);
    assert.equal(d.days.at(-1), dayKey(0));
    assert.equal(d.days.includes("not a day"), false);
    assert.equal(d.days.includes(dayKey(30)), false, "a day a month ahead is dropped");
    assert.deepEqual(d.frozen, [dayKey(0)], "a frozen day in the future is dropped, today stays");
  });

  test("answers per attempt, per day and distinct questions have ceilings", () => {
    const item = (i) => ({ questionId: `q${i}`, firstTry: true });
    const now = Date.now();
    const oneAttemptOverCap = digestOf({ attempts: [{ finishedAt: now, items: Array.from({ length: 600 }, (_, i) => item(i)) }] });
    assert.equal(oneAttemptOverCap.attempts[0][1], 500, "one attempt counts at most 500 answers");
    const manyAttempts = digestOf({ attempts: Array.from({ length: 50 }, () => ({ finishedAt: now, items: Array.from({ length: 500 }, (_, i) => item(i)) })) });
    assert.equal(manyAttempts.attempts.length, 1);
    assert.equal(manyAttempts.attempts[0][1], 1000, "however many attempts claim a day, it counts at most 1,000");
    const wide = digestOf({ attempts: Array.from({ length: 50 }, (_, a) => ({ finishedAt: now + a, items: Array.from({ length: 500 }, (_, i) => item(a * 500 + i)) })) });
    assert.equal(Object.keys(wide.answers).length, 20_000, "no more than 20,000 distinct questions are kept");
    const longId = digestOf({ attempts: [{ finishedAt: now, items: [{ questionId: "x".repeat(200), firstTry: true }] }] });
    assert.deepEqual(longId.answers, {}, "an id over 80 characters is not a question id");
  });
});

describe("saving a state", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("a state nested far too deeply is refused with a 400, not a server error, and nothing is stored", async () => {
    const c = await account(server.baseUrl);
    const cur = (await c.get("/api/state")).json.version;
    const deep = `{"version":${cur},"blob":{"x":${"[".repeat(90_000)}${"]".repeat(90_000)}}}`;
    const r = await putRaw(server.baseUrl, c, deep);
    assert.equal(r.status, 400);
    assert.equal(r.json?.error?.code, "bad_request");
    assert.equal((await c.get("/api/state")).json.version, cur, "the version did not move");
    assert.equal((await putRaw(server.baseUrl, c, stateText(cur, { fine: [[1, 2], { a: [3] }] }))).status, 200, "a normal save still works");
  });

  test("a real state with brackets inside its text is not mistaken for a deep one", async () => {
    const c = await account(server.baseUrl);
    const text = "[".repeat(500) + "{{{{";
    assert.equal((await putRaw(server.baseUrl, c, stateText(0, { chats: [text] }))).status, 200);
  });

  test("the leaderboard shows a friend's streak and week from the capped summary", async () => {
    const a = await account(server.baseUrl);
    const b = await account(server.baseUrl);
    const code = (await a.post("/api/friends/invite-code")).json.code;
    assert.equal((await b.post("/api/friends/redeem", { code })).status, 200);
    const days = Array.from({ length: 20_000 }, (_, i) => dayKey(-i));   // 54 years of consecutive study days
    const now = Date.now();
    const attempts = Array.from({ length: 60 }, () => ({ finishedAt: now, items: Array.from({ length: 500 }, () => ({})) }));
    const put = await putRaw(server.baseUrl, a, stateText(0, { activity: { daysStudied: days, frozenDays: [] }, attempts }));
    assert.equal(put.status, 200);
    const mine = (await b.get("/api/friends/leaderboard")).json.entries.find((e) => !e.isMe);
    assert.equal(mine.streak, 1500, "the streak counts at most the 1,500 most recent days");
    assert.equal(mine.questionsThisWeek, 1000, "30,000 claimed answers today count as the daily maximum");
  });
});

describe("how often one account may save", () => {
  let server;
  before(async () => { server = await startServer({ STATE_SAVES_PER_MIN_PER_USER: "3", STATE_BIG_MB_PER_5MIN_PER_USER: "3" }); });
  after(async () => { await server.stop(); });

  test("the fourth save within a minute is a 429 with Retry-After, and another account is not affected", async () => {
    const c = await account(server.baseUrl);
    let version = 0;
    for (let i = 0; i < 3; i++) {
      const r = await putRaw(server.baseUrl, c, stateText(version, { n: i }));
      assert.equal(r.status, 200);
      version = r.json.version;
    }
    const blocked = await putRaw(server.baseUrl, c, stateText(version, { n: 4 }));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal(blocked.json?.error?.code, "too_many_saves");
    const other = await account(server.baseUrl);
    assert.equal((await putRaw(server.baseUrl, other, stateText(0, { n: 1 }))).status, 200);
  });

  test("big bodies draw on a megabyte budget; small ones never do", async () => {
    const c = await account(server.baseUrl);
    const big = (version) => stateText(version, { filler: "x".repeat(1_500_000) });   // 2 units each of a budget of 3
    const first = await putRaw(server.baseUrl, c, big(0));
    assert.equal(first.status, 200);
    const second = await putRaw(server.baseUrl, c, big(first.json.version));
    assert.equal(second.status, 429, "the second 1.5 MB save would pass the 3 MB budget");
    const small = await putRaw(server.baseUrl, c, stateText(first.json.version, { n: 1 }));
    assert.equal(small.status, 200, "a small state is still accepted");
  });
});

describe("the whole server's budget for big saves", () => {
  let server;
  before(async () => { server = await startServer({ STATE_BIG_MB_PER_MIN_ALL: "3" }); });
  after(async () => { await server.stop(); });

  test("two accounts together cannot pass it: the second big save is refused, small ones are not", async () => {
    const a = await account(server.baseUrl);
    const b = await account(server.baseUrl);
    const big = () => stateText(0, { filler: "x".repeat(1_500_000) });   // 2 units of a budget of 3
    assert.equal((await putRaw(server.baseUrl, a, big())).status, 200);
    assert.equal((await putRaw(server.baseUrl, b, big())).status, 429);
    assert.equal((await putRaw(server.baseUrl, b, stateText(0, { n: 1 }))).status, 200);
  });
});
