// Question renderers, one per kind. Each returns { el, result } and calls
// opts.onDone(result) when the student has finished the question.
//   result = { correct, hintsUsed, selfRating?, srsGrade }
//
// opts: { question, tutor, live, onDone }

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { gradeAnswer } from "../claude.js";
import { fromCorrect } from "../lib/srs.js";
import { t } from "../lib/i18n.js";
import { mathKeypad } from "./math-keypad.js";
import { heuristic, normalizeAnswer } from "../lib/answer-match.js";

export function renderQuestion(opts) {
  switch (opts.question.kind) {
    case "mc": return mc(opts);
    case "flashcard": return flashcard(opts);
    case "worked": return worked(opts);
    // A cloze with no {{blanks}} is just a short-answer question — fall through
    // rather than render a sentence nobody can answer.
    case "cloze": return parseCloze(opts.question.prompt).some((p) => p.blank) ? cloze(opts) : text(opts);
    default: return text(opts);
  }
}

/**
 * Splits a cloze prompt into text runs and blanks.
 * "The capital is {{Paris|paris}}." -> [{text}, {blank:["Paris","paris"]}, {text}]
 */
export function parseCloze(prompt) {
  const parts = [];
  const re = /\{\{(.+?)\}\}/g;
  let last = 0, m;
  const src = String(prompt || "");
  while ((m = re.exec(src))) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index) });
    parts.push({ blank: m[1].split("|").map((s) => s.trim()).filter(Boolean) });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ text: src.slice(last) });
  return parts;
}

/**
 * A cloze prompt rendered for a *preview* context — results, the review list,
 * a printed worksheet — where the blanks aren't fillable and raw `{{ }}` must
 * never leak out. Each blank becomes `fill` ("____" by default). Non-cloze
 * text passes straight through.
 */
export function clozeToUnderscores(prompt, fill = "____") {
  const src = String(prompt || "");
  if (!src.includes("{{")) return src;
  return parseCloze(src).map((p) => (p.blank ? fill : p.text)).join("");
}

function shell(question, body, { showPrompt = true } = {}) {
  return el("div.question", {}, [
    showPrompt && el("div.question__prompt", { html: renderRich(question.prompt) }),
    body,
  ].filter(Boolean));
}

/* ---------------- multiple choice ---------------- */
function mc({ question, tutor, testMode, onDone, askConfidence }) {
  const result = { correct: false, hintsUsed: 0 };
  let picked = -1, attempts = 0, done = false;

  const btns = question.choices.map((c, i) =>
    el("button.choice", {
      type: "button",
      onclick: () => { if (done) return; picked = i; sync(); },
    }, [
      el("span.choice__key", {}, String.fromCharCode(65 + i)),
      el("span", { html: renderRich(c) }),
    ]));

  const checkBtn = el("button.btn.btn--sm", { type: "button", disabled: true, onclick: check }, t("q.check"));
  const feedback = el("div", {});
  const list = el("div.choices", {}, btns);

  function sync() {
    btns.forEach((b, i) => b.setAttribute("aria-pressed", String(i === picked)));
    checkBtn.disabled = picked < 0;
  }

  const triedWrong = new Set();
  let lastWrongChoice = "";

  function check() {
    if (picked < 0 || done) return;
    attempts++;
    const correct = picked === question.answer;
    btns.forEach((b) => (b.disabled = true));

    // In a test the answer is recorded as-is: no marking, no second try,
    // no reveal. Everything is explained on the results screen instead.
    if (testMode) {
      done = true;
      result.correct = correct;
      result.hintsUsed = 0;
      btns[picked].setAttribute("aria-pressed", "true");
      feedback.className = "feedback";
      feedback.textContent = t("q.recorded");
      checkBtn.remove();
      onDone(finalize(result));
      return;
    }

    btns[picked].classList.add(correct ? "is-correct" : "is-wrong");
    if (correct) {
      btns[question.answer].classList.add("is-correct");
      done = true;
      result.correct = true;
      result.hintsUsed = attempts - 1;
      feedback.className = "feedback ok";
      feedback.innerHTML = renderRich(question.explanation || t("q.correct"));
      checkBtn.remove();
      tutor?.celebrate(t("q.tutorRight"));
      maybeConfidence(finalize(result), feedback, onDone, askConfidence);
    } else {
      result.hintsUsed = attempts;
      lastWrongChoice = question.choices[picked];
      feedback.className = "feedback retry";
      feedback.textContent = attempts >= 2
        ? t("q.stillNotRight")
        : t("q.notQuite");
      tutor?.note(t("q.tutorWrongMc", { choice: question.choices[picked] }));
      triedWrong.add(picked);
      btns.forEach((b, i) => {
        b.setAttribute("aria-pressed", "false");
        b.disabled = triedWrong.has(i);          // eliminate options already ruled out
      });
      picked = -1; checkBtn.disabled = true;
      if (attempts >= 2 && !document.getElementById("mc-reveal")) {
        const reveal = el("button.btn.btn--ghost.btn--sm", { id: "mc-reveal", type: "button", onclick: revealAnswer }, t("q.reveal"));
        feedback.appendChild(el("div", { style: { marginTop: "10px" } }, [reveal]));
      }
    }
  }

  function revealAnswer() {
    done = true;
    result.correct = false;
    btns.forEach((b) => (b.disabled = true));
    btns[question.answer].classList.add("is-correct");
    feedback.className = "feedback retry";
    feedback.innerHTML = renderRich(question.explanation || t("q.answerIs", { letter: String.fromCharCode(65 + question.answer) }));
    explainWhyRow(tutor, question, lastWrongChoice, feedback);
    maybeConfidence(finalize(result), feedback, onDone, askConfidence);
  }

  // A–D / 1–4 pick a choice; Enter checks it.
  function handleKey(e) {
    if (done) return false;
    const letter = e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) - 65 : -1;
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    const idx = letter >= 0 && letter < btns.length ? letter : digit;
    if (idx >= 0 && idx < btns.length && !btns[idx].disabled) {
      picked = idx; sync(); btns[idx].focus();
      return true;
    }
    if (e.key === "Enter" && picked >= 0) { check(); return true; }
    return false;
  }

  return {
    result, handleKey,
    el: shell(question, el("div", {}, [list, el("div", { style: { marginTop: "16px" } }, [checkBtn]), feedback])),
  };
}

