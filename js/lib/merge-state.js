// Merging two copies of a student's saved data — the server's and this device's — when they have
// drifted apart (a sync conflict, signing in on a device that has its own work, a phone that was
// offline). Kept free of the store and the DOM so it can be unit-tested (test/lib/merge-state.test.mjs).

/** How long a "this session was finished / thrown away" mark is kept. A copy of the session older
 *  than its mark can't come back from another device in that time; after it, the mark is dropped. */
const CLEARED_KEEP_MS = 30 * 86400000;

/** How long a "deleted on a device" mark (state.deleted: id -> when) is kept, and the most marks kept.
 *  A device that has been offline longer than this can bring a deleted item back. */
const DELETED_KEEP_MS = 120 * 86400000;
const DELETED_MAX = 1000;

/**
 * Merge `local` into `server`, the server's copy winning where neither side says which is newer.
 * Both args are raw (pre-migrate); the caller migrates the result. Every field falls back to the
 * server's value when the local one is missing or malformed.
 *
 * What "newer" means, per part:
 *  - sets, tests: the copy with the later `updatedAt` (stamped by every edit in store.js); one deleted
 *    on either side (`deleted`) stays gone unless it was edited or restored after that, and so do
 *    rules and subjects
 *  - profile: the side with the later `profileAt`
 *  - settings: the side with the later `settingsAt`
 *  - review schedule: per question, the record reviewed last (`reviewedAt`), so a miss on one
 *    device isn't undone by an older, longer streak of hits on the other
 *  - in-progress sessions: one finished or thrown away on either side (`sessionsCleared`) stays
 *    gone; otherwise whichever got further
 *  - attempts, achievements, studied days: union — nothing a student did is dropped
 */
