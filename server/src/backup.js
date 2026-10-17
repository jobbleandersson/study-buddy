// A nightly copy of the whole database to a second place (an S3-compatible bucket, normally Fly's Tigris).
//
// Until now the only backup of every account and every student's study data was Fly's volume snapshots
// (kept 5 days, same provider, same volume). This writes a gzipped, consistent copy of the SQLite file once a
// night to a bucket and keeps 30 days of them, so a bug noticed on day 6, a lost volume or a bad deploy is
// recoverable. It is off unless the bucket's settings are present (`fly storage create` sets them all):
//   BUCKET_NAME, AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, (AWS_REGION, default "auto")
// and optionally BACKUP_PREFIX (default "studybuddy-db/").
//
// The copy holds everything the database holds (emails, password hashes, study states): it lives in the same
// kind of private bucket as the data lives on the volume, and the privacy text says so. Restore: see
// HOSTING-FLYIO.md ("Backups").
//
// A compressed copy above MAX_BACKUP_BYTES is not uploaded (it is held in memory for the signed upload, and the
// machine has 512 MB): the owner is told by the usual error mail instead of the backup silently failing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { s3Client } from "./s3.js";
import { reportServerError } from "./alerts.js";

const DAY = 24 * 60 * 60 * 1000;
export const KEEP_DAYS = 30;
export const KEEP_NEWEST = 7;                         // never prune the newest few, whatever their dates say
export const MAX_BACKUP_BYTES = 150 * 1024 * 1024;
const START_HOUR_UTC = 3;                             // from 03:00 UTC, while nobody is studying

/** The bucket settings, or null when backups are not set up. */
export function backupConfig(env = process.env) {
  const { BUCKET_NAME: bucket, AWS_ENDPOINT_URL_S3: endpoint, AWS_ACCESS_KEY_ID: accessKey, AWS_SECRET_ACCESS_KEY: secretKey } = env;
  if (!bucket || !endpoint || !accessKey || !secretKey) return null;
  return { bucket, endpoint, accessKey, secretKey, region: env.AWS_REGION || "auto", prefix: env.BACKUP_PREFIX || "studybuddy-db/" };
}

export const dayOf = (date) => date.toISOString().slice(0, 10);
export const backupKey = (prefix, date) => `${prefix}${dayOf(date)}.sqlite3.gz`;

/** Make one backup now and prune old ones. `database` is a better-sqlite3 connection (default: the app's). */
export async function runBackup({ cfg, client = s3Client(cfg), now = new Date(), database = null, tmpDir = os.tmpdir() } = {}) {
  const db = database || (await import("./db.js")).db;
  const stamp = `${process.pid}-${Date.now()}`;
  const raw = path.join(tmpDir, `studybuddy-backup-${stamp}.sqlite3`);
  const gz = `${raw}.gz`;
  try {
    await db.backup(raw);                                            // SQLite's online backup: a consistent copy while the app runs
    await pipeline(fs.createReadStream(raw), zlib.createGzip({ level: 9 }), fs.createWriteStream(gz));
    await fs.promises.rm(raw, { force: true });                       // the uncompressed copy is as big as the database
    const size = (await fs.promises.stat(gz)).size;
    if (size > MAX_BACKUP_BYTES) throw new Error(`the compressed backup is ${Math.round(size / 1048576)} MB, over the ${MAX_BACKUP_BYTES / 1048576} MB this uploader handles`);
    const key = backupKey(cfg.prefix, now);
    await client.put(key, await fs.promises.readFile(gz));
    const removed = await prune({ cfg, client, now });
    return { key, bytes: size, removed };
  } finally {
    await fs.promises.rm(raw, { force: true }).catch(() => {});
    await fs.promises.rm(gz, { force: true }).catch(() => {});
  }
}

/** Delete backups older than KEEP_DAYS (by the date in their name), always keeping the newest KEEP_NEWEST. */
export async function prune({ cfg, client, now = new Date() }) {
  const objects = (await client.list(cfg.prefix))
    .map((o) => ({ key: o.key, day: o.key.slice(cfg.prefix.length).match(/^(\d{4}-\d{2}-\d{2})\.sqlite3\.gz$/)?.[1] }))
    .filter((o) => o.day)
    .sort((a, b) => (a.day < b.day ? 1 : -1));                        // newest first
  const cutoff = dayOf(new Date(now.getTime() - KEEP_DAYS * DAY));
  let removed = 0;
  for (const o of objects.slice(KEEP_NEWEST)) {
    if (o.day < cutoff) { await client.del(o.key); removed++; }
  }
  return removed;
}

let running = false;
/** One check of the schedule: run today's backup if it is past 03:00 UTC and there is not one yet. */
export async function backupTick({ cfg, client = s3Client(cfg), now = new Date(), run = runBackup } = {}) {
  if (running || now.getUTCHours() < START_HOUR_UTC) return "waiting";
  running = true;
  try {
    const today = backupKey(cfg.prefix, now);
    if ((await client.list(today)).some((o) => o.key === today)) return "have";
    const r = await run({ cfg, client, now });
    console.log(`[backup] ${r.key}: ${Math.round(r.bytes / 1024)} KB uploaded, ${r.removed} old removed`);
    return "done";
  } catch (err) {
    console.error("[backup] failed:", err);
    reportServerError({ where: "nightly backup", err });
    return "failed";
  } finally {
    running = false;
  }
}

export function startBackups() {
  const cfg = backupConfig();
  if (!cfg) { console.log("[backup] off: no bucket settings (see HOSTING-FLYIO.md, \"Backups\")"); return; }
  const tick = () => { backupTick({ cfg }); };
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
  console.log(`[backup] on: nightly from ${START_HOUR_UTC}:00 UTC to ${cfg.bucket}/${cfg.prefix}, ${KEEP_DAYS} days kept`);
}
