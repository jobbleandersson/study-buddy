// Run a set of questions: question on the left, tutor chat on the right.
//
// A session is {title, type, an ordered list of question ids, a cursor,
// answers}. That shape covers a normal assignment, a test, a cross-set review,
// a targeted practice run and a weak-spots drill identically — and it's what
// gets saved so you can resume.

import { store, REVIEW_ID, PRACTICE_ID, WEAK_ID, RULES_ID, TONIGHT_ID, HP_MOCK_ID, NATIONAL_MIX_PREFIX, nationalMixId, EXAM_PASS_PREFIX, examPassId } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import {
  parseHpSetId, isHpSetId, rawByPart, DELPROV_ORDER, NORM_TABLES, VERBAL_DELPROV, KVANT_DELPROV,
  PASS_COUNT, SEC_PER_Q, minutesFor, pickPracticeIds, questionHistory,
} from "../lib/hp.js";
import { ensureHpSets, hpQuestionIndex } from "../data/hp-content.js";
import { passageFor } from "../lib/passages.js";
import { announce } from "../lib/a11y.js";
import { t, plural } from "../lib/i18n.js";
import { renderQuestion, parseCloze, clozeToUnderscores } from "../components/questions.js";
import { targetLangFor } from "../lib/lang-detect.js";
import { parseChallenge } from "../lib/challenge.js";
import { renderRich } from "../lib/rich.js";
import { TutorChat } from "../components/tutor-chat.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { openReadingControls } from "../components/reading-controls.js";
import { closePopover } from "../lib/popover.js";
import { review } from "../lib/srs.js";
import { weakSpotQuestions, masteryByTopic, firstTryCorrect } from "../lib/mastery.js";
import { ruleQuestionIds } from "../lib/rules.js";
import { pickTonightQuestions } from "../lib/tonight.js";
import { playCorrect, playWrong, playChime } from "../lib/sound.js";
import { renderBusQuestion, isBusQuestion, resetBusPrime } from "../components/bus-question.js";
import { speechSupported } from "../lib/speech.js";
import { setSessionActive } from "../lib/session-active.js";
import { examCells, examSummary, toggleFlag } from "../lib/exam-nav.js";
import { choicesDependOnOrder } from "../lib/choices.js";
import { buildStudyPass, questionsForMinutes, pickMockQuestions } from "../lib/exam.js";
import { resolveExam, contextLine } from "../components/exam-flow.js";

const TIP_SEEN_KEY = "studybuddy.shortcutTipSeen";

/** `?prov=<test id>`: the session was started from that test's prep page. Its header then says so,
 *  and the attempt remembers it, so the results screen can offer the next step of the test. */
const provOf = (qs) => { const id = qs?.get?.("prov"); return id && store.getExam(id) ? id : null; };
const withProv = (hash, examId) => (examId ? `${hash}${hash.includes("?") ? "&" : "?"}prov=${examId}` : hash);

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
  // ?bus=1 is commute mode: the multiple-choice questions only, read aloud and
  // answered by voice or tap (components/bus-question.js). It always counts as
  // practice, even on a test set — feedback is spoken straight away.
  const bus = !examMode && qs?.get?.("bus") === "1";
  // ?practice=1 runs a test set as ordinary practice — tutor on, feedback as
  // you go. Exam prep links here: getting ready for a test shouldn't lock help.
  const practice = !examMode && !bus && qs?.get?.("practice") === "1";
  const allIds = assignment.questions
    .filter((q) => !bus || isBusQuestion(q))
    .map((q) => q.id);
  if (bus && !allIds.length) return emptyScreen(t("bus.noneTitle"), t("bus.noneBody"), t("bus.badge"));
  const rawCount = Math.round(Number(qs?.get?.("count")));
  const count = !examMode && rawCount > 0 && rawCount < allIds.length ? rawCount : null;
  const questionIds = count ? shuffled(allIds).slice(0, count) : allIds;
  const retryQuery = count ? (examQuery ? `${examQuery}&count=${count}` : `?count=${count}`) : examQuery;
  const busQuery = bus ? (retryQuery ? "&bus=1" : "?bus=1") : "";
  const practiceQuery = practice ? (retryQuery ? "&practice=1" : "?practice=1") : "";

  // A friend's challenge (#/utmaning): remembered on the attempt so the results
  // screen can compare. A retry is an ordinary run, hence not in retryQuery.
  const challenge = examMode ? null : parseChallenge(qs, assignment.id);
  const examId = provOf(qs);

  return runSession({
    // A shorter run keeps its own resumable slot, so it can't resume into a
    // full run of the same set (or the other way round); same for a challenge.
    // The clock and the test it was started from are part of the slot too: a 20-minute mock for one
    // test must not resume as another test's 40-minute one.
    key: `${assignment.id}${examMode ? "::exam" : ""}${timeLimitMin ? `::m${timeLimitMin}` : ""}${examId ? `::p${examId}` : ""}${count ? `::n${count}` : ""}${challenge ? "::ch" : ""}${bus ? "::bus" : ""}${practice ? "::practice" : ""}`,
    challenge,
    assignmentId: assignment.id,
    title: assignment.title,
    type: bus || practice ? "assignment" : assignment.type,
    bus,
    forceTutor: bus || practice || undefined,
    examMode,
    timeLimitMin,
    hp,
    hpTestId: hp ? parseHpSetId(assignment.id).test : null,
    retryHash: withProv(`#/session/${assignment.id}${retryQuery}${busQuery}${practiceQuery}`, examId),
    examId,
    questionIds,
    shuffle: isRetry || examMode || !!count,
  });
}

// A review can span the whole library's backlog — cap a single sitting so
// it's never hundreds of questions long, and let the rest wait for next time.
const REVIEW_CAP = 40;
// A commute is short, and a spoken question takes longer than a read one.
const BUS_REVIEW_CAP = 15;

/** Review what is due. Across every set by default; `?sets=a,b` keeps it to the sets one test covers
 *  (the exam-prep plan), so a pass for a test never drifts into questions from other sets. */
export async function renderReview(qs) {
  const bus = qs?.get?.("bus") === "1";
  const examId = provOf(qs);
  const setIds = (qs?.get?.("sets") || "").split(",").filter(Boolean);
  const scope = setIds.length ? new Set(setIds) : null;
  const scopeQuery = scope ? `sets=${setIds.join(",")}` : "";
  const due = store.dueQuestions()
    .filter((d) => !bus || isBusQuestion(d.question))
    .filter((d) => !scope || scope.has(d.assignment.id)); // most-overdue-first
  if (!due.length) {
    return bus
      ? emptyScreen(t("bus.noneTitle"), t("bus.noneReviewBody"), t("bus.badge"))
      : emptyScreen(t("session.nothingDueTitle"), t("session.nothingDueBody"), t("session.badgeReview"));
  }

  const batch = due.slice(0, bus ? BUS_REVIEW_CAP : REVIEW_CAP);

  return runSession({
    // A test-scoped review gets its own resumable slot, so it can't resume into (or over) the all-sets one.
    key: `${bus ? `${REVIEW_ID}::bus` : REVIEW_ID}${scope ? `::${scopeQuery}` : ""}`,
    assignmentId: REVIEW_ID,
    title: t("session.reviewTitle"),
    type: "assignment",
    bus,
    reviewScope: scopeQuery,
    retryHash: withProv(`#/review${bus || scope ? `?${[bus ? "bus=1" : "", scopeQuery].filter(Boolean).join("&")}` : ""}`, examId),
    examId,
    questionIds: batch.map((d) => d.question.id),
    reviewRemaining: due.length - batch.length,
  });
}

