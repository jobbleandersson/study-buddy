// Exam prep. `#/exam-prep` is a subject picker; `#/exam-prep/:id` is the
// per-subject dashboard — the countdown to your test, where you stand, your
// weak spots, and two actions (drill weak spots / timed mock exam).
// Composed entirely from existing helpers; no new persisted state — it
// recomputes from dueAt / mastery / attempts / the srs map on every visit.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { t, plural, daysUntil } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { countdownLabel } from "../lib/date-phrases.js";
import {
  masteryByTopic, masteryForSubject, masteryForAssignment, weakSpotQuestions,
} from "../lib/mastery.js";

const MOCK_LENGTHS = [20, 40, 60];
const MOCK_COUNT = 20;
const MOCK_MIN_QUESTIONS = 5;

export function renderExamPrep(subjectId) {
  if (!subjectId) return renderLanding();

  const subject = store.subjects.find((s) => s.id === subjectId);
  if (!subject) return emptyScreen(t("exam.noSubject"));

  const sets = store.assignments.filter((a) => a.subjectId === subjectId);
  const heading = `${subject.name} — ${t("exam.pageTitle")}`;

  if (!sets.length) {
    return {
      title: heading,
      node: el("div.exam-prep", {}, [
        homeButton(),
        el("h1", {}, heading),
        el("section.panel", {}, [
          el("p", {}, t("exam.noSets", { subject: subject.name })),
          el("a.btn", { href: "#/library", style: { marginTop: "12px" } },
            [icon(ICONS.book, 16), t("exam.addFromLibrary")]),
        ]),
      ]),
    };
  }

  const tm = masteryByTopic(store.attempts);
  const color = store.subjectColor(subjectId);

  /* ---- countdown ---- */
  const testSet = store.upcomingDue().find((a) => a.subjectId === subjectId && a.type === "test");
  const head = el("section.panel.exam-prep__head", {}, [
    testSet
      ? el("p.exam-prep__when", {}, [
          icon(ICONS.clock, 16), " ",
          t("exam.testIn", { subject: subject.name, when: countdownLabel(testSet.dueAt) }),
        ])
      : el("p.note", {}, `${t("exam.noDate")} ${t("exam.setDateHint")}`),
  ]);

  /* ---- where you stand ---- */
  const m = masteryForSubject(subjectId, store.assignments, tm);
  const pct = m == null ? null : Math.round(m * 100);
  const masteryPanel = el("section.panel", {}, [
    el("h3", {}, t("exam.masteryHeading", { subject: subject.name })),
    m == null
      ? el("p.note", {}, t("exam.masteryUnknown"))
      : el("div.meter", {}, [
          el("span", {}, subject.name),
          el("div.meter__track", {
            role: "img", "aria-label": t("prog.masteryAria", { subject: subject.name, pct }),
          }, [el("div.meter__fill", { style: { width: `${pct}%`, "--subject": color.solid } })]),
          el("span.tabular", { style: { textAlign: "right", fontWeight: "700" } }, `${pct}%`),
        ]),
  ]);

  /* ---- weak spots ---- */
  const weak = weakSpotQuestions(sets, store.attempts);
  const weakTopics = [...new Set(weak.map((w) => w.question.topic))].slice(0, 4);
  const weakPanel = el("section.panel", {}, [
    el("h3", {}, t("exam.weakHeading")),
    weak.length
      ? el("div", {}, [
          el("p", {}, plural(weak.length, "exam.weakCountOne", "exam.weakCountMany")),
          weakTopics.length ? el("p.note", {}, weakTopics.join(" · ")) : null,
        ].filter(Boolean))
      : el("p.note", {}, t("exam.weakNone")),
  ]);

  /* ---- your sets ---- */
  const setsPanel = el("section.panel", {}, [
    el("h3", {}, t("exam.setsHeading", { subject: subject.name })),
    el("div.exam-prep__sets", {}, sets.map((a) => {
      const sm = masteryForAssignment(a, tm);
      return el("a.exam-prep__set", { href: `#/session/${a.id}` }, [
        el("span.exam-prep__set-title", {}, a.title),
        el("span.exam-prep__set-pct", {}, sm == null ? "—" : `${Math.round(sm * 100)}%`),
        icon(ICONS.play, 14),
      ]);
    })),
  ]);

  /* ---- due for review ---- */
  const dueN = store.dueQuestions().filter((d) => d.assignment.subjectId === subjectId).length;
  const duePanel = dueN
    ? el("section.panel", {}, [
        el("p", { style: { marginBottom: "8px" } }, plural(dueN, "exam.dueSrsOne", "exam.dueSrsMany")),
        el("a.linkbtn", { href: "#/review" }, [icon(ICONS.spark, 13), " ", t("prog.reviewToday")]),
      ])
    : null;

  /* ---- actions ---- */
  const totalQ = sets.reduce((n, a) => n + a.questions.length, 0);
  let mockLen = 40;
  const lenSel = el("select", {
    "aria-label": t("exam.mockLenLabel"),
    onchange: (e) => { mockLen = Number(e.target.value) || 40; },
  }, MOCK_LENGTHS.map((n) => el("option", { value: String(n) }, `${n} min`)));
  lenSel.value = "40";

  const actions = el("section.panel.exam-prep__actions", {}, [
    weak.length
      ? el("a.btn", { href: `#/practice-weak?subject=${subjectId}` },
          [icon(ICONS.target, 16), t("exam.drillBtn")])
      : null,
    totalQ >= MOCK_MIN_QUESTIONS
      ? el("div.exam-prep__mock", {}, [
          el("label.field", { style: { maxWidth: "150px", margin: "0" } },
            [el("span", {}, t("exam.mockLenLabel")), lenSel]),
          el("button.btn", {
            type: "button",
            onclick: () => {
              location.hash = `#/national/mix/${subjectId}?exam=1&min=${mockLen}&count=${MOCK_COUNT}`;
            },
          }, [icon(ICONS.clock, 16), t("exam.mockBtn")]),
        ])
      : el("p.note", {}, t("exam.mockTooFew")),
  ].filter(Boolean));

  return {
    title: heading,
    node: el("div.exam-prep", {}, [
      homeButton(),
      el("h1", {}, heading),
      head,
      masteryPanel,
      weakPanel,
      setsPanel,
      duePanel,
      actions,
    ].filter(Boolean)),
  };
}

