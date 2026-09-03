// The tutor chat panel. Works in two modes:
//   - live:    streams from Claude (when the tutor server is reachable)
//   - scripted: walks a hint ladder from data/samples/scripted-tutor.json (offline demo)

import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { announce } from "../lib/a11y.js";
import { markdown } from "../lib/markdown.js";
import { mascot, setMood } from "./mascot.js";
import { store } from "../store.js";
import { tutorSystem, fallbackOpeners } from "../prompts.js";
import { t, getLang } from "../lib/i18n.js";
import { tutorStream, ClaudeError } from "../claude.js";

// Cached per language — switching language should pick up the other script,
// not keep serving the one loaded first.
const scriptedByLang = {};
const SCRIPTED_FILES = {
  en: "data/samples/scripted-tutor.json",
  sv: "data/samples/scripted-tutor.sv.json",
};

async function loadScripted() {
  const lang = getLang();
  if (scriptedByLang[lang]) return scriptedByLang[lang];
  const file = SCRIPTED_FILES[lang] || SCRIPTED_FILES.en;
  scriptedByLang[lang] = await fetch(file)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .catch(() => ({ generic: {}, byQuestion: {} }));
  return scriptedByLang[lang];
}

export class TutorChat {
  constructor({ locked = false, hintBudget = Infinity } = {}) {
    this.locked = locked;
    // In a test the tutor can be given a small hint allowance instead of being
    // shut off entirely. hintBudget counts student questions, not tutor lines.
    this.hintBudget = hintBudget;
    this.hintsLeft = hintBudget;
    this.live = store.hasKey();
    this.messages = [];       // Anthropic-format history for the current question
    this.ladderIndex = -1;    // scripted mode
    this.turns = 0;
    this.busy = false;
    this.abort = null;
    this.history = [];        // how the whole session has gone, for continuity
    this._openerIndex = Math.floor(Math.random() * fallbackOpeners().length);
    this._build();
  }

  /** Called by the session when a question is finished, so later questions
   *  can be tutored with some sense of how the student is doing. */
  recordOutcome(question, result) {
    this.history.push({
      topic: question.topic || "general",
      correct: !!result.correct,
      hintsUsed: result.hintsUsed || 0,
    });
  }

  _build() {
    this.mascotEl = mascot("idle", 40);
    // Deliberately NOT a live region: streaming text would be announced
    // character by character. Finished messages are announced once instead.
    this.logEl = el("div.tutor__log", { "aria-live": "off", tabindex: "0", "aria-label": t("tutor.convAria") });
    this.inputEl = el("input.tutor__input", {
      type: "text", placeholder: t("tutor.ask"), "aria-label": t("tutor.askAria"),
      onkeydown: (e) => { if (e.key === "Enter") this._submit(); },
    });

    // Voice in / voice out are independent. Speech recognition drives the mic
    // button (tap to dictate); speech synthesis reads replies aloud when the
    // student has turned that on in Settings. The button is hidden outright
    // when the browser has neither.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._canListen = !!SR;
    this._canSpeak = "speechSynthesis" in window;

    const voiceBtn = el("button.iconbtn.voice-btn", {
      type: "button",
      "aria-label": t("tutor.voiceStart"),
      title: t("tutor.voiceStart"),
      onclick: (e) => { e.preventDefault(); this._toggleMic(); },
    }, [icon(ICONS.mic, 18)]);
    this.voiceBtn = voiceBtn;
    if (!this._canListen && !this._canSpeak) voiceBtn.hidden = true;
    if (!this._canListen) { voiceBtn.disabled = true; voiceBtn.title = t("tutor.voiceListenUnsupported"); }

    if (SR) {
      const rec = new SR();
      rec.lang = getLang() === "sv" ? "sv-SE" : "en-GB";
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let txt = "";
        for (const r of e.results) txt += r[0].transcript;
        this.inputEl.value = txt;
        if (e.results[e.results.length - 1].isFinal) {
          this._stopMic();
          this._submit();
        }
      };
      rec.onerror = () => this._stopMic();
      rec.onend = () => { if (this._listening) this._stopMic(); };
      this._rec = rec;
    }

    this.formEl = el("form.tutor__form", { onsubmit: (e) => { e.preventDefault(); this._submit(); } }, [
      this.inputEl,
      voiceBtn,
      el("button.iconbtn", { type: "submit", "aria-label": t("tutor.send"), style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]),
    ]);

