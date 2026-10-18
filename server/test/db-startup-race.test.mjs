import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Four servers starting on one new database file at the same moment must all start: the migrations add columns only when
// they are missing, and two processes can both see one missing (this made practice-pages.test.mjs fail now and then in CI).

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("database startup", () => {
  test("simultaneous starts on one new database all succeed", async () => {
    const failures = [];
    for (let round = 0; round < 12; round++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-race-"));
      const run = () => new Promise((resolve) => {
        const p = spawn(process.execPath, ["--input-type=module", "-e", 'await import("./src/db.js")'], {
          cwd: SERVER_DIR, env: { ...process.env, DB_PATH: path.join(dir, "db.sqlite3") }, stdio: ["ignore", "ignore", "pipe"],
        });
        let err = "";
        p.stderr.on("data", (d) => { err += d; });
        p.on("exit", (code) => resolve({ code, err }));
      });
      for (const r of await Promise.all([run(), run(), run(), run()])) {
        if (r.code !== 0) failures.push(r.err.split("\n").find((l) => /Error/.test(l)) || `exit ${r.code}`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.deepEqual(failures, []);
  });
});
