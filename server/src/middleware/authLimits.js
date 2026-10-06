import { attemptLimit, clientKey } from "./attemptLimit.js";
import { db } from "../db.js";

// The limits on signup, login and code guessing. All adjustable from the
// environment — a school signing up a few classes from one Wi-Fi is the case
// to keep in mind — and 0 switches a limit off.

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Every signup attempt counts. Sixty an hour per IP fits a couple of classes on
// one school network; the daily figure stops a slow drip from one address.
export const signupHourly = attemptLimit({ name: "signup-hour", max: num("SIGNUPS_PER_HOUR_PER_IP", 60), windowMs: HOUR });
export const signupDaily = attemptLimit({ name: "signup-day", max: num("SIGNUPS_PER_DAY_PER_IP", 200), windowMs: DAY });

// Only wrong passwords count, so a class logging in at once isn't slowed down. The
// tight limit is per account and IP: someone hammering one account gets stopped, but
// one pupil's bad logins on a shared school network can't lock out everyone else.
// The looser per-IP ceiling is for one address trying many accounts.
export const loginFailures = [
  attemptLimit({
    name: "login-fail-account", max: num("LOGIN_FAILS_PER_15MIN_PER_ACCOUNT", 10), windowMs: 15 * MIN, failureStatuses: [401],
    key: (req) => `${clientKey(req)}|${String(req.body?.email || "").trim().toLowerCase().slice(0, 254)}`,
  }),
  attemptLimit({
    name: "login-fail-ip", max: num("LOGIN_FAILS_PER_15MIN_PER_IP", 300), windowMs: 15 * MIN, failureStatuses: [401],
  }),
];

// Joining the premium waitlist: no account needed, so this is the only thing
// standing between it and a scraper filling the table with junk addresses.
// Same generous defaults as signup above — joining a waitlist is lower-stakes
// than creating an account, so it shouldn't be the tighter of the two limits
// a class on one shared IP can run into.
export const waitlistHourly = attemptLimit({ name: "waitlist-hour", max: num("WAITLIST_PER_HOUR_PER_IP", 60), windowMs: HOUR });
export const waitlistDaily = attemptLimit({ name: "waitlist-day", max: num("WAITLIST_PER_DAY_PER_IP", 200), windowMs: DAY });

// The contact form (routes/contact.js): no account needed, and every message that gets through is a
// real email on the shared daily quota (email.js), so these are tighter than the waitlist's. The
// all-visitors daily cap lives in the route, counted for each valid message it tries to send.
export const contactHourly = attemptLimit({ name: "contact-hour", max: num("CONTACT_PER_HOUR_PER_IP", 5), windowMs: HOUR });
export const contactDaily = attemptLimit({ name: "contact-day", max: num("CONTACT_PER_DAY_PER_IP", 15), windowMs: DAY });
export const contactAllDaily = num("CONTACT_PER_DAY", 30);

// Every call verifies a Google-signed token (a JWKS fetch/cache plus a signature check) - cheap,
// but not free. Only rejected credentials count (401 not verifiable, 403 email unverified): a whole
// class signing in with Google from one school network makes dozens of perfectly good calls a
// minute, and a flat per-IP cap would lock the last ones out. Garbage floods still stop at the cap.
export const googleSignInLimit = attemptLimit({
  name: "google-signin", max: num("GOOGLE_SIGNIN_FAILS_PER_MIN_PER_IP", 30), windowMs: MIN, failureStatuses: [401, 403],
});

// Verification and password-reset. All three are reachable without an existing session (reset and
// verify have to be — that's the whole point), so IP is the only key available for two of them; a
// generous default keeps a shared school network from locking a class out of resetting anything.
export const resendVerificationLimit = attemptLimit({
  name: "resend-verify", max: num("RESEND_VERIFY_PER_HOUR_PER_USER", 5), windowMs: HOUR, key: (req) => req.user?.userId,
});
// Per IP only: a per-address counter would answer 429 for registered addresses first, telling anyone
// which emails have accounts, and would let a stranger lock the owner out. The per-account cooldown
// lives in the route itself (see /auth/forgot-password), where it can stay silent.
export const forgotPasswordLimits = [
  attemptLimit({ name: "forgot-pw-ip", max: num("FORGOT_PW_PER_HOUR_PER_IP", 30), windowMs: HOUR }),
];
export const verifyEmailIpLimit = attemptLimit({ name: "verify-email-ip", max: num("VERIFY_EMAIL_PER_HOUR_PER_IP", 60), windowMs: HOUR });
export const resetPasswordIpLimit = attemptLimit({ name: "reset-pw-ip", max: num("RESET_PW_PER_HOUR_PER_IP", 30), windowMs: HOUR });

