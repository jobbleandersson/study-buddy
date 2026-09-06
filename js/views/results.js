// Results screen: animated score ring, per-topic mastery change, review list, confetti.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { deltaFromAttempt } from "../lib/mastery.js";
import { estimatedGrade, gradeRank } from "../lib/grade.js";
import { summarizeSchedule, dueLabel, retentionForecast } from "../lib/srs.js";
import { celebrate, clearConfetti } from "../lib/confetti-helper.js";
import { t, plural, daysUntil } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { playFanfare } from "../lib/sound.js";
import { parseCloze, clozeToUnderscores } from "../components/questions.js";
import { shareCard } from "../lib/share-card.js";

export function renderResults(attemptId) {
  const attempt = store.attempts.find((a) => a.id === attemptId);
  if (!attempt) {
    return el("div.empty", {}, [el("h2", {}, t("results.none")), el("a.btn.btn--ghost", { href: "#/" }, t("common.backToMenu"))]);
  }
  const assignment = store.getAssignment(attempt.assignmentId);
  const isReview = !!attempt.isReview;
  // A demo/library set follows the UI language, so show its current title
  // rather than whatever it was called when this attempt was recorded.
  const synced = assignment && (assignment._sampleLang || assignment._libLang);
  const heading = (synced && assignment.title) || attempt.title || assignment?.title || t("session.reviewTitle");
  const score = attempt.scorePct;
  const great = score >= 80;

  const before = store.attempts.filter((a) => a.finishedAt < attempt.finishedAt);
  const deltas = deltaFromAttempt(before, attempt);

  // Look questions up across the whole library — a review session mixes sets.
  // Paired (not two parallel arrays) so a since-deleted question can't
  // silently misalign the item and its question.
  const wrong = (attempt.items || []).filter((i) => !i.correct);
  const wrongEntries = wrong
    .map((item) => ({ item, question: store.findQuestion(item.questionId)?.question }))
    .filter((e) => e.question);

  // finish() commits SRS before redirecting here, so store.state.srs is already
  // "as of now" — but only for the freshly-finished attempt. Re-opening an
  // older result would read a schedule that has since moved, so gate on latest.
  const isLatest = store.attempts[store.attempts.length - 1]?.id === attempt.id;
  const sched = isLatest && attempt.items?.length
    ? summarizeSchedule(attempt.items, store.state.srs)
    : null;

  // "What you'll still remember" — the recall you'd lose without review versus
  // the recall your schedule holds. Horizon is the days to this set's test if
  // it has one, otherwise a fortnight.
  const daysToTest = assignment?.dueAt && assignment.type === "test" ? daysUntil(assignment.dueAt) : null;
  const horizonDays = daysToTest != null && daysToTest > 1 ? Math.min(30, daysToTest) : 14;
  const forecast = isLatest && attempt.items?.length
    ? retentionForecast(attempt.items, store.state.srs, { horizonDays })
    : null;
  const horizonLabel = daysToTest != null && daysToTest > 1
    ? t("results.retentionTestDay")
    : t("results.retentionHorizon", { n: horizonDays });

  const R = 74, C = 2 * Math.PI * R;
  const ringWrap = el("div.scorering");
  ringWrap.innerHTML = `
    <svg viewBox="0 0 180 180">
      <circle class="bg" cx="90" cy="90" r="${R}"></circle>
      <circle class="fg" cx="90" cy="90" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"
        stroke="${great ? "var(--ok)" : "var(--retry)"}"></circle>
      <text x="90" y="86" text-anchor="middle" font-size="34">${score}%</text>
      <text x="90" y="110" text-anchor="middle" font-size="13" fill="var(--ink-faint)">${countLabel(attempt)}</text>
    </svg>`;
  requestAnimationFrame(() => {
    const fg = ringWrap.querySelector(".fg");
    if (fg) fg.style.strokeDashoffset = String(C * (1 - score / 100));
  });

  if (great) setTimeout(() => { celebrate(); playFanfare(); }, 250);

  const deltaEntries = Object.entries(deltas).sort((a, b) => (b[1].after - b[1].before) - (a[1].after - a[1].before));

  const node = el("div.results", {}, [
    el("div", { style: { textAlign: "left" } }, [homeButton()]),
    el("h1", {}, t(great ? "results.great" : "results.nice")),
    el("p.note", {}, heading + (attempt.examMode ? t("results.examSuffix") : attempt.wasTest ? t("results.testSuffix") : "")),
    ringWrap,
    el("p.note", { style: { marginTop: "-8px" } }, [
      icon(ICONS.clock, 14),
      " ",
      elapsedLabel(attempt),
      attempt.timeLimitMin ? t("results.examLimit", { n: attempt.timeLimitMin }) : "",
      attempt.wasTest && !attempt.examMode && attempt.tutorHints > 0
        ? "  ·  " + plural(attempt.tutorHints, "results.hintsUsedOne", "results.hintsUsedMany")
        : "",
    ]),
    attempt.timedOut ? el("p.note.note--warn", {}, t("results.timedOut")) : null,

    gradeReveal(attempt),

    deltaEntries.length ? el("div", {}, [
      el("h3", { style: { marginBottom: "8px" } }, t("results.topicMastery")),
      el("div.delta-list", {}, deltaEntries.map(([topic, d]) => {
        const change = Math.round((d.after - d.before) * 100);
        return el("div.delta", {}, [
          el("span", { style: { textTransform: "capitalize", minWidth: "110px" } }, topic),
          el("span.delta__bar", {}, [el("i", { style: { width: "0%" }, dataset: { w: Math.round(d.after * 100) } })]),
          el("span", { class: "delta__n " + (change > 0 ? "up" : change < 0 ? "down" : ""), }, change > 0 ? `+${change}` : `${change}`),
        ]);
      })),
    ]) : null,

    wrongEntries.length ? el("div", { style: { marginTop: "8px", textAlign: "left" } }, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "8px" } }, [
        el("h3", {}, t("results.worthLook")),
        el("a.btn.btn--sm", { href: `#/practice/${attempt.id}` }, [icon(ICONS.spark, 16),
          wrongEntries.length === 1 ? t("results.practiseTheseOne") : t("results.practiseTheseMany", { n: wrongEntries.length })]),
      ]),
      attempt.wasTest && !attempt.tutorHints ? el("p.note", { style: { marginBottom: "8px" } },
        t("results.tutorSatOut")) : null,
      el("div.delta-list.delta-list--review", {}, wrongEntries.map(({ question: q }) => {
        const answerHtml = correctAnswerLine(q);
        const promptText = q.kind === "cloze" ? clozeToUnderscores(q.prompt) : q.prompt;
        return el("div.delta.delta--review", {}, [
          el("span.delta__prompt", { html: renderRich(promptText.length > 90 ? promptText.slice(0, 90) + "…" : promptText) }),
          answerHtml ? el("p.delta__answer", {}, [el("strong", {}, t("results.correctAnswerLabel")), " ", el("span", { html: answerHtml })]) : null,
          q.explanation ? el("p.delta__explain", { html: renderRich(q.explanation) }) : null,
        ].filter(Boolean));
      })),
    ].filter(Boolean)) : null,

    retentionSection(forecast, horizonLabel),

    sched && sched.scheduled ? el("div", { style: { marginTop: "8px", textAlign: "left" } }, [
      el("h3", { style: { marginBottom: "8px" } }, t("results.srsTitle")),
      el("p.note", {}, plural(sched.scheduled, "results.srsScheduledOne", "results.srsScheduledMany")),
      el("p.note.srs-next", {}, t("results.srsNext", {
        when: sched.relearnOnly ? t("results.srsRelearnLabel") : dueLabel(sched.nextRec),
      })),
      bucketLine(sched) ? el("p.note", {}, bucketLine(sched)) : null,
      reviewCta(),
    ].filter(Boolean)) : null,

    el("div", { style: { display: "flex", gap: "12px", justifyContent: "center", marginTop: "24px", flexWrap: "wrap" } }, [
      el("button.btn.btn--ghost", {
        type: "button",
        onclick: () => shareCard({
          tone: great ? "ok" : "brand",
          emoji: great ? "🎉" : "📚",
          tag: attempt.wasTest ? t("share.gradeTag") : t("share.scoreTag"),
          headline: `${score}%`,
          caption: heading,
          filename: "studybuddy-result.png",
        }),
      }, [icon(ICONS.share, 16), t("share.shareButton")]),
      retryHash(attempt, assignment) && el("a.btn.btn--ghost", { href: retryHash(attempt, assignment) },
        t(isReview ? "results.reviewAgain" : "results.tryAgain")),
      el("a.btn.btn--ghost", { href: "#/progress" }, t("results.seeProgress")),
      el("a.btn.btn--ghost", { href: "#/" }, t("common.backToMenu")),
    ].filter(Boolean)),
  ]);

  requestAnimationFrame(() => {
    node.querySelectorAll(".delta__bar i").forEach((i) => { i.style.width = `${i.dataset.w}%`; });
  });

  return { title: t("results.title"), node, cleanup: clearConfetti };
}

