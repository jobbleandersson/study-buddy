// Question renderers, one per kind. Each returns { el, result } and calls
// opts.onDone(result) when the student has finished the question.
//   result = { correct, hintsUsed, selfRating?, srsGrade }
//
// opts: { question, tutor, live, onDone }

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { figureURL } from "../lib/figures.js";
import { gradeAnswer, gradeWorking, gradeCloze } from "../claude.js";
import { fromCorrect } from "../lib/srs.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { ruleSaveCard, rulePeek } from "./rule-card.js";
import { mathKeypad } from "./math-keypad.js";
import { heuristic, normalizeAnswer } from "../lib/answer-match.js";
import {
  speechSupported, isSpeaking, speakSegments, stopSpeaking, questionToSegments, getAutoRead,
  voiceForBcp, recognitionSupported, listenOnce, similarity,
} from "../lib/speech.js";
import { targetPhrases, maskTargetSpans, choicesAreTarget, segmentPrompt } from "../lib/lang-detect.js";
import { firstSentence } from "../lib/text.js";

// The language being learned in the question being built ({ code, bcp }), or
// null for every other subject. Set for the duration of renderQuestion so
// shell() can add the listen/speak tools without threading it through every
// renderer.
let activeTarget = null;
// The "your rule" line for the question being built (see ruleHooks), placed by
// shell() the same way.
let activeRulePeek = null;
// The text a follow-up question depends on ("Samma text. ..."), shown above it by shell() - see lib/passages.js.
let activePassage = null;
// Whether the student left the text open. Kept across questions, so hiding it once keeps it hidden.
let passageOpen = true;

export function renderQuestion(opts) {
  const rules = ruleHooks(opts);
  if (rules) opts = rules.opts;
  activeTarget = opts.targetLang || null;
  activeRulePeek = rules?.peek || null;
  activePassage = opts.passage || null;
  let r;
  try {
    r = (() => {
      switch (opts.question.kind) {
        case "mc": return mc(opts);
        case "flashcard": return flashcard(opts);
        case "worked": return worked(opts);
        // A cloze with no {{blanks}} is just a short-answer question — fall through
        // rather than render a sentence nobody can answer.
        case "cloze": return parseCloze(opts.question.prompt).some((p) => p.blank) ? cloze(opts) : text(opts);
        default: return text(opts);
      }
    })();
  } finally {
    activeTarget = null;
    activeRulePeek = null;
    activePassage = null;
  }
  rules?.attach(r.el);
  // Read-aloud: if the student has turned on auto-read, speak the new question
  // once it's on screen. The speaker button on the card does it on demand.
  if (getAutoRead() && speechSupported()) {
    const target = opts.targetLang || null;
    setTimeout(() => speakSegments(questionToSegments(opts.question, t, target)), 350);
  }
  return r;
}

const SRS_ORDER = ["again", "hard", "good", "easy"];

/**
 * Memory rules around one question, outside tests: a collapsed "your rule" line
 * when the student has already written one for it, and after a miss a one-line
 * prompt to write one (Settings can switch the prompt off — the line stays).
 * Reading a rule and then answering right still counts, but the question comes
 * back a little sooner: you needed the help.
 *
 * Returns { opts, peek, attach } — opts with onDone / askConfidence wrapped —
 * or null when the session isn't asking for rules.
 */
function ruleHooks(opts) {
  const ctx = opts.ruleContext;
  if (!ctx || opts.testMode) return null;
  const { question } = opts;
  const known = store.rulesFor(ctx.subjectId, question);
  const prompting = store.settings.rulePrompts !== false;
  if (!known.length && !prompting) return null;

  let peeked = false, host = null, card = null;
  const peek = known.length
    ? rulePeek(known, question.topic, () => { peeked = true; store.notePeek(known.map((r) => r.id)); })
    : null;

  const onDone = (result) => {
    if (peeked && result.correct) {
      result.rulePeek = true;
      if (SRS_ORDER.indexOf(result.srsGrade) > 1) result.srsGrade = "hard";
    }
    opts.onDone(result);
    if (!prompting || !host) return;
    // Missed it, or found it only after a wrong pick.
    const missed = !result.correct || result.firstTry === false;
    if (missed && !card) {
      card = ruleSaveCard({ subjectId: ctx.subjectId, topic: question.topic, questionId: question.id });
      host.appendChild(card);
      // Below the fold on a short screen — bring it into view without moving focus.
      requestAnimationFrame(() => card?.scrollIntoView?.({ block: "nearest" }));
    } else if (!missed && card && !card.classList.contains("rulecard--saved")) {
      card.remove();     // an appeal turned the miss around
      card = null;
    }
  };
  // A rule you had to read is its own signal — don't also ask "how sure were you?".
  const askConfidence = opts.askConfidence
    ? (result) => !peeked && opts.askConfidence(result)
    : opts.askConfidence;

  return { opts: { ...opts, onDone, askConfidence }, peek, attach: (node) => { host = node; } };
}

/** A speaker button that reads a question aloud (prompt + options), toggling
 *  to "stop" while it speaks. In a language set the quoted foreign text is
 *  read in that language's voice. Null when the browser has no speech synthesis. */
