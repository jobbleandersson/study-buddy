// Results screen: animated score ring, per-topic mastery change, review list, confetti.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { deltaFromAttempt } from "../lib/mastery.js";
import { celebrate, clearConfetti } from "../lib/confetti-helper.js";
import { t, plural } from "../lib/i18n.js";
import { playFanfare } from "../lib/sound.js";

export function renderResults(attemptId) {
  const attempt = store.attempts.find((a) => a.id === attemptId);
  if (!attempt) {
    return el("div.empty", {}, [el("h2", {}, t("results.none")), el("a.btn.btn--ghost", { href: "#/" }, t("common.backToMenu"))]);
  }
  const assignment = store.getAssignment(attempt.assignmentId);
  const isReview = !!attempt.isReview;
  const heading = attempt.title || assignment?.title || t("session.reviewTitle");
  const score = attempt.scorePct;
  const great = score >= 80;

  const before = store.attempts.filter((a) => a.finishedAt < attempt.finishedAt);
  const deltas = deltaFromAttempt(before, attempt);

  // Look questions up across the whole library — a review session mixes sets.
  const wrong = (attempt.items || []).filter((i) => !i.correct);
  const wrongQ = wrong.map((i) => store.findQuestion(i.questionId)?.question).filter(Boolean);

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
    el("h1", {}, t(great ? "results.great" : "results.nice")),
    el("p.note", {}, heading + (attempt.wasTest ? t("results.testSuffix") : "")),
    ringWrap,
    el("p.note", { style: { marginTop: "-8px" } }, [
      icon(ICONS.clock, 14),
      " ",
      elapsedLabel(attempt),
      attempt.wasTest && attempt.tutorHints > 0
        ? "  ·  " + plural(attempt.tutorHints, "results.hintsUsedOne", "results.hintsUsedMany")
        : "",
    ]),

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

    wrongQ.length ? el("div", { style: { marginTop: "8px", textAlign: "left" } }, [
      el("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "8px" } }, [
        el("h3", {}, t("results.worthLook")),
        el("a.btn.btn--sm", { href: `#/practice/${attempt.id}` }, [icon(ICONS.spark, 16),
          wrongQ.length === 1 ? t("results.practiseTheseOne") : t("results.practiseTheseMany", { n: wrongQ.length })]),
      ]),
      attempt.wasTest && !attempt.tutorHints ? el("p.note", { style: { marginBottom: "8px" } },
        t("results.tutorSatOut")) : null,
      el("div.delta-list", {}, wrongQ.map((q) => el("div.delta", {}, [
        el("span", { html: renderRich(q.prompt.length > 90 ? q.prompt.slice(0, 90) + "…" : q.prompt) }),
      ]))),
    ].filter(Boolean)) : null,

    el("div", { style: { display: "flex", gap: "12px", justifyContent: "center", marginTop: "24px", flexWrap: "wrap" } }, [
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
