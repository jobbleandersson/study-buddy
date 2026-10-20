import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "./harness.mjs";

// Links as the other way to hand over what a code hands over: a student's invitation for a parent or
// teacher, and a class's join. A link is a long random token in an address the app opens; the short
// codes keep working exactly as before.

const email = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("a student's invite link for a parent or teacher", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  async function account(prefix) {
    const addr = email(prefix);
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/signup", { email: addr, password: "correctpw1", consent: true })).status, 200);
    return { addr, c };
  }
  const userId = (addr) => server.db.prepare("SELECT id FROM users WHERE email = ?").get(addr).id;

  test("asking again gives the same live link, a long token that lasts a day", async () => {
    const student = await account("student");
    const first = (await student.c.post("/api/links/invite-link")).json;
    assert.match(first.token, /^[A-Za-z0-9_-]{24}$/);
    const day = first.expiresAt - Date.now();
    assert.ok(day > 23 * 3600e3 && day <= 24 * 3600e3, "about 24 hours");
    const second = (await student.c.post("/api/links/invite-link")).json;
    assert.equal(second.token, first.token);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM invite_links WHERE student_user_id = ?").get(userId(student.addr)).n, 1);
    assert.equal((await makeClient(server.baseUrl).post("/api/links/invite-link")).status, 401, "needs a session");
  });

  test("the preview names the student without using the link up, and never shows the whole address", async () => {
    const student = await account("student");
    const parent = await account("parent");
    const { token } = (await student.c.post("/api/links/invite-link")).json;

    const seen = await parent.c.post("/api/links/preview", { token });
    assert.equal(seen.status, 200);
    assert.ok(seen.json.studentName);
    assert.equal(JSON.stringify(seen.json).includes(student.addr), false);
    assert.match(seen.json.studentName, /@example\.com$/);
    assert.equal((await parent.c.post("/api/links/preview", { token })).status, 200, "looking does not use it up");
    assert.deepEqual((await parent.c.get("/api/links")).json.asParent, [], "and links nothing");
  });

  test("redeeming a link links the accounts, and it works once", async () => {
    const student = await account("student");
    const parent = await account("parent");
    const other = await account("other");
    const { token } = (await student.c.post("/api/links/invite-link")).json;

    const done = await parent.c.post("/api/links/redeem", { token });
    assert.equal(done.status, 200);
    assert.equal(done.json.studentEmail, student.addr);
    const mine = (await parent.c.get("/api/links")).json.asParent;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].studentUserId, userId(student.addr));
    assert.equal((await student.c.get("/api/links")).json.asStudent.length, 1);

    assert.equal((await other.c.post("/api/links/redeem", { token })).status, 400, "used");
    assert.equal((await other.c.post("/api/links/preview", { token })).status, 400, "and no longer shown");
    assert.deepEqual((await other.c.get("/api/links")).json.asParent, []);
  });

  test("two people opening the same link at once: only one becomes the parent", async () => {
    const student = await account("student");
    const a = await account("a");
    const b = await account("b");
    const { token } = (await student.c.post("/api/links/invite-link")).json;
    const results = await Promise.all([a.c.post("/api/links/redeem", { token }), b.c.post("/api/links/redeem", { token })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM links WHERE student_user_id = ?").get(userId(student.addr)).n, 1);
  });

  test("an expired link, an unknown one and your own are refused", async () => {
    const student = await account("student");
    const parent = await account("parent");
    const { token } = (await student.c.post("/api/links/invite-link")).json;

    assert.equal((await student.c.post("/api/links/redeem", { token })).status, 400, "not your own account");
    assert.equal((await student.c.post("/api/links/preview", { token })).status, 400);
    assert.equal((await parent.c.post("/api/links/redeem", { token: "A".repeat(24) })).status, 400, "no such link");
    assert.equal((await parent.c.post("/api/links/preview", {})).status, 400);

    server.db.prepare("UPDATE invite_links SET expires_at = ? WHERE code = ?").run(Date.now() - 1000, token);
    assert.equal((await parent.c.post("/api/links/preview", { token })).status, 400);
    const late = await parent.c.post("/api/links/redeem", { token });
    assert.equal(late.status, 400);
    assert.match(late.json.error.message, /invitation/);
    // and the student gets a fresh one rather than the dead one
    const fresh = (await student.c.post("/api/links/invite-link")).json;
    assert.notEqual(fresh.token, token);
  });

  test("a code is not a link and a link is not a code", async () => {
    const student = await account("student");
    const parent = await account("parent");
    const { code } = (await student.c.post("/api/links/invite-code")).json;
    const { token } = (await student.c.post("/api/links/invite-link")).json;
    assert.equal((await parent.c.post("/api/links/redeem", { token: code })).status, 400);
    assert.equal((await parent.c.post("/api/links/redeem", { code: token })).status, 400);
    assert.equal((await parent.c.post("/api/links/redeem", { code })).status, 200, "the code still works the old way");
    assert.equal((await parent.c.post("/api/links/redeem", { token })).status, 200, "and the link is its own invitation");
  });

  test("deleting the account removes its links", async () => {
    const student = await account("student");
    await student.c.post("/api/links/invite-link");
    const id = userId(student.addr);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM invite_links WHERE student_user_id = ?").get(id).n, 1);
    const del = await student.c.delete("/api/account", { password: "correctpw1" });
    assert.equal(del.status, 200);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM invite_links WHERE student_user_id = ?").get(id).n, 0);
  });
});

