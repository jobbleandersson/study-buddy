import { Router } from "express";

export const health = Router();

health.get("/health", (req, res) => {
  res.json({ ok: true, keyConfigured: !!process.env.ANTHROPIC_API_KEY });
});
