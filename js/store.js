// Single source of truth. One JSON blob in localStorage behind this module so a
// future cloud/account backend can replace persistence without touching views.

import { uid } from "./lib/dom.js";
import { localDayKey, currentStreak } from "./lib/activity.js";
import { isDue } from "./lib/srs.js";

const KEY = "studybuddy.v1";
const SCHEMA_VERSION = 2;

export const PALETTE = [
  { name: "grape", solid: "#7A5CFF", tint: "#EDE9FF" },
  { name: "ocean", solid: "#1F9FB5", tint: "#E1F4F6" },
  { name: "leaf", solid: "#4C9F55", tint: "#E7F5E7" },
  { name: "tangerine", solid: "#F0913C", tint: "#FDEEDD" },
  { name: "berry", solid: "#E4588A", tint: "#FCE7EF" },
  { name: "sky", solid: "#4C7DF0", tint: "#E6EDFD" },
];

const DEFAULT_SUBJECTS = ["Science", "History", "Math", "English", "Geography"];

export const REVIEW_ID = "__review__";

function seedState() {
  return {
    version: SCHEMA_VERSION,
    settings: { apiKey: "", model: "claude-opus-5", tutorVerbosity: "normal" },
    subjects: DEFAULT_SUBJECTS.map((name, i) => ({
      id: uid(), name, color: PALETTE[i % PALETTE.length].name,
    })),
    assignments: [],
    attempts: [],
    srs: {},
    sessions: {},                    // in-progress sessions, keyed by session key
    activity: { daysStudied: [] },   // streak is derived, never stored
  };
}

// --- migration seam: bump SCHEMA_VERSION and add a block here ---
function migrate(state) {
  if (!state || typeof state !== "object") return seedState();
  const s = state;

  if (!(s.version >= 2)) {
    // v1 stored a streak counter that went stale, and UTC day keys.
    // Keep the day list (it's the real record), drop the derived fields.
    const days = Array.isArray(s.activity?.daysStudied) ? s.activity.daysStudied : [];
    s.activity = { daysStudied: [...new Set(days)].sort() };
    s.sessions = s.sessions || {};
  }

  s.version = SCHEMA_VERSION;
  s.settings = { ...seedState().settings, ...(s.settings || {}) };
  s.srs = s.srs || {};
  s.sessions = s.sessions || {};
  s.attempts = s.attempts || [];
  s.assignments = s.assignments || [];
  return s;
}

class Store extends EventTarget {
  constructor() {
    super();
    this.state = seedState();
  }

