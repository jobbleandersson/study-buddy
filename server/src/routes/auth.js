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
  twoFaVerifyLimits, twoFaPasswordLimit,
} from "../middleware/authLimits.js";
import { isUniqueViolation } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { emailEnabled, sendVerifyEmail, sendResetEmail, sendTwoFaEnabledEmail, sendTwoFaDisabledEmail } from "../email.js";
import { generateSecret, verifyTotp, otpauthUri, generateBackupCodes } from "../totp.js";

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

// A password (or reset token) just checked out on a 2FA-enabled account: hold off on the real
// session until the second factor clears. Five minutes is long enough to type a code, short
// enough that an abandoned challenge doesn't sit around.
const TWOFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
function issueTwoFaChallenge(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO twofa_challenges (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, now + TWOFA_CHALLENGE_TTL_MS, now);
  return id;
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

// Used up every reset link still floating around for an account, so a second, older email can't be
// redeemed after the first one (or after the account was linked to Google, which has no password).
const retireResetTokens = (userId, now) =>
  db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(now, userId);

// An account whose address nobody has proven may have been registered by someone who doesn't own
// that address - they can sign up as anyone@example.com and wire the account to their own other
// accounts (a parent link via an invite code, a friendship, a class) before the real owner turns up.
// Password reset and Google linking both hand that account to its rightful owner, and both already
// cut off the old password and sessions; this cuts what the earlier holder attached to it as well,
// or their second account would keep reading the new owner's progress. The study data itself is
// kept - the owner may well have started using the account too.
//
// "Unverified" only counts as a warning sign when verification was possible at signup
// (users.email_verify_required, set while email is on). Every account made before email existed has
// email_verified_at NULL too, and those are the real, pre-existing users - treating them as suspects
// would wipe a legitimate person's parent, friend and class links the first time they reset a password.
// The price is that an address someone pre-registered before email was switched on is not caught.
const looksPreRegistered = (u) => !u.emailVerifiedAt && !!u.verifyRequired;
function revokeTies(userId) {
  db.prepare("DELETE FROM links WHERE parent_user_id = ? OR student_user_id = ?").run(userId, userId);
  db.prepare("DELETE FROM invite_codes WHERE student_user_id = ?").run(userId);
  db.prepare("DELETE FROM friend_links WHERE user_a_id = ? OR user_b_id = ?").run(userId, userId);
  db.prepare("DELETE FROM friend_codes WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM class_daily_answers WHERE student_user_id = ?").run(userId);
  db.prepare("DELETE FROM class_members WHERE student_user_id = ?").run(userId);
  db.prepare("DELETE FROM assigned_sets WHERE student_user_id = ? OR assigned_by_user_id = ?").run(userId, userId);
}

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
    db.prepare("INSERT INTO users (id, email, password_hash, created_at, consent_at, terms_version, email_verify_required) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, email, hash, now, now, TERMS_VERSION, emailEnabled() ? 1 : null);
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

  const user = db.prepare(
    "SELECT id, password_hash, email_verified_at AS emailVerifiedAt, totp_enabled_at AS totpEnabledAt FROM users WHERE email = ?"
  ).get(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: { message: "Wrong email or password." } });
  }

  // The password is right, but that's only the first factor on this account — hold off on a real
  // session until /auth/2fa/verify clears the second one.
  if (user.totpEnabledAt) {
    return res.json({ twoFactorRequired: true, challenge: issueTwoFaChallenge(user.id) });
  }

  createSession(res, user.id);
  res.json({ email, emailVerified: !emailEnabled() || !!user.emailVerifiedAt });
}));

