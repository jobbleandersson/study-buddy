import { Router } from "express";

export const health = Router();

health.get("/health", (req, res) => {
  res.json({
    ok: true,
    keyConfigured: !!process.env.ANTHROPIC_API_KEY,
    // The client needs to know whether the proxy will accept anonymous
    // requests — with MESSAGES_REQUIRE_AUTH off (a trusted single-user run)
    // it should let the AI features work without a sign-in.
    messagesRequireAuth: process.env.MESSAGES_REQUIRE_AUTH !== "false",
    // Public by design (it's sent to every browser anyway). Null = Google
    // sign-in isn't set up, and the sign-in screen shows no Google button.
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,

    // Where the "you've used this month's AI allowance" prompt sends people
    // who want more (e.g. a Stripe Payment Link). Unset = the prompt only
    // explains the limit, with no upgrade button.
    premiumUrl: /^https:\/\//.test(process.env.PREMIUM_URL || "") ? process.env.PREMIUM_URL : null,
  });
});
