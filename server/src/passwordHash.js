// Password hashing off the main thread, with a hard cap on how much of it runs at once.
//
// bcrypt is deliberately slow (about 60-100 ms of pure CPU in bcryptjs), and the server is one
// Node process on one shared vCPU. Done on the main thread, a burst of password checks - guesses
// at a login, a signup flood - stalls /api/auth/me and the study sync for everybody else (the
// stall was seconds long under 300 parallel guesses). So the work goes to a small pool of worker
// threads (same bcryptjs, same hashes, no new dependency), and the pool is bounded twice:
//   WORKERS    how many hashes run at the same time (PASSWORD_HASH_WORKERS, default 2)
//   MAX_QUEUE  how many more may wait (PASSWORD_HASH_QUEUE, default 64); past that a request is
//              refused at once with HashBusyError, which the routes turn into 503 "busy" instead
//              of letting the wait grow without limit. 64 waiting at ~25 hashes a second is
//              about two and a half seconds of queue - a class signing up together fits.
// A worker that dies takes only the job it was running with it; the next job starts a new one.

import { Worker } from "node:worker_threads";

const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isInteger(n) && n >= 0 ? n : fallback;
};
const WORKERS = Math.max(1, num("PASSWORD_HASH_WORKERS", 2));
const MAX_QUEUE = num("PASSWORD_HASH_QUEUE", 64);
export const BCRYPT_COST = 10;

export class HashBusyError extends Error {
  constructor() { super("Too many password checks at once."); this.code = "hash_busy"; }
}

const workerUrl = new URL("./passwordHashWorker.js", import.meta.url);
const idle = [];        // workers waiting for a job
const queue = [];       // { job, resolve, reject } waiting for a worker
const running = new Map();   // worker -> { resolve, reject, id }
let started = 0;
let nextId = 1;

function spawn() {
  const w = new Worker(workerUrl);
  w.unref();   // the pool alone never keeps the process alive
  started++;
  w.on("message", ({ id, result, error }) => {
    const job = running.get(w);
    if (!job || job.id !== id) return;
    running.delete(w);
    if (error) job.reject(new Error(error)); else job.resolve(result);
    release(w);
  });
  const die = (err) => {
    started--;
    const idleAt = idle.indexOf(w);
    if (idleAt >= 0) idle.splice(idleAt, 1);
    const job = running.get(w);
    running.delete(w);
    job?.reject(err instanceof Error ? err : new Error("password worker exited"));
    pump();   // a queued job may now need a fresh worker
  };
  w.on("error", die);
  w.on("exit", () => { if (running.has(w) || idle.includes(w)) die(new Error("password worker exited")); });
  return w;
}

function release(w) {
  idle.push(w);
  pump();
}

function pump() {
  while (queue.length) {
    let w = idle.pop();
    if (!w && started < WORKERS) w = spawn();
    if (!w) return;
    const { job, resolve, reject } = queue.shift();
    const id = nextId++;
    running.set(w, { resolve, reject, id });
    w.postMessage({ id, ...job });
  }
}

function run(job) {
  if (queue.length >= MAX_QUEUE && !idle.length && started >= WORKERS) return Promise.reject(new HashBusyError());
  return new Promise((resolve, reject) => { queue.push({ job, resolve, reject }); pump(); });
}

/** bcrypt hash of `password` (cost 10, same as before). Rejects with HashBusyError when the pool is full. */
export const hashPassword = (password) => run({ op: "hash", password: String(password), cost: BCRYPT_COST });

/** Does `password` match `hash`? Rejects with HashBusyError when the pool is full. */
export const comparePassword = (password, hash) => run({ op: "compare", password: String(password), hash: String(hash) });

/** For the routes: a HashBusyError becomes a 503 that says so (and costs the caller nothing in the
 *  failure limiters, since 503 is not one of the statuses they count). Returns true if it answered. */
export function answerIfBusy(err, res) {
  if (!(err instanceof HashBusyError)) return false;
  res.set("Retry-After", "2");
  res.status(503).json({ error: { message: "The server is busy right now. Try again in a moment.", code: "busy" } });
  return true;
}