describe("a class's join link", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  async function account(prefix) {
    const addr = email(prefix);
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/signup", { email: addr, password: "correctpw1", consent: true })).status, 200);
    return { addr, c };
  }

  test("the teacher gets one long token that stays the same, and only they can ask for it", async () => {
    const teacher = await account("teacher");
    const other = await account("other");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 7A" })).json;

    const first = await teacher.c.post(`/api/classes/${cls.id}/link`);
    assert.equal(first.status, 200);
    assert.match(first.json.token, /^[A-Za-z0-9_-]{24}$/);
    assert.equal((await teacher.c.post(`/api/classes/${cls.id}/link`)).json.token, first.json.token);

    assert.equal((await other.c.post(`/api/classes/${cls.id}/link`)).status, 404);
    assert.equal((await makeClient(server.baseUrl).post(`/api/classes/${cls.id}/link`)).status, 401);

    // the token is not part of anything else the class answers with
    assert.equal(JSON.stringify((await teacher.c.get("/api/classes")).json).includes(first.json.token), false);
    assert.equal(JSON.stringify((await teacher.c.get(`/api/classes/${cls.id}`)).json).includes(first.json.token), false);
  });

  test("a student sees the class and its teacher, then joins with the link", async () => {
    const teacher = await account("teacher");
    const student = await account("student");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 8B" })).json;
    const { token } = (await teacher.c.post(`/api/classes/${cls.id}/link`)).json;

    const seen = await student.c.post("/api/classes/preview", { token });
    assert.equal(seen.status, 200);
    assert.equal(seen.json.name, "Klass 8B");
    assert.ok(seen.json.teacherName);
    assert.equal(JSON.stringify(seen.json).includes(teacher.addr), false, "never the whole address");
    assert.equal(seen.json.alreadyMember, false);
    assert.deepEqual((await student.c.get("/api/classes")).json.member, [], "looking joins nothing");

    const joined = await student.c.post("/api/classes/join", { token });
    assert.equal(joined.status, 200);
    assert.equal(joined.json.name, "Klass 8B");
    assert.equal((await student.c.get("/api/classes")).json.member.length, 1);
    assert.equal((await student.c.post("/api/classes/preview", { token })).json.alreadyMember, true);
    assert.equal((await student.c.post("/api/classes/join", { token })).status, 200, "joining twice is harmless");
    assert.equal((await teacher.c.get(`/api/classes/${cls.id}`)).json.members.length, 1);
  });

  test("the teacher cannot join their own class, and the code still works", async () => {
    const teacher = await account("teacher");
    const student = await account("student");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 9C" })).json;
    const { token } = (await teacher.c.post(`/api/classes/${cls.id}/link`)).json;
    assert.equal((await teacher.c.post("/api/classes/join", { token })).status, 400);
    assert.equal((await teacher.c.post("/api/classes/preview", { token })).status, 400);
    assert.equal((await student.c.post("/api/classes/join", { code: cls.code })).status, 200);
  });

  test("a link is not a code and a code is not a link", async () => {
    const teacher = await account("teacher");
    const student = await account("student");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 7B" })).json;
    const { token } = (await teacher.c.post(`/api/classes/${cls.id}/link`)).json;
    assert.equal((await student.c.post("/api/classes/join", { token: cls.code })).status, 400);
    assert.equal((await student.c.post("/api/classes/join", { code: token })).status, 400);
    assert.equal((await student.c.post("/api/classes/preview", { token: cls.code })).status, 400);
    assert.equal((await student.c.post("/api/classes/join", {})).status, 400);
  });

  test("a new class code takes the link with it; students already in stay; the next link is a different one", async () => {
    const teacher = await account("teacher");
    const student = await account("student");
    const late = await account("late");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass 8A" })).json;
    const old = (await teacher.c.post(`/api/classes/${cls.id}/link`)).json.token;
    assert.equal((await student.c.post("/api/classes/join", { token: old })).status, 200);

    assert.equal((await teacher.c.post(`/api/classes/${cls.id}/new-code`)).status, 200);
    assert.equal((await late.c.post("/api/classes/join", { token: old })).status, 400, "the old link no longer works");
    assert.equal((await late.c.post("/api/classes/preview", { token: old })).status, 400);
    assert.equal((await student.c.get("/api/classes")).json.member.length, 1, "the first student is still in");

    const fresh = (await teacher.c.post(`/api/classes/${cls.id}/link`)).json.token;
    assert.notEqual(fresh, old);
    assert.equal((await late.c.post("/api/classes/join", { token: fresh })).status, 200);
  });

  test("a full class refuses a link as it does a code", async () => {
    const teacher = await account("teacher");
    const student = await account("student");
    const cls = (await teacher.c.post("/api/classes", { name: "Klass full" })).json;
    const { token } = (await teacher.c.post(`/api/classes/${cls.id}/link`)).json;
    const ins = server.db.prepare("INSERT INTO class_members (class_id, student_user_id, joined_at) VALUES (?, ?, ?)");
    const mkUser = server.db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', ?)");
    for (let i = 0; i < 200; i++) { const id = `fill-${cls.id}-${i}`; mkUser.run(id, `${id}@example.com`, Date.now()); ins.run(cls.id, id, Date.now()); }
    const full = await student.c.post("/api/classes/join", { token });
    assert.equal(full.status, 400);
    assert.match(full.json.error.message, /full/);
  });
});

