// What a linked parent or teacher gets of a student's saved state: only what the progress page draws.
//
// The page (js/views/parent-dashboard.js) shows the study streak, days studied, sessions, how the student
// is doing per subject, and how many questions are due for review. It used to be handed the student's
// WHOLE state: every set with its questions and notes, rules the student wrote after a miss, every
// answer, the profile. The privacy text promises "read-only progress". So the state is cut down here to
// the fields those calculations read, and topic names (which can say what a set is about) are replaced
// by opaque ids that only have to match each other.

const MAX_ATTEMPTS = 3000, MAX_ITEMS = 300, MAX_SETS = 600, MAX_QUESTIONS = 2000, MAX_DAYS = 4000, MAX_SUBJECTS = 100;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const str = (x, max) => (typeof x === "string" ? x.slice(0, max) : "");
const num = (x) => (Number.isFinite(x) ? x : 0);

export function parentViewOf(blob) {
  if (!blob || typeof blob !== "object") return null;
  const topics = new Map();
  const topicId = (t) => {
    if (typeof t !== "string" || !t) return undefined;
    if (!topics.has(t)) topics.set(t, `t${topics.size}`);
    return topics.get(t);
  };

  const subjects = arr(blob.subjects).slice(0, MAX_SUBJECTS)
    .filter((s) => s && typeof s.id === "string")
    .map((s) => ({ id: str(s.id, 64), name: str(s.name, 60) }));

  const assignments = arr(blob.assignments).slice(0, MAX_SETS)
    .filter((a) => a && typeof a.id === "string")
    .map((a) => ({
      id: str(a.id, 64),
      subjectId: str(a.subjectId, 64),
      questions: arr(a.questions).slice(0, MAX_QUESTIONS)
        .filter((q) => q && typeof q.id === "string")
        .map((q) => ({ id: str(q.id, 64), topic: topicId(q.topic) })),
    }));

  const attempts = arr(blob.attempts).slice(-MAX_ATTEMPTS)
    .filter((a) => a && typeof a === "object")
    .map((a) => ({
      finishedAt: num(a.finishedAt),
      items: arr(a.items).slice(0, MAX_ITEMS).filter((i) => i && typeof i === "object").map((i) => ({
        topic: topicId(i.topic),
        correct: !!i.correct,
        ...(i.firstTry === undefined ? {} : { firstTry: !!i.firstTry }),
        ...(i.appealed ? { appealed: true } : {}),
      })),
    }));

  // Only the due date of each question's review record, and only for questions that are in a set above.
  const known = new Set(assignments.flatMap((a) => a.questions.map((q) => q.id)));
  const srs = {};
  for (const [qid, rec] of Object.entries(obj(blob.srs))) {
    if (known.has(qid) && rec && Number.isFinite(rec.dueAt)) srs[qid] = { dueAt: rec.dueAt };
  }

  const days = (x) => arr(x).filter((d) => typeof d === "string" && DAY_RE.test(d)).slice(-MAX_DAYS);
  return { subjects, assignments, attempts, srs, activity: { daysStudied: days(blob.activity?.daysStudied), frozenDays: days(blob.activity?.frozenDays) } };
}