// The code (from an authenticator app) or backup code that follows a password/reset-token check on
// a 2FA-enabled account. Shared by /auth/login and /auth/reset-password, which is why it isn't
// nested under either — a wrong code never consumes the challenge (so a mistyped digit can be
// retried), but a right one always does, in the same statement that checks it was still unused, so
// two parallel submits of the same challenge+code can't both create a session.
auth.post("/auth/2fa/verify", ...twoFaVerifyLimits, asyncHandler(async (req, res) => {
  const challengeId = String(req.body?.challenge || "");
  const code = String(req.body?.code || "").trim();
  const invalid = () => res.status(401).json({ error: { message: "That code is invalid or has expired." } });
  if (!challengeId || !code) return invalid();

  const challenge = db.prepare("SELECT id, user_id AS userId FROM twofa_challenges WHERE id = ? AND used_at IS NULL AND expires_at > ?")
    .get(challengeId, Date.now());
  if (!challenge) return invalid();

  const user = db.prepare("SELECT id, email, email_verified_at AS emailVerifiedAt, totp_secret AS totpSecret, totp_last_counter AS totpLastCounter FROM users WHERE id = ?")
    .get(challenge.userId);
  if (!user || !user.totpSecret) return invalid();   // 2FA was disabled after the challenge was minted

  const totp = verifyTotp(user.totpSecret, code, { afterCounter: user.totpLastCounter || 0 });
  let backupRow = null;
  if (!totp.ok) {
    for (const row of db.prepare("SELECT id, code_hash FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL").all(user.id)) {
      if (await bcrypt.compare(code, row.code_hash)) { backupRow = row; break; }
    }
  }
  if (!totp.ok && !backupRow) return invalid();

  const now = Date.now();
  const claimed = db.transaction(() => {
    // Claim the challenge first: whichever of two parallel correct submits gets here first wins,
    // the other's claim reports 0 rows changed and falls through to the failure response below.
    if (db.prepare("UPDATE twofa_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, challenge.id).changes === 0) return false;
    if (totp.ok) db.prepare("UPDATE users SET totp_last_counter = ? WHERE id = ?").run(totp.counter, user.id);
    else db.prepare("UPDATE totp_backup_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, backupRow.id);
    return true;
  })();
  if (!claimed) return invalid();

  createSession(res, user.id);
  res.json({ email: user.email, emailVerified: !emailEnabled() || !!user.emailVerifiedAt });
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
      const existing = db.prepare("SELECT id, email, google_sub, email_verified_at AS emailVerifiedAt, email_verify_required AS verifyRequired FROM users WHERE email = ?").get(email);
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
            retireResetTokens(existing.id, now);
            if (looksPreRegistered(existing)) revokeTies(existing.id);
            // This account becomes passwordless (signs in with Google only), so there's no local
            // password step left to gate with a second factor — clear it rather than leave it
            // orphaned and unreachable (Settings hides 2FA management once passwordless).
            db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = ?").run(existing.id);
            db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(existing.id);
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
    `SELECT users.email AS email, users.google_sub AS googleSub, users.email_verified_at AS emailVerifiedAt, users.totp_enabled_at AS totpEnabledAt
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at > ?`
  ).get(sid, Date.now());
  // passwordless: a Google-linked account has no usable password, so account deletion asks for its email instead.
  res.json(row
    ? { authed: true, email: row.email, passwordless: !!row.googleSub, emailVerified: !emailEnabled() || !!row.emailVerifiedAt, totpEnabled: !!row.totpEnabledAt }
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
  // sendEmail never throws, it answers false - and "sent" is exactly what this button promises,
  // so a provider that refused the message has to show up as an error, not a quiet ok.
  const sent = await sendVerifyEmail(user.email, issueVerifyToken(req.user.userId));
  if (!sent) return res.status(502).json({ error: { message: "Couldn't send the email. Try again shortly.", code: "email_send_failed" } });
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
  // Claim the token in the same statement that checks it is unused: two requests carrying the same
  // link (a double-tap, a mail scanner that opened it first) both pass the SELECT above, and only
  // one may win - the other reads as an already-used link.
  const now = Date.now();
  const email = db.transaction(() => {
    const claimed = db.prepare("UPDATE email_verify_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, row.id);
    if (claimed.changes === 0) return null;
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(now, row.userId);
    return db.prepare("SELECT email FROM users WHERE id = ?").get(row.userId)?.email ?? null;
  })();
  if (!email) return badToken(res);
  // The address goes back so a signed-in browser can tell whether this link was for ITS account.
  res.json({ ok: true, email });
}));

// Always the same reply, whether or not that address has an account — otherwise this endpoint
// would let anyone check which emails are registered. A Google-linked account has no password to
// reset (it signs in with Google only), so it's silently skipped too; the reply doesn't say which
// case applied. Two things follow from that:
//   • the email is sent in the background - waiting for the provider only when the account exists
//     would make "has an account" measurably slower than "doesn't";
//   • throttling can't be keyed on the address (a per-email counter that answers 429 tells anyone
//     which addresses are registered, and lets a stranger lock the owner out of resetting). Instead
//     an account that was mailed a link a moment ago is simply not mailed another, and the reply
//     is the same either way. The per-IP limit still caps how fast one machine can ask.
const RESET_COOLDOWN_MS = 2 * 60 * 1000;
auth.post("/auth/forgot-password", ...forgotPasswordLimits, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (email && emailEnabled()) {
    const user = db.prepare("SELECT id, google_sub AS googleSub FROM users WHERE email = ?").get(email);
    if (user && !user.googleSub) {
      const recent = db.prepare("SELECT 1 AS x FROM password_reset_tokens WHERE user_id = ? AND created_at > ?")
        .get(user.id, Date.now() - RESET_COOLDOWN_MS);
      if (!recent) sendResetEmail(email, issueResetToken(user.id)).catch(() => {});
    }
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
    // Claim the link before anything else: the SELECT above and this write are separated by a bcrypt
    // await, so two requests with the same link can both get here - only one may change the password.
    const claimed = db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, row.id);
    if (claimed.changes === 0) return null;
    retireResetTokens(row.userId, now);   // any other link mailed for this account dies with this one
    const before = db.prepare("SELECT email, email_verified_at AS emailVerifiedAt, email_verify_required AS verifyRequired, totp_enabled_at AS totpEnabledAt FROM users WHERE id = ?").get(row.userId);
    if (looksPreRegistered(before)) revokeTies(row.userId);   // see revokeTies: this hands the account to whoever owns the inbox
    // Clicking a link mailed to this address proves the address as surely as the verify-email flow
    // does, so an unverified account is now verified too — COALESCE leaves an already-set date alone.
    db.prepare("UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?")
      .run(hash, now, row.userId);
    // A reset that wasn't the account owner's idea is exactly the case where every other signed-in
    // device should be signed out — same move as linking a Google account (see /auth/google above).
    // This runs unconditionally, even when a 2FA step still follows below: proving control of the
    // inbox is reason enough to kill every other session regardless of what happens next.
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.userId);
    return { email: before.email, totpEnabledAt: before.totpEnabledAt };
  })();
  if (!user) return badToken(res);

  // A compromised inbox shouldn't bypass 2FA any more than a compromised password should — the
  // new password is already live and every other session already dead either way; only the final
  // sign-in step waits on the second factor.
  if (user.totpEnabledAt) {
    return res.json({ twoFactorRequired: true, challenge: issueTwoFaChallenge(row.userId) });
  }

  createSession(res, row.userId);
  res.json({ email: user.email, emailVerified: true });   // they just proved they control the inbox
}));

