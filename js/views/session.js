// Run a set of questions: question on the left, tutor chat on the right.
//
// A session is just {title, type, an ordered list of question ids, a cursor,
// answers}. That shape covers a normal assignment, a test, and a cross-set
// review session identically — and it's what gets saved so you can resume.

import { store, REVIEW_ID } from "../store.js";
import { el, clear, icon, ICONS, uid } from "../lib/dom.js";
import { announce } from "../lib/a11y.js";
import { renderQuestion } from "../components/questions.js";
import { TutorChat } from "../components/tutor-chat.js";
import { review } from "../lib/srs.js";

export async function renderSession(assignmentId) {
  const assignment = store.getAssignment(assignmentId);
  if (!assignment) return notFound("That set no longer exists.");
  if (!assignment.questions.length) return notFound("That set has no questions yet.");

  return runSession({
    key: assignment.id,
    assignmentId: assignment.id,
    title: assignment.title,
    type: assignment.type,
    questionIds: assignment.questions.map((q) => q.id),
  });
}

export async function renderReview() {
  const due = store.dueQuestions();
  if (!due.length) {
    return {
      title: "Review",
      node: el("div.empty", {}, [
        icon(ICONS.check, 26),
        el("h2", {}, "Nothing due right now"),
        el("p", {}, "Spaced repetition brings questions back just before you'd forget them. Come back tomorrow, or study a set to add more."),
        el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, "Back to menu"),
      ]),
    };
  }

  return runSession({
    key: REVIEW_ID,
    assignmentId: REVIEW_ID,
    title: "Review session",
    type: "assignment",
    isReview: true,
    questionIds: due.map((d) => d.question.id),
  });
}

/* ------------------------------------------------------------------ */

