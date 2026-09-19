// Run a set of questions: question on the left, tutor chat on the right.
//
// A session is {title, type, an ordered list of question ids, a cursor,
// answers}. That shape covers a normal assignment, a test, a cross-set review,
// a targeted practice run and a weak-spots drill identically — and it's what
// gets saved so you can resume.

import { store, REVIEW_ID, PRACTICE_ID, WEAK_ID, HP_MOCK_ID, NATIONAL_MIX_PREFIX, nationalMixId } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { parseHpSetId, isHpSetId, rawByPart, DELPROV_ORDER } from "../lib/hp.js";
import { announce } from "../lib/a11y.js";
import { t, plural } from "../lib/i18n.js";
import { renderQuestion, parseCloze, clozeToUnderscores } from "../components/questions.js";
import { renderRich } from "../lib/rich.js";
import { TutorChat } from "../components/tutor-chat.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { openReadingControls } from "../components/reading-controls.js";
import { closePopover } from "../lib/popover.js";
import { review } from "../lib/srs.js";
import { weakSpotQuestions, masteryByTopic, firstTryCorrect } from "../lib/mastery.js";
import { playCorrect, playWrong, playChime } from "../lib/sound.js";

const TIP_SEEN_KEY = "studybuddy.shortcutTipSeen";

// True while a session is on screen. main.js checks this on a language switch:
// a running session updates its own question + tutor in place rather than
// being torn down and rebuilt mid-set.
let sessionActive = false;
export function isSessionActive() { return sessionActive; }

export async function renderSession(assignmentId, qs) {
  const assignment = store.getAssignment(assignmentId);
  if (!assignment) return notFound(t("session.goneSet"));
  if (!assignment.questions.length) return notFound(t("session.emptySet"));

  // ?exam=1[&min=N] runs ANY set under exam conditions — locked tutor, no
  // immediate feedback, an on-screen clock — without touching how the set is
  // stored. An exam run is kept under its own session key so resuming a normal
  // run of the same set doesn't inherit the timer/lock state.
  const examMode = qs?.get?.("exam") === "1";
  const rawMin = examMode ? Number(qs?.get?.("min")) : 0;
  const timeLimitMin = rawMin > 0 ? Math.max(1, Math.min(240, Math.round(rawMin))) : null;
  const examQuery = examMode ? `?exam=1${timeLimitMin ? `&min=${timeLimitMin}` : ""}` : "";

  // Repeat runs are shuffled so a retry tests the material, not the order.
  const isRetry = store.attempts.some((a) => a.assignmentId === assignment.id);

  // A Högskoleprov delprov set: tag the attempt so results shows a normed
  // estimate instead of the F–A grade reveal.
  const hp = isHpSetId(assignment.id);

  // ?count=N studies N questions from this set only — never from another set.
  // Fewer than the set has: a fresh random pick each run, so repeats see others.
  // Exam mode always runs the full set, even if a count slipped into the URL.
  const allIds = assignment.questions.map((q) => q.id);
  const rawCount = Math.round(Number(qs?.get?.("count")));
  const count = !examMode && rawCount > 0 && rawCount < allIds.length ? rawCount : null;
  const questionIds = count ? shuffled(allIds).slice(0, count) : allIds;
  const retryQuery = count ? (examQuery ? `${examQuery}&count=${count}` : `?count=${count}`) : examQuery;

  return runSession({
    // A shorter run keeps its own resumable slot, so it can't resume into a
    // full run of the same set (or the other way round).
    key: `${assignment.id}${examMode ? "::exam" : ""}${count ? `::n${count}` : ""}`,
    assignmentId: assignment.id,
    title: assignment.title,
    type: assignment.type,
    examMode,
    timeLimitMin,
    hp,
    hpTestId: hp ? parseHpSetId(assignment.id).test : null,
    retryHash: `#/session/${assignment.id}${retryQuery}`,
    questionIds,
    shuffle: isRetry || examMode || !!count,
  });
}

// A review can span the whole library's backlog — cap a single sitting so
// it's never hundreds of questions long, and let the rest wait for next time.
const REVIEW_CAP = 40;

export async function renderReview() {
  const due = store.dueQuestions(); // most-overdue-first
  if (!due.length) {
    return emptyScreen(t("session.nothingDueTitle"), t("session.nothingDueBody"), t("session.badgeReview"));
  }

  const batch = due.slice(0, REVIEW_CAP);

  return runSession({
    key: REVIEW_ID,
    assignmentId: REVIEW_ID,
    title: t("session.reviewTitle"),
    type: "assignment",
    retryHash: "#/review",
    questionIds: batch.map((d) => d.question.id),
    reviewRemaining: due.length - batch.length,
  });
}

/** Practise just the questions missed in a given attempt. */
export async function renderPractice(attemptId) {
  const attempt = store.attempts.find((a) => a.id === attemptId);
  if (!attempt) return notFound(t("session.goneResult"));

  const ids = (attempt.items || [])
    .filter((i) => !firstTryCorrect(i))
    .map((i) => i.questionId)
    .filter((id) => store.findQuestion(id));

  if (!ids.length) {
    return emptyScreen(t("session.nothingPractiseTitle"), t("session.nothingPractiseBody"), t("session.badgePractice"));
  }

  return runSession({
    key: PRACTICE_ID,
    assignmentId: PRACTICE_ID,
    title: t("session.practiceTitle"),
    type: "assignment",
    retryHash: `#/practice/${attemptId}`,
    questionIds: ids,
    // Practice is where the tutoring happens after a test, so never lock it.
    forceTutor: true,
  });
}

