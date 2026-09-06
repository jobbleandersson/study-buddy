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
  const filename = `studybuddy-${slug(a.title)}.json`;

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
  const doc = obj.set;
  if (!doc || !Array.isArray(doc.questions) || !doc.questions.length) {
    throw new Error(t("share.setBad"));
  }
  return doc;
}

/** Import a shared-set doc into the student's own library. Returns the saved
 *  assignment. */
export function importSharedSet(doc) {
  const a = store.addAssignmentDoc(doc, { silent: true });
  store.save();
  store.emit();
  return a;
}
