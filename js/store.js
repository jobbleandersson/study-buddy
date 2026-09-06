// Single source of truth. One JSON blob in localStorage behind this module so a
// future cloud/account backend can replace persistence without touching views.

import { uid } from "./lib/dom.js";
import { localDayKey, currentStreak, addDays, studiedToday } from "./lib/activity.js";
import { getLang, t } from "./lib/i18n.js";
import { ACHIEVEMENTS, achievementMetrics } from "./lib/achievements.js";
import { findQuestion as findQuestionPure, dueQuestions as dueQuestionsPure } from "./lib/library.js";
import { loadLibraryIndex, loadLibraryTranslations, englishFile } from "./lib/library-content.js";
import { PROXY_HEALTH_URL, AUTH_SIGNUP_URL, AUTH_LOGIN_URL, AUTH_LOGOUT_URL, AUTH_ME_URL, STATE_URL } from "./config.js";

const KEY = "studybuddy.v1";
const SCHEMA_VERSION = 7;

/** A streak freeze is earned at every 7-day milestone and you can bank two. */
const FREEZE_STEP = 7;
const FREEZE_CAP = 2;

/** How long an overdue date lingers before it clears itself, so a missed
 *  deadline stays visible for a while but old ones don't pile up forever. */
export const DUE_GRACE_DAYS = 7;

// Separate, unmigrated key: the last state_blobs version this browser is
// known to be in sync with. Kept outside the main blob (and outside
// SCHEMA_VERSION) because it's sync bookkeeping, not app data — but it must
// still survive a page reload, unlike an in-memory field, or every reload
// would reset it to 0 and desync from the server's real version, turning
// every reload into a spurious conflict that clobbers local edits.
const SYNC_VERSION_KEY = "studybuddy.syncVersion";

// Rescue copy of a main blob that failed to parse at boot — its own key,
// unmigrated, outside SCHEMA_VERSION, so init()'s fallback to seedState()
// doesn't destroy the only copy of whatever was actually there.
const RECOVERY_KEY = "studybuddy.v1.recovery";

/** The bundled demo sets. They are no longer seeded automatically — they live
 *  in Settings under "Demo content" so a real library starts clean.
 *  `files` is per language; an unsupported language falls back to English. */
export const SAMPLE_FILES = [
  {
    id: "sample-photosynthesis",
    files: {
      en: "data/samples/sample-assignment.json",
      sv: "data/samples/sample-assignment.sv.json",
    },
  },
  {
    id: "sample-rome",
    files: {
      en: "data/samples/sample-test.json",
      sv: "data/samples/sample-test.sv.json",
    },
  },
];

function sampleFileFor(entry, lang = getLang()) {
  return entry.files[lang] || entry.files.en;
}

const SAMPLE_IDS = new Set(SAMPLE_FILES.map((x) => x.id));

/** Does a stored set's wording still match a bundle doc verbatim (same ids,
 *  same prompts)? Tells an untouched library import apart from one the
 *  student has reworded — the latter shouldn't be auto-re-translated. */
