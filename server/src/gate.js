// Private-site password, for while the site is only meant for a couple of people. SITE_PASSWORD is
// the shared password (a secret — `fly secrets set SITE_PASSWORD=...` — not code, so it isn't in git);
// unset = the site is open to everyone. Replaces the earlier INVITE_EMAILS list.
//
// How it works: the landing page asks for the password (js/components/site-gate-dialog.js) and posts it
// to POST /api/gate. A right answer sets a long-lived cookie, so each device only asks once. Everything
// under /api except /api/health and /api/gate then refuses without that cookie — no sign-up, sign-in,
// sync, AI or analytics for anyone who hasn't typed the password.
//
// The cookie holds HMAC(password, fixed label): it proves "typed the password" without storing it, and
// changing SITE_PASSWORD makes every old cookie stop working at once (that is how you lock everyone out
// again). What this does not hide: the app's own JavaScript and the library's question data, which are
// static files that also sit in the public GitHub repo.

import crypto from "node:crypto";
import { Router } from "express";
import { siteGateIpLimit, siteGateGlobalLimit } from "./middleware/authLimits.js";

export const GATE_COOKIE = "sb_gate";
const GATE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const password = () => process.env.SITE_PASSWORD || "";

/** True while a SITE_PASSWORD is set: the site is private and the gate is enforced. */
export const siteLocked = () => password().length > 0;

const hmac = (key, text) => crypto.createHmac("sha256", key).update(text).digest();

/** What a device that has typed the password carries. Hex, so it is cookie-safe. */
const gateToken = () => hmac(password(), "pluggera-site-gate-v1").toString("hex");

/** Constant-time: both sides are hashed to the same length first, so neither length nor content leaks. */
function safeEqual(a, b) {
  const key = "pluggera-compare";
  return crypto.timingSafeEqual(hmac(key, String(a)), hmac(key, String(b)));
}

/** Does this request come from a device that has typed the password (or is the site open)? */
export function hasGate(req) {
  if (!siteLocked()) return true;
  const given = req.cookies?.[GATE_COOKIE];
  return typeof given === "string" && safeEqual(given, gateToken());
}

// The only API paths a device without the cookie may reach: the health check (it has to say whether the
// site is locked) and the unlock itself. Anything that doesn't match exactly — odd slashes, other
// paths — falls through to the refusal, so a weird URL can only ever be locked, never open.
const OPEN_PATHS = /^\/(health|gate)\/?$/i;

export function requireGate(req, res, next) {
  if (!siteLocked() || OPEN_PATHS.test(req.path) || hasGate(req)) return next();
  res.status(403).json({ error: { message: "Enter the site password first.", code: "site_locked" } });
}

export const gate = Router();

gate.post("/gate", siteGateIpLimit, siteGateGlobalLimit, (req, res) => {
  if (!siteLocked() || hasGate(req)) return res.json({ ok: true });
  const given = req.body?.password;
  if (typeof given !== "string" || given.length === 0 || given.length > 200 || !safeEqual(given, password())) {
    return res.status(401).json({ error: { message: "That site password is wrong.", code: "wrong_site_password" } });
  }
  res.cookie(GATE_COOKIE, gateToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: GATE_TTL_MS,
    path: "/",
  });
  res.json({ ok: true });
});
