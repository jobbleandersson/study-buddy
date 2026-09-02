// Single source of truth. One JSON blob in localStorage behind this module so a
// future cloud/account backend can replace persistence without touching views.

import { uid } from "./lib/dom.js";
import { localDayKey, currentStreak } from "./lib/activity.js";
import { findQuestion as findQuestionPure, dueQuestions as dueQuestionsPure } from "./lib/library.js";
import { PROXY_HEALTH_URL, AUTH_SIGNUP_URL, AUTH_LOGIN_URL, AUTH_LOGOUT_URL, AUTH_ME_URL, STATE_URL } from "./config.js";

const KEY = "studybuddy.v1";
const SCHEMA_VERSION = 5;
// Separate, unmigrated key: the last state_blobs version this browser is
// known to be in sync with. Kept outside the main blob (and outside
// SCHEMA_VERSION) because it's sync bookkeeping, not app data — but it must
// still survive a page reload, unlike an in-memory field, or every reload
// would reset it to 0 and desync from the server's real version, turning
// every reload into a spurious conflict that clobbers local edits.
const SYNC_VERSION_KEY = "studybuddy.syncVersion";

/** The bundled demo sets. They are no longer seeded automatically — they live
 *  in Settings under "Demo content" so a real library starts clean. */
export const SAMPLE_FILES = [
  { id: "sample-photosynthesis", file: "data/samples/sample-assignment.json" },
  { id: "sample-rome", file: "data/samples/sample-test.json" },
];

// `ink` is the text-safe variant: >= 4.5:1 against both white and its own tint.
// `solid` is for fills and borders, where 3:1 is the bar.
export const PALETTE = [
  { name: "grape", solid: "#7A5CFF", ink: "#6B51E0", tint: "#EDE9FF" },
  { name: "ocean", solid: "#1F9FB5", ink: "#177788", tint: "#E1F4F6" },
  { name: "leaf", solid: "#4C9F55", ink: "#3B7A41", tint: "#E7F5E7" },
  { name: "tangerine", solid: "#F0913C", ink: "#9C5E27", tint: "#FDEEDD" },
  { name: "berry", solid: "#E4588A", ink: "#B0446A", tint: "#FCE7EF" },
  { name: "sky", solid: "#4C7DF0", ink: "#3E67C5", tint: "#E6EDFD" },
];

const DEFAULT_SUBJECTS = ["Science", "History", "Math", "English", "Geography"];

export const REVIEW_ID = "__review__";
export const PRACTICE_ID = "__practice__";
// Per-subject, unlike the two above — several subjects can each have their
// own in-progress "mix all years" session at once.
export const NATIONAL_MIX_PREFIX = "__npmix__";
export const nationalMixId = (subjectId) => `${NATIONAL_MIX_PREFIX}${subjectId}`;