function speakButton(question, target) {
  if (!speechSupported()) return null;
  const btn = el("button.q-speak", {
    type: "button", "aria-label": t("q.readAloud"), title: t("q.readAloud"),
  }, [icon(ICONS.volume, 16)]);
  btn.addEventListener("click", () => {
    if (isSpeaking()) { stopSpeaking(); btn.classList.remove("is-on"); return; }
    btn.classList.add("is-on");
    const done = () => btn.classList.remove("is-on");
    speakSegments(questionToSegments(question, t, target), { onend: done, onerror: done });
  });
  return btn;
}

/* ---------------- listen / speak tools for language sets ---------------- */
const LANG_MODE_KEY = "studybuddy.langMode";
const getLangMode = () => {
  try { const m = localStorage.getItem(LANG_MODE_KEY); return m === "listen" || m === "speak" ? m : "read"; } catch { return "read"; }
};
const setLangMode = (m) => { try { localStorage.setItem(LANG_MODE_KEY, m); } catch {} };

/**
 * Read / Listen / Speak for a question in a language set.
 *   Read    — as before.
 *   Listen  — the quoted foreign text is hidden behind a play button, so it's
 *             a listening exercise; "Show text" lifts the mask.
 *   Speak   — say the foreign phrase (the one in the prompt, or the right
 *             answer once it's been found) and get a match score from the
 *             browser's speech recognition. Practice only: not scored.
 * Returns { el, reveal } — reveal() tells it the question has been answered.
 */
function languageBar(question, target, promptEl) {
  const langName = t(`lang.name.${target.code}`);
  const canSpeak = recognitionSupported();
  const phrases = targetPhrases(question.prompt, target.code);
  // Shadowing a whole reading passage is too much — take its first sentence.
  const shadow = phrases.length
    ? (() => {
        const longest = phrases.reduce((a, b) => (b.split(/\s+/).length > a.split(/\s+/).length ? b : a));
        return longest.split(/\s+/).length > 20 ? firstSentence(longest) : longest;
      })()
    : null;
  const choicesInTarget = question.kind === "mc" && Array.isArray(question.choices)
    && choicesAreTarget(question.choices, question.prompt, target.code);
  const masked = phrases.length ? maskTargetSpans(question.prompt, target.code) : null;

  let mode = getLangMode();
  if (mode === "speak" && !canSpeak) mode = "read";
  let answered = false, revealed = false, listening = null;

  // What to say out loud. A prompt sentence with gaps only makes sense once
  // the right answer is known and can fill them ("llegué / cocinaba" → two gaps).
  const gap = /_{2,}(?:\s*\([^)]*\))?/g;
  const filled = () => {
    const answer = question.choices?.[question.answer];
    const gaps = shadow.match(gap) || [];
    const parts = String(answer || "").split(/\s*\/\s*/);
    if (!answer || !gaps.length) return null;
    if (gaps.length === 1) return shadow.replace(gap, answer);
    if (parts.length !== gaps.length) return null;
    let i = 0;
    return shadow.replace(gap, () => parts[i++]);
  };
  const phrase = () => {
    const known = choicesInTarget && answered;
    if (shadow && /_{2,}/.test(shadow)) return known ? filled() : null;
    return shadow || (known ? question.choices[question.answer] : null);
  };
  const promptRuns = () => segmentPrompt(question.prompt, target.code)
    .map((s) => ({ text: s.text.replace(/_{2,}/g, ", "), bcp: s.target ? target.bcp : null }));

  const modes = ["read", "listen", ...(canSpeak ? ["speak"] : [])];
  const modeBtns = modes.map((m) => el("button", {
    type: "button", "data-mode": m,
    onclick: () => { mode = m; setLangMode(m); if (listening) listening.stop(); apply(); },
  }, t(`lang.mode${m[0].toUpperCase()}${m.slice(1)}`)));

  const voiceNote = el("p.note.langbar__note", { hidden: true }, t("lang.noVoice", { lang: t(`lang.adj.${target.code}`) }));
  function play(rate) {
    if (!speechSupported()) return;
    if (!voiceForBcp(target.bcp)) voiceNote.hidden = false;
    const p = mode === "speak" ? phrase() : null;
    speakSegments(p ? [{ text: p, bcp: target.bcp }] : promptRuns(), { rate });
  }
  const playBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => play(1) }, [icon(ICONS.volume, 16), t("lang.play")]);
  const slowBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => play(0.65) }, t("lang.slow"));
  const showBtn = el("button.linkbtn", { type: "button", onclick: () => { revealed = !revealed; apply(); } }, t("lang.showText"));
  const hint = el("p.note.langbar__note", {}, t("lang.listenHint", { lang: langName }));

  const micBtn = el("button.btn.btn--sm", { type: "button", onclick: toggleMic }, [icon(ICONS.mic, 16), t("lang.sayIt", { lang: langName })]);
  const out = el("span.langbar__out", { "aria-live": "polite" });
  const speakRow = el("div.langbar__speak", {}, [micBtn, out]);

  function toggleMic() {
    if (listening) { listening.stop(); return; }
    const want = phrase();
    if (!want) return;
    out.className = "langbar__out"; out.textContent = t("lang.listening");
    micBtn.classList.add("is-on");
    const session = listenOnce(target.bcp, {
      onresult: (alts) => {
        const best = alts.map((a) => ({ a, pct: similarity(a, want) })).sort((x, y) => y.pct - x.pct)[0];
        if (!best) { out.textContent = t("lang.heardNothing"); return; }
        const tone = best.pct >= 85 ? "good" : best.pct >= 60 ? "close" : "off";
        out.className = `langbar__out is-${tone}`;
        out.textContent = `${t("lang.heard", { said: best.a, pct: best.pct })} · ${t(tone === "good" ? "lang.heardGood" : tone === "close" ? "lang.heardClose" : "lang.heardOff")}`;
      },
      onerror: (err) => {
        out.className = "langbar__out is-off";
        out.textContent = t(err === "no-speech" || err === "aborted" ? "lang.heardNothing" : "lang.micBlocked");
      },
      onend: () => { listening = null; micBtn.classList.remove("is-on"); },
    });
    if (session) listening = session;
    else { micBtn.classList.remove("is-on"); out.className = "langbar__out is-off"; out.textContent = t("lang.micBlocked"); }
  }

  function apply() {
    modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    const listen = mode === "listen", speak = mode === "speak";
    const hidden = listen && masked && !revealed;
    promptEl.innerHTML = renderRich(hidden ? masked : question.prompt);
    playBtn.hidden = slowBtn.hidden = mode === "read";
    showBtn.hidden = !(listen && masked);
    showBtn.textContent = t(revealed ? "lang.hideText" : "lang.showText");
    hint.hidden = !hidden;
    speakRow.hidden = !speak;
    if (speak && !listening) {
      const p = phrase();
      micBtn.disabled = !p;
      out.className = "langbar__out";
      out.textContent = p ? `“${p}”` : t(choicesInTarget ? "lang.answerFirst" : "lang.nothingToSay");
    }
  }
  apply();

  return {
    el: el("div.langbar", {}, [
      el("div.langbar__row", {}, [
        el("div.langbar__modes", { role: "group", "aria-label": t("lang.modeLabel") }, modeBtns),
        playBtn, slowBtn, showBtn,
      ]),
      hint, voiceNote, speakRow,
    ]),
    reveal() { answered = true; if (mode === "speak") apply(); },
  };
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

