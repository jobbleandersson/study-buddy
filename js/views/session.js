// Run a set of questions: question on the left, tutor chat on the right.
//
// A session is {title, type, an ordered list of question ids, a cursor,
// answers}. That shape covers a normal assignment, a test, a cross-set review
// and a targeted practice run identically — and it's what gets saved so you
// can resume.

import { store, REVIEW_ID, PRACTICE_ID, NATIONAL_MIX_PREFIX, nationalMixId } from "../store.js";
import { el, clear, icon, ICONS, uid } from "../lib/dom.js";
import { announce } from "../lib/a11y.js";
import { renderQuestion } from "../components/questions.js";
import { TutorChat } from "../components/tutor-chat.js";
import { review } from "../lib/srs.js";

export async function renderSession(assignmentId) {
  const assignment = store.getAssignment(assignmentId);
  if (!assignment) return notFound("That set no longer exists.");
  if (!assignment.questions.length) return notFound("That set has no questions yet.");

  // Repeat runs are shuffled so a retry tests the material, not the order.
  const isRetry = store.attempts.some((a) => a.assignmentId === assignment.id);

  return runSession({
    key: assignment.id,
    assignmentId: assignment.id,
    title: assignment.title,
    type: assignment.type,
    retryHash: `#/session/${assignment.id}`,
    questionIds: assignment.questions.map((q) => q.id),
    shuffle: isRetry,
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
    retryHash: "#/review",
    questionIds: due.map((d) => d.question.id),
  });
}

/** Practise just the questions missed in a given attempt. */
export async function renderPractice(attemptId) {
  const attempt = store.attempts.find((a) => a.id === attemptId);
  if (!attempt) return notFound("That result is no longer available.");

  const ids = (attempt.items || [])
    .filter((i) => !i.correct)
    .map((i) => i.questionId)
    .filter((id) => store.findQuestion(id));

  if (!ids.length) {
    return {
      title: "Practice",
      node: el("div.empty", {}, [
        icon(ICONS.check, 26),
        el("h2", {}, "Nothing to practise"),
        el("p", {}, "You got everything right in that session."),
        el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, "Back to menu"),
      ]),
    };
  }

  return runSession({
    key: PRACTICE_ID,
    assignmentId: PRACTICE_ID,
    title: "Practice",
    type: "assignment",
    retryHash: `#/practice/${attemptId}`,
    questionIds: ids,
    // Practice is where the tutoring happens after a test, so never lock it.
    forceTutor: true,
  });
}

/** Mix questions from every set imported under one subject (e.g. every year
 *  of a national exam a student has added) into one randomized session. */
export async function renderNationalMix(subjectId, qs) {
  const subject = store.subjects.find((s) => s.id === subjectId);
  const sets = store.assignments.filter((a) => a.subjectId === subjectId);
  const pool = sets.flatMap((a) => a.questions.map((q) => q.id));

  if (!pool.length) return notFound("Inga importerade set för det här ämnet ännu.");

  const count = Math.max(1, Math.min(Number(qs?.get("count")) || 15, pool.length));
  const ids = shuffled(pool).slice(0, count);

  return runSession({
    key: nationalMixId(subjectId),
    assignmentId: nationalMixId(subjectId),
    title: `Blandat – ${subject?.name || "Nationellt prov"}`,
    type: "assignment",
    retryHash: `#/national/mix/${subjectId}?count=${count}`,
    questionIds: ids,
    shuffle: true,
  });
}

/* ------------------------------------------------------------------ */

