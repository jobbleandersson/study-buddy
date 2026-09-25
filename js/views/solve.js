// Instant problem help, as a chat from the moment the page loads — no
// upload-then-chat gate. Attach a photo (button or paste), paste or type
// plain text, or both, and send; the tutor answers, then it's a normal
// back-and-forth about that same problem, reusing the exact streaming call
// the practice-session tutor already runs on. Needs the tutor server
// (store.hasKey()); until then the composer is disabled and the reason is
// spelled out, exactly like Create.
//
// Also where the six one-tap "ways to study" live (quiz me, explain, summarise, compare,
// word list, debate — lib/study-modes.js): tapping one starts a fresh thread under that
// mode's own ground rules instead of the default "help with one problem" persona; tapping
// the active one again returns to the default. This used to be its own page (#/chat) —
// folded in here because it was the exact same chat, just with a different system prompt,
// and having "the AI page" and "the AI chat page" as two separate things confused more than
// it helped. #/chat?mode=X still gets read as ?mode=X here (main.js no longer routes #/chat
// at all — an old link to it lands on the home page, same as any other unknown hash).
//
//   #/solve            the default "help with a problem" persona
//   #/solve?mode=quiz  starts in that way of studying (also linked from the home page's
//                      AI study help strip, and from the mode chips below)
//   #/solve?mode=check is intercepted by main.js before this module ever loads — that's
//                      the separate "Kolla min uträkning" tab (check.js), not a mode here.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { markdown } from "../lib/markdown.js";
import { announce } from "../lib/a11y.js";
import { readImageFile } from "../material.js";
import { tutorStream, ClaudeError } from "../claude.js";
import { solveChatSystem, studyChatSystem } from "../prompts.js";
import { STUDY_MODES, isStudyMode, trimHistory, MAX_INPUT_CHARS } from "../lib/study-modes.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { bindFileTargets } from "../components/file-drop.js";
import { solveTabs } from "../components/solve-tabs.js";
import { aiQuotaNote } from "../components/ai-gate.js";
import { mascot, setMood } from "../components/mascot.js";

/** How much of a long pasted text is echoed back in the student's own bubble — the message
 *  sent to the model is never truncated, only what's shown (a page of notes shouldn't make
 *  the transcript unscrollable). */
const ECHO_CHARS = 600;

