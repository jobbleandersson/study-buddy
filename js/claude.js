// Claude API client — calls the local backend proxy (server/), which holds
// the actual Claude API key. The browser never sees it.

import { store } from "./store.js";
import { generationSystem, gradingSystem, workedGradingSystem, clozeGradingSystem, checkWorkSystem, podcastSystem } from "./prompts.js";
import { t } from "./lib/i18n.js";
import { PROXY_URL } from "./config.js";
import { parseLooseJSON } from "./lib/loose-json.js";
import { normalizeCheck } from "./lib/check.js";
import { parseScript } from "./lib/podcast.js";
import { shuffleMc } from "./lib/choices.js";

const API_URL = PROXY_URL;

/**
 * One fixed model per job — not a user choice. The jobs have very different
 * requirements: writing a question set is worth a stronger model, because
 * the result is saved and reused by every student who studies that set
 * afterward, not just once. Tutoring and grading (Solve included — it's a
 * tutoring conversation, not a one-shot lookup) are forgotten the moment
 * they're done, so they run on the fast, cheap model. Checking a photo of
 * handwritten working is the exception among the throwaway jobs: it has to read
 * handwriting and re-do the maths line by line, and telling a student a correct
 * line is wrong costs more trust than the price difference saves.
 */
export const MODELS = {
  generate: "claude-sonnet-5",
  tutor: "claude-haiku-4-5",
  grade: "claude-haiku-4-5",
  check: "claude-sonnet-5",
};

function headers() {
  return { "content-type": "application/json" };
}

/** task: "generate" | "tutor" | "grade" | "check" | "solve" */
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

  if (code === "daily_cap") return new ClaudeError(t("err.dailyCap"));   // the server's daily spend cap: off until tomorrow, not "shortly"
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

/** One non-streaming call: the reply text plus what Anthropic says it used. */
async function callRaw(body, { strict = false } = {}) {
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
  return { text: data.content?.map((b) => b.text || "").join("") || "", usage: data.usage || null };
}

