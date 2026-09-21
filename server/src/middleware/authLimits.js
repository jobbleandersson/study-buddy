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
