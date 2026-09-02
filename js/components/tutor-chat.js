// The tutor chat panel. Works in two modes:
//   - live:    streams from Claude (when the tutor server is reachable)
//   - scripted: walks a hint ladder from data/samples/scripted-tutor.json (offline demo)

import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { announce } from "../lib/a11y.js";
import { markdown } from "../lib/markdown.js";
import { mascot, setMood } from "./mascot.js";
import { store } from "../store.js";
import { tutorSystem, FALLBACK_OPENERS } from "../prompts.js";
import { tutorStream, ClaudeError } from "../claude.js";

let scripted = null;
async function loadScripted() {
  if (scripted) return scripted;
  scripted = await fetch("data/samples/scripted-tutor.json").then((r) => r.json()).catch(() => ({ generic: {}, byQuestion: {} }));
  return scripted;
}

export class TutorChat {
  constructor({ locked = false } = {}) {
    this.locked = locked;
    this.live = store.hasKey();
    this.messages = [];       // Anthropic-format history for the current question
    this.ladderIndex = -1;    // scripted mode
    this.turns = 0;
    this.busy = false;
    this.abort = null;
    this.history = [];        // how the whole session has gone, for continuity
    this._openerIndex = Math.floor(Math.random() * FALLBACK_OPENERS.length);
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
    this.logEl = el("div.tutor__log", { "aria-live": "off", tabindex: "0", "aria-label": "Tutor conversation" });
    this.inputEl = el("input.tutor__input", {
      type: "text", placeholder: "Ask the tutor…", "aria-label": "Message the tutor",
      onkeydown: (e) => { if (e.key === "Enter") this._submit(); },
    });
    // Not disabled: a disabled button explains nothing on a touch screen,
    // where there is no hover. Tapping it says why it doesn't work yet.
    const voiceBtn = el("button.iconbtn.voice-btn.tooltip", {
      type: "button", "aria-disabled": "true",
      "aria-label": "Voice mode — coming soon",
      dataset: { tip: "Voice mode — coming soon" },
      onclick: (e) => {
        e.preventDefault();
        toast("Voice mode is coming — you'll be able to talk through problems out loud.");
      },
    }, [icon(ICONS.mic, 18), el("span.voice-soon", {}, "soon")]);

    this.formEl = el("form.tutor__form", { onsubmit: (e) => { e.preventDefault(); this._submit(); } }, [
      this.inputEl,
      voiceBtn,
      el("button.iconbtn", { type: "submit", "aria-label": "Send", style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]),
    ]);

    this.subEl = el("div.tutor__sub", {}, this.locked
      ? "locked during the test"
      : this.live ? "your tutor" : "your tutor · demo mode");

    this.el = el("div.tutor.card", {}, [
      el("div.tutor__head", {}, [
        this.mascotEl,
        el("div", {}, [
          el("div.tutor__title", {}, "StudyBuddy"),
          this.subEl,
        ]),
      ]),
      this.logEl,
      this.formEl,
    ]);

    if (this.locked) this.formEl.hidden = true;
  }

  /** Test mode: no hints while the test is running, and say why. */
  showLocked() {
    clear(this.logEl);
    setMood(this.mascotEl, "thinking");
    this.logEl.appendChild(el("div.tutor__locked", {}, [
      el("p", {}, "I'm sitting this one out."),
      el("p.note", {}, "It's a test, so no hints — answer as best you can. When you finish I'll go through everything you missed with you."),
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
    this._openerIndex = (this._openerIndex + 1) % FALLBACK_OPENERS.length;
    return FALLBACK_OPENERS[this._openerIndex];
  }

  // Programmatic nudge, phrased in the student's voice (e.g. after a wrong answer).
  note(studentVoicedText, mood = "encourage") {
    setMood(this.mascotEl, mood);
    this._respond(studentVoicedText, { fromNote: true });
  }

  celebrate(studentVoicedText = "I got it right!") {
    setMood(this.mascotEl, "cheer");
    this._respond(studentVoicedText, { correct: true });
  }

  _submit() {
    const text = this.inputEl.value.trim();
    if (!text || this.busy) return;
    this.inputEl.value = "";
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
      reply = q.correct || g.correct || "That's right — well done!";
      setMood(this.mascotEl, "cheer");
    } else {
      const stuck = /\b(i don'?t know|no idea|tell me|give up|just the answer|idk)\b/i.test(userText);
      if (stuck) this.ladderIndex = ladder.length - 1;
      else this.ladderIndex = Math.min(this.ladderIndex + 1, ladder.length - 1);
      reply = ladder[this.ladderIndex] || g.encourage || "Give it another try — you're close.";
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
      announce(`Tutor: ${acc}`);
    } catch (e) {
      const msg = e instanceof ClaudeError ? e.message : "The tutor hit a snag. Try again in a moment.";
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
    announce(`Tutor: ${text}`);
  }

  _append(who, text) {
    const node = el(`div.msg.${who}`, {}, []);
    node.innerHTML = who === "me" ? escapeHtml(text) : markdown(text);
    this.logEl.appendChild(node);
    this._scroll();
    return node;
  }

  _scroll() { this.logEl.scrollTop = this.logEl.scrollHeight; }

  destroy() { try { this.abort?.abort(); } catch {} }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
