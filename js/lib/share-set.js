// Share one set with a friend: package a single assignment as a small JSON
// file they open on their own device. No backend — a plain file that goes
// over AirDrop, a chat, email, whatever. The recipient opens it from the
// Create → Import step, or the "open a shared set" file picker in Settings.

import { store } from "../store.js";
import { downloadText, toast } from "./dom.js";
import { t } from "./i18n.js";

const MARKER = "studybuddy.set";
const FORMAT = 1;

/** A plain, id-free doc for one assignment — the shape addAssignmentDoc()
 *  expects, so importing it re-ids everything and gives the copy its own
 *  spaced-repetition schedule. */
export function setToDoc(a) {
  const subjectName = store.subjects.find((s) => s.id === a.subjectId)?.name || "";
  return {
    type: a.type === "test" ? "test" : "assignment",
    subject: subjectName,
    title: a.title || "",
    sourceSummary: a.sourceSummary || "",
    topics: a.topics || [],
    questions: (a.questions || []).map((q) => ({
      kind: q.kind,
      topic: q.topic,
      prompt: q.prompt,
      choices: q.choices,
      answer: q.answer,
      rubric: q.rubric,
      explanation: q.explanation,
      steps: q.steps,
      opener: q.opener,
    })),
  };
}

function slug(s) {
  return String(s || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "set";
}

/** Offer the set as a downloadable file, and the native share sheet where the
 *  browser supports sharing files. */
export async function shareSet(a) {
  const doc = setToDoc(a);
  const payload = JSON.stringify({ [MARKER]: FORMAT, set: doc }, null, 2);
  const filename = `pluggera-${slug(a.title)}.json`;

  const file = new File([payload], filename, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: a.title, text: t("share.setText", { title: a.title }) });
      return;
    } catch { /* cancelled or unsupported — fall through to a download */ }
  }
  downloadText(filename, payload, "application/json");
  toast(t("share.setDownloaded"));
}

/** Parse text that might be a shared-set file. Returns the doc, or null if it
 *  isn't one (so callers can fall back to card/CSV parsing). Throws only on a
 *  file that IS a shared set but is broken. */
export function parseSharedSet(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return null; }
  if (!obj || typeof obj !== "object" || !(MARKER in obj)) return null;
  const doc = cleanSetDoc(obj.set);
  if (!doc) throw new Error(t("share.setBad"));
  return doc;
}

/** A set doc from outside the app (a shared file, a parent's assignment) reduced to well-formed
 *  fields: text where text belongs, options as text, a right answer that exists. Ids are dropped
 *  (addAssignmentDoc gives new ones). Null when no usable question is left. */
export function cleanSetDoc(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.questions)) return null;
  const s = (v, max = 5000) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
  const questions = doc.questions.filter((q) => q && typeof q === "object" && s(q.prompt).trim()).map((q) => {
    const kind = ["mc", "text", "cloze", "flashcard", "worked"].includes(q.kind) ? q.kind : "text";
    const out = { kind, topic: s(q.topic, 80) || "general", prompt: s(q.prompt) };
    if (kind === "mc") {
      out.choices = (Array.isArray(q.choices) ? q.choices : []).map((c) => s(c, 500));
      out.answer = Number.isInteger(q.answer) && q.answer >= 0 && q.answer < out.choices.length ? q.answer : -1;
    } else {
      out.answer = s(q.answer);
    }
    if (s(q.explanation)) out.explanation = s(q.explanation);
    if (s(q.rubric)) out.rubric = s(q.rubric);
    if (Array.isArray(q.steps)) out.steps = q.steps.map((x) => s(x, 1000)).filter(Boolean);
    return out;
  }).filter((q) => q.kind !== "mc" || (q.choices.length >= 2 && q.answer >= 0));
  if (!questions.length) return null;
  return {
    title: s(doc.title, 120).trim() || t("create.untitledSet"),
    subject: s(doc.subject, 60).trim(),
    type: doc.type === "test" ? "test" : "assignment",
    ...(s(doc.sourceSummary) ? { sourceSummary: s(doc.sourceSummary, 2000) } : {}),
    questions,
  };
}

/** Import a shared-set doc into the student's own library. Returns the saved
 *  assignment. */
export function importSharedSet(doc) {
  const a = store.addAssignmentDoc(doc, { silent: true });
  store.save();
  store.emit();
  return a;
}