/** Drill whatever topics you keep getting wrong. Across every set by
 *  default; scoped to one subject when `?subject=<id>` is set (the
 *  exam-prep page uses this) or to one set with `?set=<id>` (a library
 *  card's "weak spots" button) — weakSpotQuestions already filters on the
 *  assignments array it's handed, so a subset scopes it for free. */
export async function renderWeakPractice(qs) {
  const subjectId = qs?.get?.("subject") || null;
  const setId = qs?.get?.("set") || null;
  const pool = setId
    ? store.assignments.filter((a) => a.id === setId)
    : subjectId
      ? store.assignments.filter((a) => a.subjectId === subjectId)
      : store.assignments;
  const weak = weakSpotQuestions(pool, store.attempts);
  if (!weak.length) {
    return emptyScreen(t("session.noWeakTitle"), t("session.noWeakBody"), t("session.badgeWeak"));
  }

  return runSession({
    // A set-scoped drill gets its own resumable slot, so it can't resume into
    // (or over) the all-sets drill.
    key: setId ? `${WEAK_ID}::${setId}` : WEAK_ID,
    assignmentId: WEAK_ID,
    title: t("session.weakTitle"),
    type: "assignment",
    retryHash: setId ? `#/practice-weak?set=${setId}`
      : subjectId ? `#/practice-weak?subject=${subjectId}` : "#/practice-weak",
    questionIds: weak.map((w) => w.question.id),
    forceTutor: true,
  });
}

/** Mix questions from every set imported under one subject (e.g. every year
 *  of a national exam a student has added) into one randomized session. */
export async function renderNationalMix(subjectId, qs) {
  const subject = store.subjects.find((s) => s.id === subjectId);
  const sets = store.assignments.filter((a) => a.subjectId === subjectId);
  const pool = sets.flatMap((a) => a.questions.map((q) => q.id));

  if (!pool.length) return notFound(t("session.nationalMixEmpty"));

  // `?exam=1[&min=N]` turns the mix into a timed mock under exam conditions
  // (locked tutor, no reveal, a countdown). runSession already reads
  // config.examMode / config.timeLimitMin — the timer machinery is generic.
  const examMode = qs?.get?.("exam") === "1";
  const rawMin = examMode ? Number(qs?.get?.("min")) : 0;
  const timeLimitMin = rawMin > 0 ? Math.max(1, Math.min(240, Math.round(rawMin))) : null;

  const count = Math.max(1, Math.min(Number(qs?.get("count")) || 15, pool.length));
  const ids = shuffled(pool).slice(0, count);

  return runSession({
    // A mock keeps its own resumable slot so it can't collide with a plain
    // mix left in progress.
    key: examMode ? `${nationalMixId(subjectId)}::exam` : nationalMixId(subjectId),
    assignmentId: nationalMixId(subjectId),
    title: t("session.nationalMixTitle", { subject: subject?.name || t("session.nationalMixFallback") }),
    type: "assignment",
    examMode,
    timeLimitMin,
    retryHash: `#/national/mix/${subjectId}?count=${count}${examMode ? `&exam=1${timeLimitMin ? `&min=${timeLimitMin}` : ""}` : ""}`,
    questionIds: ids,
    shuffle: true,
  });
}

/** The Högskoleprov mini-mock: ~40 questions sampled across every imported HP
 *  delprov set with a compressed-provpass quota, verbal block then kvant block,
 *  under one 55-minute clock. Reuses runSession's exam machinery; the attempt
 *  is tagged `hp` so results shows a normed estimate. */
export async function renderHpMock(qs) {
  const hpSets = store.assignments.filter((a) => isHpSetId(a.id));
  if (!hpSets.length) {
    return emptyScreen(t("hp.mockEmptyTitle"), t("hp.mockEmptyBody"), t("hp.mockBadge"));
  }

  const byDelprov = {};
  for (const a of hpSets) {
    const setDp = parseHpSetId(a.id).delprov;
    for (const q of a.questions) {
      const dp = q.variant || setDp;
      if (!dp) continue;
      (byDelprov[dp] = byDelprov[dp] || []).push(q.id);
    }
  }

  const QUOTA = { ord: 6, las: 6, mek: 4, elf: 4, xyz: 6, kva: 5, nog: 3, dtk: 6 };
  const want = Math.max(4, Math.min(Number(qs?.get?.("count")) || 40, 40));
  const order = new Map(DELPROV_ORDER.map((dp, i) => [dp, i]));

  let ids = [];
  for (const dp of DELPROV_ORDER) {
    ids.push(...shuffled(byDelprov[dp] || []).slice(0, QUOTA[dp] || 0));
  }
  if (ids.length < want) {
    const chosen = new Set(ids);
    const rest = DELPROV_ORDER.flatMap((dp) => (byDelprov[dp] || []).filter((id) => !chosen.has(id)));
    ids.push(...shuffled(rest).slice(0, want - ids.length));
  }
  ids = ids.slice(0, want).sort((x, y) => {
    const dx = order.get(store.findQuestion(x)?.question.variant) ?? 99;
    const dy = order.get(store.findQuestion(y)?.question.variant) ?? 99;
    return dx - dy;
  });
  if (!ids.length) return notFound(t("hp.mockEmptyBody"));

  return runSession({
    key: HP_MOCK_ID,
    assignmentId: HP_MOCK_ID,
    title: t("hp.mockTitle"),
    type: "assignment",
    examMode: true,
    timeLimitMin: 55,
    hp: true,
    hpTestId: null,
    retryHash: "#/hp/mock",
    questionIds: ids,
    shuffle: false,
  });
}

