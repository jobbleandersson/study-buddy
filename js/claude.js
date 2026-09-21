// Claude API client — calls the local backend proxy (server/), which holds
// the actual Claude API key. The browser never sees it.

import { store } from "./store.js";
import { generationSystem, gradingSystem } from "./prompts.js";
import { t } from "./lib/i18n.js";
import { PROXY_URL } from "./config.js";

const API_URL = PROXY_URL;

/**
 * One fixed model per job — not a user choice. The jobs have very different
 * requirements: writing a question set is worth a stronger model, because
 * the result is saved and reused by every student who studies that set
 * afterward, not just once. Tutoring and grading (Solve included — it's a
 * tutoring conversation, not a one-shot lookup) are forgotten the moment
 * they're done, so they run on the fast, cheap model.
 */
export const MODELS = {
  generate: "claude-sonnet-5",
  tutor: "claude-haiku-4-5",
  grade: "claude-haiku-4-5",
};

function headers() {
  return { "content-type": "application/json" };
}

/** task: "generate" | "tutor" | "grade" | "solve" */
export function modelFor(task) {
  return MODELS[task] || MODELS.generate;
}

class ClaudeError extends Error {}

/** Maps a non-OK proxy/Anthropic response to a friendly ClaudeError. The proxy
 *  tags its own failures with a machine `code` (see server/src/routes/messages.js)
 *  so a 401 from "not signed in" reads differently from a 401 from a bad key,
 *  and a 402 quota rejection latches the client-side gates shut. */
async function errorFrom(res) {
  let body = null;
  try { body = await res.json(); } catch {}
  const code = body?.error?.code || "";
  const detail = body?.error?.message || "";

  if (code === "maintenance" || res.status === 503) return new ClaudeError(t("err.maintenance"));
  if (code === "quota_exceeded" || res.status === 402) {
    store.markAiQuotaExhausted({ used: body?.used, limit: body?.limit, resetsAt: body?.resetsAt });
    return new ClaudeError(t("err.quotaExceeded"));
  }
  if (code === "not_authenticated") return new ClaudeError(t("err.notSignedIn"));
  if (code === "rate_limited" || res.status === 429) return new ClaudeError(t("err.rateLimited"));
  if (code === "server_no_key" || (res.status === 500 && /ANTHROPIC_API_KEY/.test(detail))) return new ClaudeError(t("err.serverNoKey"));
  if (code === "model_not_allowed" || code === "bad_request") return new ClaudeError(detail || t("err.api", { status: res.status }));
  if (res.status === 401) return new ClaudeError(t("err.badKey"));   // Anthropic passthrough (server key rejected)
  // The proxy couldn't reach Anthropic (502), timed out (504), or Anthropic said it's overloaded (529).
  if (code === "upstream_unreachable" || [502, 504, 529].includes(res.status)) return new ClaudeError(t("err.upstream"));
  return new ClaudeError(detail ? t("err.apiDetail", { status: res.status, detail }) : t("err.api", { status: res.status }));
}

