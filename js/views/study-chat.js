// The study chat: an AI study assistant with one-tap ways to study (quiz me, explain, summarise, compare,
// word list, debate) for a topic or a page of pasted notes. It is the same streaming call the tutor and
// Solve use, so it needs the tutor server and an account, and says which of those is missing (or that this
// month's allowance is used up) instead of a bare "no server".
//
//   #/chat            free chat
//   #/chat?mode=quiz  starts in that way of studying (the home page's AI study help strip links here)

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { markdown } from "../lib/markdown.js";
import { announce } from "../lib/a11y.js";
import { tutorStream, ClaudeError } from "../claude.js";
import { studyChatSystem } from "../prompts.js";
import { STUDY_MODES, isStudyMode, trimHistory, MAX_INPUT_CHARS } from "../lib/study-modes.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { aiQuotaNote } from "../components/ai-gate.js";

/** How much of a long pasted text is echoed back in the student's own bubble. */
const ECHO_CHARS = 600;

export function renderStudyChat(qs) {
  const root = el("div.solve.studychat");
  const canChat = store.hasKey();
  const state = {
    mode: isStudyMode(qs?.get?.("mode")) ? qs.get("mode") : null,   // null = free chat
    messages: [],   // Anthropic-format history for this conversation
    busy: false,
    abort: null,
  };
  let refs = null;

  const modeKey = (part) => `chat.${part}.${state.mode || "free"}`;

  function appendBubble(who, html) {
    const node = el(`div.msg.${who}`, {});
    if (html != null) node.innerHTML = html;
    refs.logEl.appendChild(node);
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
    return node;
  }

  function paintModes() {
    for (const btn of refs.modeBtns) {
      const on = btn.dataset.mode === state.mode;
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("is-on", on);
    }
    refs.inputEl.placeholder = t(modeKey("placeholder"));
    refs.inputEl.setAttribute("aria-label", t(modeKey("placeholder")));
  }

  /** A new conversation, opened with what this way of studying expects from the student. */
  function resetThread() {
    state.abort?.abort();
    state.messages = [];
    state.busy = false;
    clear(refs.logEl);
    appendBubble("ai", markdown(t(modeKey("intro"))));
    refs.resetBtn.hidden = true;
    refs.inputEl.disabled = !canChat;
    refs.sendBtn.disabled = !canChat;
    paintModes();
  }

  function pickMode(id) {
    state.mode = state.mode === id ? null : id;   // tap again to go back to free chat
    resetThread();
    refs.inputEl.focus();
  }

  async function send() {
    if (state.busy || !canChat) return;
    const text = refs.inputEl.value.trim();
    if (!text) return;
    if (text.length > MAX_INPUT_CHARS) { toast(t("chat.tooLong", { n: MAX_INPUT_CHARS })); return; }

    state.messages.push({ role: "user", content: text });
    appendBubble("me", "").textContent = text.length > ECHO_CHARS ? `${text.slice(0, ECHO_CHARS)}…` : text;
    refs.inputEl.value = "";
    autosize();
    refs.resetBtn.hidden = false;
    await streamReply();
  }

  async function streamReply() {
    state.busy = true;
    refs.inputEl.disabled = true;
    refs.sendBtn.disabled = true;
    const bubble = appendBubble("ai", `<span class="typing"><span></span><span></span><span></span></span>`);
    state.abort = new AbortController();
    const mine = state.abort;
    let acc = "";
    try {
      for await (const chunk of tutorStream({
        system: studyChatSystem(state.mode),
        messages: trimHistory(state.messages),
        signal: mine.signal,
        maxTokens: 1200,
      })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        refs.logEl.scrollTop = refs.logEl.scrollHeight;
      }
      state.messages.push({ role: "assistant", content: acc || "…" });
      announce(t("tutor.prefix", { text: acc }));
    } catch (e) {
      if (mine.signal.aborted) return;   // the student started a new chat; that thread is gone
      const msg = e instanceof ClaudeError ? e.message : t("tutor.snag");
      bubble.innerHTML = markdown(`_${msg}_`);
      state.messages.pop();   // the failed question is not part of the history; they can send it again
      toast(msg);
    } finally {
      if (state.abort === mine) {
        state.busy = false;
        refs.inputEl.disabled = !canChat;
        refs.sendBtn.disabled = !canChat;
        if (canChat) refs.inputEl.focus();
      }
    }
  }

  function autosize() {
    const ta = refs.inputEl;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }

  function gateNote() {
    const why = store.aiBlockReason();
    if (why === "quota") return aiQuotaNote({ style: { marginBottom: "16px" } });
    if (why === "signin") {
      return el("p.note", { style: { marginBottom: "16px" } }, [
        t("chat.needSignIn"), el("a", { href: "#/login" }, t("chat.needSignInLink")), t("chat.needSignInTail"),
      ]);
    }
    return el("p.note.note--warn", { style: { marginBottom: "16px" } }, [
      t("chat.noServer") + " ", el("a", { href: "#/library" }, t("solve.noServerAlt")),
    ]);
  }

  function build() {
    const logEl = el("div.solve-chat__log", { "aria-live": "off", tabindex: "0", "aria-label": t("tutor.convAria") });
    const inputEl = el("textarea.tutor__input.studychat__input", {
      rows: 1,
      oninput: autosize,
      // Enter sends; Shift+Enter is a new line (notes are pasted in here, so multi-line matters).
      onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } },
    });
    const sendBtn = el("button.iconbtn", { type: "submit", "aria-label": t("tutor.send"), style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]);
    const formEl = el("form.tutor__form.studychat__form", { onsubmit: (e) => { e.preventDefault(); send(); } }, [inputEl, sendBtn]);
    const resetBtn = el("button.linkbtn.solve-chat__reset", { type: "button", hidden: true, onclick: resetThread }, t("chat.newChat"));

    const modeBtns = STUDY_MODES.map((m) => el("button.chatmode", {
      type: "button", "data-mode": m.id, "aria-pressed": "false", onclick: () => pickMode(m.id),
    }, [icon(ICONS[m.icon] || ICONS.spark, 16), t(`chat.mode.${m.id}`)]));

    refs = { logEl, inputEl, sendBtn, resetBtn, modeBtns };

    root.appendChild(homeButton({ grid: true }));
    root.appendChild(el("div", { style: { display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginTop: "8px" } }, [
      el("h1", {}, t("chat.title")),
      resetBtn,
    ]));
    root.appendChild(el("p.note", { style: { margin: "0 0 12px" } }, t("chat.sub")));
    root.appendChild(el("div.chatmodes", { role: "group", "aria-label": t("chat.modesLabel") }, modeBtns));
    root.appendChild(el("div.panel.solve-chat__panel", {}, [canChat ? null : gateNote(), logEl, formEl].filter(Boolean)));

    resetThread();
  }

  build();
  return {
    title: t("chat.pageTitle"),
    node: root,
    cleanup: () => state.abort?.abort(),
  };
}
