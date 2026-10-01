import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, sessionCookieFrom } from "./harness.mjs";

const PASSWORD = "ebbe-and-liam";
const SIGNUP = (email) => ({ email, password: "a-good-password", consent: true });

async function unlock(baseUrl, password) {
  const res = await fetch(`${baseUrl}/api/gate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return { res, status: res.status, cookie: sessionCookieFrom(res, "sb_gate") };
}

describe("site password (SITE_PASSWORD set)", () => {
  let server;
  before(async () => { server = await startServer({ SITE_PASSWORD: PASSWORD }); });
  after(async () => { await server.stop(); });

  test("/api/health says the site is locked, and that this visitor has not unlocked it", async () => {
    const { status, json } = await makeClient(server.baseUrl).get("/api/health");
    assert.equal(status, 200);
    assert.equal(json.siteLocked, true);
    assert.equal(json.unlocked, false);
  });

  test("without the password the API is closed: no sign-up, sign-in, state, AI or analytics", async () => {
    const c = makeClient(server.baseUrl);
    for (const [method, path, body] of [
      ["post", "/api/auth/signup", SIGNUP("anyone@example.com")],
      ["post", "/api/auth/login", { email: "anyone@example.com", password: "a-good-password" }],
      ["get", "/api/auth/me"],
      ["get", "/api/state"],
      ["post", "/api/messages", { messages: [] }],
      ["post", "/api/analytics/pageview", {}],
      ["get", "/api/nope"],
      ["get", "/API/auth/me"],
      ["get", "/api//health"],
    ]) {
      const r = await c[method](path, body);
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.equal(r.json?.error?.code, "site_locked", `${method} ${path}`);
    }
    assert.equal(c.cookie, null, "a refused sign-up must not have made an account or session");
  });

  test("a wrong password is refused and sets no cookie", async () => {
    for (const bad of ["", "nope", PASSWORD + " ", PASSWORD.toUpperCase(), "x".repeat(500)]) {
      const r = await unlock(server.baseUrl, bad);
      assert.equal(r.status, 401, JSON.stringify(bad.slice(0, 20)));
      assert.equal(r.cookie, null);
    }
    const noBody = await fetch(`${server.baseUrl}/api/gate`, { method: "POST" });
    assert.equal(noBody.status, 401);
    const notAString = await fetch(`${server.baseUrl}/api/gate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: { $ne: 1 } }),
    });
    assert.equal(notAString.status, 401);
  });

  test("the right password sets a long-lived, HttpOnly cookie that opens the API", async () => {
    const r = await unlock(server.baseUrl, PASSWORD);
    assert.equal(r.status, 200);
    assert.ok(r.cookie, "sets sb_gate");
    const header = r.res.headers.getSetCookie().find((c) => c.startsWith("sb_gate="));
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(header)?.[1]);
    assert.ok(maxAge >= 300 * 24 * 3600, `stays for about a year, got ${maxAge}s`);
    assert.ok(!header.includes(PASSWORD), "the password itself is never in the cookie");

    const c = makeClient(server.baseUrl, { extraCookie: r.cookie });
    const health = await c.get("/api/health");
    assert.equal(health.json.unlocked, true);
    assert.equal((await c.post("/api/auth/signup", SIGNUP("me@example.com"))).status, 200);
    assert.equal((await c.get("/api/auth/me")).json.authed, true);
    assert.equal((await c.get("/api/state")).status, 200);
  });

  test("a made-up or tampered cookie does not open anything", async () => {
    const real = (await unlock(server.baseUrl, PASSWORD)).cookie;
    const flipped = real.slice(0, -1) + (real.endsWith("0") ? "1" : "0");
    for (const cookie of ["sb_gate=1", "sb_gate=", `sb_gate=${PASSWORD}`, flipped, real + "00", "sb_gate=" + "a".repeat(64)]) {
      const r = await makeClient(server.baseUrl, { extraCookie: cookie }).get("/api/state");
      assert.equal(r.status, 403, cookie);
    }
  });

  test("a signed-in session alone is not enough without the password cookie", async () => {
    const real = (await unlock(server.baseUrl, PASSWORD)).cookie;
    const c = makeClient(server.baseUrl, { extraCookie: real });
    await c.post("/api/auth/signup", SIGNUP("session@example.com"));
    const sessionOnly = makeClient(server.baseUrl);
    sessionOnly.cookie = c.cookie;
    assert.equal((await sessionOnly.get("/api/state")).status, 403);
  });

  test("signing in and out works as usual once unlocked, for any email", async () => {
    const cookie = (await unlock(server.baseUrl, PASSWORD)).cookie;
    const first = makeClient(server.baseUrl, { extraCookie: cookie });
    assert.equal((await first.post("/api/auth/signup", SIGNUP("anyone-at-all@example.com"))).status, 200);
    const again = makeClient(server.baseUrl, { extraCookie: cookie });
    assert.equal((await again.post("/api/auth/login", { email: "anyone-at-all@example.com", password: "a-good-password" })).status, 200);
  });

  test("unlocking again from an unlocked device is a harmless no-op", async () => {
    const cookie = (await unlock(server.baseUrl, PASSWORD)).cookie;
    const r = await fetch(`${server.baseUrl}/api/gate`, {
      method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ password: "whatever" }),
    });
    assert.equal(r.status, 200);
  });

  test("the public practice pages and the sitemap stay hidden while the site is private", async () => {
    const ova = await fetch(`${server.baseUrl}/ova/ak9-matematik`, { redirect: "manual" });
    assert.equal(ova.status, 302);
    assert.equal(ova.headers.get("location"), "/");
    assert.equal((await fetch(`${server.baseUrl}/sitemap.xml`)).status, 404);
  });

  test("the front page itself is still served, so there is somewhere to type the password", async () => {
    const res = await fetch(`${server.baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /html/);
  });
});

describe("changing SITE_PASSWORD signs every device out of the gate", () => {
  test("a cookie from the old password is refused by a server started with a new one", async () => {
    const one = await startServer({ SITE_PASSWORD: "old-password" });
    let oldCookie;
    try { oldCookie = (await unlock(one.baseUrl, "old-password")).cookie; } finally { await one.stop(); }
    assert.ok(oldCookie);
    const two = await startServer({ SITE_PASSWORD: "new-password" });
    try {
      assert.equal((await makeClient(two.baseUrl, { extraCookie: oldCookie }).get("/api/state")).status, 403);
      assert.equal((await unlock(two.baseUrl, "old-password")).status, 401);
      assert.equal((await unlock(two.baseUrl, "new-password")).status, 200);
    } finally { await two.stop(); }
  });
});

describe("open (SITE_PASSWORD unset)", () => {
  let server;
  before(async () => { server = await startServer({ SITE_PASSWORD: "" }); });
  after(async () => { await server.stop(); });

  test("nothing is locked, and the gate endpoint is a no-op", async () => {
    const c = makeClient(server.baseUrl);
    const health = (await c.get("/api/health")).json;
    assert.equal(health.siteLocked, false);
    assert.equal(health.unlocked, true);
    assert.equal((await c.post("/api/auth/signup", SIGNUP("anyone@example.com"))).status, 200);
    assert.equal((await unlock(server.baseUrl, "anything")).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/ova`)).status, 200);
  });
});