/** A study pass for one test, sized to the time the student has (`?min=15|30|60`): about a question
 *  every minute and a half, picked across the test's sets — never-answered first, then wrong ones, then
 *  reviews that are due, then whatever was answered longest ago (lib/exam.js buildStudyPass). Ordinary
 *  practice: feedback and the tutor as you go, one session instead of starting set after set. */
export async function renderExamPass(examId, qs) {
  const exam = resolveExam(examId);
  if (!exam) return notFound(t("exam.noTest"));
  const min = Math.max(5, Math.min(120, Math.round(Number(qs?.get?.("min")) || 30)));
  const ids = buildStudyPass({ sets: exam.sets, attempts: store.attempts, srs: store.state.srs, n: questionsForMinutes(min) });
  if (!ids.length) return notFound(t("exam.noSetsLeft"));
  return runSession({
    key: `${examPassId(exam.id)}::${min}`,
    assignmentId: examPassId(exam.id),
    title: t("exam.passTitle", { min }),
    type: "assignment",
    forceTutor: true,
    examId: exam.id,
    retryHash: `#/exam-pass/${exam.id}?min=${min}`,
    questionIds: ids,
    shuffle: false,
  });
}

/** Practise just the questions missed in a given attempt. */
export async function renderPractice(attemptId) {
  const attempt = store.attempts.find((a) => a.id === attemptId);
  if (!attempt) return notFound(t("session.goneResult"));

  const ids = [...(attempt.items || []).filter((i) => !firstTryCorrect(i)).map((i) => i.questionId), ...(attempt.unanswered || [])]
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
 *  assignments array it's handed, so a subset scopes it for free.
 *  `?sets=a,b` scopes it to the sets a test covers, and `&topic=` narrows it
 *  to one topic (both from the exam-prep plan). */
export async function renderWeakPractice(qs) {
  const subjectId = qs?.get?.("subject") || null;
  const setId = qs?.get?.("set") || null;
  const setIds = (qs?.get?.("sets") || "").split(",").filter(Boolean);
  const topic = qs?.get?.("topic") || null;
  const examId = provOf(qs);
  const pool = setId
    ? store.assignments.filter((a) => a.id === setId)
    : setIds.length
      ? store.assignments.filter((a) => setIds.includes(a.id))
      : subjectId
        ? store.assignments.filter((a) => a.subjectId === subjectId)
        : store.assignments;
  const all = weakSpotQuestions(pool, store.attempts);
  // A topic that has since stopped being weak falls back to every weak spot.
  const onTopic = topic ? all.filter((w) => w.question.topic === topic) : [];
  const weak = onTopic.length ? onTopic : all;
  if (!weak.length) {
    return emptyScreen(t("session.noWeakTitle"), t("session.noWeakBody"), t("session.badgeWeak"));
  }

  const testScope = !setId && setIds.length
    ? `sets=${setIds.join(",")}${topic ? `&topic=${encodeURIComponent(topic)}` : ""}` : "";
  return runSession({
    // A set- or test-scoped drill gets its own resumable slot, so it can't
    // resume into (or over) the all-sets drill.
    key: setId ? `${WEAK_ID}::${setId}` : testScope ? `${WEAK_ID}::${testScope}` : WEAK_ID,
    assignmentId: WEAK_ID,
    title: t("session.weakTitle"),
    type: "assignment",
    retryHash: withProv(setId ? `#/practice-weak?set=${setId}`
      : testScope ? `#/practice-weak?${testScope}`
        : subjectId ? `#/practice-weak?subject=${subjectId}` : "#/practice-weak", examId),
    examId,
    questionIds: weak.map((w) => w.question.id),
    forceTutor: true,
  });
}

/** "Repeat only my rules": the questions the student's memory rules were written
 *  for, plus others on the same subjects and topics. Each question shows its rule
 *  on request (see ruleHooks in components/questions.js), so this is the fastest
 *  way to find out whether the rules have stuck. */
export async function renderRulesPractice() {
  const ids = ruleQuestionIds(store.assignments, store.rules, { limit: 15, pick: shuffled });
  if (!ids.length) {
    return emptyScreen(t("session.noRulesTitle"), t("session.noRulesBody"), t("session.badgeRules"));
  }
  return runSession({
    key: RULES_ID,
    assignmentId: RULES_ID,
    title: t("session.rulesTitle"),
    type: "assignment",
    retryHash: "#/practice-rules",
    questionIds: ids,
    forceTutor: true,
  });
}

/** The last look before a test: a short session of questions from that subject that
 *  are worth one more pass (see pickTonightQuestions). Started from the evening
 *  plan (#/tonight); finishing it ticks that step off. */
export async function renderTonightPractice(setId) {
  const set = store.getAssignment(setId);
  if (!set) return notFound(t("session.goneSet"));
  const ids = pickTonightQuestions(store.assignments, store.state.srs, { subjectId: set.subjectId, pick: shuffled });
  if (!ids.length) return emptyScreen(t("session.noTonightTitle"), t("session.noTonightBody"), t("session.badgeTonight"));
  return runSession({
    key: `${TONIGHT_ID}::${setId}`,
    assignmentId: TONIGHT_ID,
    title: t("session.tonightTitle"),
    type: "assignment",
    retryHash: `#/tonight-practice/${setId}`,
    questionIds: ids,
    forceTutor: true,
  });
}

/** Mix questions from every set imported under one subject (e.g. every year
 *  of a national exam a student has added) into one randomized session.
 *  `?sets=a,b` keeps it to the sets a test covers (the exam-prep mock). */
export async function renderNationalMix(subjectId, qs) {
  const subject = store.subjects.find((s) => s.id === subjectId);
  const only = (qs?.get?.("sets") || "").split(",").filter(Boolean);
  const inSubject = store.assignments.filter((a) => a.subjectId === subjectId);
  const scoped = only.length ? inSubject.filter((a) => only.includes(a.id)) : [];
  // A test's mock asks only its own sets: if every one of them has since been deleted there is
  // nothing to ask, rather than quietly falling back to the whole subject.
  const sets = only.length ? scoped : inSubject;
  const setsQuery = scoped.length ? `&sets=${scoped.map((a) => a.id).join(",")}` : "";
  const pool = sets.flatMap((a) => a.questions.map((q) => q.id));

  if (!pool.length) return notFound(t("session.nationalMixEmpty"));

  // `?exam=1[&min=N]` turns the mix into a timed mock under exam conditions
  // (locked tutor, no reveal, a countdown). runSession already reads
  // config.examMode / config.timeLimitMin — the timer machinery is generic.
  const examMode = qs?.get?.("exam") === "1";
  const rawMin = examMode ? Number(qs?.get?.("min")) : 0;
  const timeLimitMin = rawMin > 0 ? Math.max(1, Math.min(240, Math.round(rawMin))) : null;

  const count = Math.max(1, Math.min(Number(qs?.get("count")) || 15, pool.length));
  // A test's mock reaches into the parts practised least (never answered first, then longest ago),
  // so a longer mock covers more of the test; any other mix is a plain random draw.
  const examId = provOf(qs);
  const ids = scoped.length
    ? pickMockQuestions({ sets: scoped, attempts: store.attempts, count })
    : shuffled(pool).slice(0, count);

  return runSession({
    // A mock keeps its own resumable slot so it can't collide with a plain
    // mix left in progress.
    key: `${examMode ? `${nationalMixId(subjectId)}::exam` : nationalMixId(subjectId)}${timeLimitMin ? `::m${timeLimitMin}` : ""}${examId ? `::p${examId}` : ""}${setsQuery ? "::sets" : ""}`,
    assignmentId: nationalMixId(subjectId),
    title: t("session.nationalMixTitle", { subject: subject?.name || t("session.nationalMixFallback") }),
    type: "assignment",
    examMode,
    timeLimitMin,
    retryHash: withProv(`#/national/mix/${subjectId}?count=${count}${examMode ? `&exam=1${timeLimitMin ? `&min=${timeLimitMin}` : ""}` : ""}${setsQuery}`, examId),
    examId,
    questionIds: ids,
    shuffle: true,
  });
}

/** The Högskoleprov mini-mock: ~40 questions sampled across every imported HP
 *  delprov set with a compressed-provpass quota, verbal block then kvant block,
 *  under one 55-minute clock. Reuses runSession's exam machinery; the attempt
 *  is tagged `hp` so results shows a normed estimate. */
export async function renderHpMock(qs) {
  // Opened straight from a link, before the hub has brought the HP sets in.
  await ensureHpSets();
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

/** A delprov practice run started from its page (#/hp/<dp>, views/hp-delprov.js): questions of one
 *  delprov from every HP set the student has — the övningsprov, the ORD word bank, AI-made ones.
 *    ?n=10        how many (default: what one provpass has)
 *    ?ids=a,b     exactly these questions (a filtered list, or a single question)
 *    ?mode=timed  a clock at the test's pace; with &fb=0 it runs like the test, marked at the end
 *    ?ext=1       extended time (one and a half times as long) */
export const HP_PRACTICE_PREFIX = "hp-ova-";
export async function renderHpPractice(dp, qs) {
  if (!DELPROV_ORDER.includes(dp)) return notFound(t("hp.notFoundDelprov"));
  await ensureHpSets();
  const pool = hpPool(hpQuestionIndex(), dp);
  if (!pool.length) return emptyScreen(t("hp.practiceEmptyTitle"), t("hp.practiceEmptyBody"), t(`hp.delprov.${dp}`));

  const wanted = String(qs?.get?.("ids") || "").split(",").filter((id) => pool.includes(id));
  const n = Math.max(1, Math.min(Math.round(Number(qs?.get?.("n"))) || PASS_COUNT[dp], 60));
  const ids = wanted.length ? wanted : pickPracticeIds(pool, n, questionHistory(store.attempts));
  const timed = qs?.get?.("mode") === "timed";
  const marked = !timed || qs?.get?.("fb") !== "0";
  const ext = qs?.get?.("ext") === "1";
  const query = new URLSearchParams();
  if (wanted.length) query.set("ids", wanted.join(",")); else query.set("n", String(n));
  if (timed) { query.set("mode", "timed"); if (!marked) query.set("fb", "0"); }
  if (ext) query.set("ext", "1");

  return runSession({
    // Every choice that changes the run is part of its slot — mode, length, extended time, a chosen
    // list — so a different run never resumes as this one (with this one's clock).
    key: `${HP_PRACTICE_PREFIX}${dp}::${timed ? (marked ? "timed" : "exam") : "train"}::n${ids.length}${ext ? "::ext" : ""}${wanted.length ? `::${shortHash(wanted.join(","))}` : ""}`,
    assignmentId: `${HP_PRACTICE_PREFIX}${dp}`,
    title: t("hp.practiceTitle", { delprov: t(`hp.delprov.${dp}`) }),
    type: "assignment",
    examMode: timed && !marked,
    timeLimitMin: timed ? minutesFor(dp, ids.length, { extended: ext }) : null,
    hp: true,
    hpTestId: null,
    hpDelprov: dp,
    hpOneTry: marked,
    hpIntro: !wanted.length || ids.length > 1,
    retryHash: `#/hp/ova/${dp}?${query}`,
    questionIds: ids,
    shuffle: false,
  });
}

/** Every question id of one delprov in the student's HP sets. */
const hpPool = (index, dp) => (index.byDelprov[dp] || []).map(({ q }) => q.id);

/** A provpass under test conditions (#/hp/pass/<verbal|kvant>): that half's delprov in the test's
 *  order, as many of each as a real provpass has, 55 minutes, marked at the end.
 *    ?unseen=1  only questions never answered before ("create your own test")
 *    ?full=<id> one half of a whole test; the other half follows from the results screen */
export const HP_PASS_PREFIX = "hp-pass-";
export async function renderHpPass(part, qs) {
  if (part !== "verbal" && part !== "kvant") return notFound(t("hp.notFoundDelprov"));
  await ensureHpSets();
  const unseen = qs?.get?.("unseen") === "1";
  const full = /^[\w-]{1,40}$/.test(qs?.get?.("full") || "") ? qs.get("full") : null;
  const hist = questionHistory(store.attempts);
  const index = hpQuestionIndex();
  const ids = [];
  for (const dp of part === "verbal" ? VERBAL_DELPROV : KVANT_DELPROV) {
    const pool = hpPool(index, dp).filter((id) => !unseen || !hist[id]);
    ids.push(...pickPracticeIds(pool, PASS_COUNT[dp], hist));
  }
  if (!ids.length) {
    return emptyScreen(t("hp.passEmptyTitle"), t(unseen ? "hp.passEmptyUnseen" : "hp.practiceEmptyBody"), t("hp.provTitle"));
  }
  const query = new URLSearchParams();
  if (unseen) query.set("unseen", "1");
  if (full) query.set("full", full);
  const hash = `#/hp/pass/${part}${query.toString() ? `?${query}` : ""}`;
  return runSession({
    key: `${HP_PASS_PREFIX}${part}${unseen ? "::new" : ""}${full ? `::${full}` : ""}`,
    assignmentId: `${HP_PASS_PREFIX}${part}`,
    title: t(`hp.passTitle.${part}`),
    type: "assignment",
    examMode: true,
    timeLimitMin: 55,
    hp: true,
    hpTestId: null,
    hpPass: part,
    hpFull: full,
    hpIntro: true,
    resumeHash: hash,
    retryHash: `#/hp/pass/${part}${unseen ? "?unseen=1" : ""}`,
    questionIds: ids,
    shuffle: false,
  });
}

/** The quick prognosis (#/hp/prognos): two questions from each delprov but DTK, 16 minutes, marked at
 *  the end with a normed estimate and its likely range — a first number before any practice. */
export const HP_PROGNOS_ID = "hp-prognos";
export async function renderHpPrognos() {
  await ensureHpSets();
  const hist = questionHistory(store.attempts);
  const index = hpQuestionIndex();
  const ids = DELPROV_ORDER.filter((dp) => dp !== "dtk").flatMap((dp) => pickPracticeIds(hpPool(index, dp), 2, hist));
  if (!ids.length) return emptyScreen(t("hp.passEmptyTitle"), t("hp.practiceEmptyBody"), t("hp.provTitle"));
  return runSession({
    key: HP_PROGNOS_ID,
    assignmentId: HP_PROGNOS_ID,
    title: t("hp.prognosTitle"),
    type: "assignment",
    examMode: true,
    timeLimitMin: 16,
    hp: true,
    hpTestId: null,
    hpPrognos: true,
    hpIntro: true,
    resumeHash: "#/hp/prognos",
    retryHash: "#/hp/prognos",
    questionIds: ids,
    shuffle: false,
  });
}

function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ------------------------------------------------------------------ */

function runSession(config) {
  let saved = store.getSession(config.key);
  // A timed run whose clock ran out while the student was away, with nothing answered, was never
  // really taken: it starts over instead of being handed in as "0 of 14" into their history.
  if (saved?.deadlineAt && saved.deadlineAt <= Date.now() && !Object.keys(saved.items || {}).length) {
    store.clearSession(config.key);
    saved = null;
  }
  const resumable = saved && (saved.cursor > 0 || Object.keys(saved.items || {}).length > 0);

  const state = resumable
    ? { ...saved, order: saved.order.filter((id) => store.findQuestion(id)) }
    : freshState(config);

  if (!state.order.length) return notFound(t("session.goneQuestions"));
  setSessionActive(true);   // cleared in cleanup()
  state.cursor = Math.min(state.cursor, state.order.length - 1);
  state.skipped = state.skipped || [];
  state.flagged = state.flagged || [];   // exam mode: questions the student marked to come back to
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

  const tutor = new TutorChat({ locked: tutorSilent, hintBudget, testMode });

  const fill = el("div.progressbar__fill");
  const bar = el("div.progressbar", {}, [fill]);
  const label = el("div.progress-label");
  // One dot per question: done, saved for later (skipped), the current one.
  // Replaces the bar for normal-length sets; a long review keeps the bar.
  const dots = el("div.progress-dots", { "aria-hidden": "true" });
  const adaptiveEl = el("div.adaptive");
  const testBar = el("div.testbar");
  const stage = el("div.session__stage");
  // A pen to draw on top of the question with (HP runs), like scribbling in the test booklet.
  const scratch = scratchPad(stage);
  const nextBtn = el("button.btn", { type: "button", disabled: true, onclick: next }, t("session.next"));
  const skipBtn = el("button.btn.btn--ghost", { type: "button", onclick: skip }, t("session.skip"));
  const exitBtn = el("button.btn.btn--ghost", { type: "button", onclick: exit }, t("session.exit"));
  // Exam mode only: reads like the paper test it simulates - any question in any order, a flag to come
  // back to one, answers that can be changed until hand-in (see the exam block below).
  const prevBtn = el("button.btn.btn--ghost", { type: "button", hidden: !isExam, onclick: prev }, t("session.prev"));
  const overviewLbl = el("span", {}, t("session.overview"));
  const overviewBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", hidden: !isExam, onclick: openOverview }, [icon(ICONS.layers, 15), overviewLbl]);
  const flagLbl = el("span", {}, t("session.flag"));
  const flagBtn = el("button.btn.btn--ghost.btn--sm.flagbtn", { type: "button", hidden: !isExam, "aria-pressed": "false", onclick: toggleFlagged }, [icon(ICONS.flag, 15), flagLbl]);
  const handInBtn = el("button.btn.btn--sm", { type: "button", hidden: !isExam, onclick: handIn }, t("session.handIn"));
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
    if (config.assignmentId === RULES_ID) return t("session.rulesTitle");
    if (config.assignmentId === TONIGHT_ID) return t("session.tonightTitle");
    if (config.assignmentId === HP_MOCK_ID) return t("hp.mockTitle");
    return store.getAssignment(config.assignmentId)?.title || config.title;
  }

  function nextBtnLabel() {
    if (isExam) return state.cursor >= state.order.length - 1 ? t("session.handIn") : t("session.next");
    const answered = !!state.items[currentId()];
    return unansweredCount() === 0 || (answered && state.cursor === state.order.length - 1)
      ? t("session.finish") : t("session.next");
  }

  // Set once the run is handed in or the view is gone. After that nothing may save the session again:
  // a late AI verdict or a dialog answered after the clock ran out would bring a finished run back,
  // and resuming that records a second attempt.
  let ended = false;

  function persist() {
    if (ended) return;
    store.saveSession(config.key, {
      key: config.key,
      assignmentId: config.assignmentId,
      title: config.title,
      type: config.type,
      examMode: config.examMode,
      timeLimitMin: config.timeLimitMin,
      retryHash: config.retryHash,
      resumeHash: config.resumeHash || null,   // where a "continue" link elsewhere (the HP test page) reopens it
      isReview: config.assignmentId === REVIEW_ID,
      order: state.order,
      cursor: state.cursor,
      items: state.items,
      skipped: state.skipped,
      flagged: state.flagged,
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
        const cls = (state.items[id] ? ".is-done"
          : id === current ? ".is-now"
          : state.skipped.includes(id) ? ".is-saved" : "") + (state.flagged.includes(id) ? ".is-flag" : "");
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
    // The question was edited since this run was saved (options added or removed): the stored order
    // no longer fits, so show its options as they are rather than lose the right one.
    const n = q.choices.length;
    if (perm.length !== n || new Set(perm).size !== n || perm.some((i) => !(i >= 0 && i < n))) {
      delete state.choiceOrder[q.id];
      return q;
    }
    return { ...q, choices: perm.map((i) => q.choices[i]), answer: perm.indexOf(q.answer) };
  }

  /* ----- exam clock (exam mode only) ----- */
  const examTimeText = el("span");
  // Exam mode, and any run with a time limit (a timed HP practice run is marked as it goes, but has
  // the clock all the same).
  const timed = isExam || !!config.timeLimitMin;
  // Ahead of or behind the test's pace, for an HP run on the clock.
  const paceEl = el("span.examtimer__pace", { hidden: true });
  const examTimer = el("span.examtimer", { hidden: !timed }, [icon(ICONS.clock, 13), examTimeText, paceEl]);
  // On a phone the header's clock scrolls away while the student works down a long question, so a
  // small copy floats under the top bar until the header is back in view (CSS shows it on phones only).
  const floatTimeText = el("span");
  const floatTimer = el("span.examtimer.examtimer--float", { hidden: true, "aria-hidden": "true" }, [icon(ICONS.clock, 13), floatTimeText]);
  const floatWatch = timed && "IntersectionObserver" in window
    ? new IntersectionObserver(([e]) => { floatTimer.hidden = e.isIntersecting || examTimer.hidden; }, { rootMargin: "-80px 0px 0px 0px" })
    : null;
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
      if (config.hp && config.timeLimitMin && state.order.length) {
        // Against an even pace: ahead once answers come faster than the clock, behind only once the
        // question being worked on has used up its own share of the time.
        const perQ = (config.timeLimitMin * 60000) / state.order.length;
        const elapsed = Date.now() - state.startedAt;
        const ahead = answeredCount() * perQ - elapsed;
        const over = elapsed - (answeredCount() + 1) * perQ;
        paceEl.hidden = !(ahead > 5000 || over > 5000);
        paceEl.textContent = ahead > 5000 ? t("hp.paceAhead", { t: fmtClock(ahead) }) : t("hp.paceBehind", { t: fmtClock(over) });
        paceEl.classList.toggle("is-behind", !(ahead > 5000));
      }
      if (left <= 0 && !examAutoSubmitted) {
        examAutoSubmitted = true;
        stopExam();
        toast(t("session.examTimeUp"));
        finish({ timedOut: true });
      }
    } else {
      examTimeText.textContent = fmtClock(Date.now() - state.startedAt);
    }
    floatTimeText.textContent = examTimeText.textContent;
    floatTimer.classList.toggle("examtimer--warn", examTimer.classList.contains("examtimer--warn"));
  }
  function startExam() {
    if (!timed || examTick) return;
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
    tutor.testMode = testMode;
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

  let loadToken = 0;   // which loadQuestion() drew the question on screen — a late verdict checks it
  function loadQuestion() {
    const myLoad = ++loadToken;
    currentRenderer?.cleanup?.();   // commute mode: stop the last question's voice before drawing the next
    clear(stage);
    const found = store.findQuestion(currentId());
    if (!found) { dropMissing(); return; }
    const { assignment, question } = found;
    lastPrompt = question.prompt;

    const answered = !!state.items[question.id];
    // Exam mode moves freely, so "next" never waits for an answer and there is nothing to skip.
    nextBtn.disabled = isExam ? false : !answered;
    nextBtn.textContent = nextBtnLabel();

    // Skipping is only offered while there's somewhere else to go.
    const alreadySkipped = state.skipped.includes(question.id);
    skipBtn.hidden = isExam || answered || alreadySkipped || unansweredCount() <= 1;

    if (tutorSilent) tutor.showLocked();
    else tutor.setQuestion(assignment, viewQuestion(question));

    const questionOpts = {
      question: viewQuestion(question),
      // Follow-up questions ("Samma text. ...") need the text from the first one on screen too.
      passage: passageFor(store.findQuestion(question.id)?.assignment || assignment, question),
      // Language subjects get read-aloud in the right voice plus listen/speak tools.
      targetLang: targetLangFor(store.subjects.find((s) => s.id === assignment.subjectId)?.name),
      tutor: tutorSilent ? null : tutor,
      live: store.hasKey(),
      testMode,
      // Exam mode: a multiple-choice pick is recorded at once and can be changed (questions.js mc).
      revisable: isExam,
      initialPick: isExam ? (state.items[question.id]?.pick ?? -1) : -1,
      askConfidence,
      // Memory rules: shown on request, offered after a miss — never in a test.
      ruleContext: testMode ? null : { subjectId: assignment.subjectId },
      // Can't be skipped any more (last one left, or already skipped once): offer
      // the answer after one wrong try instead of two, so the student isn't
      // left with only "Lämna" as a way out.
      revealAfter: skipBtn.hidden ? 1 : 2,
      // HP practice is marked like the real test is scored: the first pick counts, and a wrong one
      // shows the right answer and the solution at once.
      oneTry: !!config.hpOneTry && !testMode,
      onDone: (result) => {
        if (ended) return;
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
          pick: result.picked ?? null,   // exam mode: which option (in the order shown), so a revisit can show it
        };
        // A verdict that arrived after the student moved on (skipped, went back, opened another
        // question while the AI was still checking): keep the answer, but leave the screen, the
        // buttons and the tutor to the question that is showing now.
        if (myLoad !== loadToken) { persist(); return; }
        skipBtn.hidden = true;
        nextBtn.disabled = false;
        nextBtn.textContent = isExam ? nextBtnLabel() : unansweredCount() === 0 ? t("session.finish") : t("session.next");
        paintProgress();
        persist();
        if (isNew && !config.bus) adapt();
        // An appeal re-fires onDone for the same question; only log it once.
        if (!result.revised) tutor.recordOutcome(question, result);
        // Sound follows the first verdict only — an appeal shouldn't re-chime.
        if (isNew && !config.bus) (result.correct ? playCorrect : playWrong)();   // commute mode speaks its verdict instead
        if (!testMode) announce(result.correct ? t("session.annCorrect") : t("session.annWrong"));
        else announce(t("session.annRecorded"));
      },
    };
    // Commute mode runs its own conversation: it reads the question, listens,
    // says whether it was right, and moves on by itself.
    const r = config.bus
      ? renderBusQuestion({
          question: questionOpts.question,
          targetLang: questionOpts.targetLang,
          progress: { n: Math.min(answeredCount() + 1, state.order.length), total: state.order.length },
          onDone: questionOpts.onDone,
          advance: () => next(),
          skip: () => { if (skipBtn.hidden) return false; skip(); return true; },
        })
      : renderQuestion(questionOpts);

    if (config.hp) {
      const start = hpDelprovStart(question);
      if (start) stage.appendChild(start);
      stage.appendChild(hpQuestionBar(assignment, question));
    }
    stage.appendChild(r.el);
    // A question that isn't multiple choice can't show the earlier answer again, so say it is recorded.
    if (isExam && answered && question.kind !== "mc") {
      stage.insertBefore(el("p.note", {}, t("session.examRevisit")), r.el);
    }
    currentRenderer = r;
    paintProgress();
    paintExamNav();
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
    if (isExam) {
      if (state.cursor >= state.order.length - 1) handIn(); else goTo(state.cursor + 1);
      return;
    }
    if (!state.items[currentId()]) return;
    if (unansweredCount() === 0) { finish(); return; }
    // Advance to the next question that still needs answering.
    state.cursor = firstUnansweredIndex();
    persist();
    loadQuestion();
    announce(t("session.annQuestion", { n: state.cursor + 1, total: state.order.length }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ----- exam mode: free navigation, changeable answers, question map, hand-in ----- */
  // The order is fixed (the map's numbers mean something), every question is reachable, an answer can
  // be changed until hand-in, and nothing is marked until the results screen. Unanswered questions
  // count as wrong when the exam is handed in or the clock runs out (finish()).
  function goTo(i) {
    if (i < 0 || i >= state.order.length || i === state.cursor) return;
    state.cursor = i;
    persist();
    loadQuestion();
    announce(t("session.annQuestion", { n: state.cursor + 1, total: state.order.length }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function prev() { if (isExam) goTo(state.cursor - 1); }

  function toggleFlagged() {
    const id = currentId();
    if (!isExam || !id) return;
    state.flagged = toggleFlag(state.flagged, id);
    persist();
    paintProgress();
    paintExamNav();
    announce(t(state.flagged.includes(id) ? "session.annFlagged" : "session.annUnflagged"));
  }

  /** Keeps the exam-only controls in step with the question on screen. */
  function paintExamNav() {
    if (!isExam) return;
    const flagged = state.flagged.includes(currentId());
    flagBtn.setAttribute("aria-pressed", String(flagged));
    flagBtn.classList.toggle("is-on", flagged);
    flagLbl.textContent = t(flagged ? "session.flagOn" : "session.flag");
    prevBtn.disabled = state.cursor <= 0;
    nextBtn.textContent = nextBtnLabel();
  }
  /** Language switch: the exam-only labels. */
  function paintExamLabels() {
    if (!isExam) return;
    prevBtn.textContent = t("session.prev");
    overviewLbl.textContent = t("session.overview");
    handInBtn.textContent = t("session.handIn");
    paintExamNav();
  }

  async function handIn() {
    if (!isExam) return;
    const sum = examSummary(state.order, state.items, state.flagged);
    const notes = [];
    if (sum.unanswered) notes.push(plural(sum.unanswered, "session.handInOpenOne", "session.handInOpenMany"));
    if (sum.flaggedOpen) notes.push(t("session.handInFlaggedOpen", { n: sum.flaggedOpen }));
    const ok = await confirmDialog({
      message: [t("session.handInQuestion"), notes.join(" ")].filter(Boolean).join("\n\n"),
      confirmLabel: t("session.handIn"),
      cancelLabel: t("session.handInBack"),
      // Unanswered or flagged questions are a warning, not a reassurance.
      warn: notes.length > 0,
    });
    if (ok && !ended) finish();
  }

  let overviewModal = null;
  function closeOverview() {
    overviewModal?.remove();
    overviewModal = null;
    document.removeEventListener("keydown", overviewEsc);
  }
  function overviewEsc(e) { if (e.key === "Escape") closeOverview(); }
  function openOverview() {
    if (!isExam) return;
    closeOverview();
    const cells = examCells(state.order, state.items, state.flagged, state.cursor);
    const sum = examSummary(state.order, state.items, state.flagged);
    const cellState = (c) => [t(c.answered ? "session.cellAnswered" : "session.cellOpen"), c.flagged ? t("session.cellFlagged") : null].filter(Boolean).join(", ");
    overviewModal = el("div.modal", {
      role: "dialog", "aria-modal": "true", "aria-label": t("session.overview"),
      onclick: (e) => { if (e.target === overviewModal) closeOverview(); },
    }, [
      el("div.modal__card.examoverview", {}, [
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } }, [
          el("h3", {}, t("session.overview")),
          el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.close"), onclick: closeOverview }, [icon(ICONS.close, 16)]),
        ]),
        el("p.note", { style: { margin: "0 0 10px" } }, t("session.overviewCounts", { answered: sum.answered, total: sum.total, flagged: sum.flagged })),
        el("div.examlegend", { "aria-hidden": "true" }, [
          el("span", {}, [el("i.examcell.is-done"), t("session.cellAnswered")]),
          el("span", {}, [el("i.examcell"), t("session.cellOpen")]),
          el("span", {}, [el("i.examcell.is-flag"), t("session.cellFlagged")]),
        ]),
        el("div.examgrid", {}, cells.map((c) => el("button.examcell"
          + (c.answered ? ".is-done" : "") + (c.flagged ? ".is-flag" : "") + (c.current ? ".is-now" : ""), {
          type: "button",
          "aria-label": t("session.overviewCell", { n: c.n, state: cellState(c) }),
          "aria-current": c.current ? "true" : null,
          onclick: () => { closeOverview(); goTo(c.n - 1); },
        }, [String(c.n), c.flagged ? icon(ICONS.flag, 11) : null].filter((x) => x != null)))),
        el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "16px" } }, [
          el("button.btn", { type: "button", onclick: () => { closeOverview(); handIn(); } }, t("session.handIn")),
          el("button.btn.btn--ghost", { type: "button", onclick: closeOverview }, t("common.close")),
        ]),
      ]),
    ]);
    document.body.appendChild(overviewModal);
    document.addEventListener("keydown", overviewEsc);
    overviewModal.querySelector(".examcell.is-now")?.focus();
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
    }) && !ended) {
      // Only once the leave is actually confirmed — not speculatively before
      // — so cancelling and then appealing the current question can still
      // reschedule it (its id wouldn't be marked committed yet).
      commitSrs(Object.values(state.items));
      persist();
      location.hash = "#/";
    }
  }

  function finish(opts = {}) {
    if (ended) return;   // the clock ran out while "Hand in" was open, or the button was hit twice
    stopExam();
    const answered = Object.values(state.items);
    // A test or exam hands in every question, and so does a timed run whose clock ran out: the ones
    // never answered are kept on the attempt so the results list them (with their answers) and the
    // score, the HP estimate and "practise these" agree. Otherwise a timed drill answered 1 of 5 before
    // the clock ran out read as "100 %, 1 / 1".
    const graded = (config.type === "test" && !leftTestMode) || isExam || !!opts.timedOut;
    const unanswered = graded ? state.order.filter((id) => !state.items[id]) : [];
    // The score is first-try answers; a choice found after wrong picks isn't counted.
    const correct = answered.filter(firstTryCorrect).length;
    // A test or exam is out of every question: skipped or timed-out ones count as wrong, so a
    // student can not score 100% by answering one question. Practice scores what was answered.
    const denom = graded ? Math.max(state.order.length, answered.length) : answered.length;
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
      // Time ran out while the student was away: the run ended at its deadline, not when they came back
      // (otherwise "took 25 h" for a 16-minute prognosis).
      finishedAt: opts.timedOut && state.deadlineAt ? Math.min(Date.now(), state.deadlineAt) : Date.now(),
      scorePct: denom ? Math.round((correct / denom) * 100) : 0,
      tutorHints: Number.isFinite(hintBudget) ? hintBudget - tutor.hintsLeft : 0,
      items: answered,
      ...(unanswered.length ? { unanswered } : {}),
      ...(config.examId ? { examId: config.examId } : {}),
      ...(config.challenge ? { challenge: config.challenge } : {}),
      // Högskoleprovet: mark the attempt and record raw verbal/kvant scores so
      // results.js can show a normed estimate instead of the F–A reveal.
      ...(config.hp ? {
        hp: true,
        hpTestId: config.hpTestId || null,
        ...(config.hpPass ? { hpPass: config.hpPass } : {}),
        ...(config.hpFull ? { hpFull: config.hpFull } : {}),
        ...(config.hpPrognos ? { hpPrognos: true } : {}),
        // Unanswered questions in a timed mock or drill count as wrong, as on the real test.
        hpParts: rawByPart([...answered, ...unanswered.map((questionId) => ({ questionId, correct: false, firstTry: false }))],
          (qid) => store.findQuestion(qid)?.question.variant),
      } : {}),
    };
    store.recordAttempt(attempt);
    commitSrs(answered);

    store.clearSession(config.key);
    ended = true;
    location.hash = `#/results/${attempt.id}`;
  }

  function startOver() {
    store.clearSession(config.key);
    Object.assign(state, freshState(config));
    state.committedSrs = [];   // a new run: its answers update the review schedule again
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
  } else if (config.hpIntro && config.hpDelprov) {
    showHpIntro(config.hpDelprov);
  } else if (config.hpIntro) {
    showMixedIntro();
  } else {
    loadQuestion();
  }
  if (!stage.querySelector(".hp-intro")) startExam();

  /* ----- HP: the delprov's instructions before the first question, then the bar above each ----- */
  function showHpIntro(dp) {
    const sec = SEC_PER_Q[dp] || 60;
    const pace = sec % 60 === 0 ? t("hp.introMinutes", { n: sec / 60 })
      : sec > 60 ? t("hp.introPaceMin", { m: Math.floor(sec / 60), s: sec % 60 }) : t("hp.introPaceSec", { s: sec });
    // The clock shows the whole time until the run starts.
    if (config.timeLimitMin) examTimeText.textContent = fmtClock(config.timeLimitMin * 60000);
    stage.appendChild(el("div.panel.hp-intro", {}, [
      el("p.hp-intro__code", {}, t(`hp.delprov.${dp}`)),
      el("h3", {}, t(`hp.name.${dp}`)),
      el("p", {}, t(`hp.instr.${dp}`)),
      el("p.note.hp-intro__tip", {}, [icon(ICONS.spark, 15), " ", t(`hp.tip.${dp}`)]),
      el("dl.hp-intro__facts", {}, [
        el("dt", {}, t("hp.introCount")), el("dd", {}, String(state.order.length)),
        el("dt", {}, t("hp.introPace")), el("dd", {}, pace),
        config.timeLimitMin ? el("dt", {}, t("hp.introTime")) : null,
        config.timeLimitMin ? el("dd", {}, t("hp.introMinutes", { n: config.timeLimitMin })) : null,
        el("dt", {}, t("hp.introMarking")), el("dd", {}, t(isExam ? "hp.introMarkEnd" : "hp.introMarkNow")),
      ].filter(Boolean)),
      introStartBtn(),
    ]));
  }

  /** A run across several delprov (the quick prognosis, a provpass): what's in it, the time and the
   *  marking, before the clock starts. Each delprov's own instruction shows where its questions begin. */
  function showMixedIntro() {
    if (config.timeLimitMin) examTimeText.textContent = fmtClock(config.timeLimitMin * 60000);
    const counts = new Map();
    for (const id of state.order) {
      const dp = delprovOf(id);
      if (dp) counts.set(dp, (counts.get(dp) || 0) + 1);
    }
    stage.appendChild(el("div.panel.hp-intro", {}, [
      el("p.hp-intro__code", {}, t("hp.introHp")),
      el("h3", {}, config.title),
      el("p", {}, t(config.hpPrognos ? "hp.introPrognos" : "hp.introPass")),
      el("ul.hp-intro__parts", {}, [...counts].map(([dp, n]) => el("li", {}, `${t(`hp.delprov.${dp}`)} · ${n}`))),
      el("dl.hp-intro__facts", {}, [
        el("dt", {}, t("hp.introCount")), el("dd", {}, String(state.order.length)),
        config.timeLimitMin ? el("dt", {}, t("hp.introTime")) : null,
        config.timeLimitMin ? el("dd", {}, t("hp.introMinutes", { n: config.timeLimitMin })) : null,
        el("dt", {}, t("hp.introMarking")), el("dd", {}, t(isExam ? "hp.introMarkEnd" : "hp.introMarkNow")),
      ].filter(Boolean)),
      el("p.note.hp-intro__tip", {}, [icon(ICONS.spark, 15), " ", t("hp.introGuess")]),
      introStartBtn(),
    ]));
  }

  /** A question's delprov: its own `variant`, else the set it lives in (as hpQuestionIndex reads it). */
  function delprovOf(id) {
    const found = store.findQuestion(id);
    return found ? found.question.variant || parseHpSetId(found.assignment.id).delprov || null : null;
  }

  function introStartBtn() {
    return el("button.btn", {
      type: "button",
      onclick: () => {
        // The clock starts now, not when the page opened.
        state.startedAt = Date.now();
        if (config.timeLimitMin) state.deadlineAt = state.startedAt + config.timeLimitMin * 60000;
        loadQuestion();
        startExam();
      },
    }, [icon(ICONS.play, 16), t("hp.introStart")]);
  }

  /** In a mixed run, the first question of each delprov carries that delprov's instruction. */
  function hpDelprovStart(question) {
    if (!(config.hpPass || config.hpPrognos)) return null;
    const dp = delprovOf(question.id);
    if (!dp || (state.cursor > 0 && delprovOf(state.order[state.cursor - 1]) === dp)) return null;
    return el("div.hp-dpstart", {}, [
      el("strong", {}, `${t(`hp.delprov.${dp}`)} · ${t(`hp.name.${dp}`)}`),
      el("span", {}, t(`hp.instr.${dp}`)),
    ]);
  }

  /** Where the question comes from, a bookmark, and a pen to work on top of it. */
  function hpQuestionBar(assignment, question) {
    const ref = parseHpSetId(assignment.id);
    const source = /-ai$/.test(assignment.id) ? t("hp.srcAi")
      : ref.test ? (NORM_TABLES[ref.test]?.label || t("hp.srcPractice"))
      : assignment.title;
    const saveBtn = el("button.iconbtn.iconbtn--sm.hp-qbar__save", {
      type: "button", "aria-pressed": String(store.isSaved(question.id)),
      "aria-label": t("hp.saveQuestion"), title: t("hp.saveQuestion"),
      onclick: () => {
        const on = store.toggleSaved(question.id);
        saveBtn.setAttribute("aria-pressed", String(on));
        toast(t(on ? "hp.savedToast" : "hp.unsavedToast"));
      },
    }, [icon(ICONS.bookmark, 16)]);
    const penBtn = el("button.iconbtn.iconbtn--sm", {
      type: "button", "aria-pressed": "false", "aria-label": t("hp.pen"), title: t("hp.pen"),
      onclick: () => {
        const on = scratch.toggle();
        penBtn.setAttribute("aria-pressed", String(on));
      },
    }, [icon(ICONS.pencil, 16)]);
    scratch.reset();
    return el("div.hp-qbar", {}, [
      el("span.hp-qbar__src", {}, source),
      el("span.hp-qbar__tools", {}, [penBtn, saveBtn]),
    ]);
  }

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
    // A dialog over the question (answers so far, shortcuts) takes the keys; the question behind it doesn't.
    if (reviewModal || shortcutsEl) return;
    // Enter or Space on a focused button or link presses that button ("Try again", "Previous",
    // "Leave", a flashcard): it must not be turned into "Next" for the question behind it.
    if ((e.key === "Enter" || e.key === " ") && target && target !== document.body
      && target.closest?.("button, a[href], select, summary, [role='button'], [role='radio'], [role='checkbox'], [role='tab']")) return;

    // Exam mode: the question map is open (its own Esc closes it), so the keys must not move the page behind it.
    if (isExam && overviewModal) return;
    if (isExam) {
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); return; }
      const k = e.key.toLowerCase();
      if (k === "m") { e.preventDefault(); toggleFlagged(); return; }
      if (k === "o") { e.preventDefault(); openOverview(); return; }
    }

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
          isExam ? keyRow("←", t("keys.prev")) : null,
          isExam ? keyRow("M", t("keys.mark")) : null,
          isExam ? keyRow("O", t("keys.overview")) : null,
          isExam ? null : keyRow("S", t("keys.skip")),
          keyRow("Space", t("keys.space")),
          keyRow("?", t("keys.show")),
          keyRow("Esc", t("keys.close")),
        ].filter(Boolean))]),
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
    // Not over a screen you use by ear, and not on a phone or tablet: no keyboard there to use them with.
    if (!config.bus && matchMedia("(hover: hover) and (pointer: fine)").matches && !localStorage.getItem(TIP_SEEN_KEY)) {
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
    // Opens the sheet; it closes from its own head (tutor-chat.js). Phones only (CSS), in the page right
    // under the question — floating, it covered Skip / Next. It hides while the sheet is open.
    onclick: () => {
      tutor.el.classList.add("is-open");
      tutor.el.querySelector(".tutor__log")?.scrollTo(0, 0);
    },
  }, [icon(ICONS.spark, 16), el("span", {}, t("session.needHint"))]);
  if (tutorSilent) hintFab.hidden = true;

  paintTestBar();

  // Kept as refs so a mid-session language switch can refresh their text
  // without rebuilding the session (see onLangSession below).
  const headH2 = el("h2", {}, headTitle());
  const badgeEl = el("span.badge" + (config.examId && !config.examMode ? ".badge--exam" : ""), {}, badgeLabel(config));
  // Started from a test: say which, how close it is and how far today's work has got, with a way back.
  const ctxExam = config.examId ? resolveExam(config.examId) : null;
  const examCtxEl = ctxExam ? el("p.session__examctx", {}, [
    el("a", { href: `#/exam-prep/${ctxExam.id}` }, contextLine(ctxExam)),
  ]) : null;
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
    document.title = `${title} · PluggEra`;   // render() skips this on the chrome-only path
    badgeEl.textContent = badgeLabel(config);
    if (examCtxEl) examCtxEl.firstChild.textContent = contextLine(ctxExam);
    nextBtn.textContent = nextBtnLabel();
    skipBtn.textContent = t("session.skip");
    exitBtn.textContent = t("session.exit");
    paintExamLabels();
    if (reviewMoreEl) reviewMoreEl.textContent = t("session.reviewMore", { n: config.reviewRemaining });
    hintFab.lastChild.textContent = t("session.needHint");
    paintProgress();
    paintTestBar();
    const q = store.findQuestion(currentId())?.question;
    if (q && lastPrompt != null && q.prompt !== lastPrompt && !state.items[q.id]) loadQuestion();
  }
  window.addEventListener("sb:langsession", onLangSession);

  // Commute mode for this same set: only where it makes sense — practice on a
  // real set or the review queue, and only when the browser can read aloud.
  const busHref = (() => {
    if (config.bus || isTest || isExam || config.hp || !speechSupported()) return null;
    if (!state.order.some((id) => isBusQuestion(store.findQuestion(id)?.question))) return null;
    if (config.assignmentId === REVIEW_ID) return `#/review?bus=1${config.reviewScope ? `&${config.reviewScope}` : ""}`;
    return store.getAssignment(config.assignmentId) ? `#/session/${config.assignmentId}?bus=1` : null;
  })();
  const busBtn = busHref ? el("a.iconbtn.busbtn", {
    href: busHref, "aria-label": t("bus.start"), title: t("bus.start"),
  }, [icon(ICONS.headphones, 18)]) : null;

  const node = el("div" + (config.bus ? ".session--bus" : ""), {}, [
    homeButton({ confirm: () => hasProgress() }),
    el("div.session__head", {}, [
      headH2,
      el("span.session__headright", {}, [
        examTimer,
        handInBtn,
        pomoEl,
        badgeEl,
        busBtn,
        readingBtn,
        shortcutsBtn,
      ]),
    ]),
    examCtxEl,
    testBar,
    reviewMoreEl,
    bar,
    dots,
    label,
    adaptiveEl,
    el("div.session", {}, [
      el("div", {}, [
        stage,
        hintFab,
        el("div.nav-row", {}, [
          el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [exitBtn, reviewBtn, overviewBtn, flagBtn]),
          el("div", { style: { display: "flex", gap: "10px" } }, [prevBtn, skipBtn, nextBtn]),
        ]),
      ]),
      tutor.el,
    ]),
    timed ? floatTimer : null,
  ].filter(Boolean));
  floatWatch?.observe(examTimer);

  return {
    title: config.title,
    node,
    cleanup: () => {
      ended = true;
      floatWatch?.disconnect();
      scratch.reset();
      setSessionActive(false);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("sb:langsession", onLangSession);
      clearTimeout(tipTimer);
      clearInterval(pomoTimer);
      stopExam();
      closeShortcuts();
      closeReviewSoFar();
      closeOverview();
      document.removeEventListener("keydown", reviewEsc);
      closePopover();
      currentRenderer?.cleanup?.();
      resetBusPrime();
      tutor.destroy();
    },
  };
}

