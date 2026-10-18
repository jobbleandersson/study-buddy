import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// Four servers starting at the same moment on a database that lacks some columns the migrations add (an older
// database, during a deploy that overlaps the old machine) must all start: the migrations add a column only when it is
// missing, and two processes can both see it missing. This made practice-pages.test.mjs fail now and then in CI.

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const start = (file) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--input-type=module", "-e", 'await import("./src/db.js")'], {
    cwd: SERVER_DIR, env: { ...process.env, DB_PATH: file }, stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  p.stderr.on("data", (d) => { err += d; });
  p.on("exit", (code) => resolve({ code, err }));
});

describe("database startup", () => {
  test("simultaneous starts on an older database all succeed", async () => {
    const failures = [];
    for (let round = 0; round < 10; round++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-race-"));
      const file = path.join(dir, "db.sqlite3");
      assert.equal((await start(file)).code, 0, "the first start builds the schema");
      // make it an older database again: take away columns the migrations add
      const old = new Database(file);
      for (const [table, col] of [["users", "twofa_method"], ["users", "email_verify_required"], ["users", "password_set_at"], ["subscriptions", "last_event_at"], ["state_blobs", "digest"]]) {
        old.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
      }
      old.close();
      for (const r of await Promise.all([start(file), start(file), start(file), start(file)])) {
        if (r.code !== 0) failures.push(r.err.split("\n").find((l) => /Error/.test(l)) || `exit ${r.code}`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.deepEqual(failures, []);
  });
});
