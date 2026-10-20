// The floating "ask about the app" widget — a bubble in the bottom-right
// corner, on every page, for questions about using PluggEra itself (not
// schoolwork — that's the in-session tutor). Mounted once from main.js and
// appended straight to <body>, like js/lib/dom.js's toast/banner, so it
// survives the router's full re-renders on every navigation.

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { announce } from "../lib/a11y.js";
import { markdown } from "../lib/markdown.js";
import { mascot, setMood } from "./mascot.js";
import { store } from "../store.js";
import { t } from "../lib/i18n.js";
import { resetDateText } from "./ai-gate.js";
import { feedbackForm } from "./feedback-form.js";
// prompts.js and claude.js (plus their own transitive weight — check.js,
// loose-json.js) are loaded lazily in submit() below, not here: this widget
// mounts on every page from main.js, but almost nobody who loads a page ever
// opens the chat and sends a message, so shipping the AI-call machinery to
// everyone up front was pure waste on the path this file's own header says
// matters (LCP).

let mounted = false;

let api = null;   // what the top bar's chat button (phones) calls: set once mounted

/** Opens or closes the chat from outside: the top bar's button on a phone, where the floating button is gone. */
export function toggleSiteChat() {
  mountSiteChat();
  api.toggle();
}

export function mountSiteChat() {
  if (mounted) return;
  mounted = true;

  const messages = []; // Anthropic-format history, this browser tab only
  let busy = false;
  let opened = false;
  let abort = null;

  const fab = el("button.sitechat__fab", {
    type: "button", "aria-label": t("sitechat.fabLabel"), "aria-expanded": "false",
  }, [icon(ICONS.message, 24)]);

  const logEl = el("div.sitechat__log", { "aria-live": "off", tabindex: "0", "aria-label": t("sitechat.convAria") });
  const inputEl = el("input.sitechat__input", {
    type: "text", placeholder: t("sitechat.ask"), "aria-label": t("sitechat.askAria"),
  });
  const sendBtn = el("button.sitechat__send", { type: "submit", "aria-label": t("sitechat.send"), disabled: true }, [icon(ICONS.arrow, 18)]);
  // The send button wakes up once there's something to send.
  inputEl.addEventListener("input", () => { sendBtn.disabled = !inputEl.value.trim() || busy; });
  const formEl = el("form.sitechat__form", { onsubmit: (e) => { e.preventDefault(); submit(); } }, [
    el("div.sitechat__composer", {}, [inputEl, sendBtn]),
  ]);
  const fineEl = el("p.sitechat__fine", {}, t("sitechat.fine"));

  const mascotEl = mascot("idle", 36);
  const titleEl = el("div.sitechat__title", {}, t("sitechat.title"));
  const subEl = el("div.sitechat__sub");
  const closeBtn = el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.close"), onclick: close }, [icon(ICONS.close, 16)]);
  // Two tabs: "Fråga" (the helper, as always) and "Tyck till" (the feedback form, same one as #/feedback).
  // The feedback pane is built the first time its tab is opened, and again after a sign-out.
  const tabAsk = el("button.fb-tab", { type: "button", role: "tab", "aria-selected": "true", onclick: () => showTab("ask") }, t("sitechat.tabAsk"));
  const tabFb = el("button.fb-tab", { type: "button", role: "tab", "aria-selected": "false", onclick: () => showTab("fb") }, t("sitechat.tabFeedback"));
  const fbPane = el("div.sitechat__fb", { hidden: true });
  let fbBuilt = false;
  let fbAuthed = false;
  function showTab(name) {
    const fb = name === "fb";
    tabAsk.setAttribute("aria-selected", String(!fb));
    tabFb.setAttribute("aria-selected", String(fb));
    panel.classList.toggle("is-fb", fb);
    fbPane.hidden = !fb;
    // Built on first use, and again if someone signed in or out since (the form differs).
    if (fb && (!fbBuilt || fbAuthed !== store.authed)) {
      fbBuilt = true;
      fbAuthed = store.authed;
      clear(fbPane).append(feedbackForm({ context: "button", moods: false, rows: 3, hint: t("sitechat.feedbackHint") }));
    }
  }

  const panel = el("div.sitechat__panel", { role: "dialog", "aria-modal": "false", "aria-label": t("sitechat.title"), hidden: true }, [
    el("div.sitechat__head", {}, [
      mascotEl,
      el("div.sitechat__id", {}, [titleEl, subEl]),
      closeBtn,
    ]),
    el("div.fb-tabs", { role: "tablist" }, [tabAsk, tabFb]),
    logEl,
    formEl,
    fineEl,
    fbPane,
  ]);

  /** "Svarar direkt" with a live dot, or "not available" with a grey one. */
  function paintStatus() {
    const on = store.hasKey();
    clear(subEl);
    subEl.append(el(`i.solvehead__livedot${on ? "" : ".is-off"}`, { "aria-hidden": "true" }), t(on ? "sitechat.statusOn" : "sitechat.statusOff"));
  }

  fab.addEventListener("click", () => (opened ? close() : open()));
  api = { toggle: () => (opened ? close() : open()) };

  // Signed out (or the device was cleared): the conversation belonged to whoever was here before.
  store.addEventListener("deviceCleared", () => {
    abort?.abort();
    messages.length = 0;
    clear(logEl);
    clear(fbPane);
    fbBuilt = false;
    showTab("ask");
    close();
  });

  document.body.append(fab, panel);

  // This widget lives outside the router (see the file header), so main.js's
  // sb:langchange re-render never reaches it — without this it'd stay stuck
  // in whatever language it was mounted in, even after a language switch.
  window.addEventListener("sb:langchange", () => {
    fab.setAttribute("aria-label", t("sitechat.fabLabel"));
    panel.setAttribute("aria-label", t("sitechat.title"));
    titleEl.textContent = t("sitechat.title");
    tabAsk.textContent = t("sitechat.tabAsk");
    tabFb.textContent = t("sitechat.tabFeedback");
    if (fbBuilt) { fbBuilt = false; if (!fbPane.hidden) showTab("fb"); else clear(fbPane); }
    paintStatus();
    fineEl.textContent = t("sitechat.fine");
    closeBtn.setAttribute("aria-label", t("common.close"));
    inputEl.placeholder = t("sitechat.ask");
    inputEl.setAttribute("aria-label", t("sitechat.askAria"));
    sendBtn.setAttribute("aria-label", t("sitechat.send"));
    logEl.setAttribute("aria-label", t("sitechat.convAria"));
    if (!messages.length) store.hasKey() ? paintIntro() : paintDormant();
  });

  function paintDormant() {
    clear(logEl);
    if (store.aiNeedsSignIn()) {
      logEl.appendChild(el("div.sitechat__dormant", {}, [
        el("p", {}, t("sitechat.signInTitle")),
        el("p.note", {}, t("sitechat.signInBody")),
        el("a.btn.btn--sm", { href: "#/login", style: { marginTop: "12px" } }, t("login.signIn")),
      ]));
      formEl.hidden = fineEl.hidden = true;
      return;
    }
    if (store.aiBlockReason() === "quota") {
      logEl.appendChild(el("div.sitechat__dormant", {}, [
        el("p", {}, t("sitechat.quotaTitle")),
        el("p.note", {}, t("sitechat.quotaBody", { date: resetDateText(store.aiUsage?.resetsAt) })),
      ]));
      formEl.hidden = fineEl.hidden = true;
      return;
    }
    const status = !store.proxyUp ? t("set.serverDown")
      : !store.proxyKeyConfigured ? t("set.serverNoKey")
      : t("set.serverLive");
    logEl.appendChild(el("div.sitechat__dormant", {}, [
      el("p", {}, t("sitechat.dormantTitle")),
      el("p.note", {}, t("sitechat.dormantBody", { status })),
    ]));
    formEl.hidden = fineEl.hidden = true;
  }

  // A few common questions to start from — they go away once you've asked one.
  let suggestEl = null;
  function paintIntro() {
    clear(logEl);
    formEl.hidden = fineEl.hidden = false;
    append("ai", t("sitechat.intro"));
    suggestEl = el("div.sitechat__suggest", {}, [
      el("p", {}, t("sitechat.suggestTitle")),
      ...["sitechat.q1", "sitechat.q2", "sitechat.q3", "sitechat.q4"].map((k) => el("button.sitechat__chip", {
        type: "button", onclick: () => { inputEl.value = t(k); submit(); },
      }, t(k))),
    ]);
    logEl.appendChild(suggestEl);
  }

  /** A message: the student's on the right; the helper's on the left, beside
   *  a small sparkles avatar. Returns the bubble so a stream can fill it. */
  function append(who, text) {
    const node = el(`div.msg.${who}`, {}, []);
    node.innerHTML = who === "me" ? escapeHtml(text) : markdown(text);
    logEl.appendChild(who === "ai"
      ? el("div.sitechat__row", {}, [el("span.sitechat__av", { "aria-hidden": "true" }, icon(ICONS.spark, 13)), node])
      : node);
    logEl.scrollTop = logEl.scrollHeight;
    return node;
  }

  function open() {
    opened = true;
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    clear(fab); fab.appendChild(icon(ICONS.close, 22));
    paintStatus();
    if (!messages.length) store.hasKey() ? paintIntro() : paintDormant();
    inputEl.focus();
  }

  function close() {
    opened = false;
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    clear(fab); fab.appendChild(icon(ICONS.message, 24));
  }

  async function submit() {
    const text = inputEl.value.trim();
    if (!text || busy || !store.hasKey()) return;
    inputEl.value = "";
    sendBtn.disabled = true;
    suggestEl?.remove();
    suggestEl = null;
    append("me", text);
    messages.push({ role: "user", content: text });
    busy = true;
    setMood(mascotEl, "thinking");
    const bubble = append("ai", "");
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;

    abort = new AbortController();
    let acc = "";
    let stopReason = null;
    let ClaudeError;   // set once the lazy import below resolves; stays undefined if that itself fails
    try {
      const [claudeMod, promptsMod] = await Promise.all([import("../claude.js"), import("../prompts.js")]);
      ClaudeError = claudeMod.ClaudeError;
      for await (const chunk of claudeMod.tutorStream({ system: promptsMod.siteHelpSystem(), messages, signal: abort.signal, onStop: (r) => { stopReason = r; } })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        logEl.scrollTop = logEl.scrollHeight;
      }
      if (!acc.trim()) {
        // Nothing came back: say so instead of leaving the typing dots up forever.
        bubble.textContent = t("sitechat.snag");
        bubble.classList.add("msg--error");
        messages.pop();
      } else {
        messages.push({ role: "assistant", content: acc });
        if (stopReason === "max_tokens") bubble.appendChild(el("p.msg__errnote", {}, t("tutor.truncated")));   // cut off by the length limit: say so
        announce(t("sitechat.prefix", { text: acc }));
      }
      setMood(mascotEl, "idle");
    } catch (e) {
      const msg = ClaudeError && e instanceof ClaudeError ? e.message : t("sitechat.snag");
      bubble.textContent = msg;
      bubble.classList.add("msg--error");
      messages.pop();
      setMood(mascotEl, "idle");
    }
    busy = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
