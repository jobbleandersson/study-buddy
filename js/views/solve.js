// Instant problem help, as a chat from the moment the page loads — no
// upload-then-chat gate. Attach a photo (button or paste), paste or type
// plain text, or both, and send; the tutor answers, then it's a normal
// back-and-forth about that same problem, reusing the exact streaming call
// the practice-session tutor already runs on. Needs the tutor server
// (store.hasKey()); until then the composer is disabled and the reason is
// spelled out, exactly like Create.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { markdown } from "../lib/markdown.js";
import { announce } from "../lib/a11y.js";
import { readImageFile } from "../material.js";
import { tutorStream, ClaudeError } from "../claude.js";
import { solveChatSystem } from "../prompts.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { bindFileTargets } from "../components/file-drop.js";

export function renderSolve() {
  const root = el("div.solve");
  const canChat = store.hasKey();
  const state = {
    messages: [],       // Anthropic-format history for this conversation
    pendingImage: null, // { mediaType, data, preview } attached, not yet sent
    busy: false,
  };

  // Built once; mutated directly from here on (streaming and attach
  // previews need to update in place without losing focus or typed text).
  let refs = null;

  function appendWelcome() {
    const node = el("div.msg.ai.solve-chat__welcome", {});
    node.innerHTML = markdown(t("solve.intro"));
    refs.logEl.appendChild(node);
  }

  function appendUserBubble(text, imgSrc) {
    const node = el("div.msg.me", {});
    if (imgSrc) node.appendChild(el("img.msg__img", { src: imgSrc, alt: "" }));
    if (text) node.appendChild(el("span", { html: escapeHtml(text) }));
    refs.logEl.appendChild(node);
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
  }

  function appendAiBubble() {
    const node = el("div.msg.ai", {});
    refs.logEl.appendChild(node);
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
    return node;
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

  function resetChat() {
    state.messages = [];
    state.pendingImage = null;
    clear(refs.logEl);
    appendWelcome();
    renderPending();
    refs.inputEl.value = "";
    refs.resetBtn.hidden = true;
    refs.inputEl.focus();
  }

  async function send() {
    if (state.busy) return;
    const text = refs.inputEl.value.trim();
    if (!text && !state.pendingImage) return;

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
    refs.resetBtn.hidden = false;

    await streamReply();
  }

  async function streamReply() {
    state.busy = true;
    refs.inputEl.disabled = true;
    refs.attachBtn.disabled = true;
    const bubble = appendAiBubble();
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
    let acc = "";
    try {
      for await (const chunk of tutorStream({ system: solveChatSystem(), messages: state.messages })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        refs.logEl.scrollTop = refs.logEl.scrollHeight;
      }
      state.messages.push({ role: "assistant", content: acc || "…" });
      announce(t("tutor.prefix", { text: acc }));
    } catch (e) {
      const msg = e instanceof ClaudeError ? e.message : t("tutor.snag");
      bubble.innerHTML = markdown(`_${msg}_`);
      toast(msg);
    } finally {
      state.busy = false;
      refs.inputEl.disabled = false;
      refs.attachBtn.disabled = false;
      refs.inputEl.focus();
    }
  }

  function gateNote() {
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

    const inputEl = el("input.tutor__input", {
      type: "text", placeholder: t("solve.chatPlaceholder"), "aria-label": t("solve.chatPlaceholder"),
      onkeydown: (e) => { if (e.key === "Enter") send(); },
    });

    const attachBtn = el("button.iconbtn", {
      type: "button", "aria-label": t("solve.attachLabel"), title: t("solve.uploadHint"),
      onclick: () => fileInput.click(),
    }, [icon(ICONS.camera, 18)]);

    const sendBtn = el("button.iconbtn", { type: "submit", "aria-label": t("tutor.send"), style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]);
    const formEl = el("form.tutor__form", { onsubmit: (e) => { e.preventDefault(); send(); } }, [fileInput, attachBtn, inputEl, sendBtn]);

    const resetBtn = el("button.linkbtn.solve-chat__reset", { type: "button", hidden: true, onclick: resetChat }, t("solve.newChat"));

    if (!canChat) {
      inputEl.disabled = true;
      attachBtn.disabled = true;
      sendBtn.disabled = true;
    }

    refs = { logEl, pendingEl, inputEl, attachBtn, resetBtn };

    root.appendChild(homeButton({ grid: true }));
    root.appendChild(el("div", { style: { display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginTop: "8px" } }, [
      el("h1", {}, t("solve.title")),
      resetBtn,
    ]));
    const panel = el("div.panel.solve-chat__panel", {}, [
      canChat ? null : gateNote(),
      logEl,
      pendingEl,
      formEl,
      canChat ? el("div.solve-chat__drop", { "aria-hidden": "true" }, t("solve.dropHere")) : null,
    ].filter(Boolean));
    root.appendChild(panel);

    if (canChat) {
      appendWelcome();
      // Drag a picture onto the page, or paste one anywhere — focused or not.
      bindFileTargets(panel, {
        accept: "image/*", paste: true,
        onFiles: ([file]) => attachImage(file),
        onReject: () => toast(t("err.imageType")),
      });
    }
  }

  build();
  return { title: t("solve.pageTitle"), node: root };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
