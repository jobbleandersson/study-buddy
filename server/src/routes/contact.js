import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { consume } from "../middleware/attemptLimit.js";
import { contactHourly, contactDaily, contactAllDaily, DAY_MS } from "../middleware/authLimits.js";
import { emailEnabled, sendContactEmail } from "../email.js";

export const contact = Router();

// Fed by the "#/contact" page. No account needed — a parent or teacher without one should be able to
// write too — so it sits behind per-IP limits, a daily cap for everyone together, and a honeypot.
// The message is mailed to CONTACT_TO (email.js) with the sender as Reply-To; nothing is stored.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MAX_MESSAGE = 5000;

contact.post("/contact", contactHourly, contactDaily, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const message = String(req.body?.message || "").trim();

  // The form has a field people never see; a bot that fills in every input fills that one too. It
  // gets the same answer as a real send so it has nothing to learn from.
  if (String(req.body?.website || "").trim()) return res.json({ ok: true });

  if (!name || name.length > MAX_NAME) return res.status(400).json({ error: { message: "Enter your name." } });
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: { message: "Enter a valid email." } });
  if (!message || message.length > MAX_MESSAGE) return res.status(400).json({ error: { message: "Write a message of up to 5000 characters." } });

  if (!emailEnabled()) return res.status(503).json({ error: { message: "Email isn't set up on this server.", code: "email_off" } });
  if (!consume({ name: "contact-all", key: "all", max: contactAllDaily, windowMs: DAY_MS })) {
    return res.status(429).json({ error: { message: "Too many attempts. Try again in a few minutes.", code: "contact_full" } });
  }
  if (!(await sendContactEmail({ name, email, message }))) {
    return res.status(502).json({ error: { message: "Couldn't send the email. Try again shortly.", code: "send_failed" } });
  }
  res.json({ ok: true });
}));
