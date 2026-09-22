import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { waitlistHourly, waitlistDaily } from "../middleware/authLimits.js";
import { isUniqueViolation } from "../errors.js";

export const waitlist = Router();

// Fed by the "#/premium" page (see PREMIUM_URL in .env.example). No account
// required. An address already on the list is treated as success, not an
// error — the person doesn't need to know they'd already joined, and it
// keeps this endpoint from being a way to test which emails are on it.
// A real shape check, not just "has an @" — this list gets emailed from one day,
// so "@" or "a@a" slipping in as a row isn't just noise, it's an address that bounces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

waitlist.post("/waitlist/premium", waitlistHourly, waitlistDaily, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: { message: "Enter a valid email." } });
  }
  try {
    db.prepare("INSERT INTO premium_waitlist (id, email, created_at) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), email, Date.now());
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  res.json({ ok: true });
}));