function countLabel(attempt) {
  const n = (attempt.items || []).length;
  const c = (attempt.items || []).filter((i) => i.correct).length;
  return t("results.correctOf", { c, n });
}

/** For a real exam-conditions run (a "test"-type set, or any exam-mode
 *  session — never a review, which isn't "taking an exam" on one set), a
 *  prominent estimated-grade reveal: the letter this result maps to, plus
 *  how it stacks up against your own best on this same set so far. Nothing
 *  to reveal for an ordinary practice run — the per-topic deltas cover that.
 *  Always captioned as an estimate, never a real grade. */
function gradeReveal(attempt) {
  if (!attempt.wasTest || attempt.isReview) return null;

  const grade = estimatedGrade(attempt.scorePct / 100);
  const rank = gradeRank(grade.letter);

  const priorBestPct = store.attempts
    .filter((a) => a.id !== attempt.id && a.assignmentId === attempt.assignmentId && a.wasTest && a.finishedAt < attempt.finishedAt)
    .reduce((best, a) => Math.max(best, a.scorePct), -1);

  let compare, compareClass = "";
  if (priorBestPct < 0) {
    compare = t("results.gradeFirstTime");
  } else {
    const priorRank = gradeRank(estimatedGrade(priorBestPct / 100).letter);
    const priorLetter = estimatedGrade(priorBestPct / 100).letter;
    if (rank > priorRank) { compare = t("results.gradeUpFrom", { letter: priorLetter }); compareClass = "up"; }
    else if (rank === priorRank) compare = t("results.gradeMatchesBest");
    else { compare = t("results.gradeBestSoFar", { letter: priorLetter }); compareClass = "down"; }
  }

  return el("div.gradereveal" + `.gradereveal--${grade.tier}`, {}, [
    el("span.gradereveal__eyebrow", {}, t("results.gradeEyebrow")),
    el("div.gradereveal__letter", {}, grade.letter),
    el("p.gradereveal__compare" + (compareClass ? `.${compareClass}` : ""), {}, compare),
    el("p.gradereveal__caption", {}, t("prog.gradeTooltip", { letter: grade.letter })),
  ]);
}