/* ------------------------------------------------------------------ */

function runSession(config) {
  const saved = store.getSession(config.key);
  const resumable = saved && (saved.cursor > 0 || Object.keys(saved.items || {}).length > 0);

  const state = resumable
    ? { ...saved, order: saved.order.filter((id) => store.findQuestion(id)) }
    : freshState(config);

  if (!state.order.length) return notFound(t("session.goneQuestions"));
  sessionActive = true;   // cleared in cleanup()
  state.cursor = Math.min(state.cursor, state.order.length - 1);
  state.skipped = state.skipped || [];
  state.choiceOrder = state.choiceOrder || {};
  // Question ids already written to SRS this session, whether by an earlier
  // exit or a completed finish — lets commitSrs() below run from both without
  // ever reviewing the same question twice.
  state.committedSrs = state.committedSrs || [];

  // In a test the tutor is locked by default — one attempt per question, no
  // reveal. Settings can hand it a small hint allowance; 0 = the old behaviour.
  // testMode / tutorSilent are mutable: the student can switch test mode off
  // (and back on) mid-run from the banner. Once it's been off at all, the
  // finished attempt is saved as practice, not a test.
  // Exam mode = the same lock, but strict: no hint budget, no switching off,
  // and a visible clock. It's triggered by ?exam=1 on any set.
  const isExam = !!config.examMode;
  const isTest = (config.type === "test" || isExam) && !config.forceTutor;
  const hintBudget = isExam ? 0
    : isTest ? Math.max(0, Math.min(3, Number(store.settings.testHints ?? 2)))
    : Infinity;
  let testMode = isTest;
  let tutorSilent = testMode && hintBudget === 0;
  let leftTestMode = false;

  const tutor = new TutorChat({ locked: tutorSilent, hintBudget });

  const fill = el("div.progressbar__fill");
  const bar = el("div.progressbar", {}, [fill]);
  const label = el("div.progress-label");
  // One dot per question: done, saved for later (skipped), the current one.
  // Replaces the bar for normal-length sets; a long review keeps the bar.
  const dots = el("div.progress-dots", { "aria-hidden": "true" });
  const adaptiveEl = el("div.adaptive");
  const testBar = el("div.testbar");
  const stage = el("div");
  const nextBtn = el("button.btn", { type: "button", disabled: true, onclick: next }, t("session.next"));
  const skipBtn = el("button.btn.btn--ghost", { type: "button", onclick: skip }, t("session.skip"));
  const exitBtn = el("button.btn.btn--ghost", { type: "button", onclick: exit }, t("session.exit"));
  // Practice / review only — a test doesn't get to look back. Shown once
  // there's something answered to look at (paintReviewBtn keeps it in sync).
  const reviewBtn = el("button.btn.btn--ghost.btn--sm", {
    type: "button", hidden: true, onclick: openReviewSoFar,
  }, [icon(ICONS.back, 15), t("session.reviewSoFar")]);
  function paintReviewBtn() { reviewBtn.hidden = isTest || answeredCount() === 0; }

  let currentRenderer = null;
  let lastPrompt = null;   // wording of the question currently on stage — lets
                           // onLangSession tell whether the content re-translated

  function answeredCount() { return Object.keys(state.items).length; }
  function currentId() { return state.order[state.cursor]; }
  function unansweredCount() { return state.order.filter((id) => !state.items[id]).length; }

  function firstUnansweredIndex() {
    const i = state.order.findIndex((id) => !state.items[id]);
    return i === -1 ? state.order.length - 1 : i;
  }

  /** The header title, recomputed (not baked) so a language switch updates it.
   *  Review/practice/weak have a translated label; a real set uses its own
   *  (now possibly re-translated) title. */
  function headTitle() {
    if (config.assignmentId === REVIEW_ID) return t("session.reviewTitle");
    if (config.assignmentId === PRACTICE_ID) return t("session.practiceTitle");
    if (config.assignmentId === WEAK_ID) return t("session.weakTitle");
    if (config.assignmentId === HP_MOCK_ID) return t("hp.mockTitle");
    return store.getAssignment(config.assignmentId)?.title || config.title;
  }

  function nextBtnLabel() {
    const answered = !!state.items[currentId()];
    return unansweredCount() === 0 || (answered && state.cursor === state.order.length - 1)
      ? t("session.finish") : t("session.next");
  }

  function persist() {
    store.saveSession(config.key, {
      key: config.key,
      assignmentId: config.assignmentId,
      title: config.title,
      type: config.type,
      examMode: config.examMode,
      timeLimitMin: config.timeLimitMin,
      retryHash: config.retryHash,
      isReview: config.assignmentId === REVIEW_ID,
      order: state.order,
      cursor: state.cursor,
      items: state.items,
      skipped: state.skipped,
      choiceOrder: state.choiceOrder,
      committedSrs: state.committedSrs,
      startedAt: state.startedAt,
      deadlineAt: state.deadlineAt,
    });
  }

  function paintProgress() {
    const done = answeredCount();
    fill.style.width = `${(done / state.order.length) * 100}%`;
    // The question on screen is never "saved for later", even when it's a
    // skipped one that has come back round — it counts as left.
    const current = currentId();
    const skippedLeft = state.skipped.filter((id) => !state.items[id] && id !== current).length;
    // Counts, not "Question N of M": after a skip reorders the list there's no
    // position number that means anything to the student, but "done · saved
    // for later · left" always adds up to the set.
    const left = Math.max(0, state.order.length - done - skippedLeft);
    label.textContent = [
      plural(done, "session.progDoneOne", "session.progDoneMany"),
      skippedLeft ? plural(skippedLeft, "session.progSavedOne", "session.progSavedMany") : null,
      plural(left, "session.progLeftOne", "session.progLeftMany"),
    ].filter(Boolean).join(" · ");

    const showDots = state.order.length <= 30;
    dots.hidden = !showDots;
    bar.hidden = showDots;
    if (showDots) {
      clear(dots);
      for (const id of state.order) {
        const cls = state.items[id] ? ".is-done"
          : id === current ? ".is-now"
          : state.skipped.includes(id) ? ".is-saved" : "";
        dots.appendChild(el("span" + cls));
      }
    }
    paintReviewBtn();
  }

  /* ----- "review what I've done" — practice / review only ----- */
  let reviewModal = null;
  function closeReviewSoFar() { reviewModal?.remove(); reviewModal = null; }
  function correctText(q) {
    if (q.kind === "mc") return Array.isArray(q.choices) && q.choices[q.answer] != null ? renderRich(String(q.choices[q.answer])) : "";
    if (q.kind === "cloze") {
      return parseCloze(q.prompt).map((p) => p.blank ? `<strong>${renderRich(p.blank[0])}</strong>` : renderRich(p.text)).join("");
    }
    return q.answer ? renderRich(String(q.answer)) : "";
  }
  function openReviewSoFar() {
    closeReviewSoFar();
    // In answered order, following state.order.
    const rows = state.order
      .filter((id) => state.items[id])
      .map((id) => ({ item: state.items[id], q: store.findQuestion(id)?.question }))
      .filter((r) => r.q);
    reviewModal = el("div.modal", {
      role: "dialog", "aria-modal": "true", "aria-label": t("session.reviewSoFar"),
      onclick: (e) => { if (e.target === reviewModal) closeReviewSoFar(); },
    }, [
      el("div.modal__card.review-so-far", {}, [
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" } }, [
          el("h3", {}, t("session.reviewSoFar")),
          el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.close"), onclick: closeReviewSoFar }, [icon(ICONS.close, 16)]),
        ]),
        el("div.review-so-far__list", {}, rows.map(({ item, q }, i) => {
          const promptText = q.kind === "cloze" ? clozeToUnderscores(q.prompt) : q.prompt;
          return el("div.review-so-far__item" + (item.correct ? ".is-ok" : ".is-miss"), {}, [
            el("div.review-so-far__q", {}, [
              el("span.review-so-far__n", {}, String(i + 1)),
              el("span", { html: renderRich(promptText.length > 140 ? promptText.slice(0, 140) + "…" : promptText) }),
            ]),
            el("div.review-so-far__verdict", {}, [
              icon(item.correct ? ICONS.check : ICONS.close, 13),
              item.correct ? (item.appealed ? t("session.reviewAppealed") : t("session.reviewGotIt")) : t("session.reviewMissed"),
            ]),
            el("p.review-so-far__ans", {}, [el("strong", {}, t("results.correctAnswerLabel")), " ", el("span", { html: correctText(q) })]),
            q.explanation ? el("p.review-so-far__exp", { html: renderRich(String(q.explanation)) }) : null,
          ].filter(Boolean));
        })),
      ]),
    ]);
    document.body.appendChild(reviewModal);
    reviewModal.querySelector(".iconbtn")?.focus();
    document.addEventListener("keydown", reviewEsc);
  }
  function reviewEsc(e) { if (e.key === "Escape") { closeReviewSoFar(); document.removeEventListener("keydown", reviewEsc); } }

  /** Apply this session's shuffled choice order without touching stored data. */
  function viewQuestion(q) {
    const perm = state.choiceOrder[q.id];
    if (q.kind !== "mc" || !perm || !Array.isArray(q.choices)) return q;
    return { ...q, choices: perm.map((i) => q.choices[i]), answer: perm.indexOf(q.answer) };
  }

  /* ----- exam clock (exam mode only) ----- */
  const examTimeText = el("span");
  const examTimer = el("span.examtimer", { hidden: !isExam }, [icon(ICONS.clock, 13), examTimeText]);
  let examTick = null, examAutoSubmitted = false;

  function fmtClock(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }
  function tickExam() {
    if (state.deadlineAt) {
      const left = state.deadlineAt - Date.now();
      examTimer.classList.toggle("examtimer--warn", left <= 60000);
      examTimeText.textContent = fmtClock(left);
      if (left <= 0 && !examAutoSubmitted) {
        examAutoSubmitted = true;
        stopExam();
        toast(t("session.examTimeUp"));
        finish({ timedOut: true });
      }
    } else {
      examTimeText.textContent = fmtClock(Date.now() - state.startedAt);
    }
  }
  function startExam() {
    if (!isExam || examTick) return;
    tickExam();
    examTick = setInterval(tickExam, 1000);
  }
  function stopExam() { if (examTick) { clearInterval(examTick); examTick = null; } }

  /* ----- test mode: leave / re-enter mid-run ----- */
  function paintTestBar() {
    // Exam mode: a fixed warning, no toggle.
    if (isExam) {
      testBar.hidden = false;
      clear(testBar);
      testBar.className = "testbar note note--warn";
      testBar.append(el("span", {}, t(config.timeLimitMin ? "session.examBannerTimed" : "session.examBannerUntimed")));
      return;
    }
    if (!isTest) { testBar.hidden = true; return; }
    testBar.hidden = false;
    clear(testBar);
    if (testMode) {
      testBar.className = "testbar note note--warn";
      testBar.append(
        el("span", {}, tutorSilent ? t("session.testBanner") : t("session.testBannerHints", { n: hintBudget })),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: tryLeaveTestMode }, t("session.testOff")),
      );
    } else {
      testBar.className = "testbar note";
      testBar.append(
        el("span", {}, t("session.testModeOff")),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => setTestMode(true) }, t("session.testOn")),
      );
    }
  }

  async function tryLeaveTestMode() {
    // Explain the trade-off once; after that it's a free toggle.
    if (!leftTestMode) {
      const ok = await confirmDialog({
        message: t("session.testOffConfirm"),
        confirmLabel: t("session.testOff"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    setTestMode(false);
  }

  function setTestMode(on) {
    testMode = on;
    tutorSilent = testMode && hintBudget === 0;
    if (!on) leftTestMode = true;

    tutor.locked = tutorSilent;
    tutor.formEl.hidden = tutorSilent;
    hintFab.hidden = tutorSilent;

    paintTestBar();
    // Redo the current question so the change lands now, not next question —
    // but only if it hasn't been answered yet.
    const cur = currentId();
    if (cur && !state.items[cur]) loadQuestion();
    toast(t(on ? "session.testOnToast" : "session.testOffToast"));
  }

  /* ----- confidence prompt: only ask when it changes the schedule ----- */
  // Same rule everywhere — regular practice, Review, and Weak-spots alike:
  // only the ambiguous case (a clean first-try correct answer that might be
  // a guess). Two is a ceiling, not a quota — rolling for it instead of
  // always taking it means it doesn't land on the first eligible answer
  // every time, and plenty of sessions get asked once or not at all.
  let confidenceAsks = 0;
  function askConfidence(result) {
    if (!result.correct) return false;
    if (result.srsGrade !== "easy") return false;
    if (confidenceAsks >= 2) return false;
    if (Math.random() >= 0.3) return false;
    confidenceAsks++;
    return true;
  }

  function loadQuestion() {
    clear(stage);
    const found = store.findQuestion(currentId());
    if (!found) { dropMissing(); return; }
    const { assignment, question } = found;
    lastPrompt = question.prompt;

    const answered = !!state.items[question.id];
    nextBtn.disabled = !answered;
    nextBtn.textContent = nextBtnLabel();

    // Skipping is only offered while there's somewhere else to go.
    const alreadySkipped = state.skipped.includes(question.id);
    skipBtn.hidden = answered || alreadySkipped || unansweredCount() <= 1;

    if (tutorSilent) tutor.showLocked();
    else tutor.setQuestion(assignment, question);

    const r = renderQuestion({
      question: viewQuestion(question),
      tutor: tutorSilent ? null : tutor,
      live: store.hasKey(),
      testMode,
      askConfidence,
      // Can't be skipped any more (last one left, or already skipped once): offer
      // the answer after one wrong try instead of two, so the student isn't
      // left with only "Lämna" as a way out.
      revealAfter: skipBtn.hidden ? 1 : 2,
      onDone: (result) => {
        const isNew = !state.items[question.id];
        state.items[question.id] = {
          questionId: question.id,
          topic: question.topic,
          correct: !!result.correct,
          firstTry: result.firstTry ?? !!result.correct,
          selfRating: result.selfRating || null,
          confidence: result.confidence || null,
          srsGrade: result.srsGrade,
          hintsUsed: result.hintsUsed || 0,
          appealed: !!result.appealed,
        };
        skipBtn.hidden = true;
        nextBtn.disabled = false;
        nextBtn.textContent = unansweredCount() === 0 ? t("session.finish") : t("session.next");
        paintProgress();
        persist();
        if (isNew) adapt();
        // An appeal re-fires onDone for the same question; only log it once.
        if (!result.revised) tutor.recordOutcome(question, result);
        // Sound follows the first verdict only — an appeal shouldn't re-chime.
        if (isNew) (result.correct ? playCorrect : playWrong)();
        if (!testMode) announce(result.correct ? t("session.annCorrect") : t("session.annWrong"));
        else announce(t("session.annRecorded"));
      },
    });

    stage.appendChild(r.el);
    currentRenderer = r;
    paintProgress();
  }

  /* ----- adaptive pacing -----
   * A practice run reacts once to how it's going: struggling opens the tutor
   * and pulls the student's stronger topics forward; cruising offers an early
   * finish. Session-local, never persisted, at most one of each. */
  let easedAlready = false, cruiseOffered = false;

  function recentAccuracy(n = 4) {
    const items = Object.values(state.items).slice(-n);
    if (!items.length) return null;
    return items.filter(firstTryCorrect).length / items.length;
  }

  function easeUpcoming() {
    // Blend lifetime mastery with what's happened in this session so far.
    const tm = masteryByTopic(store.attempts);
    for (const it of Object.values(state.items)) {
      if (!it.topic) continue;
      const now = firstTryCorrect(it) ? 1 : 0;
      tm[it.topic] = tm[it.topic] == null ? now : (tm[it.topic] + now) / 2;
    }
    const rest = state.order.filter((id) => !state.items[id]);
    const topicOf = (id) => store.findQuestion(id)?.question.topic;
    rest.sort((a, b) => (tm[topicOf(b)] ?? 0.5) - (tm[topicOf(a)] ?? 0.5));
    let i = 0;
    state.order = state.order.map((id) => (state.items[id] ? id : rest[i++]));
    persist();
  }

  function adapt() {
    if (testMode || store.settings.adaptive === false) return;
    const acc = recentAccuracy();
    if (acc == null) return;

    if (!easedAlready && answeredCount() >= 3 && acc < 0.4 && unansweredCount() > 1) {
      easedAlready = true;
      easeUpcoming();
      tutor.el.classList.add("is-open");   // matters on mobile, harmless on desktop
      clear(adaptiveEl);
      adaptiveEl.appendChild(el("p.note.note--warn", {}, t("session.adaptiveEase")));
      announce(t("session.adaptiveEase"));
      return;
    }

    if (!cruiseOffered && answeredCount() >= 5 && acc >= 0.85 && unansweredCount() > 1) {
      cruiseOffered = true;
      clear(adaptiveEl);
      adaptiveEl.appendChild(el("p.note", {}, [
        t("session.adaptiveCruise"),
        " ",
        el("button.linkbtn", { type: "button", onclick: finish }, t("session.adaptiveFinishNow")),
      ]));
    }
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
    announce(t("session.annSkipped"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    if (!state.items[currentId()]) return;
    if (unansweredCount() === 0) { finish(); return; }
    // Advance to the next question that still needs answering.
    state.cursor = firstUnansweredIndex();
    persist();
    loadQuestion();
    announce(t("session.annQuestion", { n: state.cursor + 1, total: state.order.length }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Writes SRS for whatever in `items` hasn't already been committed this
  // session (by an earlier exit, or an earlier call here), and marks it
  // committed — so exiting partway through no longer throws away spaced-
  // repetition credit for what was actually answered, and a later finish()
  // of the same resumed session can't review the same question twice.
  function commitSrs(items) {
    const committed = new Set(state.committedSrs);
    const fresh = items.filter((it) => !committed.has(it.questionId));
    for (const it of fresh) {
      const rec = review(store.state.srs[it.questionId], it.srsGrade || (it.correct ? "good" : "again"));
      store.setSrs(it.questionId, rec);
      committed.add(it.questionId);
    }
    state.committedSrs = [...committed];
  }

  /** Something worth a "leave?" prompt: an answer recorded, an exam clock
   *  running, or an answer half-typed on the current question. */
  function hasProgress() {
    if (answeredCount() > 0 || isExam) return true;
    return [...stage.querySelectorAll(".answerbox, .cloze__blank")].some((el) => el.value.trim());
  }

  async function exit() {
    persist();
    if (!hasProgress()) { location.hash = "#/"; return; }
    if (await confirmDialog({
      message: t("session.exitConfirm"),
      confirmLabel: t("nav.leave"),
      cancelLabel: t("nav.stay"),
    })) {
      // Only once the leave is actually confirmed — not speculatively before
      // — so cancelling and then appealing the current question can still
      // reschedule it (its id wouldn't be marked committed yet).
      commitSrs(Object.values(state.items));
      persist();
      location.hash = "#/";
    }
  }

  function finish(opts = {}) {
    stopExam();
    const answered = Object.values(state.items);
    // The score is first-try answers; a choice found after wrong picks isn't counted.
    const correct = answered.filter(firstTryCorrect).length;
    const attempt = {
      id: uid(),
      assignmentId: config.assignmentId,
      isReview: config.assignmentId === REVIEW_ID,
      title: config.title,
      retryHash: config.retryHash,
      // Switched out of test mode at any point → it's a practice run now.
      wasTest: (config.type === "test" && !leftTestMode) || isExam,
      examMode: isExam,
      timeLimitMin: config.timeLimitMin || null,
      timedOut: !!opts.timedOut,
      startedAt: state.startedAt,
      finishedAt: Date.now(),
      scorePct: answered.length ? Math.round((correct / answered.length) * 100) : 0,
      tutorHints: Number.isFinite(hintBudget) ? hintBudget - tutor.hintsLeft : 0,
      items: answered,
      // Högskoleprovet: mark the attempt and record raw verbal/kvant scores so
      // results.js can show a normed estimate instead of the F–A reveal.
      ...(config.hp ? {
        hp: true,
        hpTestId: config.hpTestId || null,
        hpParts: rawByPart(answered, (qid) => store.findQuestion(qid)?.question.variant),
      } : {}),
    };
    store.recordAttempt(attempt);
    commitSrs(answered);

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
    const left = state.order.length - done;
    stage.appendChild(el("div.panel.resume", {}, [
      el("h3", {}, t("session.resumeTitle")),
      el("p.note", { style: { margin: "6px 0 16px" } },
        left ? t("session.resumeRemaining", { n: done, total: state.order.length, left })
             : t("session.resumeDone", { n: done, total: state.order.length })),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
        el("button.btn", {
          type: "button",
          onclick: () => { state.cursor = firstUnansweredIndex(); persist(); loadQuestion(); },
        }, [icon(ICONS.arrow, 18), t("session.continue")]),
        el("button.btn.btn--ghost", { type: "button", onclick: startOver }, t("session.startOver")),
      ]),
    ]));
    skipBtn.hidden = true;
    paintProgress();
  } else {
    loadQuestion();
  }
  startExam();

  /* ----- keyboard shortcuts ----- */
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

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
    shortcutsEl = el("div.modal", {
      role: "dialog", "aria-modal": "true", "aria-label": t("keys.title"),
      onclick: (e) => { if (e.target === shortcutsEl) closeShortcuts(); },
    }, [
      el("div.modal__card", {}, [
        el("h3", { style: { marginBottom: "12px" } }, t("keys.title")),
        el("table.preset-table", {}, [el("tbody", {}, [
          keyRow("A – D  ·  1 – 4", t("keys.pick")),
          keyRow("Enter", t("keys.enter")),
          keyRow("→", t("keys.next")),
          keyRow("S", t("keys.skip")),
          keyRow("Space", t("keys.space")),
          keyRow("?", t("keys.show")),
          keyRow("Esc", t("keys.close")),
        ])]),
        el("button.btn.btn--ghost.btn--sm", {
          type: "button", style: { marginTop: "16px" }, onclick: closeShortcuts,
        }, t("common.close")),
      ]),
    ]);
    document.body.appendChild(shortcutsEl);
    shortcutsEl.querySelector("button").focus();
  }
  function keyRow(keys, what) {
    return el("tr", {}, [el("th", {}, el("kbd", {}, keys)), el("td", {}, what)]);
  }

  document.addEventListener("keydown", onKeyDown);

  // A one-time nudge that the shortcuts exist at all — the button carries it
  // from then on. Shown once ever, per browser.
  let tipTimer = null;
  try {
    if (!localStorage.getItem(TIP_SEEN_KEY)) {
      localStorage.setItem(TIP_SEEN_KEY, "1");
      tipTimer = setTimeout(() => toast(t("session.shortcutTip")), 1200);
    }
  } catch { /* private mode — skip the tip rather than fail */ }

  const shortcutsBtn = el("button.iconbtn.shortcutsbtn", {
    type: "button",
    "aria-label": t("session.shortcutsBtn"),
    title: `${t("session.shortcutsBtn")}  (?)`,
    onclick: toggleShortcuts,
  }, [icon(ICONS.keyboard, 18)]);

  // Light / dark / warm paper, text size, easy-read font, read-aloud — right
  // where a long revision session makes you want it. The contrast glyph reads
  // as an appearance control; "Aa" alone looked like a text-size button.
  const readingBtn = el("button.iconbtn.readingbtn", {
    type: "button",
    "aria-label": t("read.title"), title: t("read.title"),
    onclick: (e) => { e.stopPropagation(); openReadingControls(e.currentTarget); },
  }, [icon(ICONS.contrast, 18)]);

  /* ----- optional Pomodoro focus timer ----- */
  const pomoMin = Number(store.settings.pomodoro) || 0;
  const pomoEl = el("span.pomo", { hidden: !pomoMin, title: t("session.pomoTitle") });
  let pomoLeft = pomoMin * 60, pomoTimer = null, pomoRung = false;
  function paintPomo() {
    const m = Math.floor(Math.max(0, pomoLeft) / 60);
    const s = Math.max(0, pomoLeft) % 60;
    pomoEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
    pomoEl.classList.toggle("is-up", pomoLeft <= 0);
  }
  if (pomoMin) {
    paintPomo();
    pomoTimer = setInterval(() => {
      pomoLeft--;
      paintPomo();
      if (pomoLeft <= 0 && !pomoRung) {
        pomoRung = true;
        playChime();
        toast(t("session.pomoDone"));
        clearInterval(pomoTimer);
      }
    }, 1000);
  }

  /* ----- mobile: tutor as a slide-up sheet ----- */
  const hintFab = el("button.hintfab", {
    type: "button",
    onclick: () => {
      tutor.el.classList.toggle("is-open");
      const open = tutor.el.classList.contains("is-open");
      hintFab.textContent = open ? t("session.hideTutor") : t("session.needHint");
      if (open) tutor.el.querySelector(".tutor__log")?.scrollTo(0, 0);
    },
  }, t("session.needHint"));
  if (tutorSilent) hintFab.hidden = true;

  paintTestBar();

  // Kept as refs so a mid-session language switch can refresh their text
  // without rebuilding the session (see onLangSession below).
  const headH2 = el("h2", {}, headTitle());
  const badgeEl = el("span.badge", {}, badgeLabel(config));
  const reviewMoreEl = config.reviewRemaining > 0
    ? el("p.note", {}, t("session.reviewMore", { n: config.reviewRemaining })) : null;

  /** Language switched mid-session. main.js has already re-translated demo and
   *  library set content in the store; refresh this session's chrome text, and
   *  reload the current question only if its wording actually changed and it's
   *  still unanswered — so a student's own set (or an answered question the
   *  student's done with) keeps its tutor thread and any half-typed answer. */
  function onLangSession() {
    const title = headTitle();
    headH2.textContent = title;
    document.title = `${title} · Studify`;   // render() skips this on the chrome-only path
    badgeEl.textContent = badgeLabel(config);
    nextBtn.textContent = nextBtnLabel();
    skipBtn.textContent = t("session.skip");
    exitBtn.textContent = t("session.exit");
    if (reviewMoreEl) reviewMoreEl.textContent = t("session.reviewMore", { n: config.reviewRemaining });
    if (!hintFab.hidden) {
      hintFab.textContent = tutor.el.classList.contains("is-open")
        ? t("session.hideTutor") : t("session.needHint");
    }
    paintProgress();
    paintTestBar();
    const q = store.findQuestion(currentId())?.question;
    if (q && lastPrompt != null && q.prompt !== lastPrompt && !state.items[q.id]) loadQuestion();
  }
  window.addEventListener("sb:langsession", onLangSession);

  const node = el("div", {}, [
    homeButton({ confirm: () => hasProgress() }),
    el("div.session__head", {}, [
      headH2,
      el("span.session__headright", {}, [
        examTimer,
        pomoEl,
        badgeEl,
        readingBtn,
        shortcutsBtn,
      ]),
    ]),
    testBar,
    reviewMoreEl,
    bar,
    dots,
    label,
    adaptiveEl,
    el("div.session", {}, [
      el("div", {}, [
        stage,
        el("div.nav-row", {}, [
          el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [exitBtn, reviewBtn]),
          el("div", { style: { display: "flex", gap: "10px" } }, [skipBtn, nextBtn]),
        ]),
      ]),
      tutor.el,
    ]),
    hintFab,
  ].filter(Boolean));

  return {
    title: config.title,
    node,
    cleanup: () => {
      sessionActive = false;
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("sb:langsession", onLangSession);
      clearTimeout(tipTimer);
      clearInterval(pomoTimer);
      stopExam();
      closeShortcuts();
      closeReviewSoFar();
      document.removeEventListener("keydown", reviewEsc);
      closePopover();
      tutor.destroy();
    },
  };
}

/** Högskoleprov options are never reshuffled: KVA/NOG answers carry a fixed
 *  meaning, and every delprov's explanation refers to the options by letter or
 *  number ("alternativ C"). Any question with an HP `variant` — or a figure —
 *  keeps its authored option order. Everything else shuffles on a retry / exam
 *  run as before. */
function keepsChoiceOrder(q) {
  return !!q?.variant || !!q?.figure;
}

function freshState(config) {
  const order = config.shuffle ? shuffled(config.questionIds) : [...config.questionIds];
  const choiceOrder = {};
  if (config.shuffle) {
    for (const id of order) {
      const q = store.findQuestion(id)?.question;
      if (q?.kind === "mc" && Array.isArray(q.choices) && !keepsChoiceOrder(q)) {
        choiceOrder[id] = shuffled(q.choices.map((_, i) => i));
      }
    }
  }
  const startedAt = Date.now();
  const deadlineAt = config.examMode && config.timeLimitMin ? startedAt + config.timeLimitMin * 60000 : null;
  return { ...config, order, cursor: 0, items: {}, skipped: [], choiceOrder, startedAt, deadlineAt };
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
  if (config.assignmentId === HP_MOCK_ID) return t("hp.mockBadge");
  if (config.examMode) return t("session.examBadge");
  if (config.assignmentId === REVIEW_ID) return t("session.badgeReview");
  if (config.assignmentId === PRACTICE_ID) return t("session.badgePractice");
  if (config.assignmentId === WEAK_ID) return t("session.badgeWeak");
  if (config.assignmentId?.startsWith?.(NATIONAL_MIX_PREFIX)) return t("session.badgeNationalMix");
  return config.type === "test" ? t("common.test") : t("common.assignment");
}

function emptyScreen(title, body, pageTitle) {
  return {
    title: pageTitle,
    node: el("div.empty", {}, [
      icon(ICONS.check, 26),
      el("h2", {}, title),
      el("p", {}, body),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
    ]),
  };
}

function notFound(message) {
  return {
    title: t("session.notFoundTitle"),
    node: el("div.empty", {}, [
      el("h2", {}, t("session.notFoundTitle")),
      el("p", {}, message),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
    ]),
  };
}
