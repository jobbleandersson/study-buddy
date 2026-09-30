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
  twoFaVerifyLimits, twoFaPasswordLimit, setPasswordLimit, twoFaEmail, twoFaResendIpLimit, DAY_MS,
} from "../middleware/authLimits.js";
import { consume } from "../middleware/attemptLimit.js";
import { isUniqueViolation } from "../errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { emailEnabled, sendVerifyEmail, sendResetEmail, sendTwoFaEnabledEmail, sendTwoFaDisabledEmail, sendPasswordAddedEmail, sendTwoFaCodeEmail } from "../email.js";
import { generateSecret, verifyTotp, otpauthUri } from "../totp.js";

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

// users.totp_enabled_at means "2FA is on, any method" (see db.js); this says which. A row that
// predates users.twofa_method is TOTP.
const twoFaMethod = (row) => (row?.totpEnabledAt ? row.twofaMethod || "totp" : null);

// The one place 2FA is switched off (disable, linking to Google): method, secret, counter and any
// pending challenge — a sign-in challenge minted earlier must not outlive this. The backup-code
// table is gone from the product but still exists; rows from before its removal are cleared here.
function clearTwoFa(userId) {
  db.prepare("UPDATE users SET twofa_method = NULL, totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = ?").run(userId);
  db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM twofa_challenges WHERE user_id = ?").run(userId);
}

// Emailed codes: six digits, stored only as an HMAC keyed by the challenge id (a fast or slow hash of
// a 6-digit code is brute-forceable offline either way; the real defences are the attempt cap and the
// per-account daily cap on codes generated, see authLimits.js).
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const hashCode = (challengeId, code) => crypto.createHmac("sha256", challengeId).update(code).digest("hex");
function codeMatches(challengeId, code, hash) {
  if (!hash) return false;
  const a = Buffer.from(hashCode(challengeId, code), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const tooManyCodes = (res, extra = {}) =>
  res.status(429).json({ error: { message: "Too many attempts. Try again in a few minutes.", code: "twofa_cooldown", ...extra } });

// A sign-in (or enrolment) challenge whose code goes out by email. Never hard-fails on a send
// problem: the challenge is returned either way with `emailSent`, so a provider outage or a spent
// quota degrades to "try again shortly", not a hard failure. Within the cooldown a second
// sign-in reuses the live challenge rather than mailing a code that would not match it.
async function issueEmailChallenge(user, purpose = "login") {
  const now = Date.now();
  const cooldownMs = twoFaEmail.cooldownSec * 1000;
  if (purpose === "login" && cooldownMs > 0) {
    const live = db.prepare(
      `SELECT id, last_sent_at AS lastSentAt FROM twofa_challenges
       WHERE user_id = ? AND purpose = 'login' AND used_at IS NULL AND expires_at > ? AND code_hash IS NOT NULL
         AND attempts < ? AND last_sent_at > ? ORDER BY last_sent_at DESC LIMIT 1`
    ).get(user.id, now, twoFaEmail.attempts, now - cooldownMs);
    if (live) return { challenge: live.id, emailSent: true, cooldownSec: Math.max(1, Math.ceil((live.lastSentAt + cooldownMs - now) / 1000)) };
  }
  const id = crypto.randomBytes(32).toString("hex");
  const allowed = consume({ name: "twofa-email-day", key: user.id, max: twoFaEmail.sendsPerDay, windowMs: DAY_MS });
  const code = allowed ? newCode() : null;
  db.prepare("INSERT INTO twofa_challenges (id, user_id, expires_at, created_at, code_hash, purpose, last_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, user.id, now + twoFaEmail.ttlMs, now, code ? hashCode(id, code) : null, purpose, code ? now : null);
  let emailSent = false;
  if (code) {
    emailSent = await sendTwoFaCodeEmail(user.email, code, purpose);
    if (!emailSent) db.prepare("UPDATE twofa_challenges SET last_sent_at = NULL WHERE id = ?").run(id);   // a failed send costs no cooldown
  }
  return { challenge: id, emailSent, cooldownSec: emailSent ? twoFaEmail.cooldownSec : 0 };
}

const emailTaken = (res) =>
  res.status(409).json({ error: { message: "An account with that email already exists." } });

// The check /auth/set-password's whole security rests on: a fresh Google credential proves someone
// currently controls *some* Google account, not that it's the one already linked to *this* row —
// without this, a stolen session cookie plus the attacker's own (different, valid) Google account
// would let them add a password to the victim's account. Compares `sub`, never `email`: email is
// mutable on Google's side and isn't the identity key `users_google_sub`'s unique index uses.
// Pulled out on its own so it can be unit-tested directly without any HTTP/JWT test scaffolding.
export function googleIdentityMatches(row, profile) {
  return !!row?.googleSub && row.googleSub === profile?.sub;
}

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
    db.prepare("INSERT INTO users (id, email, password_hash, created_at, consent_at, terms_version, email_verify_required, password_set_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, email, hash, now, now, TERMS_VERSION, emailEnabled() ? 1 : null, now);
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
    "SELECT id, password_hash, email_verified_at AS emailVerifiedAt, totp_enabled_at AS totpEnabledAt, twofa_method AS twofaMethod FROM users WHERE email = ?"
  ).get(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: { message: "Wrong email or password." } });
  }

  // The password is right, but that's only the first factor on this account — hold off on a real
  // session until /auth/2fa/verify clears the second one.
  const method = twoFaMethod(user);
  if (method === "email") {
    return res.json({ twoFactorRequired: true, method, ...(await issueEmailChallenge({ id: user.id, email })) });
  }
  if (method) {
    return res.json({ twoFactorRequired: true, method, challenge: issueTwoFaChallenge(user.id) });
  }

  createSession(res, user.id);
  // Signing in with a password at all proves this account has one — never passwordless here,
  // regardless of whether it's also Google-linked.
  res.json({ email, emailVerified: !emailEnabled() || !!user.emailVerifiedAt, passwordless: false });
}));