/**
 * A Högskoleprov figure (DTK diagram, XYZ sketch). `question.figure` is
 * { src, alt, caption? }; `src` is a repo-root-relative path resolved by
 * figureURL(). If the image 404s the whole <figure> is swapped for the alt
 * text — which by contract carries the data needed to answer — so the
 * question stays answerable offline or on a bad path.
 *
 * The figures are drawn small (a 340-wide viewBox), so on a phone their labels are tiny: tapping the
 * figure, or the button under it, opens it full screen (see openFigure).
 */
function figurePanel(figure) {
  if (!figure || !figure.src) return null;
  const wrap = el("figure.question__figure", {});
  const img = el("img", { src: figureURL(figure.src), alt: figure.alt || "", loading: "lazy" });
  img.addEventListener("error", () => {
    wrap.replaceWith(el("div.question__figure.question__figure--missing", {}, [
      el("b", {}, t("hp.figureMissing")),
      el("span", {}, figure.alt || ""),
    ]));
  });
  // The image itself only answers a pointer; the button is the control (the image stays out of it, so
  // its alt text, which carries the figure's data for a screen reader, isn't replaced by a label).
  const zoomBtn = el("button.question__figzoom", {
    type: "button", onclick: () => openFigure(img, zoomBtn),
  }, [icon(ICONS.zoomIn, 16), t("hp.figureZoom")]);
  img.addEventListener("click", () => openFigure(img, zoomBtn));
  wrap.append(img, zoomBtn);
  if (figure.caption) wrap.appendChild(el("figcaption", {}, figure.caption));
  return wrap;
}

/** A figure full screen, on a plain ground. Tapping the picture toggles between fitting the screen
 *  and twice that (scrolling to where it was tapped); Esc, the close button or leaving the page shut it. */
function openFigure(img, opener) {
  let zoomed = false;
  const big = el("img.figview__img", { src: img.currentSrc || img.src, alt: img.alt });
  const scroller = el("div.figview__scroll", {}, [big]);
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("hashchange", close);
    overlay.remove();
    opener?.focus?.();
  };
  // Capture phase, and swallowed: the session's answer shortcuts mustn't fire under the overlay.
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key !== "Tab") e.stopPropagation();
    else { e.preventDefault(); closeBtn.focus(); }
  }
  big.addEventListener("click", (e) => {
    const r = big.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    zoomed = !zoomed;
    overlay.classList.toggle("is-zoomed", zoomed);
    if (zoomed) {
      scroller.scrollLeft = fx * big.offsetWidth - scroller.clientWidth / 2;
      scroller.scrollTop = fy * big.offsetHeight - scroller.clientHeight / 2;
    }
  });
  const closeBtn = el("button.iconbtn.figview__close", { type: "button", "aria-label": t("common.close"), onclick: close }, [icon(ICONS.close, 20)]);
  const overlay = el("div.figview", { role: "dialog", "aria-modal": "true", "aria-label": img.alt || t("hp.figureZoom") }, [
    el("div.figview__bar", {}, [el("p.figview__hint", {}, t("hp.figureZoomHint")), closeBtn]),
    scroller,
  ]);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("hashchange", close);
  closeBtn.focus();
}

/**
 * The framing material shown once above the prompt. Shape varies by delprov:
 *   LÄS / ELF   { id?, title?, body, figure? }   — a reading passage
 *   KVA         { quantities: [I, II], given? }  — the two columns to compare
 *   NOG         { statements: [ "(1) …", "(2) …" ] }
 * Questions stay fully independent — this is render-only, no grouping.
 */