async function callJSON(body, { strict = false } = {}) {
  let res;
  try {
    res = await fetch(API_URL, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  } catch (e) {
    throw new ClaudeError(t("err.network"));
  }
  if (!res.ok) throw await errorFrom(res);
  const data = await res.json();
  // Cut off at the token cap: the JSON is incomplete, and asking again would just repeat it.
  if (strict && data.stop_reason === "max_tokens") throw new ClaudeError(t("err.genTooLong"));
  return data.content?.map((b) => b.text || "").join("") || "";
}

function parseLooseJSON(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.search(/[[{]/);
  const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

// ---------- assignment generation ----------

export async function generateAssignment({ material, topic, image, count = 6, gradeHint = "", preferFlashcards = false, moreLike = null }) {
  const userContent = [];
  if (image) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  const ask = moreLike
    ? [
        `Here is an existing question set titled "${moreLike.title}" (subject: ${moreLike.subject}).`,
        `Existing questions (JSON):\n"""\n${JSON.stringify(moreLike.questions, null, 1)}\n"""`,
        `Write about ${count} MORE questions in the same style, difficulty and topics. Do NOT repeat or lightly reword any existing question. Return the JSON object only — its "questions" array holds only the new questions.`,
      ].join("\n\n")
    : [
        material ? `Study material:\n"""\n${material}\n"""` : null,
        topic ? `Topic to build questions on: ${topic}` : null,
        image ? "Use the attached image of the student's material." : null,
        `Create about ${count} questions. Return the JSON object only.`,
      ].filter(Boolean).join("\n\n");
  userContent.push({ type: "text", text: ask });

  const body = {
    model: modelFor("generate"),
    max_tokens: 16000,
    system: generationSystem({ gradeHint, preferFlashcards }),
    messages: [{ role: "user", content: userContent }],
  };

  let raw = await callJSON(body, { strict: true });
  try {
    return normalizeDoc(parseLooseJSON(raw));
  } catch {
    // one repair pass
    const repair = await callJSON({
      ...body,
      messages: [
        { role: "user", content: userContent },
        { role: "assistant", content: [{ type: "text", text: raw.slice(0, 4000) }] },
        { role: "user", content: [{ type: "text", text: "That wasn't valid JSON. Reply again with ONLY the JSON object." }] },
      ],
    }, { strict: true });
    return normalizeDoc(parseLooseJSON(repair));
  }
}

function normalizeDoc(doc) {
  const questions = (doc.questions || []).map((q) => {
    const out = {
      kind: ["mc", "text", "cloze", "flashcard", "worked"].includes(q.kind) ? q.kind : "text",
      topic: (q.topic || (doc.topics && doc.topics[0]) || "general").toLowerCase(),
      prompt: q.prompt || "",
      explanation: q.explanation,
      rubric: q.rubric,
      steps: q.steps,
      // Carried through for parity with store.addAssignmentDoc — the generator
      // doesn't emit these, but an imported/edited Högskoleprov doc round-trips.
      variant: q.variant,
      figure: q.figure,
      stimulus: q.stimulus,
      // Generated once, here — so the tutor can open with something specific
      // to this question without an API call every time it's shown.
      opener: typeof q.opener === "string" ? q.opener.trim() : undefined,
    };
    if (out.kind === "mc") {
      out.choices = Array.isArray(q.choices) ? q.choices : [];
      out.answer = Number.isInteger(q.answerIndex) ? q.answerIndex
        : Number.isInteger(q.answer) ? q.answer : 0;
    } else {
      out.answer = typeof q.answer === "string" ? q.answer : String(q.answer ?? "");
    }
    return out;
  }).filter((q) => q.prompt && (q.kind !== "mc" || q.choices.length >= 2));

  return {
    title: doc.title || topicTitle(doc),
    subject: doc.subject || "General",
    sourceSummary: doc.sourceSummary || "",
    topics: doc.topics || [...new Set(questions.map((q) => q.topic))],
    questions,
  };
}
function topicTitle(doc) { return (doc.topics && doc.topics[0]) ? cap(doc.topics[0]) : "New assignment"; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------- free-text grading ----------

export async function gradeAnswer({ question, studentAnswer }) {
  const raw = await callJSON({
    model: modelFor("grade"),
    max_tokens: 700,
    system: gradingSystem(),
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: `Question: ${question.prompt}\n\nModel answer: ${question.answer}\n${question.rubric ? `Rubric: ${question.rubric}\n` : ""}\nStudent answer: "${studentAnswer}"\n\nReturn the JSON only.`,
      }],
    }],
  });
  const j = parseLooseJSON(raw);
  return {
    correct: !!j.correct,
    feedback: j.feedback || t(j.correct ? "q.heuristicOk" : "q.heuristicMiss"),
    missedPoints: Array.isArray(j.missedPoints) ? j.missedPoints : [],
  };
}

// ---------- streaming tutor ----------

export async function* tutorStream({ system, messages, signal }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(),
    signal,
    body: JSON.stringify({
      model: modelFor("tutor"),
      max_tokens: 800,
      stream: true,
      system,
      messages,
    }),
  });
  if (!res.ok || !res.body) throw await errorFrom(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
        yield json.delta.text;
      } else if (json.type === "error") {
        throw new ClaudeError(json.error?.message || t("err.network"));
      }
    }
  }
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

export { ClaudeError };