export function renderSolve(qs) {
  const root = el("div.solve");
  const canChat = store.hasKey();
  const state = {
    mode: isStudyMode(qs?.get?.("mode")) ? qs.get("mode") : null,   // null = the default "help with a problem" persona
    messages: [],       // Anthropic-format history for this conversation
    pendingImage: null, // { mediaType, data, preview } attached, not yet sent
    busy: false,
    abort: null,        // lets switching mode mid-stream cut the old reply off cleanly
  };

  // Built once; mutated directly from here on (streaming and attach
  // previews need to update in place without losing focus or typed text).
  let refs = null;
  // The chat header's avatar — its mood follows the same busy/idle rhythm as the
  // help-chat bubble's (site-chat.js), so the assistant visibly "thinks" while streaming.
  const mascotEl = mascot("idle", 40);

  /** The default persona has its own strings (solve.*, unchanged from before the modes existed);
   *  each study mode has its own (chat.intro.<id> / chat.placeholder.<id>). */
  const introText = () => (state.mode ? t(`chat.intro.${state.mode}`) : t("solve.intro"));
  const placeholderText = () => (state.mode ? t(`chat.placeholder.${state.mode}`) : t("solve.chatPlaceholder"));

  function appendBubble(who, html) {
    const node = el(`div.msg.${who}`, {});
    if (html != null) node.innerHTML = html;
    refs.logEl.appendChild(node);
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
    return node;
  }

  function appendWelcome() {
    // el() wants dot-separated classes in the tag string, not space-separated (a space in a single
    // token throws on classList.add) — appendBubble's `who` is always one plain word, so add the
    // second class after the fact instead of trying to smuggle it through that param.
    appendBubble("ai", markdown(introText())).classList.add("solve-chat__welcome");
  }

  function appendUserBubble(text, imgSrc) {
    const node = el("div.msg.me", {});
    if (imgSrc) node.appendChild(el("img.msg__img", { src: imgSrc, alt: "" }));
    if (text) node.appendChild(el("span", { html: escapeHtml(text.length > ECHO_CHARS ? `${text.slice(0, ECHO_CHARS)}…` : text) }));
    refs.logEl.appendChild(node);
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
  }

  async function attachImage(file) {
    try {
      state.pendingImage = await readImageFile(file);
    } catch (err) {
      toast(err.message || t("err.readFile"));
      return;
    }
    renderPending();
  }

  function renderPending() {
    clear(refs.pendingEl);
    refs.pendingEl.hidden = !state.pendingImage;
    if (!state.pendingImage) return;
    refs.pendingEl.appendChild(el("img", { src: state.pendingImage.preview, alt: "" }));
    refs.pendingEl.appendChild(el("button.iconbtn.iconbtn--sm", {
      type: "button", "aria-label": t("solve.removeImage"),
      onclick: () => { state.pendingImage = null; renderPending(); },
    }, [icon(ICONS.close, 14)]));
  }

  /** A fresh conversation, opened with whatever the current mode (or the default persona)
   *  leads with. Cuts an in-flight reply off first — switching mode mid-stream must not let
   *  the old answer land in the new, just-cleared thread. */
  function resetChat() {
    state.abort?.abort();
    state.messages = [];
    state.pendingImage = null;
    state.busy = false;
    clear(refs.logEl);
    appendWelcome();
    renderPending();
    refs.inputEl.value = "";
    autosize();
    refs.resetBtn.hidden = true;
    refs.inputEl.disabled = !canChat;
    refs.attachBtn.disabled = !canChat;
    paintModes();
    if (canChat) refs.inputEl.focus();
  }

  function pickMode(id) {
    state.mode = state.mode === id ? null : id;   // tap the active one again to go back to the default persona
    resetChat();
  }

  function paintModes() {
    for (const btn of refs.modeBtns) {
      const on = btn.dataset.mode === state.mode;
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("is-on", on);
    }
    refs.inputEl.placeholder = placeholderText();
    refs.inputEl.setAttribute("aria-label", placeholderText());
  }

  function autosize() {
    const ta = refs.inputEl;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }

  async function send() {
    if (state.busy) return;
    const text = refs.inputEl.value.trim();
    if (!text && !state.pendingImage) return;
    if (text.length > MAX_INPUT_CHARS) { toast(t("chat.tooLong", { n: MAX_INPUT_CHARS })); return; }

    const img = state.pendingImage;
    state.messages.push({
      role: "user",
      content: img
        ? [
            { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
            { type: "text", text: text || t("solve.chatSeedText") },
          ]
        : text,
    });
    appendUserBubble(text, img?.preview);
    state.pendingImage = null;
    renderPending();
    refs.inputEl.value = "";
    autosize();
    refs.resetBtn.hidden = false;

    await streamReply();
  }

  async function streamReply() {
    state.busy = true;
    refs.inputEl.disabled = true;
    refs.attachBtn.disabled = true;
    setMood(mascotEl, "thinking");
    const bubble = appendBubble("ai", `<span class="typing"><span></span><span></span><span></span></span>`);
    state.abort = new AbortController();
    const mine = state.abort;
    let acc = "";
    try {
      for await (const chunk of tutorStream({
        system: state.mode ? studyChatSystem(state.mode) : solveChatSystem(),
        messages: trimHistory(state.messages),
        signal: mine.signal,
      })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        refs.logEl.scrollTop = refs.logEl.scrollHeight;
      }
      state.messages.push({ role: "assistant", content: acc || "…" });
      announce(t("tutor.prefix", { text: acc }));
    } catch (e) {
      if (mine.signal.aborted) return;   // resetChat() already cleared this thread — nothing left to update
      const msg = e instanceof ClaudeError ? e.message : t("tutor.snag");
      bubble.innerHTML = markdown(`_${msg}_`);
      state.messages.pop();   // the failed question isn't part of the history; they can send it again
      toast(msg);
    } finally {
      if (state.abort === mine) {
        state.busy = false;
        refs.inputEl.disabled = !canChat;
        refs.attachBtn.disabled = !canChat;
        setMood(mascotEl, "idle");
        if (canChat) refs.inputEl.focus();
      }
    }
  }

  function gateNote() {
    if (store.aiBlockReason() === "quota") return aiQuotaNote({ style: { marginBottom: "16px" } });
    return store.aiNeedsSignIn()
      ? el("p.note", { style: { marginBottom: "16px" } }, [
          t("solve.needSignIn"),
          el("a", { href: "#/login" }, t("solve.needSignInLink")),
          t("solve.needSignInTail"),
        ])
      : el("p.note.note--warn", { style: { marginBottom: "16px" } }, [
          t("solve.noServerHere"),
          el("a", { href: "#/library" }, t("solve.noServerAlt")),
        ]);
  }

  function build() {
    const logEl = el("div.solve-chat__log", { "aria-live": "off", tabindex: "0", "aria-label": t("tutor.convAria") });
    const pendingEl = el("div.solve-chat__pending", { hidden: true });

    const fileInput = el("input", {
      type: "file", accept: "image/*", capture: "environment", style: { display: "none" },
      onchange: async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (file) await attachImage(file);
      },
    });

    const inputEl = el("textarea.tutor__input.solve-chat__textarea", {
      rows: 1,
      placeholder: placeholderText(), "aria-label": placeholderText(),
      oninput: autosize,
      // Enter sends; Shift+Enter is a new line — pasted notes need multiple lines.
      onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } },
    });

    const attachBtn = el("button.iconbtn", {
      type: "button", "aria-label": t("solve.attachLabel"), title: t("solve.uploadHint"),
      onclick: () => fileInput.click(),
    }, [icon(ICONS.camera, 18)]);

    const sendBtn = el("button.iconbtn", { type: "submit", "aria-label": t("tutor.send"), style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]);
    const formEl = el("form.tutor__form", { onsubmit: (e) => { e.preventDefault(); send(); } }, [fileInput, attachBtn, inputEl, sendBtn]);

    const resetBtn = el("button.linkbtn.solve-chat__reset", { type: "button", hidden: true, onclick: resetChat }, t("solve.newChat"));

    const modeBtns = STUDY_MODES.map((m) => el("button.chatmode", {
      type: "button", "data-mode": m.id, "aria-pressed": "false", onclick: () => pickMode(m.id),
    }, [icon(ICONS[m.icon] || ICONS.spark, 16), t(`chat.mode.${m.id}`)]));

    if (!canChat) {
      inputEl.disabled = true;
      attachBtn.disabled = true;
      sendBtn.disabled = true;
    }

    refs = { logEl, pendingEl, inputEl, attachBtn, resetBtn, modeBtns };

    root.appendChild(homeButton({ grid: true }));
    root.appendChild(el("div.solvehead", {}, [
      mascotEl,
      el("div.solvehead__id", {}, [
        el("h1.solvehead__name", {}, t("solve.aiName")),
        el("p.solvehead__status", {}, canChat
          ? [el("i.solvehead__livedot", { "aria-hidden": "true" }), t("solve.aiStatus")]
          : [el("i.solvehead__livedot.is-off", { "aria-hidden": "true" }), t("solve.aiOffline")]),
      ]),
      resetBtn,
    ]));
    root.appendChild(solveTabs("help"));
    root.appendChild(el("div.chatmodes", { role: "group", "aria-label": t("chat.modesLabel") }, modeBtns));
    const panel = el("div.panel.solve-chat__panel", {}, [
      canChat ? null : gateNote(),
      logEl,
      pendingEl,
      formEl,
      canChat ? el("div.solve-chat__drop", { "aria-hidden": "true" }, t("solve.dropHere")) : null,
    ].filter(Boolean));
    root.appendChild(panel);

    paintModes();
    if (canChat) appendWelcome();
    // Drag a picture onto the page, or paste one anywhere — focused or not.
    // Signed out, a drop is still caught (otherwise the browser opens the image
    // and the visitor loses the page) and answered with the reason instead.
    bindFileTargets(panel, {
      accept: "image/*", paste: canChat,
      onFiles: canChat
        ? ([file]) => attachImage(file)
        : () => toast(blockedToast()),
      onReject: () => toast(t("err.imageType")),
    });
  }

  build();
  return {
    title: t("solve.pageTitle"),
    node: root,
    cleanup: () => state.abort?.abort(),
  };
}

/** The toast for a picture dropped on the page while the AI is off, worded for the actual reason. */
function blockedToast() {
  const why = store.aiBlockReason();
  return why === "signin" ? t("err.notSignedIn") : why === "quota" ? t("err.quotaExceeded") : t("solve.noServerHere").trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