/* ---------------- short text ---------------- */
function text({ question, tutor, live, testMode, onDone, askConfidence }) {
  const result = { correct: false, hintsUsed: 0 };
  const ta = el("textarea.answerbox", { placeholder: t("q.typeAnswer"), "aria-label": t("q.yourAnswer") });
  const keypad = mathKeypad(ta);
  const checkBtn = el("button.btn.btn--sm", { type: "button", onclick: check },
    t(testMode ? "q.submit" : "q.check"));
  const feedback = el("div", {});
  const selfRate = el("div", {});

  async function check() {
    const ans = ta.value.trim();
    if (!ans) return;
    checkBtn.disabled = true; ta.disabled = true;
    keypad.toggle.remove(); keypad.pad.remove();
    result.hintsUsed++;

    let verdict = null;
    try {
      if (live) {
        checkBtn.textContent = t(testMode ? "q.submitting" : "q.checking");
        try { verdict = await gradeAnswer({ question, studentAnswer: ans }); }
        catch { verdict = null; }
      }
      if (!verdict) verdict = heuristic(ans, question.answer);
    } catch (e) {
      console.error("Grading failed:", e);
      verdict = { correct: false, feedback: t("q.gradingFailed"), missedPoints: [] };
    }

    // Test mode: grade silently, show nothing, move on.
    if (testMode) {
      result.correct = verdict.correct;
      feedback.className = "feedback";
      feedback.textContent = t("q.recorded");
      checkBtn.remove();
      onDone(finalize(result));
      return;
    }

    feedback.className = `feedback ${verdict.correct ? "ok" : "retry"}`;
    feedback.innerHTML =
      `<p>${escapeHtml(verdict.feedback)}</p>` +
      (verdict.missedPoints?.length ? `<ul>${verdict.missedPoints.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : "") +
      `<p style="margin-top:10px"><strong>${escapeHtml(t("q.modelAnswer"))}</strong> ${renderRich(question.answer)}</p>`;

    if (verdict.correct) tutor?.celebrate(t("q.tutorGotIt"));
    else tutor?.note(t("q.tutorWhatMissing", { answer: ans }));

    // The grade stands on its own — the student no longer marks their own
    // work. They can appeal it, which is recorded rather than silently taken.
    result.correct = verdict.correct;
    checkBtn.remove();
    maybeConfidence(finalize(result), feedback, onDone, askConfidence);

    clear(selfRate);
    if (!verdict.correct) {
      explainWhyRow(tutor, question, ans, selfRate);
      const appeal = el("button.linkbtn", {
        type: "button",
        onclick: () => {
          result.correct = true;
          result.appealed = true;
          result.revised = true;
          // The grade changed, so its review schedule has to be recomputed —
          // otherwise an appealed answer is still scheduled as a lapse.
          result.srsGrade = null;
          onDone(finalize(result));
          clear(selfRate);
          selfRate.appendChild(el("p.note", {}, t("q.appealDone")));
        },
      }, t("q.appeal"));
      selfRate.appendChild(el("p.note", { style: { marginTop: "12px" } }, [
        t("q.disagree"), appeal, ".",
      ]));
    }
  }

  return {
    result,
    el: shell(question, el("div", {}, [
      ta, keypad.pad,
      el("div", { style: { marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" } }, [checkBtn, keypad.toggle]),
      feedback, selfRate,
    ])),
  };
}

/* ---------------- cloze (fill in the blank) ---------------- */
function cloze({ question, tutor, testMode, onDone, askConfidence }) {
  const result = { correct: false, hintsUsed: 0 };
  const blanks = [];
  const line = el("div.cloze");

  for (const p of parseCloze(question.prompt)) {
    if (p.blank) {
      const inp = el("input.cloze__blank", {
        type: "text", autocomplete: "off", spellcheck: "false",
        size: String(Math.max(5, Math.min(20, (p.blank[0] || "").length + 3))),
        "aria-label": t("q.blankAria", { n: blanks.length + 1 }),
        onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } },
      });
      blanks.push({ inp, alts: p.blank });
      line.appendChild(inp);
    } else {
      line.appendChild(el("span", { html: renderRich(p.text) }));
    }
  }

  const checkBtn = el("button.btn.btn--sm", { type: "button", onclick: check },
    t(testMode ? "q.submit" : "q.check"));
  const feedback = el("div", {});
  let done = false;

  function check() {
    if (done) return;
    done = true;
    let allRight = true;
    for (const b of blanks) {
      const ok = b.alts.some((a) => normalizeAnswer(a) === normalizeAnswer(b.inp.value));
      if (!ok) allRight = false;
      b.inp.disabled = true;
      b.inp.classList.add(ok ? "is-correct" : "is-wrong");
    }
    result.correct = allRight;
    checkBtn.remove();

    if (testMode) {
      feedback.className = "feedback";
      feedback.textContent = t("q.recorded");
      onDone(finalize(result));
      return;
    }

    feedback.className = `feedback ${allRight ? "ok" : "retry"}`;
    const missed = blanks.filter((b) => !b.inp.classList.contains("is-correct"));
    feedback.innerHTML = allRight
      ? renderRich(question.explanation || t("q.correct"))
      : `<p>${escapeHtml(t("q.clozeMissed"))}</p><ul>${missed
          .map((b) => `<li>${escapeHtml(b.alts[0])}</li>`).join("")}</ul>` +
        (question.explanation ? renderRich(question.explanation) : "");

    if (allRight) tutor?.celebrate(t("q.tutorRight"));
    else {
      tutor?.note(t("q.tutorClozeWrong"));
      explainWhyRow(tutor, question, blanks.map((b) => b.inp.value).filter(Boolean).join(", "), feedback);
    }
    maybeConfidence(finalize(result), feedback, onDone, askConfidence);
  }

  return {
    result,
    // The prompt IS the sentence with the blanks, so don't print it twice.
    el: shell(question, el("div", {}, [
      line,
      el("div", { style: { marginTop: "16px" } }, [checkBtn]),
      feedback,
    ]), { showPrompt: false }),
  };
}

/* ---------------- flashcard ---------------- */
function flashcard({ question, tutor, live, testMode, onDone }) {
  const result = { correct: false, hintsUsed: 0 };

  // In a test/exam, flipping the card would just be a free answer key — the
  // same "recorded as-is, no reveal" contract every other kind gets there.
  // A flashcard has no typed answer to record, so ask for one and grade it
  // through the same live/heuristic path text() already uses.
  if (testMode) {
    const ta = el("textarea.answerbox", { placeholder: t("q.flashcardRecallPlaceholder"), "aria-label": t("q.yourAnswer") });
    const submitBtn = el("button.btn.btn--sm", { type: "button", onclick: submit }, t("q.submit"));
    const feedback = el("div", {});

    async function submit() {
      const ans = ta.value.trim();
      submitBtn.disabled = true; ta.disabled = true;
      result.hintsUsed++;

      let verdict = null;
      try {
        if (ans && live) {
          submitBtn.textContent = t("q.submitting");
          try { verdict = await gradeAnswer({ question, studentAnswer: ans }); }
          catch { verdict = null; }
        }
        if (!verdict) verdict = ans ? heuristic(ans, question.answer) : { correct: false };
      } catch (e) {
        console.error("Grading failed:", e);
        verdict = { correct: false };
      }
      result.correct = verdict.correct;
      feedback.className = "feedback";
      feedback.textContent = t(ans ? "q.recorded" : "q.leftBlank");
      submitBtn.remove();
      onDone(finalize(result));
    }

    return {
      result,
      el: shell(question, el("div", {}, [
        ta,
        el("div", { style: { marginTop: "12px" } }, [submitBtn]),
        feedback,
      ])),
    };
  }

  const card = el("div.flashcard", { role: "button", tabindex: "0", "aria-label": t("q.flipAria") }, [
    el("div.flashcard__inner", {}, [
      el("div.flashcard__face", { html: renderRich(question.prompt) }),
      el("div.flashcard__face.flashcard__face--back", { html: renderRich(question.answer) }),
    ]),
  ]);
  const rate = el("div.selfrate", { hidden: true }, [
    [t("q.rateAgain"), "again"], [t("q.rateHard"), "hard"], [t("q.rateGood"), "good"], [t("q.rateEasy"), "easy"],
  ].map(([label, grade]) =>
    el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => pick(grade) }, label)));

  let flipped = false;
  function flip() {
    flipped = !flipped;
    card.classList.toggle("is-flipped", flipped);
    if (flipped) rate.hidden = false;
  }
  card.addEventListener("click", flip);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });

  function pick(grade) {
    result.srsGrade = grade;
    result.correct = grade !== "again";
    result.selfRating = grade;
    rate.querySelectorAll("button").forEach((b) => (b.disabled = true));
    if (grade === "again") tutor?.note(t("q.tutorForgot"));
    else tutor?.celebrate(t("q.tutorRemembered"));
    onDone(result);
  }

  // Space flips; 1–4 rate it once it's flipped.
  function handleKey(e) {
    if (e.key === " ") { flip(); return true; }
    if (flipped && /^[1-4]$/.test(e.key)) {
      const btn = rate.children[Number(e.key) - 1];
      if (btn && !btn.disabled) { btn.click(); return true; }
    }
    return false;
  }

  return {
    result, handleKey,
    el: shell(question, el("div", {}, [
      card,
      el("p.note", { style: { marginTop: "10px" } }, t("q.tapFlip")),
      rate,
    ]), { showPrompt: false }),
  };
}

/* ---------------- worked problem ---------------- */
function worked({ question, tutor, live, testMode, onDone }) {
  const result = { correct: false, hintsUsed: 0 };
  const steps = question.steps || [];
  const ta = el("textarea.answerbox", {
    placeholder: t(testMode ? "q.workedPlaceholderTest" : "q.workedPlaceholder"),
    "aria-label": t("q.yourWorking"),
  });
  const keypad = mathKeypad(ta);
  const revealed = el("ol", { style: { margin: "12px 0 0 18px" } });
  const revealBtn = steps.length && !testMode
    ? el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: revealStep }, t("q.showStep"))
    : null;
  const doneBtn = el("button.btn.btn--sm", { type: "button", onclick: finish },
    t(testMode ? "q.submit" : "q.doneShowAnswer"));
  const feedback = el("div", {});
  const selfRate = el("div", {});
  let shown = 0;

  function revealStep() {
    if (shown >= steps.length) return;
    revealed.appendChild(el("li", { html: renderRich(steps[shown]) }));
    shown++; result.hintsUsed = shown;
    tutor?.note(t("q.tutorRevealedStep", { n: shown }), "thinking");
    if (shown >= steps.length) revealBtn.disabled = true;
  }

  async function finish() {
    ta.disabled = true;
    keypad.toggle.remove(); keypad.pad.remove();
    if (testMode) {
      // Nothing is revealed during a test, so the answer has to be graded
      // for real rather than assumed correct because something was typed.
      const written = ta.value.trim();
      doneBtn.disabled = true;
      let verdict = null;
      try {
        if (written && live) {
          doneBtn.textContent = t("q.submitting");
          try { verdict = await gradeAnswer({ question, studentAnswer: written }); }
          catch { verdict = null; }
        }
        if (!verdict) verdict = written ? heuristic(written, question.answer) : { correct: false };
      } catch (e) {
        console.error("Grading failed:", e);
        verdict = { correct: false };
      }
      result.correct = verdict.correct;
      feedback.className = "feedback";
      feedback.textContent = t(written ? "q.recorded" : "q.leftBlank");
      doneBtn.remove();
      onDone(finalize(result));
      return;
    }
    feedback.className = "feedback ok";
    feedback.innerHTML = `<strong>${escapeHtml(t("q.fullSolution"))}</strong> ${renderRich(question.answer)}`;
    doneBtn.remove();
    selfRate.appendChild(el("p.note", { style: { marginTop: "12px" } }, t("q.reasoningGetThere")));
    selfRate.appendChild(el("div.selfrate", {}, [
      el("button.btn.btn--ok.btn--sm", { type: "button", onclick: () => end("nailed") }, t("q.workedNailed")),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => end("roughly") }, t("q.workedRoughly")),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => end("missed") }, t("q.workedMissed")),
    ]));
  }
  // The worked-problem self-rate doubles as its confidence signal.
  const WORKED_GRADE = { nailed: "easy", roughly: "good", missed: "again" };
  function end(conf) {
    result.confidence = conf;
    result.correct = conf !== "missed";
    result.srsGrade = WORKED_GRADE[conf];
    selfRate.querySelectorAll("button").forEach((b) => (b.disabled = true));
    onDone(finalize(result));
  }

  return {
    result,
    el: shell(question, el("div", {}, [
      ta, keypad.pad,
      el("div", { style: { marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" } },
        [revealBtn, doneBtn, keypad.toggle].filter(Boolean)),
      revealed, feedback, selfRate,
    ])),
  };
}

/* ---------------- helpers ---------------- */
function finalize(result) {
  if (!result.srsGrade) result.srsGrade = fromCorrect(result.correct, result.hintsUsed);
  return result;
}

// A correct answer's real review interval depends on how it was reached: a
// lucky guess should come back soon, something you knew cold can wait.
const CONF_GRADE = { guessed: "hard", unsure: "good", knew: "easy" };

/**
 * Show the confidence row only when the session says it's worth asking
 * (see askConfidence in views/session.js), otherwise finish straight away.
 * A wrong answer never gets the prompt — its grade is always "again".
 */
function maybeConfidence(result, host, onDone, askConfidence) {
  const ask = askConfidence ? askConfidence(result) : result.correct;
  if (ask) confidenceStep(result, host, onDone);
  else onDone(result);
}

/**
 * A one-tap "how sure were you?" row, shown after a practice-mode answer is
 * graded. Sets result.confidence, re-grades a *correct* answer accordingly,
 * then calls onDone. Wrong answers still schedule as "again".
 */
function confidenceStep(result, host, onDone) {
  const row = el("div.confrow", {}, [el("span.confrow__q", {}, t("q.confPrompt"))]);
  const btns = ["guessed", "unsure", "knew"].map((key) => {
    const b = el("button.btn.btn--ghost.btn--sm", {
      type: "button",
      onclick: () => {
        result.confidence = key;
        if (result.correct) result.srsGrade = CONF_GRADE[key];
        btns.forEach((x) => { x.disabled = true; });
        b.classList.add("is-picked");
        onDone(result);
      },
    }, t(`q.conf_${key}`));
    return b;
  });
  row.append(...btns);
  host.appendChild(row);
}

/**
 * A one-tap "Explain why" link shown after a missed question in practice mode.
 * Hands the question and the student's answer to the tutor for one focused turn.
 */
function explainWhyRow(tutor, question, theirAnswer, host) {
  if (!tutor) return;
  const btn = el("button.linkbtn", {
    type: "button",
    onclick: () => { btn.disabled = true; tutor.explainWrong(question, theirAnswer); },
  }, t("q.explainWhy"));
  host.appendChild(el("p.note", { style: { marginTop: "10px" } }, [btn]));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