function framePanel(question) {
  const s = question.stimulus;
  if (question.variant === "kva" && s && Array.isArray(s.quantities)) {
    return el("div.hp-kva", {}, [
      el("div.hp-kva__col", {}, [
        el("h4", {}, t("hp.kvaColI")),
        el("div.hp-kva__q", { html: renderRich(s.quantities[0] ?? "") }),
      ]),
      el("div.hp-kva__div"),
      el("div.hp-kva__col", {}, [
        el("h4", {}, t("hp.kvaColII")),
        el("div.hp-kva__q", { html: renderRich(s.quantities[1] ?? "") }),
      ]),
      s.given ? el("div.hp-kva__given", {}, [
        el("b", {}, t("hp.kvaGivenLabel")), " ",
        el("span", { html: renderRich(s.given) }),
      ]) : null,
    ].filter(Boolean));
  }
  if (question.variant === "nog" && s && Array.isArray(s.statements)) {
    return el("div.hp-nog__stmts", {}, s.statements.map((line, i) =>
      el("div.hp-nog__stmt", {}, [
        el("b", {}, `(${i + 1})`),
        el("span", { html: renderRich(String(line).replace(/^\(\d+\)\s*/, "")) }),
      ])));
  }
  if (s && s.body) {
    return el("div.question__stimulus", {}, [
      s.title ? el("h4.question__stimulus-label", {}, s.title) : null,
      s.figure ? figurePanel(s.figure) : null,
      el("div.question__stimulus-body", { html: renderRich(s.body) }),
    ].filter(Boolean));
  }
  return null;
}

/** The shared reading text above a follow-up question: open by default, and the student can fold it away. */
function passagePanel(text) {
  if (!text) return null;
  const box = el("details.question__passage", { open: passageOpen }, [
    el("summary", {}, t("q.passage")),
    el("div.question__stimulus-body", { html: renderRich(text) }),
  ]);
  box.addEventListener("toggle", () => { passageOpen = box.open; });
  return box;
}

function shell(question, body, { showPrompt = true } = {}) {
  const target = activeTarget;
  const speak = speakButton(question, target);
  const promptEl = showPrompt ? el("div.question__prompt", { html: renderRich(question.prompt) }) : null;
  // Flashcards keep their text on the card itself, so they only get the speaker.
  const bar = target && promptEl && question.kind !== "flashcard" ? languageBar(question, target, promptEl) : null;
  // NOG reads like the test: the question first, then statements (1) and (2) about it.
  const frame = framePanel(question);
  const frameAfter = question.variant === "nog";
  const node = el("div.question", {}, [
    passagePanel(activePassage),
    frameAfter ? null : frame,
    figurePanel(question.figure),
    (showPrompt || speak) && el("div.question__topline", {}, [promptEl || el("span"), speak].filter(Boolean)),
    frameAfter ? frame : null,
    bar?.el,
    activeRulePeek,
    body,
  ].filter(Boolean));
  node.langReveal = bar ? bar.reveal : null;
  return node;
}