/** `#/exam-prep` — pick a subject. Subjects with a test coming up sort
 *  first (soonest), then weakest mastery, then name. */
function renderLanding() {
  const tm = masteryByTopic(store.attempts);
  const withSets = store.subjects.filter((s) => store.assignments.some((a) => a.subjectId === s.id));

  if (!withSets.length) {
    return {
      title: t("exam.pageTitle"),
      node: el("div.exam-prep", {}, [
        homeButton(),
        el("h1", {}, t("exam.pageTitle")),
        el("section.panel", {}, [
          el("p", {}, t("exam.landingEmpty")),
          el("a.btn", { href: "#/library", style: { marginTop: "12px" } },
            [icon(ICONS.book, 16), t("exam.addFromLibrary")]),
        ]),
      ]),
    };
  }

  const rows = withSets.map((s) => {
    const test = store.upcomingDue().find((a) => a.subjectId === s.id && a.type === "test");
    const m = masteryForSubject(s.id, store.assignments, tm);
    return { s, test, m, days: test ? daysUntil(test.dueAt) : Infinity, mSort: m == null ? 1.01 : m };
  }).sort((a, b) => a.days - b.days || a.mSort - b.mSort || a.s.name.localeCompare(b.s.name));

  return {
    title: t("exam.pageTitle"),
    node: el("div.exam-prep", {}, [
      homeButton(),
      el("h1", {}, t("exam.pageTitle")),
      el("p.note", { style: { marginTop: "-4px" } }, t("exam.landingSub")),
      el("div.exam-prep__pick", {}, rows.map(({ s, test, m }) => {
        const color = store.subjectColor(s.id);
        return el("a.exam-prep__pick-card", {
          href: `#/exam-prep/${s.id}`,
          style: { "--subject": color.solid },
        }, [
          el("span.exam-prep__pick-name", {}, s.name),
          test ? el("span.exam-prep__pick-when", {}, countdownLabel(test.dueAt)) : null,
          el("span.exam-prep__pick-pct", {}, m == null ? "" : `${Math.round(m * 100)}%`),
          icon(ICONS.arrow, 16),
        ].filter(Boolean));
      })),
    ]),
  };
}

function emptyScreen(msg) {
  return {
    title: t("exam.pageTitle"),
    node: el("div.empty", {}, [
      el("h2", {}, t("exam.pageTitle")),
      el("p", {}, msg),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
    ]),
  };
}