describe("wrong links count as wrong guesses", () => {
  let server;
  before(async () => { server = await startServer({ CODE_FAILS_PER_10MIN_PER_USER: "3" }); });
  after(async () => { await server.stop(); });

  test("after a few wrong tokens an account is turned away, for previews and joins alike", async () => {
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/signup", { email: email("guess"), password: "correctpw1", consent: true })).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await c.post("/api/classes/preview", { token: `${"B".repeat(23)}${i}` })).status, 400);
    assert.equal((await c.post("/api/classes/join", { token: "C".repeat(24) })).status, 429);
    assert.equal((await c.post("/api/links/redeem", { token: "D".repeat(24) })).status, 429);
  });
});

describe("a link's token is never recorded where someone was", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  test("the entry pageview and an error report store the route without the token", async () => {
    const token = "SecretTokenAbCdEfGhIjKl";
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/analytics/pageview", { path: `/join/class/${token}`, referrer: null })).status, 204);
    assert.equal((await c.post("/api/analytics/pageview", { path: `/join/parent/${token}` })).status, 204);
    assert.equal((await c.post("/api/client-errors", { kind: "error", message: "boom", route: `/join/class/${token}` })).status, 204);
    assert.equal((await c.post("/api/analytics/pageview", { path: "/classes" })).status, 204, "other routes are kept as they are");

    const paths = server.db.prepare("SELECT path FROM page_views").all().map((r) => r.path).sort();
    assert.deepEqual(paths, ["/classes", "/join/class/:id", "/join/parent/:id"]);
    assert.equal(server.db.prepare("SELECT route FROM client_errors").get().route, "/join/class/:id");
    const everything = JSON.stringify([server.db.prepare("SELECT * FROM page_views").all(), server.db.prepare("SELECT * FROM client_errors").all()]);
    assert.equal(everything.includes(token), false);
  });
});

