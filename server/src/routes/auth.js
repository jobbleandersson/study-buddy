import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "../db.js";
import { COOKIE_NAME } from "../constants.js";
import { verifyGoogleIdToken, GoogleTokenError } from "../google.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  signupHourly, signupDaily, loginFailures, googleSignInLimit,
  resendVerificationLimit, forgotPasswordLimits, verifyEmailIpLimit, resetPasswordIpLimit,
} from "../middleware/authLimits.js";
import { isUniqueViolation } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { emailEnabled, sendVerifyEmail, sendResetEmail } from "../email.js";

export const auth = Router();

// Compared against when the email is unknown, so "no such account" costs the same bcrypt time as
// "wrong password" - otherwise response time reveals which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync("studify-no-such-account", 10);

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

const emailTaken = (res) =>
  res.status(409).json({ error: { message: "An account with that email already exists." } });

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function issueVerifyToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO email_verify_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), userId, token, now + VERIFY_TTL_MS, now);
  return token;
}
function issueResetToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), userId, token, now + RESET_TTL_MS, now);
  return token;
}
const badToken = (res) => res.status(400).json({ error: { message: "That link is invalid or has expired.", code: "bad_token" } });

// Creating an account needs a yes to the Terms and Privacy Policy and to the age statement next to
// it. The date is stored with the account as evidence; bump it when either text changes materially.
const TERMS_VERSION = "2026-09-21";
const consentRequired = (res) =>
  res.status(400).json({ error: { message: "Accept the Terms and Privacy Policy to create an account.", code: "consent_required" } });

auth.post("/auth/signup", signupHourly, signupDaily, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !email.includes("@")) return res.status(400).json({ error: { message: "Enter a valid email." } });
  if (password.length < 8) return res.status(400).json({ error: { message: "Password must be at least 8 characters." } });
  if (password.length > 200) return res.status(400).json({ error: { message: "Password is too long." } });   // bcrypt only reads 72 bytes; don't hash megabytes
  if (req.body?.consent !== true) return consentRequired(res);

  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return emailTaken(res);

  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(password, 10);
  try {
    const now = Date.now();
    db.prepare("INSERT INTO users (id, email, password_hash, created_at, consent_at, terms_version) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, email, hash, now, now, TERMS_VERSION);
  } catch (e) {
    // The check above ran before the bcrypt await, so two signups for the same
    // new address can both get past it — the UNIQUE index turns the loser away.
    if (isUniqueViolation(e)) return emailTaken(res);
    throw e;
  }

  createSession(res, id);
  let emailVerified = false;
  if (emailEnabled()) sendVerifyEmail(email, issueVerifyToken(id));   // best-effort — see email.js
  else emailVerified = true;   // nothing to verify against when the feature is off; see routes/health.js
  res.json({ email, emailVerified });
}));

auth.post("/auth/login", ...loginFailures, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").slice(0, 200);

  const user = db.prepare("SELECT id, password_hash, email_verified_at AS emailVerifiedAt FROM users WHERE email = ?").get(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: { message: "Wrong email or password." } });
  }

  createSession(res, user.id);
  res.json({ email, emailVerified: !emailEnabled() || !!user.emailVerifiedAt });
}));

// Sign in with Google — and, for someone new, how the account gets made. The
// browser sends the ID token Google gave it; we verify it, then one of:
//   • this Google account is already known      → sign in
//   • its (verified) email has a password account → link the two
//   • neither                                     → create an account
// Linking turns the old password OFF and signs out other sessions. Email
// isn't verified at password signup, so without that, whoever registered an
// address first could keep a password to the real owner's data forever.
auth.post("/auth/google", googleSignInLimit, asyncHandler(async (req, res) => {
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
      if (existing && existing.google_sub) return emailTaken(res);   // that address belongs to a different Google account
      // Linking to an account that already agreed at signup needs no new yes; making a new one does.
      if (!existing && req.body?.consent !== true) return consentRequired(res);

      // A random hash nobody knows: this account signs in with Google only.
      const unusableHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      try {
        // Either way the email is Google-verified right now — there's nothing for our own
        // verify-email flow to add, so it's marked confirmed immediately.
        const now = Date.now();
        if (existing) {
          db.transaction(() => {
            db.prepare("UPDATE users SET google_sub = ?, password_hash = ?, email_verified_at = ? WHERE id = ?")
              .run(sub, unusableHash, now, existing.id);
            db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
          })();
          user = { id: existing.id, email: existing.email };
          linked = true;
        } else {
          const id = crypto.randomUUID();
          db.prepare("INSERT INTO users (id, email, password_hash, google_sub, created_at, consent_at, terms_version, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(id, email, unusableHash, sub, now, now, TERMS_VERSION, now);
          user = { id, email };
          created = true;
        }
      } catch (e) {
        if (isUniqueViolation(e)) return emailTaken(res);   // lost a race with a parallel request
        throw e;
      }
    }

    createSession(res, user.id);
    res.json({ email: user.email, created, linked, emailVerified: true });
  } catch (e) {
    console.error("[study-buddy-server] /auth/google failed:", e);
    if (!res.headersSent) res.status(500).json({ error: { message: "Something went wrong." } });
  }
}));

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
    `SELECT users.email AS email, users.google_sub AS googleSub, users.email_verified_at AS emailVerifiedAt
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at > ?`
  ).get(sid, Date.now());
  // passwordless: a Google-linked account has no usable password, so account deletion asks for its email instead.
  res.json(row
    ? { authed: true, email: row.email, passwordless: !!row.googleSub, emailVerified: !emailEnabled() || !!row.emailVerifiedAt }
    : { authed: false });
});