    this.subEl = el("div.tutor__sub", {}, this._subText());

    this.el = el("div.tutor.card", {}, [
      el("div.tutor__head", {}, [
        this.mascotEl,
        el("div", {}, [
          el("div.tutor__title", {}, t("tutor.name")),
          this.subEl,
        ]),
      ]),
      this.logEl,
      this.formEl,
    ]);

    if (this.locked) this.formEl.hidden = true;
  }

  _subText() {
    if (this.locked) return t("tutor.subLocked");
    if (Number.isFinite(this.hintBudget)) return t("tutor.hintsLeft", { n: this.hintsLeft });
    return this.live ? t("tutor.subLive") : t("tutor.subDemo");
  }
  _refreshSub() { if (this.subEl) this.subEl.textContent = this._subText(); }

  /** Test mode: no hints while the test is running, and say why. */
  showLocked() {
    clear(this.logEl);
    setMood(this.mascotEl, "thinking");
    this.logEl.appendChild(el("div.tutor__locked", {}, [
      el("p", {}, t("tutor.lockedTitle")),
      el("p.note", {}, t("tutor.lockedBody")),
    ]));
  }

  async setQuestion(assignment, question) {
    this.assignment = assignment;
    this.question = question;
    this.messages = [];
    this.ladderIndex = -1;
    this.turns = 0;
    clear(this.logEl);
    setMood(this.mascotEl, "idle");

    this._append("ai", await this._opener(question));
    this.logEl.scrollTop = 0;
  }

  /**
   * The opening line for a question. Preference order:
   *   1. the opener stored on the question (written once, at generation time)
   *   2. the hand-written demo-mode intro
   *   3. a rotating generic nudge — never the same line twice in a row
   * No API call either way.
   */
  async _opener(question) {
    if (question.opener) return question.opener;
    const s = await loadScripted();
    const scripted = s.byQuestion?.[question.id]?.intro;
    if (scripted) return scripted;
    if (!this.live && s.generic?.intro) return s.generic.intro;
    const openers = fallbackOpeners();
    this._openerIndex = (this._openerIndex + 1) % openers.length;
    return openers[this._openerIndex];
  }

  // Programmatic nudge, phrased in the student's voice (e.g. after a wrong answer).
  note(studentVoicedText, mood = "encourage") {
    setMood(this.mascotEl, mood);
    this._respond(studentVoicedText, { fromNote: true });
  }

  celebrate(studentVoicedText = t("q.tutorRight")) {
    setMood(this.mascotEl, "cheer");
    this._respond(studentVoicedText, { correct: true });
  }

  _toggleMic() {
    if (!this._rec) return;
    this._listening ? this._stopMic() : this._startMic();
  }
  _startMic() {
    try { this._rec.lang = getLang() === "sv" ? "sv-SE" : "en-GB"; this._rec.start(); }
    catch { return; }
    this._listening = true;
    this.voiceBtn.classList.add("is-listening");
    this.voiceBtn.setAttribute("aria-label", t("tutor.voiceStop"));
    this.inputEl.placeholder = t("tutor.voiceListening");
  }
  _stopMic() {
    if (!this._listening) return;
    this._listening = false;
    try { this._rec.stop(); } catch {}
    this.voiceBtn?.classList.remove("is-listening");
    this.voiceBtn?.setAttribute("aria-label", t("tutor.voiceStart"));
    this.inputEl.placeholder = t("tutor.ask");
  }

  /** Read a reply aloud, when the student has turned voice output on. */
  _speak(text) {
    if (!this._canSpeak || store.settings.voice !== true) return;
    try {
      const clean = String(text).replace(/[#*_`>~]|\$\$?/g, "").replace(/\s+/g, " ").trim();
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = getLang() === "sv" ? "sv-SE" : "en-GB";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {}
  }

  /**
   * "Explain why I was wrong" — one templated turn after a missed practice
   * question. Live mode sends it to the tutor; demo mode falls back to the
   * scripted walk-through for this question.
   */
  async explainWrong(question, theirAnswer) {
    // Wait out any in-flight scripted typing from the wrong-answer nudge.
    for (let i = 0; i < 60 && this.busy; i++) await new Promise((r) => setTimeout(r, 50));
    if (this.busy) return;
    this.el.classList.add("is-open");
    this._append("me", t("tutor.explainWhyLabel"));
    this.turns++;
    this.busy = true;
    setMood(this.mascotEl, "encourage");
    if (this.live) {
      const prompt = t("tutor.explainWhyPrompt", {
        answer: theirAnswer ? `"${theirAnswer}"` : t("tutor.explainWhyBlank"),
      });
      await this._respondLive(prompt, {});
    } else {
      const s = await loadScripted();
      const q = s.byQuestion?.[question?.id] || {};
      const g = s.generic || {};
      await this._typeOut(q.correct || g.correct || t("tutor.explainWhyScripted"));
    }
    this.busy = false;
  }

  _submit() {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    if (this.hintsLeft <= 0) { toast(t("tutor.hintsGone")); return; }
    this.inputEl.value = "";
    if (Number.isFinite(this.hintBudget)) {
      this.hintsLeft--;
      this._refreshSub();
      if (this.hintsLeft <= 0) {
        this.inputEl.disabled = true;
        this.inputEl.placeholder = t("tutor.hintsGone");
      }
    }
    this._respond(text);
  }

  async _respond(userText, opts = {}) {
    if (!opts.fromNote) this._append("me", userText);
    this.turns++;
    this.busy = true;

    if (this.live) {
      await this._respondLive(userText, opts);
    } else {
      await this._respondScripted(userText, opts);
    }
    this.busy = false;
  }

  async _respondScripted(userText, opts) {
    const s = await loadScripted();
    const q = s.byQuestion?.[this.question?.id] || {};
    const g = s.generic || {};
    const ladder = q.ladder || g.ladder || [];

    let reply;
    if (opts.correct) {
      reply = q.correct || g.correct || t("tutor.scriptedCorrect");
      setMood(this.mascotEl, "cheer");
    } else {
      // "I give up" in either language jumps straight to the fullest hint.
      const stuck = /\b(i don'?t know|no idea|tell me|give up|just the answer|idk|vet inte|ingen aning|säg svaret|ger upp|berätta)\b/i.test(userText);
      if (stuck) this.ladderIndex = ladder.length - 1;
      else this.ladderIndex = Math.min(this.ladderIndex + 1, ladder.length - 1);
      reply = ladder[this.ladderIndex] || g.encourage || t("tutor.scriptedEncourage");
      setMood(this.mascotEl, this.ladderIndex >= ladder.length - 1 ? "thinking" : "encourage");
    }
    await this._typeOut(reply);
  }

  async _respondLive(userText, opts) {
    if (this.messages.length === 0) {
      this.messages.push({ role: "user", content: userText });
    } else {
      this.messages.push({ role: "user", content: userText });
    }
    const bubble = this._append("ai", "");
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
    setMood(this.mascotEl, "thinking");

    this.abort = new AbortController();
    let acc = "";
    try {
      const system = tutorSystem({
        assignment: this.assignment, question: this.question,
        verbosity: store.settings.tutorVerbosity,
        history: this.history,
      });
      for await (const chunk of tutorStream({ system, messages: this.messages, signal: this.abort.signal })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        this._scroll();
      }
      this.messages.push({ role: "assistant", content: acc || "…" });
      setMood(this.mascotEl, opts.correct ? "cheer" : "idle");
      announce(t("tutor.prefix", { text: acc }));
      this._speak(acc);
    } catch (e) {
      const msg = e instanceof ClaudeError ? e.message : t("tutor.snag");
      bubble.innerHTML = markdown(`_${msg}_`);
      this.messages.pop(); // drop the user turn that failed
    }
  }

  async _typeOut(text) {
    const bubble = this._append("ai", "");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      bubble.innerHTML = markdown(text);
      this._scroll();
    } else {
      const words = text.split(" ");
      for (let i = 0; i < words.length; i++) {
        bubble.innerHTML = markdown(words.slice(0, i + 1).join(" "));
        this._scroll();
        await new Promise((r) => setTimeout(r, 18));
      }
    }
    announce(t("tutor.prefix", { text }));
    this._speak(text);
  }

  _append(who, text) {
    const node = el(`div.msg.${who}`, {}, []);
    node.innerHTML = who === "me" ? escapeHtml(text) : markdown(text);
    this.logEl.appendChild(node);
    this._scroll();
    return node;
  }

  _scroll() { this.logEl.scrollTop = this.logEl.scrollHeight; }

  destroy() {
    try { this.abort?.abort(); } catch {}
    try { this._stopMic(); } catch {}
    try { if (this._canSpeak) window.speechSynthesis.cancel(); } catch {}
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