describe("a friend link", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  async function account(prefix) {
    const addr = email(prefix);
    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/auth/signup", { email: addr, password: "correctpw1", consent: true })).status, 200);
    return { addr, c };
  }
  const userId = (addr) => server.db.prepare("SELECT id FROM users WHERE email = ?").get(addr).id;

  test("asking again gives the same live link, a long token that lasts a day", async () => {
    const a = await account("a");
    const first = (await a.c.post("/api/friends/invite-link")).json;
    assert.match(first.token, /^[A-Za-z0-9_-]{24}$/);
    const life = first.expiresAt - Date.now();
    assert.ok(life > 23 * 3600e3 && life <= 24 * 3600e3);
    assert.equal((await a.c.post("/api/friends/invite-link")).json.token, first.token);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM friend_invite_links WHERE user_id = ?").get(userId(a.addr)).n, 1);
    assert.equal((await makeClient(server.baseUrl).post("/api/friends/invite-link")).status, 401);
  });

  test("the preview names who is asking without using the link up; the link then makes them friends on both boards", async () => {
    const a = await account("a");
    const b = await account("b");
    const { token } = (await a.c.post("/api/friends/invite-link")).json;

    const seen = await b.c.post("/api/friends/preview", { token });
    assert.equal(seen.status, 200);
    assert.match(seen.json.friendName, /@example\.com$/);
    assert.equal(JSON.stringify(seen.json).includes(a.addr), false, "never the whole address");
    assert.equal(seen.json.alreadyFriends, false);
    assert.equal((await b.c.get("/api/friends/leaderboard")).json.entries.length, 1, "looking adds nobody");

    const done = await b.c.post("/api/friends/redeem", { token });
    assert.equal(done.status, 200);
    assert.ok(done.json.friendName);
    assert.equal((await a.c.get("/api/friends/leaderboard")).json.entries.length, 2);
    assert.equal((await b.c.get("/api/friends/leaderboard")).json.entries.length, 2);
    assert.equal((await b.c.post("/api/friends/preview", { token })).status, 400, "used");
  });

  test("it works once, even when two people open it at once", async () => {
    const a = await account("a");
    const b = await account("b");
    const c = await account("c");
    const { token } = (await a.c.post("/api/friends/invite-link")).json;
    const results = await Promise.all([b.c.post("/api/friends/redeem", { token }), c.c.post("/api/friends/redeem", { token })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM friend_links WHERE user_a_id = ? OR user_b_id = ?").get(userId(a.addr), userId(a.addr)).n, 1);
  });

  test("your own link, an unknown one and an expired one are refused; people who are friends already are told", async () => {
    const a = await account("a");
    const b = await account("b");
    const { token } = (await a.c.post("/api/friends/invite-link")).json;
    assert.equal((await a.c.post("/api/friends/redeem", { token })).status, 400);
    assert.equal((await a.c.post("/api/friends/preview", { token })).status, 400);
    assert.equal((await b.c.post("/api/friends/redeem", { token: "Z".repeat(24) })).status, 400);
    assert.equal((await b.c.post("/api/friends/preview", {})).status, 400);

    server.db.prepare("UPDATE friend_invite_links SET expires_at = ? WHERE code = ?").run(Date.now() - 1000, token);
    assert.equal((await b.c.post("/api/friends/preview", { token })).status, 400);
    const fresh = (await a.c.post("/api/friends/invite-link")).json.token;
    assert.notEqual(fresh, token);
    assert.equal((await b.c.post("/api/friends/redeem", { token: fresh })).status, 200);

    const again = (await a.c.post("/api/friends/invite-link")).json.token;
    assert.equal((await b.c.post("/api/friends/preview", { token: again })).json.alreadyFriends, true);
  });

  test("a code is not a link and a link is not a code; the code still works", async () => {
    const a = await account("a");
    const b = await account("b");
    const { code } = (await a.c.post("/api/friends/invite-code")).json;
    const { token } = (await a.c.post("/api/friends/invite-link")).json;
    assert.equal((await b.c.post("/api/friends/redeem", { token: code })).status, 400);
    assert.equal((await b.c.post("/api/friends/redeem", { code: token })).status, 400);
    assert.equal((await b.c.post("/api/friends/redeem", { code })).status, 200);
  });

  test("deleting the account removes its friend links; the pageview keeps no friend token", async () => {
    const a = await account("a");
    await a.c.post("/api/friends/invite-link");
    const id = userId(a.addr);
    assert.equal((await a.c.delete("/api/account", { password: "correctpw1" })).status, 200);
    assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM friend_invite_links WHERE user_id = ?").get(id).n, 0);

    const c = makeClient(server.baseUrl);
    assert.equal((await c.post("/api/analytics/pageview", { path: "/join/friend/SecretFriendTokenAbCdEfGh" })).status, 204);
    assert.equal(server.db.prepare("SELECT path FROM page_views").get().path, "/join/friend/:id");
  });
});
