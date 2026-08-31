// The tutor chat panel. Works in two modes:
//   - live:    streams from Claude (when an API key is set)
//   - scripted: walks a hint ladder from data/samples/scripted-tutor.json (offline demo)

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { markdown } from "../lib/markdown.js";
import { mascot, setMood } from "./mascot.js";
import { store } from "../store.js";
import { tutorSystem } from "../prompts.js";
import { tutorStream, ClaudeError } from "../claude.js";

let scripted = null;
async function loadScripted() {
  if (scripted) return scripted;
  scripted = await fetch("data/samples/scripted-tutor.json").then((r) => r.json()).catch(() => ({ generic: {}, byQuestion: {} }));
  return scripted;
}

export class TutorChat {
  constructor() {
    this.live = store.hasKey();
    this.messages = [];       // Anthropic-format history (live mode)
    this.ladderIndex = -1;    // scripted mode
    this.turns = 0;
    this.busy = false;
    this.abort = null;
    this._build();
  }

  _build() {
    this.mascotEl = mascot("idle", 40);
    this.logEl = el("div.tutor__log", { role: "log" });
    this.inputEl = el("input.tutor__input", {
      type: "text", placeholder: "Ask the tutor…", "aria-label": "Message the tutor",
      onkeydown: (e) => { if (e.key === "Enter") this._submit(); },
    });
    const voiceBtn = el("button.iconbtn.voice-btn.tooltip", {
      type: "button", disabled: true, "aria-label": "Voice mode (coming soon)",
      dataset: { tip: "Voice mode — coming soon" },
    }, [icon(ICONS.mic, 18)]);

    this.el = el("div.tutor.card", {}, [
      el("div.tutor__head", {}, [
        this.mascotEl,
        el("div", {}, [
          el("div.tutor__title", {}, "StudyBuddy"),
          el("div.tutor__sub", {}, this.live ? "your tutor" : "your tutor · demo mode"),
        ]),
      ]),
      this.logEl,
      el("form.tutor__form", { onsubmit: (e) => { e.preventDefault(); this._submit(); } }, [
        this.inputEl,
        voiceBtn,
        el("button.iconbtn", { type: "submit", "aria-label": "Send", style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]),
      ]),
    ]);
  }

  async setQuestion(assignment, question) {
    this.assignment = assignment;
    this.question = question;
    this.messages = [];
    this.ladderIndex = -1;
    this.turns = 0;
    clear(this.logEl);
    setMood(this.mascotEl, "idle");

    if (this.live) {
      this._append("ai", `Let's tackle this one. What's your first thought?`);
    } else {
      const s = await loadScripted();
      const intro = s.byQuestion?.[question.id]?.intro || s.generic?.intro || "Let's work through this together — what do you already know?";
      this._append("ai", intro);
    }
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
      });
      for await (const chunk of tutorStream({ system, messages: this.messages, signal: this.abort.signal })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        this._scroll();
      }
      this.messages.push({ role: "assistant", content: acc || "…" });
      setMood(this.mascotEl, opts.correct ? "cheer" : "idle");
    } catch (e) {
      const msg = e instanceof ClaudeError ? e.message : "The tutor hit a snag. Try again in a moment.";
      bubble.innerHTML = markdown(`_${msg}_`);
      this.messages.pop(); // drop the user turn that failed
    }
  }

  async _typeOut(text) {
    const bubble = this._append("ai", "");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { bubble.innerHTML = markdown(text); this._scroll(); return; }
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      bubble.innerHTML = markdown(words.slice(0, i + 1).join(" "));
      this._scroll();
      await new Promise((r) => setTimeout(r, 18));
    }
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