// The code that follows a password/reset-token check on a 2FA-enabled account: a 6-digit code from
// an authenticator app (method 'totp') or one we emailed (method 'email'). There is deliberately no
// backup/recovery code: if the email can't be sent, the person retries (resend) later. Shared by /auth/login and /auth/reset-password, which is why it isn't
// nested under either. A wrong code never consumes the challenge (a mistyped digit can be retried;
// an emailed code absorbs a limited number of wrong guesses, then the challenge is dead), but a
// right one always does, in the same statement that checks it was still unused, so two parallel
// submits of the same challenge+code can't both create a session. 401 `twofa_restart` tells the
// client the challenge itself is gone (expired, spent, burned, 2FA turned off): start over.
auth.post("/auth/2fa/verify", ...twoFaVerifyLimits, asyncHandler(async (req, res) => {
  const challengeId = String(req.body?.challenge || "");
  const code = String(req.body?.code || "").trim();
  const invalid = () => res.status(401).json({ error: { message: "That code is invalid or has expired." } });
  const restart = () => res.status(401).json({ error: { message: "That code is invalid or has expired.", code: "twofa_restart" } });
  if (!challengeId || !code) return invalid();

  const challenge = db.prepare("SELECT id, user_id AS userId, code_hash AS codeHash FROM twofa_challenges WHERE id = ? AND purpose = 'login' AND used_at IS NULL AND expires_at > ?")
    .get(challengeId, Date.now());
  if (!challenge) return restart();

  const user = db.prepare("SELECT id, email, email_verified_at AS emailVerifiedAt, totp_secret AS totpSecret, totp_last_counter AS totpLastCounter, totp_enabled_at AS totpEnabledAt, twofa_method AS twofaMethod FROM users WHERE id = ?")
    .get(challenge.userId);
  const method = twoFaMethod(user);
  if (!method) return restart();   // 2FA was turned off after the challenge was minted

  let totp = { ok: false };
  let emailOk = false;
  if (method === "email") {
    // Reserve the attempt BEFORE comparing, so a parallel burst of guesses can't all be evaluated
    // against one read of the counter.
    const reserved = db.prepare("UPDATE twofa_challenges SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?")
      .run(challenge.id, Date.now(), twoFaEmail.attempts).changes === 1;
    if (!reserved) return restart();
    emailOk = codeMatches(challenge.id, code.replace(/\s/g, ""), challenge.codeHash);
  } else {
    totp = verifyTotp(user.totpSecret, code, { afterCounter: user.totpLastCounter || 0 });
  }
  if (!totp.ok && !emailOk) return invalid();

  const now = Date.now();
  const claimed = db.transaction(() => {
    // Claim the challenge first: whichever of two parallel correct submits gets here first wins,
    // the other's claim reports 0 rows changed and falls through to the failure response below.
    // For an emailed code the claim also pins the code it was checked against, so a re-send that
    // rotated the code mid-request can't let the old one through.
    const r = emailOk
      ? db.prepare("UPDATE twofa_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND code_hash IS ?").run(now, challenge.id, challenge.codeHash)
      : db.prepare("UPDATE twofa_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, challenge.id);
    if (r.changes === 0) return false;
    if (totp.ok) db.prepare("UPDATE users SET totp_last_counter = ? WHERE id = ?").run(totp.counter, user.id);
    return true;
  })();
  if (!claimed) return invalid();

  createSession(res, user.id);
  res.json({ email: user.email, emailVerified: !emailEnabled() || !!user.emailVerifiedAt, twofaMethod: method });
}));

// Another emailed code for a sign-in challenge (the first never arrived, or expired while it sat in
// the inbox). No session exists yet, so it's limited per IP, and per challenge by a cooldown and a
// resend cap. A failed send costs nothing: no cooldown stamp, no resend counted.
auth.post("/auth/2fa/resend", twoFaResendIpLimit, asyncHandler(async (req, res) => {
  const restart = () => res.status(401).json({ error: { message: "That code is invalid or has expired.", code: "twofa_restart" } });
  const challenge = db.prepare("SELECT id, user_id AS userId, resends, attempts, last_sent_at AS lastSentAt FROM twofa_challenges WHERE id = ? AND purpose = 'login' AND used_at IS NULL AND expires_at > ?")
    .get(String(req.body?.challenge || ""), Date.now());
  if (!challenge || challenge.attempts >= twoFaEmail.attempts) return restart();
  const user = db.prepare("SELECT email, totp_enabled_at AS totpEnabledAt, twofa_method AS twofaMethod FROM users WHERE id = ?").get(challenge.userId);
  if (twoFaMethod(user) !== "email") return restart();

  const cooldownMs = twoFaEmail.cooldownSec * 1000;
  const wait = challenge.lastSentAt && cooldownMs > 0 ? challenge.lastSentAt + cooldownMs - Date.now() : 0;
  if (wait > 0) return tooManyCodes(res, { cooldownSec: Math.ceil(wait / 1000) });
  if (twoFaEmail.resends > 0 && challenge.resends >= twoFaEmail.resends) return tooManyCodes(res);
  if (!consume({ name: "twofa-email-day", key: challenge.userId, max: twoFaEmail.sendsPerDay, windowMs: DAY_MS })) return tooManyCodes(res);

  const code = newCode();
  if (!(await sendTwoFaCodeEmail(user.email, code, "login"))) {
    return res.status(502).json({ error: { message: "Couldn't send the email. Try again shortly.", code: "email_send_failed" } });
  }
  const now = Date.now();
  db.prepare("UPDATE twofa_challenges SET code_hash = ?, attempts = 0, resends = resends + 1, last_sent_at = ?, expires_at = ? WHERE id = ? AND used_at IS NULL")
    .run(hashCode(challenge.id, code), now, now + twoFaEmail.ttlMs, challenge.id);
  res.json({ ok: true, cooldownSec: twoFaEmail.cooldownSec });
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

      // A random hash nobody knows: this account signs in with Google only. password_set_at stays
      // NULL below for a brand-new account (omitted from the INSERT) — passwordless from birth,
      // same as the unusable hash right here.
      const unusableHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      try {
        // Either way the email is Google-verified right now — there's nothing for our own
        // verify-email flow to add, so it's marked confirmed immediately.
        const now = Date.now();
        if (existing) {
          db.transaction(() => {
            // password_set_at = NULL right here, atomic with the password_hash that's becoming
            // unusable — this is the one event that turns the password off, so the two travel
            // together in one statement rather than being spread across the transaction.
            db.prepare("UPDATE users SET google_sub = ?, password_hash = ?, email_verified_at = ?, password_set_at = NULL WHERE id = ?")
              .run(sub, unusableHash, now, existing.id);
            db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
            retireResetTokens(existing.id, now);
            if (looksPreRegistered(existing)) revokeTies(existing.id);
            // This account becomes passwordless (signs in with Google only), so there's no local
            // password step left to gate with a second factor — clear it rather than leave it
            // orphaned and unreachable (Settings hides 2FA management once passwordless).
            clearTwoFa(existing.id);
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
    `SELECT users.email AS email, users.google_sub AS googleSub, users.password_set_at AS passwordSetAt, users.email_verified_at AS emailVerifiedAt, users.totp_enabled_at AS totpEnabledAt, users.twofa_method AS twofaMethod
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at > ?`
  ).get(sid, Date.now());
  // passwordless: Google-linked with no password ever added, so there's no local sign-in step to
  // type — account deletion asks for the Google email instead, and 2FA has nothing to protect.
  // A hybrid account (linked to Google *and* has since added a password) is not passwordless.
  res.json(row
    ? { authed: true, email: row.email, passwordless: !!row.googleSub && !row.passwordSetAt, emailVerified: !emailEnabled() || !!row.emailVerifiedAt, totpEnabled: !!row.totpEnabledAt, twofaMethod: twoFaMethod(row) }
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
// would let anyone check which emails are registered. An account with no usable password (Google-
// linked, never added one via /auth/set-password) has nothing to reset, so it's silently skipped
// too; the reply doesn't say which case applied. Two things follow from that:
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
    const user = db.prepare("SELECT id, password_set_at AS passwordSetAt FROM users WHERE email = ?").get(email);
    if (user && user.passwordSetAt) {
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
    const before = db.prepare("SELECT email, email_verified_at AS emailVerifiedAt, email_verify_required AS verifyRequired, totp_enabled_at AS totpEnabledAt, twofa_method AS twofaMethod FROM users WHERE id = ?").get(row.userId);
    if (looksPreRegistered(before)) revokeTies(row.userId);   // see revokeTies: this hands the account to whoever owns the inbox
    // Clicking a link mailed to this address proves the address as surely as the verify-email flow
    // does, so an unverified account is now verified too — COALESCE leaves an already-set date alone.
    db.prepare("UPDATE users SET password_hash = ?, password_set_at = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?")
      .run(hash, now, now, row.userId);
    // A reset that wasn't the account owner's idea is exactly the case where every other signed-in
    // device should be signed out — same move as linking a Google account (see /auth/google above).
    // This runs unconditionally, even when a 2FA step still follows below: proving control of the
    // inbox is reason enough to kill every other session regardless of what happens next.
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.userId);
    return { email: before.email, method: twoFaMethod(before) };
  })();
  if (!user) return badToken(res);

  // A compromised inbox shouldn't bypass an authenticator-app second factor any more than a
  // compromised password should — the new password is already live and every other session already
  // dead either way; only the final sign-in step waits on the code. An EMAIL second factor is
  // different: the reset link and the emailed code arrive in the same inbox, so demanding a code
  // here adds friction and a second mail, not security — whoever can click the link can read it.
  if (user.method === "totp") {
    return res.json({ twoFactorRequired: true, method: "totp", challenge: issueTwoFaChallenge(row.userId) });
  }

  createSession(res, row.userId);
  res.json({ email: user.email, emailVerified: true });   // they just proved they control the inbox
}));

// ---------------- two-factor authentication ----------------

const alreadyOn = (res) =>
  res.status(400).json({ error: { message: "Two-factor authentication is already on.", code: "twofa_already_on" } });
const wrongPasswordRes = (res) =>
  res.status(403).json({ error: { message: "That password is wrong.", code: "confirm_mismatch" } });
const badCodeRes = (res) => res.status(400).json({ error: { message: "That code is invalid or has expired." } });

// Step one of turning 2FA on. Body `{method}`: 'totp' (the default, for clients that send nothing)
// generates a secret and returns it unpersisted — nothing is written until /auth/2fa/confirm proves
// it was set up, so an abandoned setup needs no cleanup. 'email' needs the password right here (a
// stolen session must not be able to make us mail the owner's inbox) and mails a 6-digit code bound
// to an 'enroll' challenge; that needs server-side state, unlike TOTP. Never sent on merely opening
// the dialog: the client calls this when the person clicks "send me a code".
auth.post("/auth/2fa/setup", requireAuth, twoFaPasswordLimit, asyncHandler(async (req, res) => {
  const user = db.prepare("SELECT email, password_hash, totp_enabled_at AS totpEnabledAt FROM users WHERE id = ?").get(req.user.userId);
  if (!user) return res.status(404).json({ error: { message: "Not found." } });
  if (user.totpEnabledAt) return alreadyOn(res);

  if (req.body?.method !== "email") {
    const secret = generateSecret();
    return res.json({ method: "totp", secret, otpauthUri: otpauthUri(secret, { email: req.user.email }) });
  }

  if (!emailEnabled()) return res.status(501).json({ error: { message: "Email isn't set up on this server.", code: "email_not_configured" } });
  const password = String(req.body?.password || "").slice(0, 200);
  if (!(await bcrypt.compare(password, user.password_hash))) return wrongPasswordRes(res);

  const now = Date.now();
  const cooldownMs = twoFaEmail.cooldownSec * 1000;
  if (cooldownMs > 0) {
    const recent = db.prepare("SELECT last_sent_at AS lastSentAt FROM twofa_challenges WHERE user_id = ? AND purpose = 'enroll' AND used_at IS NULL AND last_sent_at > ? ORDER BY last_sent_at DESC LIMIT 1")
      .get(req.user.userId, now - cooldownMs);
    if (recent) return tooManyCodes(res, { cooldownSec: Math.ceil((recent.lastSentAt + cooldownMs - now) / 1000) });
  }
  if (!consume({ name: "twofa-email-day", key: req.user.userId, max: twoFaEmail.sendsPerDay, windowMs: DAY_MS })) return tooManyCodes(res);

  db.prepare("DELETE FROM twofa_challenges WHERE user_id = ? AND purpose = 'enroll'").run(req.user.userId);   // only one outstanding at a time
  const id = crypto.randomBytes(32).toString("hex");
  const code = newCode();
  db.prepare("INSERT INTO twofa_challenges (id, user_id, expires_at, created_at, code_hash, purpose, last_sent_at) VALUES (?, ?, ?, ?, ?, 'enroll', ?)")
    .run(id, req.user.userId, now + twoFaEmail.ttlMs, now, hashCode(id, code), now);
  if (!(await sendTwoFaCodeEmail(user.email, code, "enroll"))) {
    db.prepare("DELETE FROM twofa_challenges WHERE id = ?").run(id);
    return res.status(502).json({ error: { message: "Couldn't send the email. Try again shortly.", code: "email_send_failed" } });
  }
  res.json({ method: "email", challenge: id, cooldownSec: twoFaEmail.cooldownSec });
}));

// Step two. 'totp' requires the current password (without it, a stolen session alone could enroll an
// attacker's own authenticator on the victim's account and lock them out) plus a code matching the
// secret the client echoes back. 'email' already proved the password at setup; here it's the emailed
// code, against a challenge bound to this user and to enrolling (never a sign-in challenge).
auth.post("/auth/2fa/confirm", requireAuth, twoFaPasswordLimit, asyncHandler(async (req, res) => {
  const user = db.prepare("SELECT password_hash, totp_enabled_at AS totpEnabledAt FROM users WHERE id = ?").get(req.user.userId);
  if (!user) return res.status(404).json({ error: { message: "Not found." } });
  if (user.totpEnabledAt) return alreadyOn(res);
  const code = String(req.body?.code || "").trim();
  const now = Date.now();

  if (req.body?.method === "email") {
    const challenge = db.prepare("SELECT id, code_hash AS codeHash FROM twofa_challenges WHERE id = ? AND user_id = ? AND purpose = 'enroll' AND used_at IS NULL AND expires_at > ?")
      .get(String(req.body?.challenge || ""), req.user.userId, now);
    if (!challenge || !code) return badCodeRes(res);
    const reserved = db.prepare("UPDATE twofa_challenges SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?")
      .run(challenge.id, now, twoFaEmail.attempts).changes === 1;
    if (!reserved || !codeMatches(challenge.id, code.replace(/\s/g, ""), challenge.codeHash)) return badCodeRes(res);

    const enabled = db.transaction(() => {
      if (db.prepare("UPDATE twofa_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND code_hash IS ?").run(now, challenge.id, challenge.codeHash).changes === 0) return false;
      db.prepare("UPDATE users SET twofa_method = 'email', totp_enabled_at = ?, totp_secret = NULL, totp_last_counter = NULL WHERE id = ?").run(now, req.user.userId);
      return true;
    })();
    if (!enabled) return badCodeRes(res);
    return res.json({ ok: true, method: "email" });   // no "2FA turned on" mail: the code mail + password already prove it
  }

  const password = String(req.body?.password || "").slice(0, 200);
  const secret = String(req.body?.secret || "");
  if (!secret || !code) return badCodeRes(res);
  if (!(await bcrypt.compare(password, user.password_hash))) return wrongPasswordRes(res);
  const totp = verifyTotp(secret, code, { afterCounter: 0 });
  if (!totp.ok) return badCodeRes(res);

  db.prepare("UPDATE users SET twofa_method = 'totp', totp_secret = ?, totp_enabled_at = ?, totp_last_counter = ? WHERE id = ?")
    .run(secret, now, totp.counter, req.user.userId);
  sendTwoFaEnabledEmail(req.user.email).catch(() => {});
  res.json({ ok: true, method: "totp" });
}));

auth.post("/auth/2fa/disable", requireAuth, twoFaPasswordLimit, asyncHandler(async (req, res) => {
  const password = String(req.body?.password || "").slice(0, 200);
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.userId);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return wrongPasswordRes(res);
  const sid = req.cookies?.[COOKIE_NAME];
  db.transaction(() => {
    clearTwoFa(req.user.userId);
    // Kill every *other* session — the one making this request already just re-proved the
    // password, so leaving it alive isn't a risk, and killing it too would just be confusing.
    // Revoking the rest still matters: it makes any other signed-in device notice something changed.
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(req.user.userId, sid || "");
  })();
  sendTwoFaDisabledEmail(req.user.email).catch(() => {});
  res.json({ ok: true });
}));

// Lets a Google-linked account add a password, so either method reaches the same account from
// then on — asked for by a user who'd linked Google and found password sign-in (and
// forgot-password) permanently dead for that address afterward, by the original design. Requires
// a *fresh* Google credential for THIS account (not just an existing session — see
// googleIdentityMatches above): at the moment it's presented, Google has just re-proven current
// ownership, so the freshly-chosen password poses none of the pre-registration risk that made
// /auth/google turn the old password off in the first place (it's never inherited from whatever an
// earlier squatter might have set). Purely additive — unlike 2FA disable or a password reset, it
// doesn't remove any existing protection or hand control to a new party — so it doesn't revoke
// other sessions; a best-effort notification email is the safety net for a stolen-session attempt.
auth.post("/auth/set-password", requireAuth, setPasswordLimit, asyncHandler(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(501).json({ error: { message: "Google sign-in isn't set up on this server.", code: "google_not_configured" } });
  }
  const credential = String(req.body?.credential || "");
  const password = String(req.body?.password || "");
  const invalid = () => res.status(401).json({ error: { message: "Couldn't verify your Google sign-in.", code: "google_invalid" } });
  if (!credential || credential.length > 4096) return invalid();
  if (password.length < 8) return res.status(400).json({ error: { message: "Password must be at least 8 characters." } });
  if (password.length > 200) return res.status(400).json({ error: { message: "Password is too long." } });

  const row = db.prepare("SELECT google_sub AS googleSub, password_set_at AS passwordSetAt FROM users WHERE id = ?").get(req.user.userId);
  if (!row?.googleSub) {
    return res.status(400).json({ error: { message: "This account isn't linked to Google.", code: "no_google_account" } });
  }
  if (row.passwordSetAt) {
    return res.status(400).json({ error: { message: "This account already has a password.", code: "password_already_set" } });
  }

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
  if (!googleIdentityMatches(row, profile)) {
    return res.status(403).json({ error: { message: "That Google account doesn't match this one.", code: "google_sub_mismatch" } });
  }

  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  db.prepare("UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?").run(hash, now, req.user.userId);
  sendPasswordAddedEmail(req.user.email).catch(() => {});
  res.json({ ok: true });
}));
