import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "../db.js";
import { COOKIE_NAME } from "../constants.js";
import { verifyGoogleIdToken, GoogleTokenError } from "../google.js";

export const auth = Router();

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}

function createSession(res, userId) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, now + SESSION_TTL_MS, now);
  res.cookie(COOKIE_NAME, id, cookieOpts());
}

auth.post("/auth/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !email.includes("@")) return res.status(400).json({ error: { message: "Enter a valid email." } });
  if (password.length < 8) return res.status(400).json({ error: { message: "Password must be at least 8 characters." } });

  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: { message: "An account with that email already exists." } });
  }

  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(id, email, hash, Date.now());

  createSession(res, id);
  res.json({ email });
});

auth.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: { message: "Wrong email or password." } });
  }

  createSession(res, user.id);
  res.json({ email });
});

// Sign in with Google — and, for someone new, how the account gets made. The
// browser sends the ID token Google gave it; we verify it, then one of:
//   • this Google account is already known      → sign in
//   • its (verified) email has a password account → link the two
//   • neither                                     → create an account
// Linking turns the old password OFF and signs out other sessions. Email
// isn't verified at password signup, so without that, whoever registered an
// address first could keep a password to the real owner's data forever.
auth.post("/auth/google", async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(501).json({ error: { message: "Google sign-in isn't set up on this server.", code: "google_not_configured" } });
  }
  try {
    const credential = String(req.body?.credential || "");
    const invalid = () => res.status(401).json({ error: { message: "Couldn't verify your Google sign-in.", code: "google_invalid" } });
    if (!credential || credential.length > 4096) return invalid();

    let profile;
    try {
      profile = await verifyGoogleIdToken(credential, { clientId });
    } catch (e) {
      const code = e instanceof GoogleTokenError ? e.code : "";
      if (code === "email_unverified") {
        return res.status(403).json({ error: { message: "Your Google account's email isn't verified.", code: "google_email_unverified" } });
      }
      if (code === "keys_unavailable") {
        return res.status(503).json({ error: { message: "Google sign-in is unavailable right now. Try again shortly.", code: "google_unavailable" } });
      }
      return invalid();
    }

    const { sub, email } = profile;
    let user = db.prepare("SELECT id, email FROM users WHERE google_sub = ?").get(sub);
    let created = false;
    let linked = false;

    if (!user) {
      const existing = db.prepare("SELECT id, email, google_sub FROM users WHERE email = ?").get(email);
      const taken = () => res.status(409).json({ error: { message: "An account with that email already exists." } });
      if (existing && existing.google_sub) return taken();   // that address belongs to a different Google account

      // A random hash nobody knows: this account signs in with Google only.
      const unusableHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      try {
        if (existing) {
          db.transaction(() => {
            db.prepare("UPDATE users SET google_sub = ?, password_hash = ? WHERE id = ?").run(sub, unusableHash, existing.id);
            db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
          })();
          user = { id: existing.id, email: existing.email };
          linked = true;
        } else {
          const id = crypto.randomUUID();
          db.prepare("INSERT INTO users (id, email, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(id, email, unusableHash, sub, Date.now());
          user = { id, email };
          created = true;
        }
      } catch (e) {
        if (String(e?.code || "").startsWith("SQLITE_CONSTRAINT")) return taken();   // lost a race with a parallel request
        throw e;
      }
    }

    createSession(res, user.id);
    res.json({ email: user.email, created, linked });
  } catch (e) {
    console.error("[study-buddy-server] /auth/google failed:", e);
    if (!res.headersSent) res.status(500).json({ error: { message: "Something went wrong." } });
  }
});

auth.post("/auth/logout", (req, res) => {
  const sid = req.cookies?.[COOKIE_NAME];
  if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

// "Who am I?" is asked on every page load, signed in or not, so a signed-out
// visitor is a normal answer (200 {authed:false}), not an error — a 401 here
// would put a failed request in the browser console on every visit.
auth.get("/auth/me", (req, res) => {
  const sid = req.cookies?.[COOKIE_NAME];
  const row = sid && db.prepare(
    `SELECT users.email AS email
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at > ?`
  ).get(sid, Date.now());
  res.json(row ? { authed: true, email: row.email } : { authed: false });
});
