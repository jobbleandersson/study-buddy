// Claude API client — calls the local backend proxy (server/), which holds
// the actual Claude API key. The browser never sees it.

import { store } from "./store.js";
import { generationSystem, gradingSystem } from "./prompts.js";
import { PROXY_URL } from "./config.js";

const API_URL = PROXY_URL;

/**
 * Model choice is a preset, not a single model: the three jobs have very
 * different requirements. Writing a question set is worth the best model
 * (once per set); grading a one-line answer is not (many times per session).
 */
export const PRESETS = {
  balanced: {
    label: "Balanced — recommended",
    hint: "Best model writes your questions; a lighter one marks answers. Good quality, much lower cost.",
    generate: "claude-opus-5", tutor: "claude-sonnet-5", grade: "claude-haiku-4-5",
  },
  best: {
    label: "Best quality",
    hint: "Claude Opus 5 for everything. The strongest tutoring, and the most expensive.",
    generate: "claude-opus-5", tutor: "claude-opus-5", grade: "claude-opus-5",
  },
  cheapest: {
    label: "Lowest cost",
    hint: "Fast and cheap throughout. Fine for drilling facts; weaker at explaining hard ideas.",
    generate: "claude-sonnet-5", tutor: "claude-haiku-4-5", grade: "claude-haiku-4-5",
  },
};

export const DEFAULT_PRESET = "balanced";

function headers() {
  return { "content-type": "application/json" };
}

/** task: "generate" | "tutor" | "grade" */
export function modelFor(task) {
  const preset = PRESETS[store.settings.preset] || PRESETS[DEFAULT_PRESET];
  return preset[task] || PRESETS[DEFAULT_PRESET][task];
}

class ClaudeError extends Error {}

async function callJSON(body) {
  let res;
  try {
    res = await fetch(API_URL, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  } catch (e) {
    throw new ClaudeError("Network error — check your connection.");
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    if (res.status === 500 && /ANTHROPIC_API_KEY/.test(detail)) throw new ClaudeError("The tutor server isn't configured with a Claude key. Contact whoever's running this instance.");
    if (res.status === 429) throw new ClaudeError("Rate limited by the API — wait a moment and try again.");
    throw new ClaudeError(`API error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const data = await res.json();
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

export async function generateAssignment({ material, topic, image, count = 6, gradeHint = "", preferFlashcards = false }) {
  const userContent = [];
  if (image) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  const ask = [
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

  let raw = await callJSON(body);
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
    });
    return normalizeDoc(parseLooseJSON(repair));
  }
}

function normalizeDoc(doc) {
  const questions = (doc.questions || []).map((q) => {
    const out = {
      kind: ["mc", "text", "flashcard", "worked"].includes(q.kind) ? q.kind : "text",
      topic: (q.topic || (doc.topics && doc.topics[0]) || "general").toLowerCase(),
      prompt: q.prompt || "",
      explanation: q.explanation,
      rubric: q.rubric,
      steps: q.steps,
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
    feedback: j.feedback || (j.correct ? "Nice work!" : "Not quite — take another look."),
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
  if (!res.ok || !res.body) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    throw new ClaudeError(res.status === 500 && /ANTHROPIC_API_KEY/.test(detail)
      ? "The tutor server isn't configured with a Claude key. Contact whoever's running this instance."
      : `Tutor unavailable (API ${res.status}${detail ? `: ${detail}` : ""}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
      }
    }
  }
}

export { ClaudeError };
