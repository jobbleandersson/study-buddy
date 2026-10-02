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
export async function addMoreQuestions(exam, subjectName, label) {
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
  const title = t("exam.moreTitle", { name: label });
  const existing = sets.find((a) => a.title === title);
  if (existing) {
    const current = store.getAssignment(existing.id);
    store.updateAssignment(existing.id, { questions: [...(current?.questions || []), ...fresh] });
  } else {
    const a = store.addAssignmentDoc({ subject: subjectName, type: "assignment", title, questions: fresh });
    store.updateExam(exam.id, { setIds: [...exam.setIds, a.id] });
  }
  return fresh.length;
}
