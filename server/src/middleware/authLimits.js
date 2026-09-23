import { attemptLimit, clientKey } from "./attemptLimit.js";

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

// One ping per app load (see js/main.js) — generous enough that a whole class
// opening the app on one school IP at once never gets blocked, tight enough
// that a script hammering the endpoint can't grow the page_views table without bound.
export const pageviewLimit = attemptLimit({ name: "pageview-ip", max: num("PAGEVIEW_PER_HOUR_PER_IP", 300), windowMs: HOUR });

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