async function callJSON(body, opts) {
  return (await callRaw(body, opts)).text;
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
  // More questions for an existing set stay in ITS kinds: a history set that never had a worked
  // (step-by-step) problem must not get one, and a maths set keeps its mix.
  const moreKinds = moreLike ? [...new Set((moreLike.questions || []).map((q) => q?.kind).filter(Boolean))] : [];
  const ask = moreLike
    ? [
        `Here is an existing question set titled "${moreLike.title}" (subject: ${moreLike.subject}).`,
        `Existing questions (JSON):\n"""\n${JSON.stringify(moreLike.questions, null, 1)}\n"""`,
        moreKinds.length ? `Use ONLY these question kinds, in roughly the same mix as the existing questions: ${moreKinds.join(", ")}. Do not use any other kind.` : null,
        `Write about ${count} MORE questions in the same style, difficulty and topics. Do NOT repeat or lightly reword any existing question. Return the JSON object only — its "questions" array holds only the new questions.`,
      ].filter(Boolean).join("\n\n")
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

// Model output is checked field by field: a number where text belongs, a missing list or a null
// question must not throw half-way (or slip through and break the set later).
const txt = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
function normalizeDoc(doc) {
  doc = doc && typeof doc === "object" ? doc : {};
  const docTopics = Array.isArray(doc.topics) ? doc.topics.map(txt).filter(Boolean) : null;
  const questions = (Array.isArray(doc.questions) ? doc.questions : []).filter((q) => q && typeof q === "object").map((q) => {
    const out = {
      kind: ["mc", "text", "cloze", "flashcard", "worked"].includes(q.kind) ? q.kind : "text",
      topic: (txt(q.topic) || (docTopics && docTopics[0]) || "general").toLowerCase(),
      prompt: txt(q.prompt),
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
      out.choices = Array.isArray(q.choices) ? q.choices.map(txt) : [];
      let answer = Number.isInteger(q.answerIndex) ? q.answerIndex
        : Number.isInteger(q.answer) ? q.answer : 0;
      // An index past the options (a model counting from 1, say): find the right one by its text if
      // the answer was written out, otherwise the question can't be trusted and is dropped below.
      if (!(answer >= 0 && answer < out.choices.length)) {
        answer = typeof q.answer === "string" ? out.choices.findIndex((c) => c.trim() === q.answer.trim()) : -1;
      }
      out.answer = answer;
      if (answer < 0) return out;
      // The model tends to write the correct option first, whatever the prompt says, so the order is
      // randomised here, in code, rather than left to a request it can ignore.
      Object.assign(out, shuffleMc({ choices: out.choices, answer: out.answer }));
    } else {
      out.answer = typeof q.answer === "string" ? q.answer : String(q.answer ?? "");
    }
    return out;
  }).filter((q) => q.prompt && (q.kind !== "mc" || (q.choices.length >= 2 && q.answer >= 0)));

  const topics = docTopics || [...new Set(questions.map((q) => q.topic))];
  return {
    title: txt(doc.title) || topicTitle(docTopics),
    subject: txt(doc.subject) || t("common.general"),
    // The prompt asks for a real summary and calls it out as easy to skip
    // (see generationSystem in prompts.js), but a model instruction is never
    // a guarantee — this still needs a real fallback, not just a better ask.
    // Topics as a plain list, not a fake sentence: honest about being a
    // fallback rather than passing off derived data as the model's own prose.
    sourceSummary: doc.sourceSummary || (topics.length ? cap(topics.join(", ")) : ""),
    topics,
    questions,
  };
}
function topicTitle(topics) { return topics && topics[0] ? cap(topics[0]) : t("create.untitledSet"); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------- free-text grading ----------

export async function gradeAnswer({ question, studentAnswer }) {
  const raw = await callJSON({
    model: modelFor("grade"),
    max_tokens: 900,
    system: gradingSystem(),
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: `${question.topic ? `Topic: ${question.topic}\n` : ""}Question: ${question.prompt}\n\nModel answer: ${question.answer}\n${question.rubric ? `Rubric: ${question.rubric}\n` : ""}\nStudent answer: "${studentAnswer}"\n\nReturn the JSON only.`,
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

/** The AI judges fill-in-the-blank answers that did not match exactly. `blanks` is
 *  [{ n, accepted: string[], given }] (1-based n). Resolves [{ n, verdict: "ok"|"close"|"wrong", note }]. */
export async function gradeCloze({ question, blanks }) {
  const raw = await callJSON({
    model: modelFor("grade"),
    max_tokens: 800,
    system: clozeGradingSystem(),
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: `${question.topic ? `Topic: ${question.topic}\n` : ""}Sentence: ${question.prompt}\n\nBlanks to judge:\n${blanks.map((b) => `${b.n}) accepted: ${b.accepted.join(" / ")}; the student wrote: "${b.given}"`).join("\n")}\n\nReturn the JSON only.`,
      }],
    }],
  });
  const j = parseLooseJSON(raw);
  const list = Array.isArray(j.blanks) ? j.blanks : [];
  return blanks.map((b) => {
    const r = list.find((x) => Number(x?.n) === b.n) || {};
    return {
      n: b.n,
      verdict: ["ok", "close", "wrong"].includes(r.verdict) ? r.verdict : "wrong",
      note: typeof r.note === "string" ? r.note.trim() : "",
    };
  });
}

/** The AI judges a student's written working for a worked problem (nobody asks the student whether
 *  it was right). Resolves { level: "nailed" | "roughly" | "missed", correct, feedback, missedPoints };
 *  `correct` is true unless the level is "missed". Throws if the model can't be reached. */