function runSession(config) {
  const saved = store.getSession(config.key);
  const resumable = saved && (saved.cursor > 0 || Object.keys(saved.items || {}).length > 0);

  const state = resumable
    ? { ...saved, order: saved.order.filter((id) => store.findQuestion(id)) }
    : { ...config, order: config.questionIds, cursor: 0, items: {}, startedAt: Date.now() };

  if (!state.order.length) return notFound("These questions are no longer available.");
  state.cursor = Math.min(state.cursor, state.order.length - 1);

  const tutor = new TutorChat();

  const fill = el("div.progressbar__fill");
  const label = el("div.progress-label");
  const stage = el("div");
  const nextBtn = el("button.btn", { type: "button", disabled: true, onclick: next }, "Next");
  const exitBtn = el("button.btn.btn--ghost", { type: "button", onclick: exit }, "Exit");

  function answeredCount() { return Object.keys(state.items).length; }
  function currentId() { return state.order[state.cursor]; }

  /** Where "Continue" should drop you: the first question you haven't done.
   *  Resuming onto an already-answered question would re-present it blank. */
  function firstUnansweredIndex() {
    const i = state.order.findIndex((id) => !state.items[id]);
    return i === -1 ? state.order.length - 1 : i;
  }

  function persist() {
    store.saveSession(config.key, {
      key: config.key,
      assignmentId: config.assignmentId,
      title: config.title,
      type: config.type,
      isReview: !!config.isReview,
      order: state.order,
      cursor: state.cursor,
      items: state.items,
      startedAt: state.startedAt,
    });
  }

  function paintProgress() {
    const done = answeredCount();
    fill.style.width = `${(done / state.order.length) * 100}%`;
    label.textContent = `Question ${state.cursor + 1} of ${state.order.length} · ${done} answered`;
  }

  function loadQuestion() {
    clear(stage);
    const found = store.findQuestion(currentId());
    if (!found) { skipMissing(); return; }
    const { assignment, question } = found;

    nextBtn.disabled = !state.items[question.id];
    nextBtn.textContent = state.cursor === state.order.length - 1 ? "Finish" : "Next";
    tutor.setQuestion(assignment, question);

    const r = renderQuestion({
      question,
      tutor,
      live: store.hasKey(),
      onDone: (result) => {
        state.items[question.id] = {
          questionId: question.id,
          topic: question.topic,
          correct: !!result.correct,
          selfRating: result.selfRating || null,
          srsGrade: result.srsGrade,
          hintsUsed: result.hintsUsed || 0,
        };
        nextBtn.disabled = false;
        paintProgress();
        persist();
        announce(result.correct ? "Correct." : "Not correct. The tutor can help.");
      },
    });

    stage.appendChild(r.el);
    paintProgress();
  }

  function skipMissing() {
    state.order = state.order.filter((id) => store.findQuestion(id));
    if (!state.order.length) { location.hash = "#/"; return; }
    state.cursor = Math.min(state.cursor, state.order.length - 1);
    loadQuestion();
  }

  function next() {
    if (!state.items[currentId()]) return;
    if (state.cursor < state.order.length - 1) {
      state.cursor++;
      persist();
      loadQuestion();
      announce(`Question ${state.cursor + 1} of ${state.order.length}.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      finish();
    }
  }

  function exit() {
    persist();
    if (confirm("Leave this session?\n\nYour progress is saved — you can pick up where you left off.")) {
      location.hash = "#/";
    }
  }

  function finish() {
    const answered = Object.values(state.items);
    const correct = answered.filter((i) => i.correct).length;
    const attempt = {
      id: uid(),
      assignmentId: config.assignmentId,
      isReview: !!config.isReview,
      title: config.title,
      startedAt: state.startedAt,
      finishedAt: Date.now(),
      scorePct: answered.length ? Math.round((correct / answered.length) * 100) : 0,
      items: answered,
    };
    store.recordAttempt(attempt);

    for (const it of answered) {
      const rec = review(store.state.srs[it.questionId], it.srsGrade || (it.correct ? "good" : "again"));
      store.setSrs(it.questionId, rec);
    }

    store.clearSession(config.key);
    location.hash = `#/results/${attempt.id}`;
  }

  function startOver() {
    store.clearSession(config.key);
    state.order = config.questionIds;
    state.cursor = 0;
    state.items = {};
    state.startedAt = Date.now();
    loadQuestion();
  }

  // ----- initial paint: resume prompt, or straight into the questions -----
  if (resumable) {
    const done = answeredCount();
    const remaining = state.order.length - done;
    stage.appendChild(el("div.panel.resume", {}, [
      el("h3", {}, "Pick up where you left off?"),
      el("p.note", { style: { margin: "6px 0 16px" } },
        `You answered ${done} of ${state.order.length} question${state.order.length === 1 ? "" : "s"} last time` +
        (remaining ? ` — ${remaining} to go.` : ", so you're ready to finish.")),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
        el("button.btn", {
          type: "button",
          onclick: () => { state.cursor = firstUnansweredIndex(); persist(); loadQuestion(); },
        }, [icon(ICONS.arrow, 18), "Continue"]),
        el("button.btn.btn--ghost", { type: "button", onclick: startOver }, "Start over"),
      ]),
    ]));
    paintProgress();
  } else {
    loadQuestion();
  }

  const node = el("div", {}, [
    el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "8px", flexWrap: "wrap" } }, [
      el("h2", {}, config.title),
      el("span.badge", {}, config.isReview ? "Review" : config.type === "test" ? "Test" : "Assignment"),
    ]),
    el("div.progressbar", {}, [fill]),
    label,
    el("div.session", {}, [
      el("div", {}, [
        stage,
        el("div.nav-row", {}, [exitBtn, nextBtn]),
      ]),
      tutor.el,
    ]),
  ]);

  return { title: config.title, node, cleanup: () => tutor.destroy() };
}

function notFound(message) {
  return {
    title: "Not found",
    node: el("div.empty", {}, [
      el("h2", {}, "Nothing to study here"),
      el("p", {}, message),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, "Back to menu"),
    ]),
  };
}
