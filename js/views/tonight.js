// #/tonight[/:setId] — "Kvällen före provet". The evening before a test the
// app gets calmer: a short checklist built from what the student already has
// (their own rules, questions that are nearly there, the formula sheet), a
// clear end, and quiet reminders until morning. No AI, no new material.

import { store, TONIGHT_ID } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { t, plural, fmtDate, daysUntil } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { announce } from "../lib/a11y.js";
import { homeButton } from "../components/nav.js";
import {
  testsTomorrow, tonightKey, isFormulaSubject, pickTonightQuestions,
  buildSteps, progressMinutes, nextMorning,
} from "../lib/tonight.js";

/** Everything the page and the home card need to know about one evening. */
export function tonightPlan(set) {
  const subject = store.subjects.find((s) => s.id === set.subjectId);
  const today = localDayKey();
  const rules = store.rules.filter((r) => r.subjectId === set.subjectId);
  const questionIds = pickTonightQuestions(store.assignments, store.state.srs, { subjectId: set.subjectId });
  const steps = buildSteps({
    rulesCount: rules.length,
    questionCount: questionIds.length,
    formulas: isFormulaSubject(subject?.name),
  });
  const key = tonightKey(today, set.subjectId);
  const day = store.tonightDay(key);
  // The last-look session finishing is what ticks it off — it's recorded as an attempt.
  const practiceHash = `#/tonight-practice/${set.id}`;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const practiceDone = store.attempts.some((a) => a.assignmentId === TONIGHT_ID
    && a.retryHash === practiceHash && (a.finishedAt || 0) >= startOfDay.getTime());
  const done = new Set(Object.keys(day.done));
  if (practiceDone) done.add("practice");
  return { subject, rules, questionIds, steps, key, day, done, practiceHash, minutes: progressMinutes(steps, done) };
}

function fmtClock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function none() {
  return {
    title: t("tonight.pageTitle"),
    node: el("div.empty", {}, [
      icon(ICONS.moon, 26),
      el("h2", {}, t("tonight.noneTitle")),
      el("p", {}, t("tonight.noneBody")),
      el("a.btn.btn--ghost", { href: "#/calendar", style: { marginTop: "16px" } }, t("tonight.noneCta")),
    ]),
  };
}