// Ask for a fresh verification link — the signup one may have expired, landed in spam, or gone to
// an inbox they can't check right now. Rate-limited per account, not per IP: this needs a session,
// so the account itself is already the scarce resource an attacker would need many of.
auth.post("/auth/verify-email/resend", requireAuth, resendVerificationLimit, asyncHandler(async (req, res) => {
  if (!emailEnabled()) return res.status(501).json({ error: { message: "Email isn't set up on this server.", code: "email_not_configured" } });
  const user = db.prepare("SELECT email, email_verified_at AS emailVerifiedAt FROM users WHERE id = ?").get(req.user.userId);
  if (!user) return res.status(404).json({ error: { message: "Not found." } });
  if (user.emailVerifiedAt) return res.status(400).json({ error: { message: "That email is already verified.", code: "already_verified" } });
  await sendVerifyEmail(user.email, issueVerifyToken(req.user.userId));
  res.json({ ok: true });
}));

// The link in the email — a token is the whole credential here, so no session is required (the
// person may well be verifying from a different device than the one they signed up on).
auth.post("/auth/verify-email", verifyEmailIpLimit, asyncHandler(async (req, res) => {
  const token = String(req.body?.token || "");
  if (!token) return badToken(res);
  const row = db.prepare("SELECT id, user_id AS userId FROM email_verify_tokens WHERE token = ? AND used_at IS NULL AND expires_at > ?")
    .get(token, Date.now());
  if (!row) return badToken(res);
  db.transaction(() => {
    db.prepare("UPDATE email_verify_tokens SET used_at = ? WHERE id = ?").run(Date.now(), row.id);
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(Date.now(), row.userId);
  })();
  res.json({ ok: true });
}));

// Always the same reply, whether or not that address has an account — otherwise this endpoint
// would let anyone check which emails are registered. A Google-linked account has no password to
// reset (it signs in with Google only), so it's silently skipped too; the reply doesn't say which
// case applied.
auth.post("/auth/forgot-password", ...forgotPasswordLimits, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (email && emailEnabled()) {
    const user = db.prepare("SELECT id, google_sub AS googleSub FROM users WHERE email = ?").get(email);
    if (user && !user.googleSub) await sendResetEmail(email, issueResetToken(user.id));
  }
  res.json({ ok: true });
}));

auth.post("/auth/reset-password", resetPasswordIpLimit, asyncHandler(async (req, res) => {
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (!token) return badToken(res);
  if (password.length < 8) return res.status(400).json({ error: { message: "Password must be at least 8 characters." } });
  if (password.length > 200) return res.status(400).json({ error: { message: "Password is too long." } });

  const row = db.prepare("SELECT id, user_id AS userId FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > ?")
    .get(token, Date.now());
  if (!row) return badToken(res);

  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const user = db.transaction(() => {
    db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").run(now, row.id);
    // Clicking a link mailed to this address proves the address as surely as the verify-email flow
    // does, so an unverified account is now verified too — COALESCE leaves an already-set date alone.
    db.prepare("UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?")
      .run(hash, now, row.userId);
    // A reset that wasn't the account owner's idea is exactly the case where every other signed-in
    // device should be signed out — same move as linking a Google account (see /auth/google above).
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.userId);
    return db.prepare("SELECT email FROM users WHERE id = ?").get(row.userId);
  })();

  createSession(res, row.userId);
  res.json({ email: user.email, emailVerified: true });   // they just proved they control the inbox
}));
