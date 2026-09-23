// Spins up the real server (server/src/index.js) as a child process against a
// throwaway SQLite file, so these tests exercise actual HTTP + actual SQL
// rather than mocks. Each test file that calls startServer() gets its own
// process, own temp DB, and own random port, so suites can run concurrently
// without stepping on each other's rate-limit buckets or rows.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, "..", "src", "index.js");

function randomPort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

async function waitForHealth(baseUrl, { timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never became healthy at ${baseUrl}: ${lastErr}`);
}

/**
 * Starts a real server instance.
 * `env` overrides/extends process.env for the child (e.g. RESEND_API_KEY,
 * or tightened *_PER_HOUR_PER_IP limits for the rate-limit suite).
 * Returns { baseUrl, db, dir, stop() }. `db` is a direct better-sqlite3
 * handle onto the same file the server writes to - used to read tokens
 * that are never returned over HTTP (verify/reset links go out by email
 * only).
 */
export async function startServer(env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "sb-server-test-"));
  const dbPath = path.join(dir, "test.sqlite3");
  const port = randomPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: path.join(__dirname, "..", ".."),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      NODE_ENV: "test",
      COOKIE_SECURE: "false",
      // Every attemptLimit is off by default in these tests unless a suite
      // deliberately tightens one - see middleware/authLimits.js's num():
      // an explicit 0 always means "off", regardless of the fallback default.
      SIGNUPS_PER_HOUR_PER_IP: "0",
      SIGNUPS_PER_DAY_PER_IP: "0",
      LOGIN_FAILS_PER_15MIN_PER_ACCOUNT: "0",
      LOGIN_FAILS_PER_15MIN_PER_IP: "0",
      GOOGLE_SIGNIN_FAILS_PER_MIN_PER_IP: "0",
      RESEND_VERIFY_PER_HOUR_PER_USER: "0",
      FORGOT_PW_PER_HOUR_PER_IP: "0",
      VERIFY_EMAIL_PER_HOUR_PER_IP: "0",
      RESET_PW_PER_HOUR_PER_IP: "0",
      WAITLIST_PER_HOUR_PER_IP: "0",
      WAITLIST_PER_DAY_PER_IP: "0",
      PAGEVIEW_PER_HOUR_PER_IP: "0",
      CODE_FAILS_PER_10MIN_PER_USER: "0",
      CODE_FAILS_PER_10MIN_PER_IP: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logLines = [];
  child.stdout.on("data", (d) => logLines.push(d.toString()));
  child.stderr.on("data", (d) => logLines.push(d.toString()));

  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

  try {
    await waitForHealth(baseUrl);
  } catch (e) {
    child.kill();
    throw new Error(`${e.message}\n--- server output ---\n${logLines.join("")}`);
  }

  const db = new Database(dbPath);

  let stopped = false;
  return {
    baseUrl,
    db,
    dir,
    logLines,
    async stop() {
      if (stopped) return;
      stopped = true;
      db.close();
      child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Extracts the session cookie's value from a fetch Response's Set-Cookie headers. */
export function sessionCookieFrom(res, cookieName = "sb_session") {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const [pair] = c.split(";");
    const [name, value] = pair.split("=");
    if (name === cookieName) return `${name}=${value}`;
  }
  return null;
}

/** A tiny fetch wrapper that carries one cookie jar across calls, like a browser tab. */
export function makeClient(baseUrl) {
  let cookie = null;
  async function request(method, urlPath, body) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const newCookie = sessionCookieFrom(res);
    if (newCookie) cookie = newCookie;
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON response, e.g. static/HTML */ }
    return { status: res.status, headers: res.headers, json, res };
  }
  return {
    get: (p) => request("GET", p),
    post: (p, body) => request("POST", p, body),
    delete: (p, body) => request("DELETE", p, body),
    clearCookie: () => { cookie = null; },
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}