/** Högskoleprov options are never reshuffled: KVA/NOG answers carry a fixed
 *  meaning, and every delprov's explanation refers to the options by letter or
 *  number ("alternativ C"). Any question with an HP `variant` — or a figure —
 *  keeps its authored option order, and so does one whose options point at each
 *  other ("Alla ovanstående"). Everything else is shuffled in every session. */
function keepsChoiceOrder(q) {
  return !!q?.variant || !!q?.figure || choicesDependOnOrder(q?.choices);
}

function freshState(config) {
  const order = config.shuffle ? shuffled(config.questionIds) : [...config.questionIds];
  // Options are reshuffled in EVERY session, not only on a retry: the correct option is so often stored
  // first (see lib/choices.js) that a fixed order would let a student answer "A" without reading.
  const choiceOrder = {};
  for (const id of order) {
    const q = store.findQuestion(id)?.question;
    if (q?.kind === "mc" && Array.isArray(q.choices) && !keepsChoiceOrder(q)) {
      choiceOrder[id] = shuffled(q.choices.map((_, i) => i));
    }
  }
  const startedAt = Date.now();
  const deadlineAt = config.timeLimitMin ? startedAt + config.timeLimitMin * 60000 : null;
  return { ...config, order, cursor: 0, items: {}, skipped: [], flagged: [], choiceOrder, startedAt, deadlineAt };
}