  async init() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { this.state = migrate(JSON.parse(raw)); }
      catch { this.state = seedState(); }
      this.save();
    } else {
      this.state = seedState();
      await this._seedSamples();
      this.save();
    }
    this.emit();
  }

  async _seedSamples() {
    try {
      const [a, t] = await Promise.all([
        fetch("data/samples/sample-assignment.json").then((r) => r.json()),
        fetch("data/samples/sample-test.json").then((r) => r.json()),
      ]);
      for (const doc of [a, t]) this.addAssignmentDoc(doc, { silent: true });
    } catch (e) {
      console.warn("Could not seed sample content:", e);
    }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); }
    catch (e) { console.error("Save failed (storage full or blocked):", e); }
  }

  emit() { this.dispatchEvent(new CustomEvent("change")); }

  update(fn) { fn(this.state); this.save(); this.emit(); }

  // ---------- subjects ----------
  get subjects() { return this.state.subjects; }

  subjectColor(subjectId) {
    const s = this.state.subjects.find((x) => x.id === subjectId);
    const p = PALETTE.find((c) => c.name === (s?.color || "grape")) || PALETTE[0];
    return p;
  }

  ensureSubject(name) {
    const clean = (name || "General").trim();
    let s = this.state.subjects.find((x) => x.name.toLowerCase() === clean.toLowerCase());
    if (!s) {
      const used = new Set(this.state.subjects.map((x) => x.color));
      const color = (PALETTE.find((c) => !used.has(c.name)) || PALETTE[this.state.subjects.length % PALETTE.length]).name;
      s = { id: uid(), name: clean, color };
      this.state.subjects.push(s);
    }
    return s;
  }

  // ---------- assignments ----------
  get assignments() { return this.state.assignments; }

  getAssignment(id) { return this.state.assignments.find((a) => a.id === id); }

  /** Find a question anywhere in the library. Lets results and review
   *  sessions work without knowing which set a question came from. */
  findQuestion(questionId) {
    for (const a of this.state.assignments) {
      const q = a.questions.find((x) => x.id === questionId);
      if (q) return { assignment: a, question: q };
    }
    return null;
  }

  /** Every question whose spaced-repetition record says it's due, across all sets. */
  dueQuestions(now = Date.now()) {
    const out = [];
    for (const a of this.state.assignments) {
      for (const q of a.questions) {
        const rec = this.state.srs[q.id];
        if (rec && isDue(rec, now)) out.push({ assignment: a, question: q, rec });
      }
    }
    return out.sort((x, y) => (x.rec?.dueAt || 0) - (y.rec?.dueAt || 0));
  }

  // Accepts a "doc" (sample file or model output): {type,subject,title,questions,...}
  addAssignmentDoc(doc, { silent = false } = {}) {
    const subject = this.ensureSubject(doc.subject);
    const a = {
      id: doc.id && !this.getAssignment(doc.id) ? doc.id : uid(),
      type: doc.type === "test" ? "test" : "assignment",
      subjectId: subject.id,
      title: doc.title || "Untitled",
      sourceSummary: doc.sourceSummary || "",
      createdAt: Date.now(),
      tutorStyle: doc.tutorStyle || "adaptive",
      topics: doc.topics || [...new Set((doc.questions || []).map((q) => q.topic).filter(Boolean))],
      questions: (doc.questions || []).map((q) => ({
        id: q.id || uid(),
        kind: ["mc", "text", "flashcard", "worked"].includes(q.kind) ? q.kind : "text",
        topic: q.topic || (doc.topics && doc.topics[0]) || "general",
        prompt: q.prompt || "",
        choices: q.choices || undefined,
        answer: q.answer,
        rubric: q.rubric || undefined,
        explanation: q.explanation || undefined,
        steps: q.steps || undefined,
      })),
    };
    this.state.assignments.unshift(a);
    if (!silent) { this.save(); this.emit(); }
    return a;
  }

  deleteAssignment(id) {
    this.update((s) => {
      s.assignments = s.assignments.filter((a) => a.id !== id);
      delete s.sessions[id];
    });
  }

  // ---------- in-progress sessions ----------
  getSession(key) { return this.state.sessions[key] || null; }

  saveSession(key, snapshot) {
    this.update((s) => { s.sessions[key] = { ...snapshot, savedAt: Date.now() }; });
  }

  clearSession(key) {
    this.update((s) => { delete s.sessions[key]; });
  }

  // ---------- attempts + progress ----------
  get attempts() { return this.state.attempts; }

  get streak() { return currentStreak(this.state.activity.daysStudied); }

  recordAttempt(attempt) {
    this.update((s) => {
      s.attempts.push(attempt);
      const today = localDayKey();
      if (!s.activity.daysStudied.includes(today)) {
        s.activity.daysStudied.push(today);
        s.activity.daysStudied.sort();
      }
    });
  }

  setSrs(questionId, record) {
    this.update((s) => { s.srs[questionId] = record; });
  }

  // ---------- settings ----------
  get settings() { return this.state.settings; }
  setSettings(patch) { this.update((s) => Object.assign(s.settings, patch)); }
  hasKey() { return !!(this.state.settings.apiKey || "").trim(); }

  // ---------- data management ----------
  exportJSON() { return JSON.stringify(this.state, null, 2); }

  wipe() {
    localStorage.removeItem(KEY);
    this.state = seedState();
    this._seedSamples().then(() => { this.save(); this.emit(); });
  }
}

export const store = new Store();