export function mergeStates(server, local, now = Date.now()) {
  const s = server && typeof server === "object" && !Array.isArray(server) ? { ...server } : {};
  const l = local && typeof local === "object" && !Array.isArray(local) ? local : {};
  const arr = (x) => (Array.isArray(x) ? x : []);
  const o = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const unionSorted = (a, b) => [...new Set([...arr(a), ...arr(b)])].sort();
  const stamp = (x) => Number(x?.updatedAt) || 0;

  // attempts — union by id, chronological
  const aSeen = new Set(arr(s.attempts).map((a) => a && a.id));
  s.attempts = [...arr(s.attempts), ...arr(l.attempts).filter((a) => a && a.id && !aSeen.has(a.id))]
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));

  // sets and tests — union by id; on a shared id the later edit wins (the server's on a tie)
  const byIdNewer = (sv, lv) => {
    const out = arr(sv).map((x) => x);
    const at = new Map(out.map((x, i) => [x && x.id, i]));
    for (const x of arr(lv)) {
      if (!x || !x.id) continue;
      if (!at.has(x.id)) { out.push(x); at.set(x.id, out.length - 1); }
      else if (stamp(x) > stamp(out[at.get(x.id)])) out[at.get(x.id)] = x;
    }
    return out;
  };
  if (Array.isArray(s.exams) || Array.isArray(l.exams)) s.exams = byIdNewer(s.exams, l.exams);
  s.assignments = byIdNewer(s.assignments, l.assignments);

  // subjects — add the ones only the local side has (migrate() dedupes + prunes after)
  const suSeen = new Set(arr(s.subjects).map((x) => x && x.id));
  s.subjects = [...arr(s.subjects), ...arr(l.subjects).filter((x) => x && x.id && !suSeen.has(x.id))];

  // rules — union by id; on a shared id the later edit wins. (Like sets, a rule
  // deleted on one device can come back from a stale one — worth it to never
  // lose something a student wrote.)
  {
    const byId = new Map(arr(s.rules).filter((r) => r && r.id).map((r) => [r.id, r]));
    for (const r of arr(l.rules)) {
      if (!r || !r.id) continue;
      const cur = byId.get(r.id);
      if (!cur || (r.updatedAt || r.createdAt || 0) > (cur.updatedAt || cur.createdAt || 0)) byId.set(r.id, r);
    }
    s.rules = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  // deletions — a set, test, rule or subject deleted on either device is gone on both, unless it was
  // edited or put back after that (its stamp is later than the mark). Without this a deletion was
  // undone by the union above the next time the other device synced.
  {
    const marks = [];
    for (const src of [o(s.deleted), o(l.deleted)]) {
      for (const [id, ts] of Object.entries(src)) if (Number(ts) > 0 && now - Number(ts) < DELETED_KEEP_MS) marks.push([id, Number(ts)]);
    }
    const del = {};
    for (const [id, ts] of marks) if (ts > (del[id] || 0)) del[id] = ts;
    const kept = Object.entries(del).sort((a, b) => b[1] - a[1]).slice(0, DELETED_MAX);
    s.deleted = Object.fromEntries(kept);
    const itemStamp = (x) => Number(x?.updatedAt) || Number(x?.createdAt) || 0;
    const alive = (x) => !(s.deleted[x.id] >= itemStamp(x));
    s.assignments = s.assignments.filter(alive);
    s.subjects = s.subjects.filter(alive);
    s.rules = s.rules.filter(alive);
    if (Array.isArray(s.exams)) {
      const setIds = new Set(s.assignments.map((a) => a.id));
      s.exams = s.exams.filter(alive).map((e) => {
        // a test loses the sets that were deleted; one left with none is gone too
        if (!Array.isArray(e.setIds)) return e;
        const left = e.setIds.filter((id) => !s.deleted[id] || setIds.has(id));
        return left.length === e.setIds.length ? e : { ...e, setIds: left };
      }).filter((e) => !Array.isArray(e.setIds) || e.setIds.length > 0);
    }
  }

  // tonight — union the evening checklists (a step done on either device stays
  // done); quiet hours end at the later of the two
  {
    const st = o(s.tonight), lt = o(l.tonight);
    const days = { ...o(st.days) };
    for (const [k, v] of Object.entries(o(lt.days))) {
      const cur = days[k];
      days[k] = !cur ? v : {
        done: { ...o(v?.done), ...o(cur.done) },
        finishedAt: Math.max(cur.finishedAt || 0, v?.finishedAt || 0) || null,
      };
    }
    s.tonight = { days, quietUntil: Math.max(st.quietUntil || 0, lt.quietUntil || 0) };
  }

  // srs — per question, the record reviewed last. Records from before reviewedAt existed fall
  // back to "more review history wins".
  const srs = { ...o(s.srs) };
  for (const [qid, rec] of Object.entries(o(l.srs))) {
    if (!rec || typeof rec !== "object") continue;
    const cur = srs[qid];
    let better;
    if (!cur) better = true;
    else if (rec.reviewedAt || cur.reviewedAt) better = (rec.reviewedAt || 0) > (cur.reviewedAt || 0);
    else better = (rec.reps || 0) > (cur.reps || 0)
      || ((rec.reps || 0) === (cur.reps || 0) && (rec.dueAt || 0) > (cur.dueAt || 0));
    if (better) srs[qid] = rec;
  }
  s.srs = srs;

  // in-progress sessions — a session finished or discarded on either device stays gone (unless
  // it was saved again after that); otherwise keep whichever got further
  const cleared = {};
  for (const src of [o(s.sessionsCleared), o(l.sessionsCleared)]) {
    for (const [k, ts] of Object.entries(src)) {
      if (Number(ts) > (cleared[k] || 0) && now - Number(ts) < CLEARED_KEEP_MS) cleared[k] = Number(ts);
    }
  }
  const sess = {};
  for (const [k, ss] of [...Object.entries(o(s.sessions)), ...Object.entries(o(l.sessions))]) {
    if (!ss || typeof ss !== "object") continue;
    if (cleared[k] && (ss.savedAt || 0) <= cleared[k]) continue;
    const cur = sess[k];
    const li = Object.keys(o(ss.items)).length;
    const ci = Object.keys(o(cur?.items)).length;
    if (!cur || li > ci || (li === ci && (ss.savedAt || 0) > (cur.savedAt || 0))) sess[k] = ss;
  }
  s.sessions = sess;
  s.sessionsCleared = cleared;

  // activity — union the day lists, take the higher counters. A freeze spent on either side stays
  // spent: the side that has bridged more days has the true (lower) bank.
  const sa = o(s.activity), la = o(l.activity);
  const sFrozen = arr(sa.frozenDays).length, lFrozen = arr(la.frozenDays).length;
  s.activity = {
    ...sa,
    daysStudied: unionSorted(sa.daysStudied, la.daysStudied),
    frozenDays: unionSorted(sa.frozenDays, la.frozenDays),
    goalDays: unionSorted(sa.goalDays, la.goalDays),
    freezes: sFrozen === lFrozen ? Math.max(sa.freezes || 0, la.freezes || 0)
      : sFrozen > lFrozen ? (sa.freezes || 0) : (la.freezes || 0),
    freezeMark: Math.max(sa.freezeMark || 0, la.freezeMark || 0),
    bestStreak: Math.max(sa.bestStreak || 0, la.bestStreak || 0),
    lastBackupAt: Math.max(sa.lastBackupAt || 0, la.lastBackupAt || 0) || null,
  };

  // saved questions — per question, the side that changed its bookmark last decides (saved or not);
  // one changed on neither side since the stamps began stays as the server has it, or the local
  // copy adds it
  if (Array.isArray(s.savedQuestions) || Array.isArray(l.savedQuestions)) {
    const sAt = o(s.savedChangedAt), lAt = o(l.savedChangedAt);
    const sSet = new Set(arr(s.savedQuestions)), lSet = new Set(arr(l.savedQuestions));
    const ids = new Set([...sSet, ...lSet, ...Object.keys(sAt), ...Object.keys(lAt)]);
    const out = [];
    const at = {};
    for (const id of ids) {
      const localWins = (lAt[id] || 0) > (sAt[id] || 0);
      const saved = localWins ? lSet.has(id) : (sAt[id] || lAt[id] ? sSet.has(id) : sSet.has(id) || lSet.has(id));
      if (saved) out.push(id);
      const stamp = Math.max(sAt[id] || 0, lAt[id] || 0);
      if (stamp) at[id] = stamp;
    }
    s.savedQuestions = out;
    s.savedChangedAt = at;
  }

  // achievements — union, keeping the earlier unlock stamp
  const ach = { ...o(s.achievements) };
  for (const [id, ts] of Object.entries(o(l.achievements))) {
    if (!(id in ach)) ach[id] = ts;
    else if (ts && ach[id] && ts < ach[id]) ach[id] = ts;
  }
  s.achievements = ach;

  s.onboarded = !!(s.onboarded || l.onboarded);
  // profile — the later edit wins (a rename on the second device to sync used to be lost); stamps
  // missing on both sides keep the server's, falling back to the local one
  if ((l.profileAt || 0) > (s.profileAt || 0) && l.profile && typeof l.profile === "object") {
    s.profile = l.profile;
    s.profileAt = l.profileAt;
  } else s.profile = s.profile || l.profile || null;
  // profile picture — the later change wins, a removal included, so a picture
  // picked before signing in or on a device that was behind isn't dropped
  if ((l.avatarAt || 0) > (s.avatarAt || 0)) { s.avatar = l.avatar ?? null; s.avatarAt = l.avatarAt; }
  // settings — the later change wins; readNotifications stay the server's (transient state)
  if ((l.settingsAt || 0) > (s.settingsAt || 0) && l.settings && typeof l.settings === "object") {
    s.settings = l.settings;
    s.settingsAt = l.settingsAt;
  }
  // reminders clicked away on the home page — the later change wins, so an undo isn't brought back
  if ((l.dismissedDueAt || 0) > (s.dismissedDueAt || 0) && l.dismissedDue && typeof l.dismissedDue === "object") {
    s.dismissedDue = l.dismissedDue;
    s.dismissedDueAt = l.dismissedDueAt;
  }
  return s;
}

/** Is this parsed JSON a full PluggEra backup (Settings → Export), as opposed to a shared set, a
 *  library file or anything else? Used before "Import backup" replaces everything. */
export function looksLikeBackup(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  if ("studybuddy.set" in x) return false;
  return Array.isArray(x.assignments) && (Array.isArray(x.attempts) || Array.isArray(x.subjects))
    && (x.settings == null || (typeof x.settings === "object" && !Array.isArray(x.settings)));
}
