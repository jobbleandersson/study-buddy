import { Router } from "express";
import { Readable } from "node:stream";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export const messages = Router();

// Proxies the browser's request body straight to Anthropic, injecting the
// API key server-side so it never reaches the client. Streaming requests are
// piped through untouched — same SSE bytes in, same SSE bytes out — so
// js/claude.js's existing tutorStream() parser needs no changes.
messages.post("/messages", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "Server has no ANTHROPIC_API_KEY configured." } });
  }

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    return res.status(502).json({ error: { message: "Could not reach the Claude API." } });
  }

  res.status(upstream.status);
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.setHeader("content-type", contentType);

  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
});
