import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { startServer, makeClient, hashToken } from "./harness.mjs";

// Sweep finding S1: session ids and link tokens were stored as they are, so a copy of the database (the
// nightly backup) could be replayed as live sessions and links. They are stored hashed now (src/tokens.js),
// and a database from before is hashed in place once, so the cookies and links people already have still work.

const RAW_SID = crypto.randomUUID();
const RAW_VERIFY = crypto.randomBytes(32).toString("hex");
const RAW_RESET = crypto.randomBytes(32).toString("hex");

/** A database as an older server left it: the base tables, holding raw values. */
function oldDatabase() {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "sb-hash-tokens-")), "old.sqlite3");
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE email_verify_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE password_reset_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL);
  `);
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'old@example.com', 'x', ?)").run(now);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 'u1', ?, ?)").run(RAW_SID, now + 3600_000, now);
  db.prepare("INSERT INTO email_verify_tokens (id, user_id, token, expires_at, created_at) VALUES ('v1', 'u1', ?, ?, ?)").run(RAW_VERIFY, now + 3600_000, now);
  db.prepare("INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES ('r1', 'u1', ?, ?, ?)").run(RAW_RESET, now + 3600_000, now);
  db.close();
  return file;
}

describe("session ids and link tokens are stored hashed (S1)", () => {
  test("an older database is hashed once on start, and the cookie and link people have still work", async () => {
    const file = oldDatabase();
    // The harness's own handle (server.db) is on its default file, so this test reads the one it passed in.
    const read = (sql) => { const db = new Database(file, { readonly: true }); try { return db.prepare(sql).get(); } finally { db.close(); } };
    let server = await startServer({ DB_PATH: file });
    try {
      assert.equal(read("SELECT id FROM sessions").id, hashToken(RAW_SID), "only the hash is stored");
      assert.equal(read("SELECT token FROM email_verify_tokens").token, hashToken(RAW_VERIFY));
      assert.equal(read("SELECT token FROM password_reset_tokens").token, hashToken(RAW_RESET));
      const c = makeClient(server.baseUrl);
      c.cookie = `sb_session=${RAW_SID}`;
      const me = await c.get("/api/auth/me");
      assert.equal(me.json.authed, true, "the cookie from before still signs in");
      assert.equal((await c.post("/api/auth/verify-email", { token: RAW_VERIFY })).status, 200, "a link from before still works");
    } finally { await server.stop(); }

    // A second start must not hash the hashes.
    server = await startServer({ DB_PATH: file });
    try {
      assert.equal(read("SELECT id FROM sessions").id, hashToken(RAW_SID));
      const c = makeClient(server.baseUrl);
      c.cookie = `sb_session=${RAW_SID}`;
      assert.equal((await c.get("/api/auth/me")).json.authed, true);
    } finally { await server.stop(); }
  });

  test("a stored value can't be used as the secret it stands for", async () => {
    const server = await startServer();
    try {
      const c = makeClient(server.baseUrl);
      assert.equal((await c.post("/api/auth/signup", { email: `s1-${Date.now()}@example.com`, password: "longenough1", consent: true })).status, 200);
      const raw = c.cookie.split("=")[1];
      const stored = server.db.prepare("SELECT id FROM sessions").get().id;
      assert.notEqual(stored, raw);
      assert.equal(stored, hashToken(raw));
      const thief = makeClient(server.baseUrl);
      thief.cookie = `sb_session=${stored}`;   // what a leaked copy of the database would hold
      assert.equal((await thief.get("/api/auth/me")).json.authed, false);
    } finally { await server.stop(); }
  });
});
