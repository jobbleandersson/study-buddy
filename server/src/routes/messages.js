import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { takeToken, RATE_PER_MIN } from "../middleware/rateLimit.js";
import {
  addUsage, checkBudget, readUsage, currentPeriod, periodResetsAt,
  MONTHLY_TOKEN_BUDGET, MAX_OUTPUT_TOKENS, ALLOWED_MODELS,
} from "../usage.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Default ON: a public deployment must not leave the key spendable by
// anyone who finds the URL. Set MESSAGES_REQUIRE_AUTH=false only for a
// trusted single-user / local run — metering is then skipped too (there's
// no user to attribute spend to).
const REQUIRE_AUTH = process.env.MESSAGES_REQUIRE_AUTH !== "false";

// A kill switch: flip this and redeploy nothing to stop all spend.
function proxyDisabled() {
  return process.env.PROXY_DISABLED === "true" || process.env.PROXY_DISABLED === "1";
}

export const messages = Router();

// Only forward the fields we expect. Anything else the client sent is dropped
// before the request reaches Anthropic.
function sanitizeBody(raw) {
  const b = raw && typeof raw === "object" ? raw : {};
  const model = String(b.model || "");
  const asked = Number(b.max_tokens);
  const out = {
    model,
    max_tokens: Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS,
    messages: Array.isArray(b.messages) ? b.messages : [],
  };
  if (b.system != null) out.system = b.system;
  if (b.stream === true) out.stream = true;
  if (typeof b.temperature === "number") out.temperature = Math.max(0, Math.min(1, b.temperature));
  return out;
}

function log(fields) {
  // One structured line per request — grep-able, and the seed of a cost view.
  try { console.log("[proxy] " + JSON.stringify({ t: new Date().toISOString(), ...fields })); } catch {}
}

// Everything below /messages runs the same guard chain.
const guards = [];
if (REQUIRE_AUTH) guards.push(requireAuth);

messages.post("/messages", ...guards, asyncHandler(async (req, res) => {
  const userId = req.user?.userId || null;
  const started = Date.now();

  if (proxyDisabled()) {
    return res.status(503).json({ error: { message: "AI is temporarily unavailable.", code: "maintenance" } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "Server has no ANTHROPIC_API_KEY configured.", code: "server_no_key" } });
  }

  const body = sanitizeBody(req.body);
  if (!ALLOWED_MODELS.has(body.model)) {
    return res.status(400).json({ error: { message: `Model not allowed: ${body.model || "(none)"}`, code: "model_not_allowed" } });
  }
  if (!body.messages.length) {
    return res.status(400).json({ error: { message: "No messages.", code: "bad_request" } });
  }

  // Metering only applies when there's a user to meter (REQUIRE_AUTH on).
  if (userId) {
    if (!takeToken(userId)) {
      return res.status(429).json({ error: { message: `Too many requests — max ${RATE_PER_MIN}/min.`, code: "rate_limited" } });
    }
    const budget = checkBudget(userId);
    if (!budget.ok) {
      return res.status(402).json({
        error: { message: "You've reached this month's AI limit.", code: "quota_exceeded" },
        used: budget.used, limit: budget.limit, resetsAt: budget.resetsAt,
      });
    }
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
      body: JSON.stringify(body),
    });
  } catch (e) {
    log({ userId, model: body.model, status: 502, ms: Date.now() - started, err: "unreachable" });
    return res.status(502).json({ error: { message: "Could not reach the Claude API.", code: "upstream_unreachable" } });
  }

  res.status(upstream.status);
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.setHeader("content-type", contentType);

  // --- streaming: forward the raw SSE bytes untouched, but read the usage
  //     events off the side as they go past (input from message_start, final
  //     output from the last message_delta). ---
  if (body.stream && upstream.body) {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let inTok = 0, outTok = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const evt = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const j = JSON.parse(dataLine.slice(5).trim());
            if (j.type === "message_start" && j.message?.usage) inTok = j.message.usage.input_tokens || inTok;
            if (j.type === "message_delta" && j.usage?.output_tokens != null) outTok = j.usage.output_tokens;
          } catch { /* partial / non-JSON keepalive */ }
        }
      }
    } catch { /* client hung up mid-stream — still bill what we saw */ }
    res.end();
    if (userId && upstream.ok) addUsage(userId, { inputTokens: inTok, outputTokens: outTok });
    log({ userId, model: body.model, stream: true, status: upstream.status, in: inTok, out: outTok, ms: Date.now() - started });
    return;
  }

  // --- non-streaming: buffer so we can read response.usage before forwarding. ---
  const text = await upstream.text();
  res.setHeader("content-length", Buffer.byteLength(text));
  res.end(text);
  let inTok = 0, outTok = 0;
  try {
    const j = JSON.parse(text);
    inTok = j?.usage?.input_tokens || 0;
    outTok = j?.usage?.output_tokens || 0;
  } catch { /* error body / non-JSON */ }
  if (userId && upstream.ok) addUsage(userId, { inputTokens: inTok, outputTokens: outTok });
  log({ userId, model: body.model, status: upstream.status, in: inTok, out: outTok, ms: Date.now() - started });
}));

// The signed-in user's spend this month, for the Settings usage line and the
// client's "limit reached" state. Cheap; no auth escape hatch (if
// REQUIRE_AUTH is off there's nothing to report).
messages.get("/usage", requireAuth, (req, res) => {
  const u = readUsage(req.user.userId);
  res.json({
    period: currentPeriod(),
    used: u.totalTokens,
    limit: MONTHLY_TOKEN_BUDGET,
    requests: u.requests,
    resetsAt: periodResetsAt(),
    metered: REQUIRE_AUTH,
  });
});
