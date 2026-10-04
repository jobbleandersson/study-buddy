// "More practice questions" for a test: the AI writes new questions in the style of the test's own
// sets, so a test with only a few small sets can be studied for longer. They go into one companion set
// per test ("<test> – more questions"), which is part of the test, so the plan, weak spots and the mock
// exam pick them up. Nothing outside the test's sets is used as the model.

import { store } from "../store.js";
import { uid } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { generateAssignment } from "../claude.js";
import { pickSeedQuestions, newQuestionsOnly } from "../lib/exam.js";

export const MORE_QUESTIONS = 10;

/** `exam` is an entry from upcomingExams() (it has `.sets`). Resolves how many questions were added;
 *  throws (a ClaudeError or Error) when it couldn't make any. */
const running = new Map();   // exam id -> the batch being made for it

export function addMoreQuestions(exam, subjectName, label) {
  // A re-render can bring the button back while a batch is still being written; a second click joins it.
  if (running.has(exam.id)) return running.get(exam.id);
  const p = addMoreNow(exam, subjectName, label).finally(() => running.delete(exam.id));
  running.set(exam.id, p);
  return p;
}

async function addMoreNow(exam, subjectName, label) {
  const sets = exam.sets;
  const seed = pickSeedQuestions(sets);
  if (!seed.length) throw new Error(t("exam.moreNoSeed"));

  const gen = await generateAssignment({
    count: MORE_QUESTIONS,
    moreLike: { title: label, subject: subjectName, questions: seed },
  });
  const fresh = newQuestionsOnly((gen.questions || []).map((q) => ({ ...q, id: uid() })), sets);
  if (!fresh.length) throw new Error(t("exam.moreFailed"));

  // One companion set per test: the next batch is appended to it rather than starting another set.
  // The test as it is now, not as it was when the batch started (its sets may have changed meanwhile).
  const now = store.getExam(exam.id) || exam;
  const title = t("exam.moreTitle", { name: label });
  const existing = store.assignments.find((a) => now.setIds.includes(a.id) && a.title === title);
  if (existing) {
    store.updateAssignment(existing.id, { questions: [...(existing.questions || []), ...fresh] });
  } else {
    const a = store.addAssignmentDoc({ subject: subjectName, type: "assignment", title, questions: fresh });
    store.updateExam(exam.id, { setIds: [...now.setIds, a.id] });
  }
  return fresh.length;
}
