// "Make me a set" from the AI chat. The assistant first asks what the set should be about, then ends
// its reply with one machine-readable line:
//
//   [[MAKE_SET {"title":"…","subject":"…","topic":"…","focus":"…","level":"…","count":8,"flashcards":false,"fromNotes":false}]]
//
// The page hides that line and shows a "Create the set" card instead; nothing is generated until the
// student taps it. This module is the pure half - parsing the line, clamping what the model wrote (it
// is model output, and a pasted text can try to steer it), and turning it into the arguments of
// generateAssignment(). No DOM, store or i18n, so it can be unit-tested.

export const COUNT_MIN = 3;
export const COUNT_MAX = 15;
export const COUNT_DEFAULT = 8;
/** Notes the model asked us to build the set from, as pasted into the chat: only a real passage counts. */
const NOTES_MIN_CHARS = 200;
const NOTES_MAX_CHARS = 8000;

const MARKER = /\[\[MAKE_SET\s*(\{[\s\S]*?\})\s*\]\]/;
// A marker still being streamed: "[[MAKE_SET {..." that has not closed yet, or just its first letters
// ("[[", "[[MA", "[[MAKE_"). Anything else that happens to start with "[[" (a matrix, a citation) is
// ordinary text and is left alone.
const OPEN_MARKER = /\s*\[\[MAKE_SET[\s\S]*$|\s*\[\[(?:M(?:A(?:K(?:E(?:_(?:S(?:E(?:T)?)?)?)?)?)?)?)?$/;

const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** What the model wrote, made safe: strings capped, the count clamped, flags real booleans.
 *  null when there is nothing to build a set from (no title and no topic). */
export function normalizeBrief(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const topic = str(raw.topic, 300);
  const title = str(raw.title, 60);
  if (!topic && !title) return null;
  const n = raw.count == null || raw.count === "" ? NaN : Math.round(Number(raw.count));
  const brief = {
    title: title || topic.slice(0, 60),
    subject: str(raw.subject, 40),
    topic: topic || title,
    focus: str(raw.focus, 300),
    level: str(raw.level, 40),
    count: Number.isFinite(n) ? Math.min(COUNT_MAX, Math.max(COUNT_MIN, n)) : COUNT_DEFAULT,
    flashcards: raw.flashcards === true,
    fromNotes: raw.fromNotes === true,
  };
  const setId = str(raw.setId, 60);
  if (setId) brief.setId = setId;
  // The day of the test the set is for, when the student said it: offered as "add the test" on the card.
  const testDate = str(raw.testDate, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(testDate)) brief.testDate = testDate;
  return brief;
}

/** A reply split into what the student reads and the set the assistant proposes (or null). A marker
 *  that is still arriving, or one that is not valid JSON, is hidden rather than shown as raw text. */
export function extractSetBrief(raw) {
  const src = String(raw ?? "");
  const m = src.match(MARKER);
  if (m) {
    let brief = null;
    try { brief = normalizeBrief(JSON.parse(m[1])); } catch { /* unreadable: just hide it */ }
    return { text: src.replace(MARKER, "").trim(), brief };
  }
  return { text: src.replace(OPEN_MARKER, "").trim(), brief: null };
}

/** The same reply with the created set's id written into its marker, so a saved chat that is opened
 *  again shows "created" rather than offering to make the set a second time. */
export function withSetId(raw, setId) {
  const src = String(raw ?? "");
  const m = src.match(MARKER);
  if (!m) return src;
  let obj;
  try { obj = JSON.parse(m[1]); } catch { return src; }
  return src.replace(MARKER, () => `[[MAKE_SET ${JSON.stringify({ ...obj, setId })}]]`);
}

/** The text the set should be built from, or "": the material attached to the chat, else - when the
 *  assistant said the set is from the student's own notes - the longest passage they pasted. */
export function pickMaterial({ brief, material = null, messages = [] }) {
  if (material?.text) return String(material.text).slice(0, NOTES_MAX_CHARS);
  if (!brief?.fromNotes) return "";
  let best = "";
  for (const m of messages || []) {
    if (m?.role !== "user") continue;
    const text = typeof m.content === "string"
      ? m.content
      : (Array.isArray(m.content) ? m.content.filter((p) => p?.type === "text").map((p) => p.text).join("\n") : "");
    if (text.length > best.length) best = text;
  }
  return best.length >= NOTES_MIN_CHARS ? best.slice(0, NOTES_MAX_CHARS) : "";
}

/** Arguments for generateAssignment(): the topic carries the title and any extra wish. */
export function generationParams(brief, material = "") {
  const topic = [
    brief.topic,
    brief.title && brief.title !== brief.topic ? `Working title: ${brief.title}` : "",
    brief.focus ? `What the student asked for: ${brief.focus}` : "",
    brief.subject ? `School subject: ${brief.subject}` : "",
  ].filter(Boolean).join("\n");
  return {
    material: material || "",
    topic,
    count: brief.count,
    gradeHint: brief.level,
    preferFlashcards: brief.flashcards,
  };
}
