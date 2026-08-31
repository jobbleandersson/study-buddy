// Single source of truth. One JSON blob in localStorage behind this module so a
// future cloud/account backend can replace persistence without touching views.

import { uid } from "./lib/dom.js";

const KEY = "studybuddy.v1";
const SCHEMA_VERSION = 1;

export const PALETTE = [
  { name: "grape", solid: "#7A5CFF", tint: "#EDE9FF" },
  { name: "ocean", solid: "#1F9FB5", tint: "#E1F4F6" },
  { name: "leaf", solid: "#4C9F55", tint: "#E7F5E7" },
  { name: "tangerine", solid: "#F0913C", tint: "#FDEEDD" },
  { name: "berry", solid: "#E4588A", tint: "#FCE7EF" },
  { name: "sky", solid: "#4C7DF0", tint: "#E6EDFD" },
];

const DEFAULT_SUBJECTS = ["Science", "History", "Math", "English", "Geography"];

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
    activity: { streakCount: 0, lastStudyDay: null, daysStudied: [] },
  };
}

// --- migration seam: bump SCHEMA_VERSION and add cases here ---
function migrate(state) {
  if (!state || typeof state !== "object") return seedState();
  let s = state;
  // if (s.version < 2) { ...transform...; s.version = 2; }
  s.version = SCHEMA_VERSION;
  return s;
}

class Store extends EventTarget {
  constructor() {
    super();
    this.state = seedState();
    this._loaded = false;
  }

  async init() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { this.state = migrate(JSON.parse(raw)); }
      catch { this.state = seedState(); }
    } else {
      this.state = seedState();
      await this._seedSamples();
      this.save();
    }
    this._loaded = true;
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
    this.update((s) => { s.assignments = s.assignments.filter((a) => a.id !== id); });
  }

  // ---------- attempts + progress ----------
  get attempts() { return this.state.attempts; }

  recordAttempt(attempt) {
    this.update((s) => {
      s.attempts.push(attempt);
      // activity / streak
      const today = new Date().toISOString().slice(0, 10);
      if (!s.activity.daysStudied.includes(today)) {
        s.activity.daysStudied.push(today);
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        s.activity.streakCount = s.activity.lastStudyDay === y || s.activity.lastStudyDay === today
          ? (s.activity.streakCount || 0) + 1 : 1;
        s.activity.lastStudyDay = today;
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