/** A transparent drawing layer over `host` (position: relative). Off by default; when on it takes the
 *  pointer, with a small "clear" button. Strokes are thrown away with the question. */
function scratchPad(host) {
  const canvas = el("canvas.scratch", { "aria-hidden": "true" });
  const clearBtn = el("button.btn.btn--ghost.btn--sm.scratch__clear", { type: "button", onclick: () => wipe() }, t("hp.penClear"));
  let on = false, drawing = false, ctx = null;
  // Follows the question as it grows (marking, steps, an explanation appear under it) or the screen
  // turns: the canvas takes the new size and keeps what was already drawn.
  function size() {
    const r = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(host.scrollHeight * dpr));
    if (ctx && canvas.width === w && canvas.height === h) return;
    let keep = null;
    if (ctx && canvas.width > 1) {
      keep = document.createElement("canvas");
      keep.width = canvas.width; keep.height = canvas.height;
      keep.getContext("2d").drawImage(canvas, 0, 0);
    }
    canvas.width = w;
    canvas.height = h;
    canvas.style.height = `${host.scrollHeight}px`;
    ctx = canvas.getContext("2d");
    if (keep) ctx.drawImage(keep, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(host).getPropertyValue("--brand").trim() || "#3D5AFE";
  }
  const watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (on) size(); }) : null;
  function wipe() { if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointerdown", (e) => { if (!on) return; drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
  canvas.addEventListener("pointermove", (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
  const stop = () => { drawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  return {
    toggle() {
      on = !on;
      if (on) { host.append(canvas, clearBtn); size(); watch?.observe(host); }
      else { canvas.remove(); clearBtn.remove(); watch?.disconnect(); }
      host.classList.toggle("is-drawing", on);
      return on;
    },
    reset() {
      on = false; drawing = false; watch?.disconnect();
      canvas.remove(); clearBtn.remove(); host.classList.remove("is-drawing");
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    },
  };
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
  if (config.bus) return t("bus.badge");
  if (config.assignmentId === HP_MOCK_ID) return t("hp.mockBadge");
  if (config.examMode) return t("session.examBadge");
  if (config.examId) return t("exam.badge");
  if (config.assignmentId === REVIEW_ID) return t("session.badgeReview");
  if (config.assignmentId === PRACTICE_ID) return t("session.badgePractice");
  if (config.assignmentId === WEAK_ID) return t("session.badgeWeak");
  if (config.assignmentId === RULES_ID) return t("session.badgeRules");
  if (config.assignmentId === TONIGHT_ID) return t("session.badgeTonight");
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