/** The correct answer, in whatever shape fits the question's kind — reuses
 *  the exact answer/explanation content already authored on the question,
 *  never shown anywhere until now for a test/exam run. */
function correctAnswerLine(q) {
  switch (q.kind) {
    case "mc":
      return Array.isArray(q.choices) && q.choices[q.answer] != null ? renderRich(q.choices[q.answer]) : "";
    case "cloze":
      // The whole sentence, with each blank filled in and emphasised — reads
      // better than a bare list of the missing words.
      return parseCloze(q.prompt)
        .map((p) => (p.blank ? `<strong>${renderRich(p.blank[0])}</strong>` : renderRich(p.text)))
        .join("");
    case "text": case "worked": case "flashcard":
      return q.answer ? renderRich(q.answer) : "";
    default:
      return "";
  }
}

/** "What you'll still remember" — a two-curve forgetting-curve forecast plus a
 *  one-line reading. Null when retentionForecast() had too little to work with.
 *  Everything here is captioned as an estimate. */
function retentionSection(f, horizonLabel) {
  if (!f) return null;
  const without = Math.round(f.decayed * 100);
  const withPlan = Math.round(f.held * 100);
  return el("div", { style: { marginTop: "8px", textAlign: "left" } }, [
    el("h3", { style: { marginBottom: "8px" } }, t("results.retentionTitle")),
    retentionChart(f, horizonLabel, without, withPlan),
    el("div.retention__legend", {}, [
      el("span", {}, [el("i.retention__k.retention__k--without"), t("results.retentionWithout")]),
      el("span", {}, [el("i.retention__k.retention__k--with"), t("results.retentionWith")]),
    ]),
    el("p.note", { style: { marginTop: "8px" } },
      t("results.retentionLine", { when: horizonLabel, without, with: withPlan })),
    el("p.note", {}, f.reviewsInWindow
      ? plural(f.reviewsInWindow, "results.retentionReviewsOne", "results.retentionReviewsMany")
      : t("results.retentionNoReviews")),
    el("p.note.retention__cap", {}, t("results.retentionCaption")),
  ]);
}