/* ---------------- multiple choice ---------------- */
// `revisable` (exam mode): there is no Check button — picking an option records it at once, and
// picking another one replaces it, until the student hands the exam in. `initialPick` re-selects the
// recorded choice when the student comes back to the question.
function mc({ question, tutor, testMode, onDone, askConfidence, revealAfter = 2, revisable = false, initialPick = -1, oneTry = false }) {
  const result = { correct: false, hintsUsed: 0 };
  let picked = -1, attempts = 0, done = false;

  const btns = question.choices.map((c, i) =>
    el("button.choice", {
      type: "button",
      onclick: () => { if (done) return; picked = i; sync(); if (revisable) record(); },
    }, [
      el("span.choice__key", {}, String.fromCharCode(65 + i)),
      el("span", { html: renderRich(c) }),
    ]));

  const checkBtn = el("button.btn.btn--sm", { type: "button", disabled: true, hidden: revisable, onclick: check }, t("q.check"));
  const feedback = el("div", {});
  // Four short options sit two by two, as on a test page, instead of a long column of one-word rows.
  const shortChoices = question.choices.length === 4
    && question.choices.every((c) => String(c).replace(/\$([^$]*)\$/g, (_, m) => m.slice(0, 8)).length <= 18);
  const list = el("div.choices" + (shortChoices ? ".choices--grid" : ""), {}, btns);

  function sync() {
    btns.forEach((b, i) => b.setAttribute("aria-pressed", String(i === picked)));
    checkBtn.disabled = picked < 0;
  }

  // Exam mode: a fresh result each time (finalize() keeps the first srsGrade it is given, which
  // would freeze the grade of a first pick that was later changed).
  function record() {
    if (picked < 0) return;
    feedback.className = "feedback";
    feedback.textContent = t("q.recordedChangeable");
    onDone(finalize({ correct: picked === question.answer, hintsUsed: 0, picked }));
  }
  if (revisable && initialPick >= 0 && initialPick < btns.length) {
    picked = initialPick;
    sync();
    feedback.className = "feedback";
    feedback.textContent = t("q.recordedChangeable");
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
      node.langReveal?.();
      result.correct = true;
      // Found after wrong picks: celebrated here, but not scored as known.
      result.firstTry = attempts === 1;
      result.hintsUsed = attempts - 1;
      feedback.className = "feedback ok";
      feedback.innerHTML = renderRich(question.explanation || t("q.correct")) + stepsHtml(question);
      checkBtn.remove();
      tutor?.celebrate(t("q.tutorRight"));
      maybeConfidence(finalize(result), feedback, onDone, askConfidence);
    } else if (oneTry) {
      // Marked like the test: one pick, then the right answer and how to get there.
      lastWrongChoice = question.choices[picked];
      checkBtn.remove();
      revealAnswer({ wrongPick: true });
    } else {
      result.hintsUsed = attempts;
      lastWrongChoice = question.choices[picked];
      feedback.className = "feedback retry";
      feedback.textContent = attempts >= 2
        ? t("q.stillNotRight")
        : t("q.notQuite");
      // The tutor's answer to this wrong pick (it names the likely mistake), shortened and shown right
      // under the marking, so the reason is on screen without opening the tutor.
      const hintEl = el("p.feedback__hint", { hidden: true });
      feedback.appendChild(hintEl);
      const forTry = attempts;
      tutor?.note(t("q.tutorWrongMc", { choice: question.choices[picked] }), "encourage", {
        onReply: (txt) => {
          if (done || forTry !== attempts) return;
          const s = shortHint(txt);
          if (s) { hintEl.textContent = s; hintEl.hidden = false; }
        },
      });
      triedWrong.add(picked);
      btns.forEach((b, i) => {
        b.setAttribute("aria-pressed", "false");
        b.disabled = triedWrong.has(i);          // eliminate options already ruled out
      });
      picked = -1; checkBtn.disabled = true;
      // Normally after two misses; after one when the session can't skip this
      // question any more (see revealAfter in session.js).
      if (attempts >= revealAfter && !document.getElementById("mc-reveal")) {
        const reveal = el("button.btn.btn--ghost.btn--sm", { id: "mc-reveal", type: "button", onclick: revealAnswer }, t("q.reveal"));
        feedback.appendChild(el("div", { style: { marginTop: "10px" } }, [reveal]));
      }
    }
  }

  function revealAnswer({ wrongPick = false } = {}) {
    done = true;
    result.correct = false;
    btns.forEach((b) => (b.disabled = true));
    btns[question.answer].classList.add("is-correct");
    node.langReveal?.();
    feedback.className = "feedback retry";
    const letter = String.fromCharCode(65 + question.answer);
    feedback.innerHTML = (wrongPick && question.explanation ? `<p><strong>${escapeHtml(t("q.answerIs", { letter }))}</strong></p>` : "")
      + renderRich(question.explanation || t("q.answerIs", { letter })) + stepsHtml(question);
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
      if (revisable) record();
      return true;
    }
    if (e.key === "Enter" && picked >= 0) { if (revisable) record(); else check(); return true; }
    return false;
  }

  const node = shell(question, el("div", {}, [list, el("div", { style: { marginTop: "16px" } }, [checkBtn]), feedback]));
  return { result, handleKey, el: node };
}

// The "√x" symbol pad, only where there is maths to write: never in a language set, and otherwise
// when the question, its answer or its steps use a maths symbol or a calculation.
const MATHY = /\$|[=+×÷√^²³≤≥±π∞Δ]|\d\s*[*\/]\s*\d|\d\s*(?:cm|mm|km|kg|mol|m|g|s|N|J|W|V)\b/;
const NO_KEYPAD = { toggle: null, pad: null };
function keypadFor(ta, question, targetLang) {
  if (targetLang) return NO_KEYPAD;
  const text = [question.prompt, question.answer, ...(question.steps || [])].join(" ");
  return MATHY.test(text) ? mathKeypad(ta) : NO_KEYPAD;
}