// ---------------- two-factor authentication ----------------

// Generates a fresh secret and returns it unpersisted — nothing is written until /auth/2fa/confirm
// proves the person actually set it up (scanned/typed it into an authenticator app correctly).
// That statelessness means an abandoned setup needs no cleanup job.
auth.post("/auth/2fa/setup", requireAuth, (req, res) => {
  const secret = generateSecret();
  res.json({ secret, otpauthUri: otpauthUri(secret, { email: req.user.email }) });
});

// Requires the current password, not just a session: without this, a stolen session cookie alone
// would let an attacker enroll their own authenticator on the victim's account and lock them out on
// their next real login.
auth.post("/auth/2fa/confirm", requireAuth, twoFaPasswordLimit, asyncHandler(async (req, res) => {
  const password = String(req.body?.password || "").slice(0, 200);
  const secret = String(req.body?.secret || "");
  const code = String(req.body?.code || "").trim();
  const wrongPassword = () => res.status(403).json({ error: { message: "That password is wrong.", code: "confirm_mismatch" } });
  const badCode = () => res.status(400).json({ error: { message: "That code is invalid or has expired." } });
  if (!secret || !code) return badCode();

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.userId);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return wrongPassword();

  const totp = verifyTotp(secret, code, { afterCounter: 0 });
  if (!totp.ok) return badCode();

  const backupCodes = generateBackupCodes();
  const now = Date.now();
  db.transaction(() => {
    db.prepare("UPDATE users SET totp_secret = ?, totp_enabled_at = ?, totp_last_counter = ? WHERE id = ?")
      .run(secret, now, totp.counter, req.user.userId);
    db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(req.user.userId);   // re-enrolling replaces any stale set
    const insert = db.prepare("INSERT INTO totp_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)");
    for (const plain of backupCodes) insert.run(crypto.randomUUID(), req.user.userId, bcrypt.hashSync(plain, 10), now);
  })();
  sendTwoFaEnabledEmail(req.user.email).catch(() => {});
  res.json({ ok: true, backupCodes });
}));

auth.post("/auth/2fa/disable", requireAuth, twoFaPasswordLimit, asyncHandler(async (req, res) => {
  const password = String(req.body?.password || "").slice(0, 200);
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.userId);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(403).json({ error: { message: "That password is wrong.", code: "confirm_mismatch" } });
  }
  const sid = req.cookies?.[COOKIE_NAME];
  db.transaction(() => {
    db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = ?").run(req.user.userId);
    db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(req.user.userId);
    // Kill every *other* session — the one making this request already just re-proved the
    // password, so leaving it alive isn't a risk, and killing it too would just be confusing.
    // Revoking the rest still matters: it makes any other signed-in device notice something changed.
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(req.user.userId, sid || "");
  })();
  sendTwoFaDisabledEmail(req.user.email).catch(() => {});
  res.json({ ok: true });
}));

auth.post("/auth/2fa/backup-codes/regenerate", requireAuth, twoFaPasswordLimit, asyncHandler(async (req, res) => {
  const password = String(req.body?.password || "").slice(0, 200);
  const user = db.prepare("SELECT password_hash, totp_enabled_at AS totpEnabledAt FROM users WHERE id = ?").get(req.user.userId);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(403).json({ error: { message: "That password is wrong.", code: "confirm_mismatch" } });
  }
  if (!user.totpEnabledAt) return res.status(400).json({ error: { message: "Two-factor authentication isn't on for this account.", code: "twofa_off" } });

  const backupCodes = generateBackupCodes();
  const now = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(req.user.userId);
    const insert = db.prepare("INSERT INTO totp_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)");
    for (const plain of backupCodes) insert.run(crypto.randomUUID(), req.user.userId, bcrypt.hashSync(plain, 10), now);
  })();
  res.json({ ok: true, backupCodes });
}));
