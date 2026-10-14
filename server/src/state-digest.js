// A small summary of each student's synced state, kept next to it (state_blobs.digest).
//
// The class results page and the friends leaderboard need a few numbers out of other people's states:
// when and how many questions were answered, the days studied, a profile picture, and how each question
// was last answered. Reading those out of the whole saved state (up to 10 MB of JSON per person) on
// every request made one page view cost as much as the whole class's data: a class of 200 meant
// parsing hundreds of megabytes in the one process that also serves everyone else. So the summary is
// worked out once, when the state is saved (routes/state.js, from the body it has already parsed), and
// the pages read that instead. A row saved before this existed gets its summary on first read.
//
// Only what those two pages show is kept: never the questions, answers' text, chats or anything else.

import { db } from "./db.js";

/** Bump when the shape below changes: older rows are then rebuilt from their state on next read. */
export const DIGEST_VERSION = 2;

// A profile picture (js/components/avatar-editor.js) travels inside each person's synced state. That
// blob is whatever the client PUT, so before a picture goes out to a friend it is checked against the
// same shape and size cap as js/store.js (AVATAR_RE / AVATAR_MAX) — anything else is dropped, never
// forwarded to other people's browsers.
const AVATAR_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX = 200_000;
export function avatarFrom(blob) {
  const a = blob?.avatar;
  return typeof a === "string" && a.length <= AVATAR_MAX && AVATAR_RE.test(a) ? a : null;
}

// The first name a student typed on their profile (js/components/onboarding.js cleanName) is what friends
// and a class teacher see instead of an email address. It is whatever the client PUT, so it is cut down
// here to the same rule the app uses: letters, marks, spaces, apostrophes and hyphens, 24 characters.
export function nameFrom(blob) {
  const n = blob?.profile?.name;
  if (typeof n !== "string") return null;
  const clean = n.replace(/[^\p{L}\p{M}\s'’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
  return clean || null;
}

/** "jonas.berg@school.se" -> "j•••@school.se": enough for a person to recognise their own pupil, not
 *  enough to write to them. Used when a student has set no name. */
export function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "?";
  return `${[...local][0]}•••@${domain}`;
}

const arr = (x) => (Array.isArray(x) ? x : []);
const strings = (x) => arr(x).filter((d) => typeof d === "string");

/**
 * The summary of one state (null or anything unreadable summarises as nothing done).
 *   attempts: [[finishedAt, answersGiven], ...]   for "questions answered this week"
 *   days, frozen: the study days and streak-freeze days, as the state wrote them
 *   answers: { questionId: [at, 1|0] }            how each question was last answered (1 = first try right)
 */
export function digestOf(blob) {
  const state = blob && typeof blob === "object" ? blob : null;
  const attempts = [];
  const latest = new Map();   // a Map while building: a question id like "__proto__" must stay data
  for (const attempt of arr(state?.attempts)) {
    const at = Number(attempt?.finishedAt) || 0;
    const items = arr(attempt?.items);
    attempts.push([at, items.length]);
    for (const item of items) {
      const id = item?.questionId;
      if (typeof id !== "string") continue;
      const ok = item.firstTry ?? !!item.correct;
      const prev = latest.get(id);
      if (!prev || at >= prev[0]) latest.set(id, [at, ok ? 1 : 0]);
    }
  }
  return {
    v: DIGEST_VERSION,
    avatar: avatarFrom(state),
    name: nameFrom(state),
    attempts,
    days: strings(state?.activity?.daysStudied),
    frozen: strings(state?.activity?.frozenDays),
    answers: Object.fromEntries(latest),
  };
}

const rowStmt = db.prepare("SELECT version, digest FROM state_blobs WHERE user_id = ?");
const blobStmt = db.prepare("SELECT blob FROM state_blobs WHERE user_id = ? AND version = ?");
const saveStmt = db.prepare("UPDATE state_blobs SET digest = ? WHERE user_id = ? AND version = ?");

/** The summary of a user's saved state, or null if they have never synced. */
export function readDigest(userId) {
  const row = rowStmt.get(userId);
  if (!row) return null;
  if (row.digest) {
    try {
      const d = JSON.parse(row.digest);
      if (d?.v === DIGEST_VERSION) return d;
    } catch { /* rebuilt below */ }
  }
  let blob = null;
  try { blob = JSON.parse(blobStmt.get(userId, row.version)?.blob ?? "null"); } catch { /* unreadable: nothing done */ }
  const digest = digestOf(blob);
  // Only if the state hasn't moved on meanwhile (a save carries its own summary).
  saveStmt.run(JSON.stringify(digest), userId, row.version);
  return digest;
}

const emailStmt = db.prepare("SELECT email FROM users WHERE id = ?");

/** What other people see for these accounts: the profile first name, else the email masked. Never the
 *  address itself. First names are not unique, so two accounts with the same label (in one list: a class,
 *  a leaderboard) get the masked address added, and if even that is the same, a number: the person who
 *  removes "Anna" from a class must be able to tell which one they mean.
 *  `digests` (userId -> digest) saves reading again what the caller has already read. Returns Map userId -> label. */
export function displayNames(userIds, digests = new Map()) {
  const masks = new Map();
  const labels = new Map();
  for (const id of userIds) {
    const mask = maskEmail(emailStmt.get(id)?.email);
    const digest = digests.has(id) ? digests.get(id) : readDigest(id);
    masks.set(id, mask);
    labels.set(id, digest?.name || mask);
  }
  const count = (m) => { const c = new Map(); for (const l of m.values()) c.set(l.toLowerCase(), (c.get(l.toLowerCase()) || 0) + 1); return c; };
  let dup = count(labels);
  for (const [id, label] of labels) {
    if (dup.get(label.toLowerCase()) > 1 && label !== masks.get(id)) labels.set(id, `${label} (${masks.get(id)})`);
  }
  dup = count(labels);
  const nth = new Map();
  for (const id of [...userIds].sort()) {
    const key = labels.get(id).toLowerCase();
    if (dup.get(key) > 1) { const n = (nth.get(key) || 0) + 1; nth.set(key, n); if (n > 1) labels.set(id, `${labels.get(id)} #${n}`); }
  }
  return labels;
}