/* ---------------- short text ---------------- */
function text({ question, tutor, live, testMode, onDone, askConfidence, targetLang }) {
  const result = { correct: false, hintsUsed: 0 };
  const ta = el("textarea.answerbox", { placeholder: t("q.typeAnswer"), "aria-label": t("q.yourAnswer") });
  const keypad = keypadFor(ta, question, targetLang);
  const checkBtn = el("button.btn.btn--sm", { type: "button", onclick: check },
    t(testMode ? "q.submit" : "q.check"));
  const feedback = el("div", {});
  const selfRate = el("div", {});
  let tries = 0;   // practice: a miss can be tried once more before the model answer is shown
  const modelHtml = () => `<p style="margin-top:10px"><strong>${escapeHtml(t("q.modelAnswer"))}</strong> ${renderRich(question.answer)}</p>`;

  async function grade(ans) {
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
    return verdict;
  }

  function closeInput() {
    ta.disabled = true;
    keypad.toggle?.remove(); keypad.pad?.remove();
    checkBtn.remove();
  }

  async function check() {
    const ans = ta.value.trim();
    if (!ans) return;
    checkBtn.disabled = true; ta.disabled = true;
    tries++;   // a check is not a hint: a right first answer is "easy", like any other question type
    const verdict = await grade(ans);

    // Moved on while this was being checked (skipped, went back, the run ended): record the verdict
    // for this question and touch nothing on screen — the tutor and buttons belong to another one now.
    if (!ta.isConnected) {
      result.correct = !!verdict.correct;
      onDone(finalize(result));
      return;
    }

    // Test mode: grade silently, show nothing, move on.
    if (testMode) {
      result.correct = verdict.correct;
      feedback.className = "feedback";
      feedback.textContent = t("q.recorded");
      closeInput();
      onDone(finalize(result));
      return;
    }

    clear(selfRate);
    const pointsHtml = verdict.missedPoints?.length
      ? `<ul>${verdict.missedPoints.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : "";

    if (verdict.correct) {
      closeInput();
      feedback.className = "feedback ok";
      feedback.innerHTML = `<p>${escapeHtml(verdict.feedback)}</p>` + pointsHtml + modelHtml();
      tutor?.celebrate(t("q.tutorGotIt", { answer: ans }));
      result.correct = true;
      if (tries > 1) {
        // Right on the second try: it counts, but not as known first time (as with multiple choice).
        result.firstTry = false;
        result.revised = true;
        result.srsGrade = null;
        onDone(finalize(result));
        return;
      }
      maybeConfidence(finalize(result), feedback, onDone, askConfidence);
      return;
    }

    // Not right yet. The grade stands — the student no longer marks their own work — but in practice they
    // get one more try before the model answer, and the tutor asks a question instead of repeating it.
    result.correct = false;
    feedback.className = "feedback retry";
    feedback.innerHTML = `<p>${escapeHtml(verdict.feedback)}</p>` + pointsHtml;
    tutor?.note(t("q.tutorTextGraded", {
      answer: ans, feedback: [verdict.feedback, ...(verdict.missedPoints || [])].join(" ").slice(0, 400),
    }));
    if (tries === 1) {
      onDone(finalize(result));   // recorded as a miss now; a right second try updates it
      checkBtn.hidden = true;
      const again = el("button.btn.btn--sm", {
        type: "button",
        onclick: () => {
          row.remove();
          ta.disabled = false; ta.focus();
          checkBtn.textContent = t("q.check");
          checkBtn.disabled = false; checkBtn.hidden = false;
        },
      }, t("q.textRetry"));
      const show = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => { row.remove(); finishMiss(ans); } }, t("q.textShowModel"));
      const row = el("div.feedback__actions", {}, [again, show]);
      feedback.appendChild(row);
      return;
    }
    finishMiss(ans);
  }

  /** No more tries: show the model answer, and the ways to learn from it or contest the marking. */
  function finishMiss(ans) {
    closeInput();
    feedback.insertAdjacentHTML("beforeend", modelHtml());
    clear(selfRate);
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
    selfRate.appendChild(el("p.note", { style: { marginTop: "12px" } }, [t("q.disagree"), appeal, "."]));
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
function cloze({ question, tutor, live, testMode, onDone, askConfidence }) {
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

  async function check() {
    if (done) return;
    // In a test, nothing typed is nothing handed in — Enter in an empty blank on a revisited
    // question must not replace the answer already recorded with a blank one.
    if (testMode && blanks.every((b) => !b.inp.value.trim())) { blanks[0]?.inp.focus(); return; }
    done = true;
    checkBtn.disabled = true;
    for (const b of blanks) b.inp.disabled = true;

    // Exact matches first. What doesn't match is not simply wrong: "exportsubventioner" for
    // "exportsubvention", or a synonym, still deserves credit — so the AI looks at those, the way a
    // teacher would, and says why (nobody has to tell the app whether it was right).
    const verdicts = blanks.map((b) => ({
      ok: b.alts.some((a) => normalizeAnswer(a) === normalizeAnswer(b.inp.value)), note: "", verdict: "",
    }));
    const doubtful = blanks.map((_, i) => i).filter((i) => !verdicts[i].ok && blanks[i].inp.value.trim());
    if (doubtful.length && live) {
      checkBtn.textContent = t(testMode ? "q.submitting" : "q.checking");
      const ask = () => gradeCloze({
        question, blanks: doubtful.map((i) => ({ n: i + 1, accepted: blanks[i].alts, given: blanks[i].inp.value.trim() })),
      });
      try {
        let res; try { res = await ask(); } catch { res = await ask(); }   // once more, then the exact result stands
        for (const r of res) {
          const v = verdicts[r.n - 1];
          if (!v) continue;
          v.ok = r.verdict === "ok"; v.note = r.note; v.verdict = r.verdict;
        }
      } catch (e) { console.error("Grading failed:", e); }
    }
    const allRight = verdicts.every((v) => v.ok);
    result.correct = allRight;
    if (!feedback.isConnected) { onDone(finalize(result)); return; }   // moved on while it was checked
    blanks.forEach((b, i) => b.inp.classList.add(verdicts[i].ok ? "is-correct" : "is-wrong"));
    checkBtn.remove();

    if (testMode) {
      feedback.className = "feedback";
      feedback.textContent = t("q.recorded");
      onDone(finalize(result));
      return;
    }

    feedback.className = `feedback ${allRight ? "ok" : "retry"}`;
    const line = (b, v) => {
      const typed = b.inp.value.trim();
      return `<li>${typed ? `<em>${escapeHtml(typed)}</em> → ` : ""}<strong>${escapeHtml(b.alts[0])}</strong>${v.note ? ` — ${escapeHtml(v.note)}` : ""}</li>`;
    };
    const missed = blanks.map((b, i) => [b, verdicts[i]]).filter(([, v]) => !v.ok);
    // A word that counted although it wasn't the one in the key: say so, and which form the sentence uses.
    const credited = blanks.map((b, i) => [b, verdicts[i]]).filter(([, v]) => v.ok && v.note);
    const creditedHtml = credited.length ? `<p>${escapeHtml(t("q.clozeCredited"))}</p><ul>${credited.map(([b, v]) => line(b, v)).join("")}</ul>` : "";
    feedback.innerHTML = allRight
      ? renderRich(question.explanation || t("q.correct")) + creditedHtml
      : `<p>${escapeHtml(t("q.clozeMissed"))}</p><ul>${missed.map(([b, v]) => line(b, v)).join("")}</ul>` + creditedHtml +
        (question.explanation ? renderRich(question.explanation) : "");

    if (allRight) tutor?.celebrate(t("q.tutorRight"));
    else {
      // Include what was actually typed — without it the tutor has to ask
      // the student to repeat information the app already has right here.
      const typed = blanks.map((b) => b.inp.value).filter(Boolean).join(", ");
      tutor?.note(typed ? t("q.tutorClozeWrong", { answer: typed }) : t("q.tutorClozeWrongBlank"));
      explainWhyRow(tutor, question, typed, feedback);
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

  const promptText = el("div.flashcard__text", { html: renderRich(question.prompt) });
  const answerText = el("div.flashcard__text", { html: renderRich(question.answer) });
  const card = el("div.flashcard", { role: "button", tabindex: "0", "aria-label": t("q.flipAria") }, [
    el("div.flashcard__inner", {}, [
      el("div.flashcard__face", {}, [promptText]),
      el("div.flashcard__face.flashcard__face--back", {}, [answerText]),
    ]),
  ]);
  // Space is the session's flip shortcut — keep it from firing while this
  // button has focus, or "Show more" would flip the card instead.
  const more = el("button.linkbtn", {
    type: "button", hidden: true, "aria-expanded": "false",
    onclick: () => (expanded ? collapse() : expand()),
    onkeydown: (e) => e.stopPropagation(),
  }, t("q.showMore"));
  const rate = el("div.selfrate", { hidden: true }, [
    [t("q.rateAgain"), "again"], [t("q.rateHard"), "hard"], [t("q.rateGood"), "good"], [t("q.rateEasy"), "easy"],
  ].map(([label, grade]) =>
    el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => pick(grade) }, label)));

  let flipped = false;
  let expanded = false;

  // A face is "clamped" when its text is taller than the cap; only then is
  // there anything for "Show more" to reveal. Not measured while expanded
  // (the cap is off, so nothing overflows) — collapse() re-measures.
  function syncMore() {
    const face = flipped ? answerText : promptText;
    more.hidden = !(expanded || face.classList.contains("is-clamped"));
    more.textContent = t(expanded ? "q.showLess" : "q.showMore");
    more.setAttribute("aria-expanded", String(expanded));
  }
  function measure() {
    if (!card.isConnected) { resizeWatch?.disconnect(); return; }
    if (expanded) return;
    for (const txt of [promptText, answerText]) {
      txt.classList.toggle("is-clamped", txt.scrollHeight > txt.clientHeight + 1);
    }
    syncMore();
  }
  function expand() { expanded = true; card.classList.add("is-expanded"); syncMore(); }
  function collapse() { expanded = false; card.classList.remove("is-expanded"); measure(); }

  const resizeWatch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  resizeWatch?.observe(promptText);
  resizeWatch?.observe(answerText);

  function flip() {
    flipped = !flipped;
    card.classList.toggle("is-flipped", flipped);
    if (flipped) rate.hidden = false;
    collapse();
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
      el("div.flashcard__meta", {}, [el("p.note", {}, t("q.tapFlip")), more]),
      rate,
    ]), { showPrompt: false }),
  };
}

/* ---------------- worked problem ---------------- */
function worked({ question, tutor, live, testMode, onDone, targetLang }) {
  const result = { correct: false, hintsUsed: 0 };
  const steps = question.steps || [];
  const ta = el("textarea.answerbox", {
    placeholder: t(testMode ? "q.workedPlaceholderTest" : "q.workedPlaceholder"),
    "aria-label": t("q.yourWorking"),
  });
  const keypad = keypadFor(ta, question, targetLang);
  const revealed = el("ol", { style: { marginTop: "12px" } });
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
    tutor?.note(t("q.tutorRevealedStep", { n: shown, step: String(steps[shown - 1]).replace(/\s+/g, " ").slice(0, 240) }), "thinking");
    if (shown >= steps.length) revealBtn.disabled = true;
  }

  // The AI reads the working and decides how it went — the student is not asked whether they got it
  // right. With nothing written, or nobody to grade it (no server), it falls back to self-rating.
  const WORKED_GRADE = { nailed: "easy", roughly: "good", missed: "again" };
  function settle(level) {
    result.confidence = level;
    result.correct = level !== "missed";
    result.srsGrade = WORKED_GRADE[level];
    onDone(finalize(result));
  }

  // Nothing written, and someone to grade it: ask for the working rather than letting the student
  // rate themselves. They can still see the solution without answering, and that counts as a miss.
  const needWriting = el("p.note.note--warn", { hidden: true, role: "alert", style: { marginTop: "10px" } });
  function giveUp() {
    needWriting.hidden = true;
    ta.disabled = true;
    keypad.toggle?.remove(); keypad.pad?.remove(); doneBtn.remove();
    revealBtn?.remove();   // the full solution is on screen now: no single steps left to show
    feedback.className = "feedback retry";
    feedback.innerHTML = `<p>${escapeHtml(t("q.workedGaveUp"))}</p>` +
      solutionHtml(question);
    tutor?.note(t("q.tutorWorkedGaveUp"));
    settle("missed");
    explainWhyRow(tutor, question, "", selfRate);
  }

  async function finish() {
    if (testMode && !ta.value.trim()) { ta.focus(); return; }   // nothing written is nothing handed in
    if (!ta.value.trim() && live && !testMode) {
      needWriting.hidden = false;
      needWriting.replaceChildren(t("q.workedNeedWriting"), " ", el("button.linkbtn", { type: "button", onclick: giveUp }, t("q.workedShowAnyway")));
      ta.focus();
      return;
    }
    ta.disabled = true;
    keypad.toggle?.remove(); keypad.pad?.remove();
    needWriting.hidden = true;   // its "Show anyway" link would mark this answer as given up afterwards
    const written = ta.value.trim();

    let verdict = null;
    if (written && live) {
      doneBtn.disabled = true;
      doneBtn.textContent = t(testMode ? "q.submitting" : "q.checking");
      try { verdict = await gradeWorking({ question, working: written }); }
      catch { try { verdict = await gradeWorking({ question, working: written }); } catch (e) { console.error("Grading failed:", e); verdict = null; } }
    }

    if (!ta.isConnected) {   // moved on while it was checked: record it, leave the screen alone
      if (!verdict && written) verdict = heuristic(written, question.answer);
      result.correct = !!verdict?.correct;
      onDone(finalize(result));
      return;
    }
    if (testMode) {
      // Nothing is revealed during a test, so the answer has to be graded
      // for real rather than assumed correct because something was typed.
      if (!verdict && written) verdict = heuristic(written, question.answer);
      result.correct = !!verdict?.correct;
      feedback.className = "feedback";
      feedback.textContent = t(written ? "q.recorded" : "q.leftBlank");
      doneBtn.remove();
      onDone(finalize(result));
      return;
    }

    doneBtn.remove();
    revealBtn?.remove();   // the full solution follows: no single steps left to show
    const solution = solutionHtml(question);

    if (verdict) {
      const missed = verdict.level === "missed";
      feedback.className = `feedback ${missed ? "retry" : "ok"}`;
      feedback.innerHTML =
        `<p>${escapeHtml(verdict.feedback)}</p>` +
        (verdict.missedPoints?.length ? `<ul>${verdict.missedPoints.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : "") +
        solution;
      const brief = written.replace(/\s+/g, " ").slice(0, 120);
      if (missed) tutor?.note(t("q.tutorWhatMissing", { answer: brief }));
      else tutor?.celebrate(t("q.tutorGotIt", { answer: brief }));
      settle(verdict.level);
      if (missed) {
        explainWhyRow(tutor, question, written, selfRate);
        // The grade stands on its own, but it can be appealed — recorded, not silently taken.
        const appeal = el("button.linkbtn", {
          type: "button",
          onclick: () => {
            result.confidence = "roughly";
            result.correct = true;
            result.appealed = true;
            result.revised = true;
            result.srsGrade = WORKED_GRADE.roughly;
            onDone(finalize(result));
            clear(selfRate);
            selfRate.appendChild(el("p.note", {}, t("q.appealDone")));
          },
        }, t("q.appeal"));
        selfRate.appendChild(el("p.note", { style: { marginTop: "12px" } }, [t("q.disagree"), appeal, "."]));
      }
      return;
    }

    feedback.className = "feedback ok";
    feedback.innerHTML = solutionHtml(question);
    selfRate.appendChild(el("p.note", { style: { marginTop: "12px" } }, t("q.reasoningGetThere")));
    selfRate.appendChild(el("div.selfrate", {}, [
      el("button.btn.btn--ok.btn--sm", { type: "button", onclick: () => end("nailed") }, t("q.workedNailed")),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => end("roughly") }, t("q.workedRoughly")),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => end("missed") }, t("q.workedMissed")),
    ]));
  }
  // The self-rate fallback doubles as its confidence signal.
  function end(conf) {
    selfRate.querySelectorAll("button").forEach((b) => (b.disabled = true));
    settle(conf);
  }

  return {
    result,
    el: shell(question, el("div", {}, [
      ta, keypad.pad,
      el("div", { style: { marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" } },
        [revealBtn, doneBtn, keypad.toggle].filter(Boolean)),
      needWriting, revealed, feedback, selfRate,
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

/** A worked problem's full solution: its steps, when it has them, then the answer. */
/** A multiple-choice question's worked steps, when it has them, under its explanation. */
function stepsHtml(question) {
  const steps = Array.isArray(question.steps) ? question.steps.filter(Boolean) : [];
  return steps.length ? `<ol class="solution__steps">${steps.map((s) => `<li>${renderRich(s)}</li>`).join("")}</ol>` : "";
}

function solutionHtml(question) {
  const steps = Array.isArray(question.steps) ? question.steps.filter(Boolean) : [];
  return `<div class="solution"><p style="margin-top:10px"><strong>${escapeHtml(t("q.fullSolution"))}</strong></p>`
    + (steps.length ? `<ol class="solution__steps">${steps.map((s) => `<li>${renderRich(s)}</li>`).join("")}</ol>` : "")
    + `<p class="solution__answer">${renderRich(question.answer)}</p></div>`;
}

/** One or two plain sentences from a tutor reply, for the line under a marking. */
function shortHint(text) {
  const plain = String(text || "").replace(/\$\$?([^$]*)\$\$?/g, "$1").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  const m = plain.match(/^(.+?[.!?])(\s+.+?[.!?])?(\s|$)/);
  const out = (m ? m[1] + (m[2] || "") : plain).trim();
  return out.length > 260 ? out.slice(0, 257).trimEnd() + "…" : out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
