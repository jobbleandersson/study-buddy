import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { takeToken, RATE_PER_MIN } from "../middleware/rateLimit.js";
import {
  recordUsage, checkBudget, isBudgetExempt, checkDailyCap, reserveSpend, worstCaseMicro, readUsage, currentPeriod, periodResetsAt,
  checkUserDailyShare, reserveUserSpend,
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

// Only what the app itself sends: text, and pictures as base64. Anything else — a PDF or a picture
// Anthropic would fetch from a URL, a document block, tool calls — is refused: the spend estimate
// below can't see what a URL costs, and a 100-page PDF passed by link would be booked as ~50 tokens.
function contentOk(content) {
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.every((b) => b && typeof b === "object" && (
    (b.type === "text" && typeof b.text === "string")
    || (b.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string")));
}
function bodyContentOk(body) {
  if (!body.messages.every((m) => m && (m.role === "user" || m.role === "assistant") && contentOk(m.content))) return false;
  const sys = body.system;
  return sys == null || typeof sys === "string"
    || (Array.isArray(sys) && sys.every((b) => b && b.type === "text" && typeof b.text === "string"));
}

// One person's requests in flight at once, and their share of the server's daily dollar cap: without
// these one new account could fire a burst of maximum-size requests whose reservations fill the whole
// day's cap, and AI would be off for everyone until midnight. In memory, like the other limiters.
const MAX_INFLIGHT_PER_USER = (() => {
  const n = Number(process.env.AI_MAX_INFLIGHT_PER_USER);
  return Number.isFinite(n) && n > 0 && process.env.AI_MAX_INFLIGHT_PER_USER?.trim() ? n : 3;
})();
const inflightByUser = new Map();

// Characters of real text in a request (images and documents are billed by tokens, not characters).
// A clear 413 for an absurd request, before the spend estimate would refuse it as "AI paused".
const MAX_TEXT_CHARS = 400_000;
function textChars(v) {
  if (typeof v === "string") return v.length;
  if (Array.isArray(v)) return v.reduce((n, x) => n + textChars(x), 0);
  if (v && typeof v === "object") {
    if (v.type === "image" || v.type === "document") return 0;
    return Object.values(v).reduce((n, x) => n + textChars(x), 0);
  }
  return 0;
}

function log(fields) {
  // One structured line per request — grep-able, and the seed of a cost view.
  try { console.log("[proxy] " + JSON.stringify({ t: new Date().toISOString(), ...fields })); } catch {}
}

// Every token Anthropic bills, by kind. input_tokens leaves out whatever was read
// from or written to the prompt cache, and the client can ask for caching (the body's
// messages and system pass through untouched), so those are counted too. Values only
// grow over a stream, so the largest one seen is the final one.
const emptyUsage = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
function mergeUsage(acc, u) {
  if (!u) return acc;
  acc.input = Math.max(acc.input, u.input_tokens || 0);
  acc.output = Math.max(acc.output, u.output_tokens || 0);
  acc.cacheWrite = Math.max(acc.cacheWrite, u.cache_creation_input_tokens || 0);
  acc.cacheRead = Math.max(acc.cacheRead, u.cache_read_input_tokens || 0);
  return acc;
}
const usageFields = (u, costMicro) => ({
  in: u.input, out: u.output,
  ...(u.cacheWrite ? { cacheWrite: u.cacheWrite } : {}),
  ...(u.cacheRead ? { cacheRead: u.cacheRead } : {}),
  usd: costMicro / 1_000_000,
});

// A rough upper bound on the tokens a request will read, for the spend cap: half a
// token per character of JSON is well above what English or Swedish text needs.
// Images are the exception — their base64 isn't what's billed — so each counts a flat
// 6,000 tokens, about the most one costs.
function estimateInputTokens(body) {
  let images = 0;
  const json = JSON.stringify([body.system ?? null, body.messages], (key, value) => {
    if (value && typeof value === "object" && value.type === "image") { images++; return { type: "image" }; }
    return value;
  });
  return Math.ceil(json.length / 2) + images * 6000;
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
  if (!bodyContentOk(body)) {
    return res.status(400).json({ error: { message: "That kind of content can't be sent to the AI.", code: "bad_content" } });
  }
  if (textChars(body.messages) + textChars(body.system) > MAX_TEXT_CHARS) {
    return res.status(413).json({ error: { message: "That request is too large.", code: "bad_request" } });
  }

  // The whole server's daily dollar cap: past it, AI is off for everyone until
  // 00:00 UTC, however many accounts are asking (see usage.js). Applies with or
  // without auth — it protects the API key, not a user. The request counts at its
  // worst case, alongside everything already spent or in flight.
  const worstMicro = worstCaseMicro(body.model, { maxTokens: body.max_tokens, inputTokens: estimateInputTokens(body) });
  const cap = checkDailyCap(worstMicro);
  if (!cap.ok) {
    log({ userId, model: body.model, status: 503, err: "daily_cap" });
    return res.status(503).json({ error: { message: "AI is paused for today.", code: "daily_cap" }, resetsAt: cap.resetsAt });
  }

  // Per-user metering only applies when there's a user to meter (REQUIRE_AUTH on).
  if (userId) {
    if (!takeToken(userId)) {
      return res.status(429).json({ error: { message: `Too many requests — max ${RATE_PER_MIN}/min.`, code: "rate_limited" } });
    }
    if ((inflightByUser.get(userId) || 0) >= MAX_INFLIGHT_PER_USER) {
      return res.status(429).json({ error: { message: "Too many requests at once. Wait for the last answer to finish.", code: "ai_busy" } });
    }
    if (!checkUserDailyShare(userId, worstMicro)) {
      log({ userId, model: body.model, status: 429, err: "user_daily_cap" });
      return res.status(429).json({ error: { message: "You've used today's share of AI. Try again tomorrow.", code: "user_daily_cap" }, resetsAt: cap.resetsAt });
    }
    const budget = isBudgetExempt(userId) ? { ok: true } : checkBudget(userId);
    if (!budget.ok) {
      return res.status(402).json({
        error: { message: "You've reached this month's AI limit.", code: "quota_exceeded" },
        used: budget.used, limit: budget.limit, resetsAt: budget.resetsAt,
      });
    }
  }

  // Admitted. Hold this request's worst-case cost against the cap until it is done,
  // so a burst of parallel requests can't all slip in before the first is booked. Released
  // when forward() finishes, not when the client hangs up: Anthropic keeps working (and
  // billing) either way.
  // If the browser goes away (tab closed, question changed) stop the upstream call too, and never
  // let one hang forever. A streamed reply still books what it had produced before the cut.
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  const timer = setTimeout(() => ac.abort(), 180_000);
  res.on("close", () => clearTimeout(timer));
  const release = reserveSpend(worstMicro);
  const releaseUser = userId ? reserveUserSpend(userId, worstMicro) : () => {};
  if (userId) inflightByUser.set(userId, (inflightByUser.get(userId) || 0) + 1);
  try {
    await forward({ res, userId, body, apiKey, started, signal: ac.signal });
  } finally {
    release();
    releaseUser();
    if (userId) {
      const n = (inflightByUser.get(userId) || 1) - 1;
      if (n > 0) inflightByUser.set(userId, n); else inflightByUser.delete(userId);
    }
  }
}));

// Send one admitted request to Anthropic, relay the answer, and book what it cost.
async function forward({ res, userId, body, apiKey, started, signal }) {
  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Hung up (or timed out) while Anthropic was still working: the request may well be billed, so
    // book at least what it read rather than nothing.
    if (signal.aborted) {
      const costMicro = recordUsage({ userId, model: body.model, usage: { ...emptyUsage(), input: estimateInputTokens(body) } });
      log({ userId, model: body.model, status: 499, ms: Date.now() - started, err: "aborted_waiting", costMicro });
      return res.end();
    }
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
    const usage = emptyUsage();
    // Output is only reported in full by the closing message_delta. If the client hangs up before it,
    // count what was streamed instead (about one token per three characters) — otherwise reading the
    // whole answer and cutting the connection just before the end would cost the meter nothing.
    let outChars = 0;
    let sawFinalUsage = false;
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
            if (j.type === "message_start") mergeUsage(usage, j.message?.usage);
            else if (j.type === "message_delta") { mergeUsage(usage, j.usage); sawFinalUsage = true; }
            else if (j.type === "content_block_delta") outChars += String(j.delta?.text || j.delta?.partial_json || "").length;
          } catch { /* partial / non-JSON keepalive */ }
        }
      }
    } catch { /* client hung up mid-stream — still bill what we saw */ }
    if (!sawFinalUsage) usage.output = Math.max(usage.output, Math.ceil(outChars / 3));
    res.end();
    const costMicro = upstream.ok ? recordUsage({ userId, model: body.model, usage }) : 0;
    log({ userId, model: body.model, stream: true, status: upstream.status, ...usageFields(usage, costMicro), ms: Date.now() - started });
    return;
  }

  // --- non-streaming: buffer so we can read response.usage before forwarding. ---
  let text;
  try { text = await upstream.text(); }
  catch {
    // The client left or the timeout fired with the answer on its way: book what was read, at least.
    const costMicro = upstream.ok ? recordUsage({ userId, model: body.model, usage: { ...emptyUsage(), input: estimateInputTokens(body) } }) : 0;
    log({ userId, model: body.model, status: 499, ms: Date.now() - started, err: "aborted", costMicro });
    return res.end();
  }
  res.setHeader("content-length", Buffer.byteLength(text));
  res.end(text);
  const usage = emptyUsage();
  try { mergeUsage(usage, JSON.parse(text)?.usage); } catch { /* error body / non-JSON */ }
  const costMicro = upstream.ok ? recordUsage({ userId, model: body.model, usage }) : 0;
  log({ userId, model: body.model, status: upstream.status, ...usageFields(usage, costMicro), ms: Date.now() - started });
}

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
    // An exempt account (AI_BUDGET_EXEMPT_EMAILS) has no monthly ceiling, so the client shows no limit for it.
    metered: REQUIRE_AUTH && !isBudgetExempt(req.user.userId),
  });
});