function seedState() {
  return {
    version: SCHEMA_VERSION,
    settings: { preset: "balanced", tutorVerbosity: "normal" },
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

  if (!(s.version >= 3)) {
    // Demo sets moved out of the library. Only remove ones the user never
    // touched — anything they've actually studied is their data now, and they
    // can delete it themselves from the card menu.
    const sampleIds = new Set(SAMPLE_FILES.map((x) => x.id));
    const touched = new Set((s.attempts || []).map((a) => a.assignmentId));
    for (const id of Object.keys(s.sessions || {})) touched.add(id);
    s.assignments = (s.assignments || []).filter((a) => !sampleIds.has(a.id) || touched.has(a.id));
  }

  if (!(s.version >= 4)) {
    // One model for every job became a per-task preset. Anyone who had left
    // the default gets "balanced"; an explicit Opus choice maps to "best".
    const old = s.settings?.model;
    s.settings = s.settings || {};
    s.settings.preset = old === "claude-haiku-4-5" ? "cheapest"
      : old === "claude-sonnet-5" ? "balanced"
      : "balanced";
    delete s.settings.model;
  }

  if (!(s.version >= 5)) {
    // The API key moved server-side (backend proxy) — Settings no longer has
    // a key field, and any key a user had pasted in is stale/unused now.
    delete s.settings?.apiKey;
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
    // Backend proxy status — not app data, so it lives on the instance
    // rather than in this.state (must not enter the synced blob or bump
    // SCHEMA_VERSION). "up" tracks reachability alone, separate from
    // "keyConfigured" so Settings can tell the two failure modes apart.
    this.proxyUp = false;
    this.proxyKeyConfigured = false;

    // Auth/sync status — also instance-only, not synced app data. Sign-in is
    // opt-in: local-only mode (authed === false) works exactly as before.
    this.authed = false;
    this.authEmail = null;
    // The state_blobs version this device last synced against. Read from
    // localStorage (not just defaulted to 0) so it survives a page reload —
    // see SYNC_VERSION_KEY above.
    this._syncVersion = Number(localStorage.getItem(SYNC_VERSION_KEY)) || 0;
    this._pushTimer = null;
  }

  _setSyncVersion(v) {
    this._syncVersion = v;
    try { localStorage.setItem(SYNC_VERSION_KEY, String(v)); } catch {}
  }

  async init() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { this.state = migrate(JSON.parse(raw)); }
      catch { this.state = seedState(); }
    } else {
      this.state = seedState();
    }
    this.save({ skipPush: true });

    try {
      const res = await fetch(PROXY_HEALTH_URL);
      const data = res.ok ? await res.json() : null;
      this.proxyUp = !!data?.ok;
      this.proxyKeyConfigured = !!data?.keyConfigured;
    } catch {
      this.proxyUp = false;
      this.proxyKeyConfigured = false;
    }

    if (this.proxyUp) {
      try {
        const res = await fetch(AUTH_ME_URL, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          this.authed = true;
          this.authEmail = data.email;
        }
      } catch { /* not signed in / server unreachable — stay local-only */ }
    }

    this.emit();
  }

  // ---------- demo content (Settings → Demo content) ----------
  /** {loaded, total} — the demo sets can be partially present, e.g. after
   *  deleting one of them, so callers need the count, not a boolean. */
  get demoStatus() {
    const loaded = SAMPLE_FILES.filter(({ id }) => !!this.getAssignment(id)).length;
    return { loaded, total: SAMPLE_FILES.length };
  }

  async loadDemoContent() {
    const docs = await Promise.all(SAMPLE_FILES.map(({ file }) =>
      fetch(file).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${file}`);
        return r.json();
      })));
    let added = 0;
    for (const doc of docs) {
      if (this.getAssignment(doc.id)) continue;
      this.addAssignmentDoc(doc, { silent: true });
      added++;
    }
    this.save();
    this.emit();
    return added;
  }

  removeDemoContent() {
    const ids = new Set(SAMPLE_FILES.map((x) => x.id));
    this.update((s) => {
      s.assignments = s.assignments.filter((a) => !ids.has(a.id));
      for (const id of ids) delete s.sessions[id];
    });
  }

  save({ skipPush = false } = {}) {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); }
    catch (e) { console.error("Save failed (storage full or blocked):", e); }
    // Local write is always synchronous and unconditional — this is just the
    // additive, debounced background half. Every existing save()/update()
    // call site keeps working exactly as before, authed or not.
    if (!skipPush && this.authed) this._schedulePush();
  }

  emit() { this.dispatchEvent(new CustomEvent("change")); }

  update(fn) { fn(this.state); this.save(); this.emit(); }

  // ---------- subjects ----------
  get subjects() { return this.state.subjects; }

  /**
   * A subject's colours as CSS variable *references*, not literal hex, so the
   * cards follow the active theme. Hard-coded hex here would keep the light
   * palette in dark mode.
   */
  subjectColor(subjectId) {
    const s = this.state.subjects.find((x) => x.id === subjectId);
    const p = PALETTE.find((c) => c.name === (s?.color || "grape")) || PALETTE[0];
    return {
      name: p.name,
      solid: `var(--c-${p.name})`,
      ink: `var(--c-${p.name}-ink)`,
      tint: `var(--c-${p.name}-tint)`,
      hex: p,           // literal values, for anywhere that needs a real colour
    };
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
  findQuestion(questionId) { return findQuestionPure(this.state.assignments, questionId); }

  /** Every question whose spaced-repetition record says it's due, across all sets. */
  dueQuestions(now = Date.now()) { return dueQuestionsPure(this.state.assignments, this.state.srs, now); }

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
        opener: q.opener || undefined,
      })),
    };
    this.state.assignments.unshift(a);
    if (!silent) { this.save(); this.emit(); }
    return a;
  }

  updateAssignment(id, patch) {
    this.update((s) => {
      const a = s.assignments.find((x) => x.id === id);
      if (!a) return;
      Object.assign(a, patch);
      if (patch.questions) {
        a.topics = [...new Set(patch.questions.map((q) => q.topic).filter(Boolean))];
      }
    });
  }

  /** Copy a set. The copy gets fresh question ids so it keeps its own
   *  spaced-repetition schedule rather than sharing the original's. */
  duplicateAssignment(id) {
    const a = this.getAssignment(id);
    if (!a) return null;
    const copy = {
      ...structuredClone(a),
      id: uid(),
      title: nextCopyTitle(a.title, this.state.assignments.map((x) => x.title)),
      createdAt: Date.now(),
      questions: a.questions.map((q) => ({ ...structuredClone(q), id: uid() })),
    };
    this.update((s) => { s.assignments.unshift(copy); });
    return copy;
  }

  deleteAssignment(id) {
    this.update((s) => {
      const a = s.assignments.find((x) => x.id === id);
      s.assignments = s.assignments.filter((x) => x.id !== id);
      delete s.sessions[id];
      // Drop review scheduling for questions that no longer exist.
      for (const q of a?.questions || []) delete s.srs[q.id];
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
  /** Whether live mode is available — i.e. the backend proxy is reachable
   *  and has a Claude key configured. Was "did the user paste a key" before
   *  the key moved server-side; callers didn't need to change. */
  hasKey() { return this.proxyUp && this.proxyKeyConfigured; }

  // ---------- account + sync ----------
  // Sign-in is opt-in: local-only mode keeps working unchanged when signed
  // out. Local writes stay the offline cache (save() → localStorage,
  // synchronous, unconditional); signing in adds a debounced background push
  // to server/ on top, plus a one-time pull on login. Conflicts use
  // last-write-wins: a stale push gets the server's current blob back and
  // adopts it, surfacing a "syncConflict" event rather than clobbering it.

  async signup(email, password) {
    const res = await fetch(AUTH_SIGNUP_URL, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || "Could not create an account.");
    this.authed = true;
    this.authEmail = data.email;
    this._setSyncVersion(0);
    await this._pushNow(); // this device's local data becomes the account's data
    this.emit();
  }

  async login(email, password) {
    const res = await fetch(AUTH_LOGIN_URL, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || "Could not sign in.");
    this.authed = true;
    this.authEmail = data.email;
    await this._pullOnLogin();
    this.emit();
  }

  async logout() {
    try { await fetch(AUTH_LOGOUT_URL, { method: "POST", credentials: "include" }); } catch {}
    this.authed = false;
    this.authEmail = null;
    clearTimeout(this._pushTimer);
    this.emit();
  }

  async _pullOnLogin() {
    let res;
    try { res = await fetch(STATE_URL, { credentials: "include" }); }
    catch { return; } // offline — keep local state, next save() will retry the push once reachable
    if (!res.ok) return;
    const { version, blob } = await res.json();
    if (blob) {
      this.state = migrate(blob);
      this._setSyncVersion(version);
      this.save({ skipPush: true });
    } else {
      // Existing account with nothing synced yet — seed it from this device.
      await this._pushNow();
    }
  }

  _schedulePush() {
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this._pushNow(), 800);
  }

  async _pushNow() {
    let res;
    try {
      res = await fetch(STATE_URL, {
        method: "PUT", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: this._syncVersion, blob: this.state }),
      });
    } catch { return; } // offline/unreachable — the next save() will try again

    if (res.status === 409) {
      const { version, blob } = await res.json();
      if (blob) {
        this.state = migrate(blob);
        this._setSyncVersion(version);
        this.save({ skipPush: true });
        this.emit();
      }
      this.dispatchEvent(new CustomEvent("syncConflict"));
      return;
    }
    if (res.ok) {
      const data = await res.json();
      this._setSyncVersion(data.version);
    }
  }

  // ---------- data management ----------
  exportJSON() { return JSON.stringify(this.state, null, 2); }

  wipe() {
    localStorage.removeItem(KEY);
    this.state = seedState();
    this.save();
    this.emit();
  }
}

/** "Rome Quiz" -> "Rome Quiz (copy)" -> "Rome Quiz (copy 2)" */
function nextCopyTitle(title, existing) {
  const base = title.replace(/\s*\(copy( \d+)?\)$/, "");
  let candidate = `${base} (copy)`;
  let n = 2;
  while (existing.includes(candidate)) candidate = `${base} (copy ${n++})`;
  return candidate;
}

export const store = new Store();
