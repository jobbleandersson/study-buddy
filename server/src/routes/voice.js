import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { audioFor } from "../voice.js";

export const voice = Router();

// A question is read as about ten pieces; a student can tap through several quickly. A signed-in account
// only: the audio is made on the site's own bill, and the library text it voices is free to nobody else.
const PER_MIN = 150;
const buckets = new Map();   // userId -> { tokens, last }
setInterval(() => {
  const now = Date.now();
  for (const [id, b] of buckets) if (now - b.last > 10 * 60_000) buckets.delete(id);
}, 5 * 60_000).unref?.();
function allow(userId) {
  const now = Date.now();
  const b = buckets.get(userId) || { tokens: PER_MIN, last: now };
  b.tokens = Math.min(PER_MIN, b.tokens + ((now - b.last) * PER_MIN) / 60_000);
  b.last = now;
  buckets.set(userId, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

const STATUS = { disabled: 404, unknown: 404, cap: 503, upstream: 502 };

// GET /api/voice/<sha256 of the piece's text>.mp3?voice=nova|ash&lang=sv|en
// The text itself is never sent: the server has to find the hash in its own index of the library.
voice.get("/voice/:hash([0-9a-f]{64}).mp3", requireAuth, asyncHandler(async (req, res) => {
  if (!allow(req.user.userId)) return res.status(429).json({ error: { message: "Slow down a little.", code: "rate_limited" } });
  const out = await audioFor({ voice: String(req.query.voice || ""), lang: String(req.query.lang || ""), hash: req.params.hash });
  if (out.error) return res.status(STATUS[out.error] || 502).json({ error: { message: "No audio for that.", code: `voice_${out.error}` } });
  // The pieces are fixed text, so the browser may keep the audio; private because the route needs a sign-in.
  res.set("Cache-Control", "private, max-age=604800");
  res.type("audio/mpeg");
  res.sendFile(out.file, { dotfiles: "allow" }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { message: "No audio for that.", code: "voice_unknown" } });
  });
}));
