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
  });
});