function retentionChart(f, horizonLabel, without, withPlan) {
  const w = 320, h = 132, padL = 30, padR = 12, padT = 12, padB = 22;
  const x = (frac) => padL + frac * (w - padL - padR);
  const y = (r) => padT + (1 - r) * (h - padT - padB);
  const curve = (end) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const frac = i / 12;
      pts.push(`${x(frac).toFixed(1)},${y(f.now * Math.pow(Math.max(0.05, end) / f.now, frac)).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const dots = f.reviewFracs.map((frac) =>
    `<circle cx="${x(frac).toFixed(1)}" cy="${y(f.now * Math.pow(Math.max(0.05, f.held) / f.now, frac)).toFixed(1)}" r="3" class="retention__dot"/>`
  ).join("");
  const wrap = el("div", {
    role: "img",
    "aria-label": t("results.retentionAria", { when: horizonLabel, without, with: withPlan }),
  });
  wrap.innerHTML =
    `<svg class="retention" viewBox="0 0 ${w} ${h}">` +
    `<line x1="${padL}" y1="${y(0.9).toFixed(1)}" x2="${w - padR}" y2="${y(0.9).toFixed(1)}" class="retention__grid"/>` +
    `<line x1="${padL}" y1="${y(0.5).toFixed(1)}" x2="${w - padR}" y2="${y(0.5).toFixed(1)}" class="retention__grid"/>` +
    `<text x="${padL - 5}" y="${(y(0.9) + 3).toFixed(1)}" text-anchor="end" class="retention__lab">90%</text>` +
    `<text x="${padL - 5}" y="${(y(0.5) + 3).toFixed(1)}" text-anchor="end" class="retention__lab">50%</text>` +
    `<text x="${padL}" y="${h - 6}" class="retention__lab">${t("results.retentionNow")}</text>` +
    `<text x="${w - padR}" y="${h - 6}" text-anchor="end" class="retention__lab">+${f.horizonDays} d</text>` +
    `<polyline points="${curve(f.decayed)}" class="retention__without"/>` +
    `<polyline points="${curve(f.held)}" class="retention__with"/>` +
    dots +
    `</svg>`;
  return wrap;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** "3 back in a day or two · 2 back again shortly" — the same `·`-joined
 *  idiom the elapsed-time line uses. Empty when there's nothing to break down. */
function bucketLine(s) {
  const p = [];
  if (s.relearn) p.push(t("results.srsRelearn", { n: s.relearn }));
  if (s.soon) p.push(t("results.srsSoon", { n: s.soon }));
  if (s.later) p.push(t("results.srsLater", { n: s.later }));
  return p.join("  ·  ");
}

/** Right after a session almost nothing is due *now* — everything's scheduled
 *  forward. Only show a live "Review N" button when there's a real backlog;
 *  otherwise the honest message is that the home screen will surface these
 *  when their time comes (the "due" pill + app badge already track it). */
function reviewCta() {
  const dueNow = store.dueQuestions().length;
  return dueNow
    ? el("a.btn.btn--sm", { href: "#/review" }, [icon(ICONS.spark, 16), t("results.srsReviewNow", { n: dueNow })])
    : el("p.note", {}, t("results.srsComeBack"));
}

/** Attempts made before retryHash existed fall back to their assignment. */
function retryHash(attempt, assignment) {
  if (attempt.retryHash) return attempt.retryHash;
  if (attempt.isReview) return "#/review";
  return assignment ? `#/session/${assignment.id}` : null;
}

function elapsedLabel(attempt) {
  const ms = (attempt.finishedAt || 0) - (attempt.startedAt || 0);
  if (!(ms > 0)) return "";
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    return t("results.tookHour", { h, m: mins % 60 });
  }
  if (!mins) return t("results.tookSec", { n: secs });
  return t("results.tookMin", { n: mins });
}
