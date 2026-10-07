import { Router } from "express";
import crypto from "node:crypto";
import { emailEnabled } from "../email.js";
import { siteLocked, hasGate } from "../gate.js";
import { checkAi } from "../ai-check.js";

export const health = Router();

// Changes on every deploy and nowhere else: Fly sets FLY_IMAGE_REF per machine
// from the deployed image, so it survives restarts and scale-to-zero wake-ups.
// A tab that's been open across a deploy compares this against what it booted
// with and offers a reload (js/main.js). Hashed so the registry path isn't
// published; APP_VERSION overrides it on other hosts. Null = unknown, no check.
const VERSION_SOURCE = process.env.APP_VERSION || process.env.FLY_IMAGE_REF || "";
const VERSION = VERSION_SOURCE ? crypto.createHash("sha256").update(VERSION_SOURCE).digest("hex").slice(0, 12) : null;

health.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");   // `unlocked` depends on the visitor's cookie
  res.json({
    ok: true,
    keyConfigured: !!process.env.ANTHROPIC_API_KEY,
    // False = no RESEND_API_KEY set. The sign-up/sign-in screen then shows no verify/reset UI at
    // all — same dormant-until-configured shape as googleClientId below.
    emailConfigured: emailEnabled(),
    // The client needs to know whether the proxy will accept anonymous
    // requests — with MESSAGES_REQUIRE_AUTH off (a trusted single-user run)
    // it should let the AI features work without a sign-in.
    messagesRequireAuth: process.env.MESSAGES_REQUIRE_AUTH !== "false",
    // Public by design (it's sent to every browser anyway). Null = Google
    // sign-in isn't set up, and the sign-in screen shows no Google button.
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    // True = a SITE_PASSWORD is set (see gate.js): the client shows only the front page until `unlocked`.
    siteLocked: siteLocked(),
    unlocked: hasGate(req),

    // Where the "you've used this month's AI allowance" prompt sends people
    // who want more (e.g. a Stripe Payment Link). Unset = the prompt only
    // explains the limit, with no upgrade button.
    premiumUrl: /^https:\/\//.test(process.env.PREMIUM_URL || "") ? process.env.PREMIUM_URL : null,
    version: VERSION,
  });
});

// Whether the AI really answers (ai-check.js), for an uptime monitor: 200 when it does, 503 with the
// reason when it doesn't. Cached for 10 minutes, so polling it costs at most one tiny request per 10 min.
// Open while the site is locked (gate.js) and says nothing but ok/reason.
health.get("/health/ai", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const r = await checkAi();
    res.status(r.ok ? 200 : 503).json({ ok: r.ok, reason: r.reason, checkedAt: new Date(r.checkedAt).toISOString() });
  } catch {
    res.status(503).json({ ok: false, reason: "check_failed" });
  }
});
