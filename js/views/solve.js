// Instant photo-solve: snap a photo of ONE problem, then keep talking about
// it — a real back-and-forth with the tutor, not one static answer. The
// photo seeds the conversation (as an image content block, kept in the
// message history so follow-ups can still refer to it); everything after
// that reuses the exact same streaming call the practice-session tutor uses.
// Needs the tutor server (store.hasKey()); until then the button is disabled
// and the reason is spelled out, exactly like Create.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { markdown } from "../lib/markdown.js";
import { announce } from "../lib/a11y.js";
import { readImageFile } from "../material.js";
import { tutorStream, ClaudeError } from "../claude.js";
import { solveChatSystem } from "../prompts.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

export function renderSolve() {
  const root = el("div.solve");
  const state = {
    step: "idle",   // idle | chat
    image: null,    // { mediaType, data, preview }
    note: "",
    messages: [],   // Anthropic-format history for this photo's thread
    busy: false,
    error: "",
  };

  // Built once on entering the chat step, then mutated directly for
  // streaming — a full re-render per token would be wasteful and janky.
  let chat = null; // { logEl, inputEl, formEl }

  function paint() {
    clear(root);
    root.appendChild(homeButton({ grid: true }));
    root.appendChild(el("h1", { style: { marginTop: "8px" } }, t("solve.title")));
    root.appendChild(state.step === "chat" ? chatPanel() : idlePanel());
  }

  function reset() {
    state.step = "idle"; state.image = null; state.note = ""; state.messages = []; state.error = "";
    chat = null;
    paint();
  }

  async function startChat() {
    state.messages = [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: state.image.mediaType, data: state.image.data } },
        { type: "text", text: state.note.trim() ? `Extra context from the student: ${state.note.trim()}` : t("solve.chatSeedText") },
      ],
    }];
    state.step = "chat";
    paint();
    await streamReply();
  }

  function appendBubble(who, text) {
    const node = el(`div.msg.${who}`, {});
    node.innerHTML = who === "me" ? escapeHtml(text) : markdown(text);
    chat.logEl.appendChild(node);
    chat.logEl.scrollTop = chat.logEl.scrollHeight;
    return node;
  }

  async function submitFollowUp() {
    const text = chat.inputEl.value.trim();
    if (!text || state.busy) return;
    chat.inputEl.value = "";
    state.messages.push({ role: "user", content: text });
    appendBubble("me", text);
    await streamReply();
  }

  async function streamReply() {
    state.busy = true;
    chat.inputEl.disabled = true;
    const bubble = appendBubble("ai", "");
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
    let acc = "";
    try {
      for await (const chunk of tutorStream({ system: solveChatSystem(), messages: state.messages })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        chat.logEl.scrollTop = chat.logEl.scrollHeight;
      }
      state.messages.push({ role: "assistant", content: acc || "…" });
      announce(t("tutor.prefix", { text: acc }));
    } catch (e) {
      const msg = e instanceof ClaudeError ? e.message : t("tutor.snag");
      bubble.innerHTML = markdown(`_${msg}_`);
      toast(msg);
    } finally {
      state.busy = false;
      chat.inputEl.disabled = false;
      chat.inputEl.focus();
    }
  }

  function idlePanel() {
    const fileInput = el("input", {
      type: "file", accept: "image/*", capture: "environment", style: { display: "none" },
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        state.error = "";
        try {
          state.image = await readImageFile(file);
        } catch (err) {
          state.image = null;
          state.error = err.message || t("err.readFile");
        }
        paint();
      },
    });

    const dropzone = el("label.solve-dropzone" + (state.image ? ".has-image" : ""), {}, [
      fileInput,
      state.image
        ? el("img", { src: state.image.preview, alt: "" })
        : el("div.solve-dropzone__inner", {}, [
            icon(ICONS.camera, 32),
            el("span.solve-dropzone__cta", {}, t("solve.uploadCta")),
            el("span.note", {}, t("solve.uploadHint")),
          ]),
    ]);

    const noteInput = el("textarea", {
      placeholder: t("solve.notePlaceholder"), rows: 2, style: { minHeight: "60px" },
      oninput: (e) => { state.note = e.target.value; },
    });
    noteInput.value = state.note;

    return el("div.panel", {}, [
      el("p", { style: { marginBottom: "16px" } }, t("solve.intro")),
      el("div.field", {}, [el("span", {}, t("solve.uploadLabel")), dropzone]),
      state.image
        ? el("button.linkbtn", { type: "button", style: { marginTop: "8px" }, onclick: () => fileInput.click() }, t("solve.retake"))
        : null,
      el("label.field", { style: { marginTop: "16px" } }, [el("span", {}, t("solve.noteLabel")), noteInput]),
      state.error ? el("p.note.note--warn", { style: { marginTop: "12px" } }, state.error) : null,
      // Server is up and keyed but the visitor isn't signed in: say that, not
      // "no server" — same split as Create's source step.
      !store.hasKey() && store.aiNeedsSignIn() ? el("p.note", { style: { marginTop: "16px" } }, [
        t("solve.needSignIn"),
        el("a", { href: "#/login" }, t("solve.needSignInLink")),
        t("solve.needSignInTail"),
      ])
      : !store.hasKey() ? el("p.note.note--warn", { style: { marginTop: "16px" } }, [
        t("solve.noServerHere"),
        el("a", { href: "#/library" }, t("solve.noServerAlt")),
      ]) : null,
      el("div", { style: { marginTop: "20px", textAlign: "center" } }, [
        el("button.btn", { type: "button", disabled: !state.image || !store.hasKey(), onclick: startChat },
          [icon(ICONS.spark, 18), t("solve.solveButton")]),
      ]),
    ].filter(Boolean));
  }

  function chatPanel() {
    const logEl = el("div.solve-chat__log", { "aria-live": "off", tabindex: "0", "aria-label": t("tutor.convAria") });
    const inputEl = el("input.tutor__input", {
      type: "text", placeholder: t("solve.chatPlaceholder"), "aria-label": t("solve.chatPlaceholder"),
      onkeydown: (e) => { if (e.key === "Enter") submitFollowUp(); },
    });
    const formEl = el("form.tutor__form", { onsubmit: (e) => { e.preventDefault(); submitFollowUp(); } }, [
      inputEl,
      el("button.iconbtn", { type: "submit", "aria-label": t("tutor.send"), style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]),
    ]);
    chat = { logEl, inputEl, formEl };

    return el("div.panel", {}, [
      el("div.solve-chat__pinned", {}, [
        el("img", { src: state.image.preview, alt: "" }),
        el("button.linkbtn", { type: "button", onclick: reset }, [icon(ICONS.camera, 14), t("solve.newPhoto")]),
      ]),
      logEl,
      formEl,
    ]);
  }

  paint();
  return { title: t("solve.pageTitle"), node: root };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