// Two-factor code guessing. A per-challenge key would reset every time an attacker who already
// knows the password calls /auth/login again for a fresh challenge — so this resolves the challenge
// to the account it belongs to and keys on that instead, collapsing every challenge minted for one
// account (from one address) into the same bucket. Falls back to the raw (bogus/expired) token when
// it doesn't resolve.
const challengeUser = (req) => {
  const challenge = String(req.body?.challenge || "");
  const row = challenge && db.prepare("SELECT user_id AS userId FROM twofa_challenges WHERE id = ?").get(challenge);
  return row ? row.userId : null;
};
const twoFaAccountKey = (req) => `${clientKey(req)}|${challengeUser(req) || String(req.body?.challenge || "")}`;
export const twoFaVerifyLimits = [
  attemptLimit({
    name: "twofa-verify-account", max: num("TWOFA_FAILS_PER_15MIN_PER_ACCOUNT", 10), windowMs: 15 * MIN,
    key: twoFaAccountKey, failureStatuses: [401],
  }),
  attemptLimit({
    name: "twofa-verify-ip", max: num("TWOFA_FAILS_PER_15MIN_PER_IP", 300), windowMs: 15 * MIN, failureStatuses: [401],
  }),
  // The same account from every address at once: the two above are per address, and someone with
  // the password and many addresses (an IPv6 /48 holds 65,536 /64s) could otherwise work through the
  // million codes in hours. Thirty wrong codes a day for one account is far beyond any real typo.
  attemptLimit({
    name: "twofa-verify-account-all", max: num("TWOFA_FAILS_PER_DAY_PER_ACCOUNT", 30), windowMs: DAY,
    key: challengeUser, failureStatuses: [401],
  }),
];

// Re-entering the current password to manage 2FA (confirm/disable/regenerate) — same shape as
// account.js's own delete-account limiter: only a wrong password counts, keyed per account.
export const twoFaPasswordLimit = attemptLimit({
  name: "twofa-password-fail", max: num("TWOFA_PASSWORD_FAILS_PER_15MIN_PER_ACCOUNT", 5), windowMs: 15 * MIN,
  key: (req) => req.user?.userId, failureStatuses: [403],
});

// Presenting a Google credential to add a password (/auth/set-password) — same failure statuses as
// googleSignInLimit (a bad/mismatched credential is a 401 or 403, not a wrong password), but keyed
// per account since a session is already required to reach this route at all.
export const setPasswordLimit = attemptLimit({
  name: "set-password-fail", max: num("SET_PASSWORD_FAILS_PER_15MIN_PER_ACCOUNT", 5), windowMs: 15 * MIN,
  key: (req) => req.user?.userId, failureStatuses: [401, 403],
});

// Emailed 2FA codes. Every code costs a real email on a small free quota (see email.js), and a
// 6-digit code is only safe behind hard caps, so these are all tunable and 0 turns one off (tests).
//   cooldownSec    - minimum gap between two mails for one challenge/enrolment
//   sendsPerDay    - codes generated per account per day: the real brute-force bound (attempts x this)
//   attempts       - wrong guesses one code absorbs before it is burned
//   resends        - how many times one sign-in challenge may have its code re-sent
export const twoFaEmail = {
  cooldownSec: num("TWOFA_EMAIL_COOLDOWN_SEC", 60),
  sendsPerDay: num("TWOFA_EMAIL_SENDS_PER_DAY_PER_ACCOUNT", 10),
  attempts: num("TWOFA_EMAIL_ATTEMPTS", 5) || 5,
  resends: num("TWOFA_EMAIL_RESENDS", 3),
  ttlMs: 10 * MIN,
};
export const DAY_MS = DAY;

// Re-sending a code needs no session (you're mid-sign-in), so IP is the only key available.
export const twoFaResendIpLimit = attemptLimit({ name: "twofa-resend-ip", max: num("TWOFA_RESEND_PER_HOUR_PER_IP", 30), windowMs: HOUR });

// One ping per app load (see js/main.js) — generous enough that a whole class
// opening the app on one school IP at once never gets blocked, tight enough
// that a script hammering the endpoint can't grow the page_views table without bound.
export const pageviewLimit = attemptLimit({ name: "pageview-ip", max: num("PAGEVIEW_PER_HOUR_PER_IP", 300), windowMs: HOUR });
// Error reports from browsers: a page sends at most 10 per load (js/lib/error-report.js), so this only
// stops a script from filling the table.
export const clientErrorLimit = attemptLimit({ name: "client-error-ip", max: num("CLIENT_ERRORS_PER_HOUR_PER_IP", 60), windowMs: HOUR });

// Class, friend and parent codes: only failed guesses count. These routes need
// a session, so the tight limit is per account; the looser per-IP one catches
// guesses spread over many accounts. All three routes share the same counts.
export const codeGuessLimits = [
  attemptLimit({
    name: "code-fail-user", max: num("CODE_FAILS_PER_10MIN_PER_USER", 10), windowMs: 10 * MIN,
    key: (req) => req.user?.userId, failureStatuses: [400, 404],
  }),
  attemptLimit({
    name: "code-fail-ip", max: num("CODE_FAILS_PER_10MIN_PER_IP", 100), windowMs: 10 * MIN, failureStatuses: [400, 404],
  }),
];

// The site password (see ../gate.js). Only wrong guesses count, so typing it right never uses any up.
// Per IP stops one person guessing; the shared cap stops guessing from many addresses at once. It also
// means a flood of bad guesses briefly blocks us from unlocking a NEW device — a device that is already
// unlocked carries a cookie and is unaffected.
export const siteGateIpLimit = attemptLimit({
  name: "site-gate-ip", max: num("SITE_GATE_FAILS_PER_15MIN_PER_IP", 8), windowMs: 15 * MIN, failureStatuses: [401],
});
export const siteGateGlobalLimit = attemptLimit({
  name: "site-gate-all", max: num("SITE_GATE_FAILS_PER_HOUR", 200), windowMs: HOUR, key: () => "all", failureStatuses: [401],
});
