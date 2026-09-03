// "Teach it back" — the student explains a topic they've nearly mastered in
// their own words, and the tutor grades the explanation. Reinforces recall on
// strong subjects and feeds mastery like any other attempt.
//
// Live mode grades with Claude; demo mode falls back to a length heuristic and
// generic encouragement, so the flow is fully walkable without a key.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { gradeAnswer } from "../claude.js";
import { review, fromCorrect } from "../lib/srs.js";
import { masteryByTopic } from "../lib/mastery.js";
import { homeButton } from "../components/nav.js";

const ROUNDS = 3;

export function renderTeachback(subjectId) {
  const subject = store.subjects.find((s) => s.id === subjectId);
  if (!subject) return notFound();

  const sets = store.assignments.filter((a) => a.subjectId === subjectId);
  const tm = masteryByTopic(store.attempts);

  // One representative question per topic (for a model answer + a real id to
  // hang the SRS update on). Strongest topics first — this is a victory lap.
  const byTopic = new Map();
  for (const a of sets) {
    for (const q of a.questions || []) {
      if (!q.topic || byTopic.has(q.topic)) continue;
      byTopic.set(q.topic, q);
    }
  }
  const topics = [...byTopic.keys()]
    .sort((x, y) => (tm[y] ?? 0) - (tm[x] ?? 0))
    .slice(0, ROUNDS);

  if (!topics.length) return notFound();

  const root = el("div");
  const state = { round: 0, items: [], startedAt: Date.now() };

  function paint() {
    clear(root);
    root.appendChild(homeButton());
    root.appendChild(el("h1", { style: { marginBottom: "8px" } }, t("teach.title")));
    root.appendChild(el("p.note", { style: { marginBottom: "16px" } }, t("teach.intro", { subject: subject.name })));

    if (state.round >= topics.length) { root.appendChild(summary()); return; }
    root.appendChild(roundPanel(topics[state.round]));
  }

  function roundPanel(topic) {
    const q = byTopic.get(topic);
    const ta = el("textarea.answerbox", {
      placeholder: t("teach.placeholder"), "aria-label": t("teach.answerAria"),
    });
    const feedback = el("div", {});
    const submitBtn = el("button.btn.btn--sm", { type: "button", onclick: grade }, t("teach.submit"));
    const nextBtn = el("button.btn", { type: "button", hidden: true, onclick: () => { state.round++; paint(); window.scrollTo(0, 0); } },
      state.round + 1 >= topics.length ? t("teach.finish") : t("teach.next"));

    async function grade() {
      const answer = ta.value.trim();
      if (!answer) return;
      submitBtn.disabled = true; ta.disabled = true;

      let verdict = null;
      if (store.hasKey()) {
        submitBtn.textContent = t("teach.checking");
        try {
          verdict = await gradeAnswer({
            question: {
              prompt: t("teach.gradePrompt", { topic }),
              answer: q.answer || q.prompt || topic,
              rubric: t("teach.rubric"),
            },
            studentAnswer: answer,
          });
        } catch { verdict = null; }
      }
      if (!verdict) {
        const ok = answer.split(/\s+/).length >= 12;
        verdict = { correct: ok, feedback: t(ok ? "teach.demoOk" : "teach.demoThin"), missedPoints: [] };
      }

      const grd = verdict.correct ? "good" : "hard";
      state.items.push({
        questionId: q.id, topic, correct: !!verdict.correct,
        srsGrade: grd, selfRating: null, confidence: null, hintsUsed: 0, appealed: false,
      });

      feedback.className = `feedback ${verdict.correct ? "ok" : "retry"}`;
      feedback.innerHTML = `<p>${escapeHtml(verdict.feedback)}</p>` +
        (verdict.missedPoints?.length
          ? `<ul>${verdict.missedPoints.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : "");
      submitBtn.remove();
      nextBtn.hidden = false;
      nextBtn.focus();
    }

    return el("div.panel", {}, [
      el("p.note", {}, t("teach.round", { n: state.round + 1, total: topics.length })),
      el("h2", { style: { margin: "4px 0 12px" } }, t("teach.ask", { topic })),
      ta,
      el("div", { style: { marginTop: "12px", display: "flex", gap: "10px" } }, [submitBtn, nextBtn]),
      feedback,
    ]);
  }

  function summary() {
    // Record it once, the first time the summary renders.
    if (!state._recorded && state.items.length) {
      state._recorded = true;
      const correct = state.items.filter((i) => i.correct).length;
      store.recordAttempt({
        id: uid(),
        assignmentId: "__teachback__",
        isReview: false,
        title: t("teach.attemptTitle", { subject: subject.name }),
        retryHash: `#/teachback/${subjectId}`,
        wasTest: false,
        startedAt: state.startedAt,
        finishedAt: Date.now(),
        scorePct: Math.round((correct / state.items.length) * 100),
        items: state.items,
      });
      for (const it of state.items) {
        const rec = review(store.state.srs[it.questionId], it.srsGrade || fromCorrect(it.correct));
        store.setSrs(it.questionId, rec);
      }
    }

    const correct = state.items.filter((i) => i.correct).length;
    return el("div.panel", { style: { textAlign: "center" } }, [
      icon(ICONS.check, 26),
      el("h2", { style: { margin: "8px 0" } }, t("teach.doneTitle")),
      el("p", {}, t("teach.doneBody", { correct, total: state.items.length })),
      el("div", { style: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "16px", flexWrap: "wrap" } }, [
        el("a.btn", { href: "#/progress" }, t("teach.toProgress")),
        el("a.btn.btn--ghost", { href: "#/" }, t("common.backToMenu")),
      ]),
    ]);
  }

  paint();
  return { title: t("teach.title"), node: root };
}

function notFound() {
  return {
    title: t("teach.title"),
    node: el("div.empty", {}, [
      el("h2", {}, t("teach.goneTitle")),
      el("p", {}, t("teach.goneBody")),
      el("a.btn.btn--ghost", { href: "#/progress", style: { marginTop: "16px" } }, t("common.progress")),
    ]),
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
