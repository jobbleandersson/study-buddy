// Run through an assignment/test: question on the left, tutor chat on the right.

import { store } from "../store.js";
import { el, clear, icon, ICONS, uid } from "../lib/dom.js";
import { renderQuestion } from "../components/questions.js";
import { TutorChat } from "../components/tutor-chat.js";
import { review } from "../lib/srs.js";

export async function renderSession(assignmentId) {
  const assignment = store.getAssignment(assignmentId);
  if (!assignment) {
    return el("div.empty", {}, [
      el("h2", {}, "Assignment not found"),
      el("a.btn.btn--ghost", { href: "#/" }, "Back to menu"),
    ]);
  }

  const questions = assignment.questions;
  const startedAt = Date.now();
  const items = [];
  let index = 0;

  const tutor = new TutorChat();

  const fill = el("div.progressbar__fill");
  const label = el("div.progress-label");
  const stage = el("div");
  const nextBtn = el("button.btn", { type: "button", disabled: true, onclick: next }, "Next");
  const quitBtn = el("a.btn.btn--ghost", { href: "#/", title: "Leave without finishing — this run won't be scored" }, "Exit");

  function paintProgress() {
    const done = items.filter(Boolean).length;
    fill.style.width = `${(index / questions.length) * 100}%`;
    label.textContent = `Question ${index + 1} of ${questions.length}` + (done ? ` · ${done} answered` : "");
  }

  function loadQuestion() {
    clear(stage);
    nextBtn.disabled = !items[index];
    nextBtn.textContent = index === questions.length - 1 ? "Finish" : "Next";
    const q = questions[index];
    tutor.setQuestion(assignment, q);

    const r = renderQuestion({
      question: q,
      tutor,
      live: store.hasKey(),
      onDone: (result) => {
        items[index] = {
          questionId: q.id,
          topic: q.topic,
          correct: !!result.correct,
          selfRating: result.selfRating || null,
          srsGrade: result.srsGrade,
          hintsUsed: result.hintsUsed || 0,
        };
        nextBtn.disabled = false;
        paintProgress();
      },
    });
    stage.appendChild(r.el);
    paintProgress();
  }

  function next() {
    if (!items[index]) return;
    if (index < questions.length - 1) {
      index++;
      loadQuestion();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      finish();
    }
  }

  function finish() {
    const answered = items.filter(Boolean);
    const correct = answered.filter((i) => i.correct).length;
    const attempt = {
      id: uid(),
      assignmentId: assignment.id,
      startedAt,
      finishedAt: Date.now(),
      scorePct: answered.length ? Math.round((correct / answered.length) * 100) : 0,
      items: answered,
    };
    store.recordAttempt(attempt);

    // update spaced-repetition schedule per question
    for (const it of answered) {
      const rec = review(store.state.srs[it.questionId], it.srsGrade || (it.correct ? "good" : "again"));
      store.setSrs(it.questionId, rec);
    }

    location.hash = `#/results/${attempt.id}`;
  }

  loadQuestion();

  const node = el("div", {}, [
    el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "8px", flexWrap: "wrap" } }, [
      el("h2", {}, assignment.title),
      el("span.badge", {}, assignment.type === "test" ? "Test" : "Assignment"),
    ]),
    el("div.progressbar", {}, [fill]),
    label,
    el("div.session", {}, [
      el("div", {}, [
        stage,
        el("div.nav-row", {}, [quitBtn, nextBtn]),
      ]),
      tutor.el,
    ]),
  ]);

  return { title: assignment.title, node, cleanup: () => tutor.destroy() };
}