function bundleMatches(a, doc) {
  const d = doc.questions || [];
  if (a.questions.length !== d.length) return false;
  const byId = new Map(d.map((x) => [x.id, x]));
  return a.questions.every((x) => byId.get(x.id)?.prompt === x.prompt);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// `ink` is the text-safe variant: >= 4.5:1 against both white and its own tint.
// `solid` is for fills and borders, where 3:1 is the bar.
export const PALETTE = [
  { name: "grape", solid: "#7A5CFF", ink: "#6B51E0", tint: "#EDE9FF" },
  { name: "ocean", solid: "#1F9FB5", ink: "#177788", tint: "#E1F4F6" },
  { name: "leaf", solid: "#4C9F55", ink: "#3B7A41", tint: "#E7F5E7" },
  { name: "tangerine", solid: "#F0913C", ink: "#9C5E27", tint: "#FDEEDD" },
  { name: "berry", solid: "#E4588A", ink: "#B0446A", tint: "#FCE7EF" },
  { name: "sky", solid: "#3AA4E6", ink: "#2076A8", tint: "#E4F1FB" },
];

const DEFAULT_SUBJECTS = ["Science", "History", "Math", "English", "Geography"];

export const REVIEW_ID = "__review__";
export const PRACTICE_ID = "__practice__";
export const WEAK_ID = "__weak__";
// Per-subject, unlike the three above — several subjects can each have their
// own in-progress "mix all years" session at once.
export const NATIONAL_MIX_PREFIX = "__npmix__";
export const nationalMixId = (subjectId) => `${NATIONAL_MIX_PREFIX}${subjectId}`;

function seedState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      preset: "balanced", tutorVerbosity: "normal", sound: true, dailyGoal: 10,
      testHints: 2,        // tutor questions allowed during a test; 0 = tutor off
      adaptive: true,      // let a practice session react to how it's going
      pomodoro: "off",     // "off" | "25" | "50" focus timer in a session
      font: "system",      // "system" | "hyperlegible"
      textSize: "m",       // "s" | "m" | "l"
      voice: false,        // read tutor replies aloud (speechSynthesis)
    },
    subjects: DEFAULT_SUBJECTS.map((name, i) => ({
      id: uid(), name, color: PALETTE[i % PALETTE.length].name,
    })),
    assignments: [],
    attempts: [],
    srs: {},
    sessions: {},                    // in-progress sessions, keyed by session key
    onboarded: false,                // has the first-run walkthrough been seen?
    achievements: {},                // { id: unlockedAt } — 0 = "already true when shipped"
    readNotifications: {},           // { [notificationId]: signature } — see buildNotifications() in main.js
    activity: {
      daysStudied: [],               // the real record; the streak is derived from it
      frozenDays: [],                // days a freeze covered — count as studied
      freezes: 0,                    // banked, 0..FREEZE_CAP
      freezeMark: 0,                 // highest 7-multiple streak already rewarded
      bestStreak: 0,                 // longest streak ever, for a "personal best" line
      goalDays: [],                  // day keys where the daily goal was reached
      recapWeek: null,               // ISO "YYYY-Www" of the last recap card dismissed
    },
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
    // Due dates arrive. Nothing to convert — existing sets simply have none.
    for (const a of s.assignments || []) if (!("dueAt" in a)) a.dueAt = null;
  }

  if (!(s.version >= 6)) {
    // The API key moved server-side (backend proxy) — Settings no longer has
    // a key field, and any key a user had pasted in is stale/unused now.
    if (s.settings) delete s.settings.apiKey;
  }

  if (!(s.version >= 7)) {
    // Streak freezes + achievements arrive. Existing streak history is kept as
    // is; start earning freezes from the *next* 7-day milestone rather than
    // handing out a full bank retroactively. Badges already earned get
    // recorded silently by store.init()'s first check.
    s.achievements = s.achievements || {};
    const days = Array.isArray(s.activity?.daysStudied) ? s.activity.daysStudied : [];
    s.activity = {
      daysStudied: days,
      frozenDays: [],
      freezes: 0,
      freezeMark: Math.floor(currentStreak(days) / FREEZE_STEP) * FREEZE_STEP,
      bestStreak: currentStreak(days),
    };
  }

  s.version = SCHEMA_VERSION;
  s.settings = { ...seedState().settings, ...(s.settings || {}) };
  s.activity = { ...seedState().activity, ...(s.activity || {}) };
  s.achievements = s.achievements || {};
  s.readNotifications = s.readNotifications || {};

  // Achievements moved from ~15 one-off badges to 5 tiered tracks plus a few
  // kept milestones. Carry the old unlocks that have a direct equivalent so an
  // earned badge isn't silently lost; everything else re-evaluates on the next
  // _checkAchievements() pass (silently, so no retroactive toast storm).
  // Idempotent — the new ids just no-op on a second run.
  {
    const remap = {
      "streak-3": "streak-bronze", "streak-7": "streak-silver",
      "streak-30": "streak-gold", "streak-100": "streak-platinum",
      "q-50": "questions-bronze", "q-250": "questions-silver", "q-1000": "questions-gold",
      "subj-3": "subjects-3", "subj-5": "subjects-5", "all-60": "well-rounded",
    };
    for (const [oldId, newId] of Object.entries(remap)) {
      if (oldId in s.achievements) {
        if (!(newId in s.achievements)) s.achievements[newId] = s.achievements[oldId] || 0;
        delete s.achievements[oldId];
      }
    }
    // Drop any remaining legacy ids that have no home in the new model.
    const known = new Set(ACHIEVEMENTS.map((d) => d.id));
    for (const id of Object.keys(s.achievements)) {
      if (!known.has(id)) delete s.achievements[id];
    }
  }
  // Existing users have already "onboarded" by virtue of having data — only a
  // genuinely fresh seedState() starts with onboarded: false.
  s.onboarded = s.onboarded ?? ((s.assignments || []).length > 0 || (s.attempts || []).length > 0);
  s.srs = s.srs || {};
  s.sessions = s.sessions || {};
  s.attempts = s.attempts || [];
  s.assignments = s.assignments || [];

  // Merge subjects duplicated by name (a demo set's subject could get recreated
  // after a language swap left the original renamed). Keep the first, repoint
  // every assignment on the others. Idempotent — safe to run on every load.
  if (Array.isArray(s.subjects) && s.subjects.length) {
    const seen = new Map();       // lowercased name -> kept subject
    const remap = new Map();      // dropped id -> kept id
    const kept = [];
    for (const subj of s.subjects) {
      const key = (subj.name || "").trim().toLowerCase();
      const first = seen.get(key);
      if (first) remap.set(subj.id, first.id);
      else { seen.set(key, subj); kept.push(subj); }
    }
    if (remap.size) {
      s.subjects = kept;
      for (const a of s.assignments) {
        if (remap.has(a.subjectId)) a.subjectId = remap.get(a.subjectId);
      }
    }

    // Drop subjects nothing uses — the English starter list and any orphan left
    // behind by a demo. A pinned subject (the user named it deliberately) and
    // one with sets both stay. ensureSubject() recreates any other on demand.
    const used = new Set(s.assignments.map((a) => a.subjectId));
    if (s.subjects.some((x) => !used.has(x.id) && !x.pinned)) {
      s.subjects = s.subjects.filter((x) => used.has(x.id) || x.pinned);
    }
  }

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

    // Set when a save() write fails (full quota, blocked storage) — instance
    // only, so a UI listener can show/hide a persistent warning without this
    // ever entering the synced blob.
    this._saveFailed = false;
  }

  _setSyncVersion(v) {
    this._syncVersion = v;
    try { localStorage.setItem(SYNC_VERSION_KEY, String(v)); } catch {}
  }

  async init() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { this.state = migrate(JSON.parse(raw)); }
      catch (e) {
        console.error("Corrupt save data, falling back to a fresh start:", e);
        // Preserve the original bytes before overwriting them below — the
        // corruption could itself be quota-related, hence its own try/catch.
        try { localStorage.setItem(RECOVERY_KEY, raw); } catch {}
        this.state = seedState();
      }
    } else {
      this.state = seedState();
    }
    this._sweepStaleDueDates();
    this._reconcileStreak({ silent: true, mutating: this.state });
    this._checkAchievements({ silent: true, mutating: this.state });
    this._updateAppBadge();
    this.save({ skipPush: true });

    // On GitHub Pages (or any other purely static host) there's no server/
    // behind this, so this would 404 on every single load — which the
    // browser logs to the console as a resource-load failure regardless of
    // how gracefully the catch below handles it. `api/health` at the repo
    // root is a static stand-in for exactly that case (ok:false,
    // keyConfigured:false — same shape as server/src/routes/health.js,
    // same as this call already assumes when unreachable). It never shadows
    // the real endpoint: server/src/index.js registers the Express health
    // route before it falls back to serving static files, so a real
    // server/ deployment always answers first.
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

  /** A deadline that passed more than DUE_GRACE_DAYS ago clears itself, so the
   *  Upcoming list shows what still matters rather than every date ever set. */
  _sweepStaleDueDates() {
    const cutoff = addDays(localDayKey(), -DUE_GRACE_DAYS);
    for (const a of this.state.assignments) {
      if (a.dueAt && a.dueAt < cutoff) a.dueAt = null;
    }
  }

  // ---------- demo content (Settings → Demo content) ----------
  /** {loaded, total} — the demo sets can be partially present, e.g. after
   *  deleting one of them, so callers need the count, not a boolean. */
  get demoStatus() {
    const loaded = SAMPLE_FILES.filter(({ id }) => !!this.getAssignment(id)).length;
    return { loaded, total: SAMPLE_FILES.length };
  }

  /** Loads the demo sets in the language that's active right now. Once loaded
   *  they track the app language automatically — see syncDemoLanguage(). */
  async loadDemoContent() {
    const lang = getLang();
    const docs = await Promise.all(SAMPLE_FILES.map((entry) => {
      const file = sampleFileFor(entry);
      return fetch(file).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${file}`);
        return r.json();
      });
    }));
    let added = 0;
    for (const doc of docs) {
      if (this.getAssignment(doc.id)) continue;
      const a = this.addAssignmentDoc(doc, { silent: true });
      a._sampleLang = lang;
      added++;
    }
    this.save();
    this.emit();
    return added;
  }

  /** Add one bundled sample set to the library (used by the gallery). Returns
   *  the assignment, or the existing one if it's already there. */
  async loadSample(id) {
    const entry = SAMPLE_FILES.find((e) => e.id === id);
    if (!entry) return null;
    const existing = this.getAssignment(id);
    if (existing) return existing;
    const doc = await fetch(sampleFileFor(entry)).then((r) => r.json());
    const a = this.addAssignmentDoc(doc, { silent: true });
    a._sampleLang = getLang();
    this.save();
    this.emit();
    return a;
  }

  /** True once the first-run walkthrough has been seen or skipped. */
  markOnboarded() {
    if (this.state.onboarded) return;
    this.update((s) => { s.onboarded = true; });
  }

  /** Demo sets are examples, not the student's own content, so they follow the
   *  UI language. Re-translates any bundled demo set in the library whose
   *  question ids still match the bundle (i.e. the student hasn't restructured
   *  it); question ids are stable across languages, so attempts, SRS records
   *  and per-topic mastery all carry over. Fires "change" if anything moved. */
  async syncDemoLanguage() {
    const lang = getLang();
    let changed = 0, tagged = 0;

    for (const entry of SAMPLE_FILES) {
      const a = this.getAssignment(entry.id);
      if (!a || a._sampleLang === lang) continue;

      let doc = null;
      try {
        const res = await fetch(sampleFileFor(entry, lang));
        if (res.ok) doc = await res.json();
      } catch { /* offline — try again next time */ }
      if (!doc) continue;

      const have = a.questions.map((q) => q.id).sort().join("|");
      const want = (doc.questions || []).map((q) => q.id).sort().join("|");
      // Structurally edited, or already in the target language: just remember
      // the language so we stop re-checking it.
      if (have !== want || a.title === doc.title) { a._sampleLang = lang; tagged++; continue; }

      const t = a;
      const byId = new Map((doc.questions || []).map((q) => [q.id, q]));
      t.title = doc.title;
      t.sourceSummary = doc.sourceSummary || "";
      t.topics = doc.topics || t.topics;
      t.questions = t.questions.map((q) => {
        const d = byId.get(q.id) || {};
        return {
          ...q,
          prompt: d.prompt ?? q.prompt,
          choices: d.choices,
          answer: d.answer,
          rubric: d.rubric,
          explanation: d.explanation,
          steps: d.steps,
          opener: d.opener,
          topic: d.topic || q.topic,
        };
      });
      // Keep history keyed on the new topic strings so mastery stays continuous.
      const topicById = new Map(t.questions.map((q) => [q.id, q.topic]));
      for (const att of this.state.attempts) {
        for (const it of att.items || []) {
          if (topicById.has(it.questionId)) it.topic = topicById.get(it.questionId);
        }
      }
      // Translate the subject name in place (same id → mastery-by-subject
      // intact) only when nothing but demo sets use it.
      const subj = this.state.subjects.find((x) => x.id === t.subjectId);
      if (subj && subj.name !== doc.subject &&
          this.state.assignments.every((x) => x.subjectId !== subj.id || SAMPLE_IDS.has(x.id))) {
        subj.name = doc.subject;
      }
      t._sampleLang = lang;
      changed++;
    }

    // Demo content is fully reconstructible from the bundle + language, so it
    // doesn't need a sync push of its own — the next real change carries it.
    if (changed || tagged) this.save({ skipPush: true });
    if (changed) this.emit();
    return changed;
  }

  /** Practice-library sets follow the UI language the same way demo sets do.
   *  The library ships Swedish content with an English overlay (see
   *  lib/library-content.js); a set imported from it is tagged _libLang, and
   *  on a language switch this re-fetches it in the new language and swaps the
   *  wording in place — keyed by question id, so attempts, SRS records and
   *  per-topic mastery all carry over.
   *
   *  A set with a library id but no _libLang was imported before tagging
   *  existed (the library was Swedish-only then) — it's adopted here, but only
   *  after checking its stored wording still matches the Swedish bundle. If it
   *  doesn't (the student reworded it) — or if question ids no longer match —
   *  it's marked "custom" and never touched again. Like demo content it's
   *  reconstructible from the bundle, so no sync push of its own. */
  async syncLibraryLanguage() {
    const lang = getLang();

    // Fast path: nothing from the library is present, so there's nothing to do
    // and no reason to fetch the index.
    if (!this.state.assignments.some((a) => a._libLang || /^lib-/.test(a.id))) return 0;

    let index, tr;
    try {
      index = await loadLibraryIndex();
      tr = await loadLibraryTranslations();
    } catch { return 0; } // index not reachable/cached — try again next time
    const entryById = new Map(index.sets.map((s) => [s.id, s]));

    const targets = this.state.assignments.filter((a) => {
      if (a._sampleLang) return false;             // a demo set — syncDemoLanguage's job
      if (a._libLang === "custom") return false;   // the student's own now
      if (!a._libLang && !entryById.has(a.id)) return false;
      return (a._libLang || "sv") !== lang;        // untagged sets count as Swedish
    });
    if (!targets.length) return 0;

    let changed = 0;
    for (const a of targets) {
      const entry = entryById.get(a.id);
      if (!entry) { a._libLang = "custom"; continue; } // unknown library id — leave it

      // Adopt an untagged set only if it still is the Swedish bundle verbatim.
      if (!a._libLang) {
        let svDoc = null;
        try { const r = await fetch(entry.file); if (r.ok) svDoc = await r.json(); }
        catch { /* offline */ }
        if (!svDoc) continue;                                   // try again next time
        if (!bundleMatches(a, svDoc)) { a._libLang = "custom"; continue; }
        a._libLang = "sv";
      }
      if (a._libLang === lang) continue;

      let doc = null;
      try {
        const primary = lang === "en" ? englishFile(entry.file) : entry.file;
        let res = await fetch(primary);
        if (!res.ok && primary !== entry.file) res = await fetch(entry.file);
        if (res.ok) doc = await res.json();
      } catch { /* offline — try again next time */ }
      if (!doc) continue;

      const have = a.questions.map((q) => q.id).sort().join("|");
      const want = (doc.questions || []).map((q) => q.id).sort().join("|");
      if (have !== want) { a._libLang = "custom"; continue; } // restructured — theirs now

      const byId = new Map((doc.questions || []).map((q) => [q.id, q]));
      a.title = doc.title || a.title;
      a.sourceSummary = doc.sourceSummary || "";
      a.topics = doc.topics || a.topics;
      a.questions = a.questions.map((q) => {
        const d = byId.get(q.id) || {};
        return {
          ...q,
          prompt: d.prompt ?? q.prompt,
          choices: d.choices,
          answer: d.answer,
          rubric: d.rubric,
          explanation: d.explanation,
          steps: d.steps,
          opener: d.opener,
          topic: d.topic || q.topic,
        };
      });
      // Keep attempt history keyed on the new topic strings so mastery stays continuous.
      const topicById = new Map(a.questions.map((q) => [q.id, q.topic]));
      for (const att of this.state.attempts) {
        for (const it of att.items || []) {
          if (topicById.has(it.questionId)) it.topic = topicById.get(it.questionId);
        }
      }
      // The set files keep "subject" in Swedish (so import-matching lands in
      // the same bucket regardless of language) — the English name comes from
      // the index overlay. Rename the student's subject in place, same id, so
      // mastery-by-subject stays intact — only when nothing but library sets
      // use it.
      const targetName = lang === "en" ? tr.subjects[entry.subject]?.name : (doc.subject || null);
      const subj = this.state.subjects.find((x) => x.id === a.subjectId);
      if (targetName && subj && subj.name !== targetName &&
          this.state.assignments.every((x) => x.subjectId !== subj.id || x._libLang)) {
        subj.name = targetName;
      }
      a._libLang = lang;
      changed++;
    }

    if (changed) { this.save({ skipPush: true }); this.emit(); }
    return changed;
  }

  removeDemoContent() {
    const ids = new Set(SAMPLE_FILES.map((x) => x.id));
    this.update((s) => {
      s.assignments = s.assignments.filter((a) => !ids.has(a.id));
      for (const id of ids) delete s.sessions[id];
    });
  }

  save({ skipPush = false } = {}) {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
      if (this._saveFailed) { this._saveFailed = false; this.dispatchEvent(new CustomEvent("saveRecovered")); }
    } catch (e) {
      console.error("Save failed (storage full or blocked):", e);
      // Only dispatch on the first failure in a streak — a broken write
      // shouldn't fire an event on every keystroke/answer while it stays broken.
      if (!this._saveFailed) { this._saveFailed = true; this.dispatchEvent(new CustomEvent("saveFailed", { detail: e })); }
    }
    // Local write is always synchronous and unconditional — this is just the
    // additive, debounced background half. Every existing save()/update()
    // call site keeps working exactly as before, authed or not.
    if (!skipPush && this.authed) this._schedulePush();
  }

  emit() {
    this._updateAppBadge();
    this.dispatchEvent(new CustomEvent("change"));
  }

  /** Show the count of questions due for review on the installed-app icon.
   *  Progressive enhancement — silently absent on browsers without the API. */
  _updateAppBadge() {
    try {
      if (!("setAppBadge" in navigator)) return;
      const n = this.dueQuestions().length;
      if (n > 0) navigator.setAppBadge(n);
      else navigator.clearAppBadge?.();
    } catch { /* not installed / not permitted — fine */ }
  }

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

  /** Add a subject the user named deliberately (from the home menu). `pinned`
   *  keeps it around even with no sets yet — migrate() won't prune it. */
  addSubject(name) {
    const clean = (name || "").trim();
    if (!clean) return null;
    let created = null;
    this.update((s) => {
      let x = s.subjects.find((y) => y.name.toLowerCase() === clean.toLowerCase());
      if (!x) {
        const used = new Set(s.subjects.map((y) => y.color));
        const color = (PALETTE.find((c) => !used.has(c.name)) || PALETTE[s.subjects.length % PALETTE.length]).name;
        x = { id: uid(), name: clean, color };
        s.subjects.push(x);
      }
      x.pinned = true;
      created = x;
    });
    return created;
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
      dueAt: DAY_RE.test(doc.dueAt || "") ? doc.dueAt : null,
      tutorStyle: doc.tutorStyle || "adaptive",
      topics: doc.topics || [...new Set((doc.questions || []).map((q) => q.topic).filter(Boolean))],
      questions: (doc.questions || []).map((q) => ({
        id: q.id || uid(),
        kind: ["mc", "text", "cloze", "flashcard", "worked"].includes(q.kind) ? q.kind : "text",
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
      // Editing a demo or library set's wording or title makes it the
      // student's own — stop auto-translating it (see syncDemoLanguage /
      // syncLibraryLanguage).
      if ("questions" in patch || "title" in patch) {
        delete a._sampleLang;
        delete a._libLang;
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
    delete copy._sampleLang;   // a copy is the student's own, in its current language
    delete copy._libLang;
    this.update((s) => { s.assignments.unshift(copy); });
    return copy;
  }

  /** Removes the set and its review scheduling; attempt history is kept.
   *  Returns { assignment, srs } so the caller can offer an undo. */
  deleteAssignment(id) {
    let snapshot = null;
    this.update((s) => {
      const a = s.assignments.find((x) => x.id === id);
      if (!a) return;
      const srs = {};
      for (const q of a.questions || []) {
        if (s.srs[q.id]) { srs[q.id] = s.srs[q.id]; delete s.srs[q.id]; }
      }
      snapshot = { assignment: a, srs };
      s.assignments = s.assignments.filter((x) => x.id !== id);
      delete s.sessions[id];
    });
    return snapshot;
  }

  /** Puts back a set removed by deleteAssignment(), scheduling included. */
  restoreAssignment(snapshot) {
    if (!snapshot?.assignment) return;
    this.update((s) => {
      if (s.assignments.some((x) => x.id === snapshot.assignment.id)) return;
      s.assignments.unshift(snapshot.assignment);
      Object.assign(s.srs, snapshot.srs || {});
    });
  }

  // ---------- due dates ----------
  /** dayKey is "YYYY-MM-DD", or null to clear. Rejects anything else. */
  setDueDate(id, dayKey) {
    const value = dayKey && DAY_RE.test(dayKey) ? dayKey : null;
    if (dayKey && !value) return false;
    this.update((s) => {
      const a = s.assignments.find((x) => x.id === id);
      if (a) a.dueAt = value;
    });
    return true;
  }

  /** Sets with a deadline, soonest first. Stale ones were swept at init. */
  upcomingDue() {
    return this.state.assignments
      .filter((a) => !!a.dueAt)
      .sort((x, y) => x.dueAt.localeCompare(y.dueAt));
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

  get streak() {
    const a = this.state.activity;
    return currentStreak(a.daysStudied, a.frozenDays);
  }

  /** Everything the streak UI needs, including the "protected but not yet
   *  spent" state so the number never visibly drops to 0 while a freeze can
   *  still save it. */
  get streakInfo() {
    const a = this.state.activity;
    const today = localDayKey();
    const y = addDays(today, -1);
    const y2 = addDays(today, -2);
    const counts = (d) => a.daysStudied.includes(d) || a.frozenDays.includes(d);
    const streak = currentStreak(a.daysStudied, a.frozenDays, today);
    const atRisk = !studiedToday(a.daysStudied, today) && !counts(y) && counts(y2) && a.freezes > 0;
    const displayStreak = atRisk
      ? currentStreak(a.daysStudied, [...a.frozenDays, y], today)
      : streak;
    return {
      streak, displayStreak, atRisk,
      freezes: a.freezes,
      freezeMark: a.freezeMark,
      bestStreak: Math.max(a.bestStreak || 0, streak),
      nextFreezeIn: a.freezes < FREEZE_CAP ? a.freezeMark + FREEZE_STEP - streak : null,
    };
  }

  /** Marks today as a daily-goal day. Returns true only the first time it's
   *  called for a given day (so the caller can celebrate once). */
  markGoalReached() {
    const today = localDayKey();
    if (this.state.activity.goalDays.includes(today)) return false;
    const unlocked = [];
    this.update((s) => {
      s.activity.goalDays.push(today);
      s.activity.goalDays.sort();
      // keep it bounded — only the last few months matter for any streak
      if (s.activity.goalDays.length > 400) s.activity.goalDays = s.activity.goalDays.slice(-400);
      unlocked.push(...this._checkAchievements({ silent: false, mutating: s }));
    });
    if (unlocked.length) this.dispatchEvent(new CustomEvent("achievements", { detail: unlocked }));
    return true;
  }

  /** The user closed this week's recap card — don't show it again until next week. */
  dismissRecap(weekKey) {
    this.update((s) => { s.activity.recapWeek = weekKey; });
  }

  recordAttempt(attempt) {
    let freezeUsed = false;
    const unlocked = [];
    this.update((s) => {
      s.attempts.push(attempt);
      const today = localDayKey();
      if (!s.activity.daysStudied.includes(today)) {
        s.activity.daysStudied.push(today);
        s.activity.daysStudied.sort();
      }
      freezeUsed = this._reconcileStreak({ silent: false, mutating: s });
      unlocked.push(...this._checkAchievements({ silent: false, mutating: s }));
    });
    if (freezeUsed) {
      this.dispatchEvent(new CustomEvent("streakFreezeUsed", { detail: { streak: this.streak } }));
    }
    if (unlocked.length) {
      this.dispatchEvent(new CustomEvent("achievements", { detail: unlocked }));
    }
  }

  /** Spend a freeze when — and only when — it saves the streak: studied today,
   *  missed exactly yesterday, and the run was still alive the day before.
   *  Then earn one at every 7-day milestone up to the cap. A freeze is never
   *  spent on a gap it can't bridge, so it never silently evaporates.
   *  Returns true if a freeze was just spent (and not the silent init pass). */
  _reconcileStreak({ silent = false, mutating } = {}) {
    let spent = false;
    const run = (s) => {
      const a = s.activity;
      const today = localDayKey();
      const y = addDays(today, -1);
      const y2 = addDays(today, -2);
      const counts = (d) => a.daysStudied.includes(d) || a.frozenDays.includes(d);

      if (a.freezes > 0 && a.daysStudied.includes(today) && !counts(y) && counts(y2)) {
        a.frozenDays.push(y);
        a.frozenDays.sort();
        a.freezes--;
        spent = true;
      }

      const streak = currentStreak(a.daysStudied, a.frozenDays, today);
      a.bestStreak = Math.max(a.bestStreak || 0, streak);
      // Only reset progress-to-next-freeze when the run is *truly* gone — not
      // while a banked freeze could still bridge yesterday's gap.
      const recoverable = !counts(y) && counts(y2) && a.freezes > 0;
      if (streak === 0 && !recoverable) a.freezeMark = 0;
      while (streak >= a.freezeMark + FREEZE_STEP && a.freezes < FREEZE_CAP) {
        a.freezes++;
        a.freezeMark += FREEZE_STEP;
      }
    };
    if (mutating) run(mutating);
    else this.update(run);
    return spent && !silent;
  }

  get unlockedAchievements() { return this.state.achievements; }

  /** Evaluate every badge (tiered tracks + one-off milestones) against current
   *  state, permanently recording (with a timestamp) any newly met. Returns
   *  the newly-unlocked defs so a caller can celebrate them — empty during the
   *  silent init pass, which just backfills what's already true. */
  _checkAchievements({ silent = false, mutating } = {}) {
    const unlocked = [];
    const run = (s) => {
      let metrics;
      try { metrics = achievementMetrics(s); } catch { return; }
      for (const def of ACHIEVEMENTS) {
        if (def.id in s.achievements) continue;
        let value;
        try { value = def.track ? (metrics[def.track] ?? 0) : def.value(s); } catch { value = 0; }
        if (value < def.target) continue;
        s.achievements[def.id] = silent ? 0 : Date.now();
        if (!silent) unlocked.push(def);
      }
    };
    if (mutating) run(mutating);
    else this.update(run);
    return unlocked;
  }

  // ---------- topbar notifications ----------
  // The two live notification types (due-for-review, upcoming test) are
  // computed on the fly from other state rather than stored as events, so
  // "read" is tracked against a snapshot of the fact that fired them (the due
  // count, or the test id + date + day-count). If that fact changes — more
  // questions pile up, the test gets a day closer — it reads as unread again;
  // unchanged, it stays read across reloads.
  isNotificationRead(id, signature) {
    return this.state.readNotifications[id] === signature;
  }

  // save(), not update(): this must persist without emitting "change", which
  // triggers a full re-render on the home/progress routes — and that closes
  // every open popover, yanking the notification panel shut mid-interaction.
  markNotificationRead(id, signature) {
    this.state.readNotifications[id] = signature;
    this.save();
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
    if (!res.ok) throw new Error(data?.error?.message || t("login.signupFailed"));
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
    if (!res.ok) throw new Error(data?.error?.message || t("login.loginFailed"));
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

  /** Reuses the exact migrate() the normal boot path already trusts — no new
   *  validation logic. Throws on bad JSON so the caller can show an inline
   *  error; does not touch SCHEMA_VERSION. */
  importJSON(text) {
    const parsed = JSON.parse(text);
    this.state = migrate(parsed);
    this.save();
    this.emit();
  }

  get recoveryBlob() {
    try { return localStorage.getItem(RECOVERY_KEY); } catch { return null; }
  }
  clearRecoveryBlob() {
    try { localStorage.removeItem(RECOVERY_KEY); } catch {}
  }

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