function runSession(config) {
  const saved = store.getSession(config.key);
  const resumable = saved && (saved.cursor > 0 || Object.keys(saved.items || {}).length > 0);

  const state = resumable
    ? { ...saved, order: saved.order.filter((id) => store.findQuestion(id)) }
    : freshState(config);

  if (!state.order.length) return notFound("These questions are no longer available.");
  state.cursor = Math.min(state.cursor, state.order.length - 1);
  state.skipped = state.skipped || [];
  state.choiceOrder = state.choiceOrder || {};

  // In a test the tutor is locked: one attempt per question, no hints, no
  // reveal. All the teaching happens afterwards, on the results screen.
  const testMode = config.type === "test" && !config.forceTutor;

  const tutor = new TutorChat({ locked: testMode });

  const fill = el("div.progressbar__fill");
  const label = el("div.progress-label");
  const stage = el("div");
  const nextBtn = el("button.btn", { type: "button", disabled: true, onclick: next }, "Next");
  const skipBtn = el("button.btn.btn--ghost", { type: "button", onclick: skip }, "Skip for now");
  const exitBtn = el("button.btn.btn--ghost", { type: "button", onclick: exit }, "Exit");

  let currentRenderer = null;

  function answeredCount() { return Object.keys(state.items).length; }
  function currentId() { return state.order[state.cursor]; }
  function unansweredCount() { return state.order.filter((id) => !state.items[id]).length; }

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
      retryHash: config.retryHash,
      isReview: config.assignmentId === REVIEW_ID,
      order: state.order,
      cursor: state.cursor,
      items: state.items,
      skipped: state.skipped,
      choiceOrder: state.choiceOrder,
      startedAt: state.startedAt,
    });
  }

  function paintProgress() {
    const done = answeredCount();
    fill.style.width = `${(done / state.order.length) * 100}%`;
    const skippedLeft = state.skipped.filter((id) => !state.items[id]).length;
    label.textContent =
      `Question ${state.cursor + 1} of ${state.order.length} · ${done} answered` +
      (skippedLeft ? ` · ${skippedLeft} skipped` : "");
  }

  /** Apply this session's shuffled choice order without touching stored data. */
  function viewQuestion(q) {
    const perm = state.choiceOrder[q.id];
    if (q.kind !== "mc" || !perm || !Array.isArray(q.choices)) return q;
    return { ...q, choices: perm.map((i) => q.choices[i]), answer: perm.indexOf(q.answer) };
  }

  function loadQuestion() {
    clear(stage);
    const found = store.findQuestion(currentId());
    if (!found) { dropMissing(); return; }
    const { assignment, question } = found;

    const answered = !!state.items[question.id];
    nextBtn.disabled = !answered;
    nextBtn.textContent = unansweredCount() === 0 || (answered && state.cursor === state.order.length - 1)
      ? "Finish" : "Next";

    // Skipping is only offered while there's somewhere else to go.
    const alreadySkipped = state.skipped.includes(question.id);
    skipBtn.hidden = answered || alreadySkipped || unansweredCount() <= 1;

    if (testMode) tutor.showLocked(config.title);
    else tutor.setQuestion(assignment, question);

    const r = renderQuestion({
      question: viewQuestion(question),
      tutor: testMode ? null : tutor,
      live: store.hasKey(),
      testMode,
      onDone: (result) => {
        state.items[question.id] = {
          questionId: question.id,
          topic: question.topic,
          correct: !!result.correct,
          selfRating: result.selfRating || null,
          srsGrade: result.srsGrade,
          hintsUsed: result.hintsUsed || 0,
          appealed: !!result.appealed,
        };
        skipBtn.hidden = true;
        nextBtn.disabled = false;
        nextBtn.textContent = unansweredCount() === 0 ? "Finish" : "Next";
        paintProgress();
        persist();
        // An appeal re-fires onDone for the same question; only log it once.
        if (!result.revised) tutor.recordOutcome(question, result);
        if (!testMode) announce(result.correct ? "Correct." : "Not correct. The tutor can help.");
        else announce("Answer recorded.");
      },
    });

    stage.appendChild(r.el);
    currentRenderer = r;
    paintProgress();
  }

  function dropMissing() {
    state.order = state.order.filter((id) => store.findQuestion(id));
    if (!state.order.length) { location.hash = "#/"; return; }
    state.cursor = Math.min(state.cursor, state.order.length - 1);
    loadQuestion();
  }

  function skip() {
    const id = currentId();
    if (state.items[id] || state.skipped.includes(id) || unansweredCount() <= 1) return;
    state.skipped.push(id);
    state.order.splice(state.cursor, 1);
    state.order.push(id);           // comes back at the end, not quietly dropped
    if (state.cursor >= state.order.length) state.cursor = state.order.length - 1;
    persist();
    loadQuestion();
    announce("Skipped. You'll see this one again at the end.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    if (!state.items[currentId()]) return;
    if (unansweredCount() === 0) { finish(); return; }
    // Advance to the next question that still needs answering.
    const remaining = firstUnansweredIndex();
    state.cursor = remaining;
    persist();
    loadQuestion();
    announce(`Question ${state.cursor + 1} of ${state.order.length}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      isReview: config.assignmentId === REVIEW_ID,
      title: config.title,
      retryHash: config.retryHash,
      wasTest: config.type === "test",
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
    Object.assign(state, freshState(config));
    loadQuestion();
  }

  // ----- initial paint -----
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
    skipBtn.hidden = true;
    paintProgress();
  } else {
    loadQuestion();
  }

  /* ----- keyboard shortcuts ----- */
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

    if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
      if (typing) return;
      e.preventDefault(); toggleShortcuts(); return;
    }
    if (e.key === "Escape") { closeShortcuts(); return; }
    if (typing) return;

    if (e.key === "ArrowRight" || (e.key === "Enter" && !nextBtn.disabled && !currentRenderer)) {
      if (!nextBtn.disabled) { e.preventDefault(); next(); }
      return;
    }
    if (e.key.toLowerCase() === "s" && !skipBtn.hidden) { e.preventDefault(); skip(); return; }

    if (currentRenderer?.handleKey?.(e)) { e.preventDefault(); return; }

    // Enter advances once the question is done and the renderer didn't want it.
    if (e.key === "Enter" && !nextBtn.disabled) { e.preventDefault(); next(); }
  }

  let shortcutsEl = null;
  function toggleShortcuts() { shortcutsEl ? closeShortcuts() : openShortcuts(); }
  function closeShortcuts() { shortcutsEl?.remove(); shortcutsEl = null; }
  function openShortcuts() {
    shortcutsEl = el("div.modal", { role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts",
      onclick: (e) => { if (e.target === shortcutsEl) closeShortcuts(); } }, [
      el("div.modal__card", {}, [
        el("h3", { style: { marginBottom: "12px" } }, "Keyboard shortcuts"),
        el("table.preset-table", {}, [el("tbody", {}, [
          keyRow("A – D  or  1 – 4", "Pick a multiple-choice answer"),
          keyRow("Enter", "Check your answer, then move on"),
          keyRow("→", "Next question"),
          keyRow("S", "Skip for now"),
          keyRow("Space", "Flip a flashcard"),
          keyRow("?", "Show this list"),
          keyRow("Esc", "Close"),
        ])]),
        el("button.btn.btn--ghost.btn--sm", { type: "button", style: { marginTop: "16px" }, onclick: closeShortcuts }, "Close"),
      ]),
    ]);
    document.body.appendChild(shortcutsEl);
    shortcutsEl.querySelector("button").focus();
  }
  function keyRow(keys, what) {
    return el("tr", {}, [el("th", {}, el("kbd", {}, keys)), el("td", {}, what)]);
  }

  document.addEventListener("keydown", onKeyDown);

  /* ----- mobile: tutor as a slide-up sheet ----- */
  const hintFab = el("button.hintfab", {
    type: "button",
    onclick: () => {
      tutor.el.classList.toggle("is-open");
      const open = tutor.el.classList.contains("is-open");
      hintFab.textContent = open ? "Hide tutor" : "Need a hint?";
      if (open) tutor.el.querySelector(".tutor__log")?.scrollTo(0, 0);
    },
  }, "Need a hint?");
  if (testMode) hintFab.hidden = true;

  const node = el("div", {}, [
    el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "8px", flexWrap: "wrap" } }, [
      el("h2", {}, config.title),
      el("span.badge", {}, badgeLabel(config)),
    ]),
    testMode ? el("p.note.note--warn", { style: { marginBottom: "10px" } },
      "Test mode: one attempt per question and no hints. The tutor will go through it with you afterwards.") : null,
    el("div.progressbar", {}, [fill]),
    label,
    el("div.session", {}, [
      el("div", {}, [
        stage,
        el("div.nav-row", {}, [
          exitBtn,
          el("div", { style: { display: "flex", gap: "10px" } }, [skipBtn, nextBtn]),
        ]),
      ]),
      tutor.el,
    ]),
    hintFab,
    el("p.note.kbdhint", {}, [
      "Tip: press ", el("kbd", {}, "?"), " for keyboard shortcuts.",
    ]),
  ].filter(Boolean));

  return {
    title: config.title,
    node,
    cleanup: () => {
      document.removeEventListener("keydown", onKeyDown);
      closeShortcuts();
      tutor.destroy();
    },
  };
}

function freshState(config) {
  const order = config.shuffle ? shuffled(config.questionIds) : [...config.questionIds];
  const choiceOrder = {};
  if (config.shuffle) {
    for (const id of order) {
      const q = store.findQuestion(id)?.question;
      if (q?.kind === "mc" && Array.isArray(q.choices)) {
        choiceOrder[id] = shuffled(q.choices.map((_, i) => i));
      }
    }
  }
  return { ...config, order, cursor: 0, items: {}, skipped: [], choiceOrder, startedAt: Date.now() };
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function badgeLabel(config) {
  if (config.assignmentId === REVIEW_ID) return "Review";
  if (config.assignmentId === PRACTICE_ID) return "Practice";
  if (config.assignmentId?.startsWith?.(NATIONAL_MIX_PREFIX)) return "Nationellt prov";
  return config.type === "test" ? "Test" : "Assignment";
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
