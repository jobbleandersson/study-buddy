import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { signRequest, s3Client } from "../src/s3.js";
import { backupConfig, backupKey, runBackup, prune, backupTick } from "../src/backup.js";

// The nightly off-site backup: a signed S3 upload of a gzipped copy of the database, 30 days kept.

describe("SigV4 signing", () => {
  test("reproduces the signature in AWS's published example", () => {
    const h = signRequest({
      method: "GET", url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", region: "us-east-1", service: "iam",
      accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" }, now: new Date("2015-08-30T12:36:00Z"), s3: false,
    });
    assert.ok(h.authorization.endsWith("Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"));
    assert.match(h.authorization, /SignedHeaders=content-type;host;x-amz-date,/);
  });
});

describe("backupConfig", () => {
  const full = { BUCKET_NAME: "b", AWS_ENDPOINT_URL_S3: "https://s3.example", AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s" };
  test("is null unless every setting is there, and has defaults", () => {
    assert.equal(backupConfig({}), null);
    for (const k of Object.keys(full)) assert.equal(backupConfig({ ...full, [k]: "" }), null, k);
    const c = backupConfig(full);
    assert.equal(c.region, "auto");
    assert.equal(c.prefix, "studybuddy-db/");
    assert.equal(backupConfig({ ...full, BACKUP_PREFIX: "x/" }).prefix, "x/");
  });
});

describe("backups against a fake S3", () => {
  let srv, cfg, objects, requests, tmp;
  before(async () => {
    objects = new Map();
    requests = [];
    srv = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => {
        const u = new URL(req.url, "http://x");
        requests.push({ method: req.method, path: u.pathname, auth: req.headers.authorization, sha: req.headers["x-amz-content-sha256"] });
        const key = decodeURIComponent(u.pathname.replace(/^\/bkt\//, ""));
        if (req.method === "PUT") { objects.set(key, { body: Buffer.concat(chunks), at: new Date() }); res.end(); }
        else if (req.method === "DELETE") { objects.delete(key); res.statusCode = 204; res.end(); }
        else if (req.method === "GET" && u.searchParams.get("list-type") === "2") {
          const prefix = u.searchParams.get("prefix") || "";
          const items = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
          res.setHeader("content-type", "application/xml");
          res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${items.map((k) => `<Contents><Key>${k}</Key><LastModified>${objects.get(k).at.toISOString()}</LastModified></Contents>`).join("")}</ListBucketResult>`);
        } else { res.statusCode = 400; res.end(); }
      });
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    cfg = { bucket: "bkt", endpoint: `http://127.0.0.1:${srv.address().port}`, accessKey: "AK", secretKey: "SK", region: "auto", prefix: "studybuddy-db/" };
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bk-test-"));
  });
  after(async () => { await new Promise((r) => srv.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); });

  const seed = (n) => {
    const file = path.join(tmp, `src-${n}.sqlite3`);
    const d = new Database(file);
    d.exec("CREATE TABLE users (id TEXT, email TEXT); INSERT INTO users VALUES ('1', 'anna@example.com')");
    return d;
  };

  test("uploads a signed, gzipped, restorable copy of the database", async () => {
    const database = seed(1);
    const now = new Date("2026-10-18T03:30:00Z");
    const r = await runBackup({ cfg, now, database, tmpDir: tmp });
    assert.equal(r.key, "studybuddy-db/2026-10-18.sqlite3.gz");
    const put = requests.find((q) => q.method === "PUT");
    assert.match(put.auth, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    const raw = zlib.gunzipSync(objects.get(r.key).body);
    assert.equal(raw.subarray(0, 15).toString(), "SQLite format 3");
    const restored = path.join(tmp, "restored.sqlite3");
    fs.writeFileSync(restored, raw);
    assert.equal(new Database(restored).prepare("SELECT email FROM users").get().email, "anna@example.com");
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith("studybuddy-backup-")), [], "no temporary file is left behind");
  });

  test("keeps 30 days and the newest 7, whatever else is there", async () => {
    objects.clear();
    const client = s3Client(cfg);
    const now = new Date("2026-10-18T04:00:00Z");
    const days = [];
    for (let i = 0; i < 45; i++) days.push(new Date(now.getTime() - i * 86_400_000));
    for (const d of days) objects.set(backupKey(cfg.prefix, d), { body: Buffer.from("x"), at: d });
    objects.set("studybuddy-db/notes.txt", { body: Buffer.from("x"), at: now });
    const removed = await prune({ cfg, client, now });
    assert.equal(removed, 14, "the 14 copies older than 30 days");
    assert.equal([...objects.keys()].filter((k) => k.endsWith(".sqlite3.gz")).length, 31);
    assert.ok(objects.has("studybuddy-db/notes.txt"), "files that are not backups are left alone");

    // a long gap: only old copies exist, the newest 7 stay even though they are old
    objects.clear();
    for (let i = 60; i < 75; i++) objects.set(backupKey(cfg.prefix, new Date(now.getTime() - i * 86_400_000)), { body: Buffer.from("x"), at: now });
    await prune({ cfg, client, now });
    assert.equal(objects.size, 7);
  });

  test("the schedule waits before 03:00 UTC, skips a day that has a backup, and otherwise backs up", async () => {
    objects.clear();
    const client = s3Client(cfg);
    const runs = [];
    const run = async (a) => { runs.push(a.now); return { key: "k", bytes: 1, removed: 0 }; };
    assert.equal(await backupTick({ cfg, client, now: new Date("2026-10-18T02:59:00Z"), run }), "waiting");
    assert.equal(await backupTick({ cfg, client, now: new Date("2026-10-18T03:10:00Z"), run }), "done");
    objects.set(backupKey(cfg.prefix, new Date("2026-10-18T00:00:00Z")), { body: Buffer.from("x"), at: new Date() });
    assert.equal(await backupTick({ cfg, client, now: new Date("2026-10-18T09:00:00Z"), run }), "have");
    assert.equal(runs.length, 1);
  });

  test("a failing store does not throw out of the schedule", async () => {
    const bad = { ...cfg, endpoint: "http://127.0.0.1:1" };
    assert.equal(await backupTick({ cfg: bad, client: s3Client(bad), now: new Date("2026-10-18T05:00:00Z") }), "failed");
  });
});