export function renderTonight(setId) {
  const tests = testsTomorrow(store.assignments);
  const set = setId ? store.getAssignment(setId) : tests[0];
  if (!set) return none();

  const root = el("div.tonight-page");
  let openStep = null;      // the step whose panel is open; null = the first one left to do
  paint();
  return { title: t("tonight.pageTitle"), node: root };

  function paint() {
    const plan = tonightPlan(set);
    const finished = !!plan.day.finishedAt;
    const others = tests.filter((x) => x.id !== set.id);
    root.replaceChildren(...[
      homeButton(),
      el("div.tonight.theme-night" + (finished ? ".tonight--done" : ""), {}, finished ? doneBody(plan) : body(plan)),
      others.length && !finished ? el("p.tonight__also", {}, [
        t("tonight.also"), " ",
        ...others.flatMap((o, i) => [
          i ? ", " : null,
          el("a", { href: `#/tonight/${o.id}` }, store.subjects.find((s) => s.id === o.subjectId)?.name || o.title),
        ]),
      ].filter(Boolean)) : null,
    ].filter(Boolean));
  }

  function eyebrow(plan) {
    const name = plan.subject?.name || set.title;
    const d = set.dueAt ? daysUntil(set.dueAt) : 1;
    return d === 1 ? t("tonight.eyebrow", { subject: name }) : t("tonight.eyebrowDate", { subject: name, date: fmtDate(set.dueAt) });
  }

  function body(plan) {
    const { steps, done, minutes } = plan;
    const firstPending = steps.find((s) => !done.has(s.id))?.id ?? null;
    const opened = openStep ?? firstPending;
    const pct = minutes.total ? Math.round((minutes.done / minutes.total) * 100) : 0;
    return [
      el("div.tonight__moon", { "aria-hidden": "true" }, [icon(ICONS.moon, 24)]),
      el("p.tonight__eyebrow", {}, eyebrow(plan)),
      el("h1.tonight__title", {}, t("tonight.title")),
      el("p.tonight__lead", {}, minutes.total ? t("tonight.lead", { n: minutes.total }) : t("tonight.leadNone")),
      steps.length ? el("ol.tsteps", {}, steps.map((s) => stepEl(s, plan, opened === s.id))) : null,
      minutes.total ? el("div.tonight__meter", {}, [
        el("div.tmeter", { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(minutes.total), "aria-valuenow": String(minutes.done), "aria-label": t("tonight.minutesOf", { done: minutes.done, total: minutes.total }) },
          [el("div.tmeter__fill", { style: { width: pct + "%" } })]),
        el("p.tonight__minutes", {}, t("tonight.minutesOf", { done: minutes.done, total: minutes.total })),
      ]) : null,
      el("div.tonight__sleep", {}, [
        el("strong", {}, t("tonight.sleepTitle")),
        el("span", {}, t("tonight.sleepBody")),
      ]),
      el("div.tonight__actions", {}, [
        el("button.btn.tonight__finish", { type: "button", onclick: finish }, t("tonight.finish")),
      ]),
    ].filter(Boolean);
  }

  function stepEl(step, plan, isOpen) {
    const isDone = plan.done.has(step.id);
    const id = `tstep-${step.id}`;
    const title = step.id === "rules" ? plural(step.n, "tonight.stepRulesOne", "tonight.stepRulesMany")
      : step.id === "practice" ? t("tonight.stepPractice", { n: step.n })
      : t("tonight.stepFormulas");
    const panel = el("div.tstep__body", { id: `${id}-body`, hidden: !isOpen }, stepBody(step, plan, isDone));
    const head = el("button.tstep__head", {
      type: "button", "aria-expanded": String(isOpen), "aria-controls": `${id}-body`,
      onclick: () => { openStep = isOpen ? "" : step.id; paint(); },
    }, [
      el("span.tstep__mark", { "aria-hidden": "true" }, isDone ? [icon(ICONS.check, 16)] : []),
      el("span.tstep__title", {}, [title, isDone ? el("span.sr-only", {}, ` (${t("tonight.stepDone")})`) : null].filter(Boolean)),
      el("span.tstep__min", {}, t("tonight.minutes", { n: step.minutes })),
    ]);
    return el("li.tstep" + (isDone ? ".is-done" : "") + (isOpen ? ".is-open" : ""), {}, [head, panel]);
  }

  function stepBody(step, plan, isDone) {
    if (step.id === "rules") {
      return [
        el("p.tstep__hint", {}, t("tonight.rulesHint")),
        el("ul.tstep__rules", {}, plan.rules.map((r) => el("li", {}, r.text))),
        isDone ? null : el("button.btn.btn--sm", { type: "button", onclick: () => tick("rules") }, t("tonight.rulesRead")),
      ].filter(Boolean);
    }
    if (step.id === "practice") {
      return [
        el("p.tstep__hint", {}, t("tonight.practiceHint")),
        isDone
          ? el("a.btn.btn--sm.btn--ghost", { href: plan.practiceHash }, t("tonight.practiceAgain"))
          : el("a.btn.btn--sm", { href: plan.practiceHash }, t("tonight.practiceStart")),
      ];
    }
    return [
      el("p.tstep__hint", {}, t("tonight.formulasHint")),
      // Opening the sheet counts: it's a look, not a task with a score.
      el("a.btn.btn--sm" + (isDone ? ".btn--ghost" : ""), {
        href: "#/reference",
        onclick: () => { if (!isDone) store.markTonightStep(plan.key, "formulas"); },
      }, t("tonight.formulasOpen")),
    ];
  }

  function tick(stepId) {
    store.markTonightStep(tonightKey(localDayKey(), set.subjectId), stepId);
    openStep = null;
    paint();
    announce(t("tonight.stepDone"));
  }

  function finish() {
    const until = nextMorning();
    store.finishTonight(tonightKey(localDayKey(), set.subjectId), until);
    window.dispatchEvent(new Event("sb:reminders"));   // let the bell drop its dot
    paint();
    announce(t("tonight.doneTitle"));
    window.scrollTo?.({ top: 0 });
  }

  function doneBody(plan) {
    const until = store.state.tonight.quietUntil;
    return [
      el("div.tonight__moon", { "aria-hidden": "true" }, [icon(ICONS.moon, 24)]),
      el("p.tonight__eyebrow", {}, t("tonight.doneEyebrow")),
      el("h1.tonight__title", {}, t("tonight.doneTitle")),
      el("p.tonight__lead", {}, t("tonight.doneLead")),
      until > Date.now() ? el("p.tonight__quiet", {}, [
        icon(ICONS.bell, 15),
        el("span", {}, t("tonight.quietNote", { time: fmtClock(until) })),
        el("button.linkbtn", {
          type: "button",
          onclick: () => { store.reopenTonight(plan.key); window.dispatchEvent(new Event("sb:reminders")); paint(); },
        }, t("tonight.reopen")),
      ]) : null,
      el("div.tonight__actions", {}, [
        el("a.btn.btn--ghost", { href: "#/" }, t("tonight.backHome")),
      ]),
    ].filter(Boolean);
  }
}