export async function gradeWorking({ question, working }) {
  const steps = Array.isArray(question.steps) && question.steps.length
    ? `\nKey steps of the model solution:\n${question.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "";
  const raw = await callJSON({
    model: modelFor("grade"),
    max_tokens: 1000,
    system: workedGradingSystem(),
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: `${question.topic ? `Topic: ${question.topic}\n` : ""}Problem: ${question.prompt}\n\nModel solution (final answer): ${question.answer}${steps}\n${question.rubric ? `Rubric: ${question.rubric}\n` : ""}\nStudent's working:\n"""\n${working}\n"""\n\nReturn the JSON only.`,
      }],
    }],
  });
  const j = parseLooseJSON(raw);
  const level = ["nailed", "roughly", "missed"].includes(j.level) ? j.level : (j.correct ? "roughly" : "missed");
  return {
    level,
    correct: level !== "missed",
    feedback: j.feedback || t(level === "missed" ? "q.heuristicMiss" : "q.heuristicOk"),
    missedPoints: Array.isArray(j.missedPoints) ? j.missedPoints : [],
  };
}

// ---------- check my working ----------

const tokensOf = (u) => (u ? (u.input_tokens || 0) + (u.output_tokens || 0) : 0);

/**
 * Look over a student's written working and find the first line that doesn't
 * follow. `image` is a photo of it ({ mediaType, data }); `workingText` is the
 * same working typed line by line (used to re-check after the student fixes how
 * a line was read — no photo needed then). `problem` is optional either way.
 * Resolves the cleaned result from normalizeCheck() plus `tokens` (what the
 * call used, so the screen can say what it cost).
 */
export async function checkWorking({ image = null, problem = "", workingText = "" }) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  const parts = [];
  if (problem.trim()) parts.push(`The problem, as the student gave it:\n"""\n${problem.trim()}\n"""`);
  if (workingText.trim()) parts.push(`The student's working, one line per step (typed, so there is no photo):\n"""\n${workingText.trim()}\n"""`);
  else if (image) parts.push("Check the working in the attached photo.");
  parts.push("Return the JSON object only.");
  content.push({ type: "text", text: parts.join("\n\n") });

  const body = {
    model: modelFor("check"),
    max_tokens: 2500,
    system: checkWorkSystem(),
    messages: [{ role: "user", content }],
  };

  const first = await callRaw(body);
  let tokens = tokensOf(first.usage);
  let json;
  try {
    json = parseLooseJSON(first.text);
  } catch {
    // One cheap repair pass: hand the model its own reply back, without the photo.
    const repair = await callRaw({
      ...body,
      max_tokens: 2500,
      messages: [{ role: "user", content: [{ type: "text", text: `Return this as ONLY a valid JSON object in the shape described in your instructions — no other text:\n\n${first.text.slice(0, 6000)}` }] }],
    });
    tokens += tokensOf(repair.usage);
    try { json = parseLooseJSON(repair.text); }
    catch { throw new ClaudeError(t("check.err.parse")); }
  }
  return { ...normalizeCheck(json), tokens };
}

// ---------- listen-as-conversation ----------

/** A two-person spoken-style script about the material, ready for parseScript()'s { title, lines } shape. */
export async function generateTalkScript({ material }) {
  const { text } = await callRaw({
    model: modelFor("tutor"),
    max_tokens: 2200,
    system: podcastSystem(),
    messages: [{ role: "user", content: [{ type: "text", text: `Material:\n${material.text}\n\nWrite the conversation now.` }] }],
  }, { strict: true });
  try { return parseScript(parseLooseJSON(text)); }
  catch { throw new ClaudeError(t("talk.err")); }
}

// ---------- streaming tutor ----------

/** Known upstream mid-stream error types, mapped to an already-translated message — the raw Anthropic
 *  text (e.g. "Overloaded") is English and not something to show a student. Falls through to the raw
 *  message only for a type this doesn't recognise. */
const STREAM_ERROR_KEYS = { overloaded_error: "err.upstream", rate_limit_error: "err.rateLimited" };

export async function* tutorStream({ system, messages, signal, maxTokens = 800, onStop } = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: headers(),
    signal,
    body: JSON.stringify({
      model: modelFor("tutor"),
      max_tokens: maxTokens,
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
      } else if (json.type === "message_delta" && json.delta?.stop_reason) {
        onStop?.(json.delta.stop_reason);
      } else if (json.type === "error") {
        const key = STREAM_ERROR_KEYS[json.error?.type];
        throw new ClaudeError(key ? t(key) : json.error?.message || t("err.network"));
      }
    }
  }
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

export { ClaudeError };
