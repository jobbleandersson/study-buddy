// The floating "ask about the app" widget — a bubble in the bottom-right
// corner, on every page, for questions about using StudyBuddy itself (not
// schoolwork — that's the in-session tutor). Mounted once from main.js and
// appended straight to <body>, like js/lib/dom.js's toast/banner, so it
// survives the router's full re-renders on every navigation.

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { announce } from "../lib/a11y.js";
import { markdown } from "../lib/markdown.js";
import { mascot, setMood } from "./mascot.js";
import { store } from "../store.js";
import { siteHelpSystem } from "../prompts.js";
import { t } from "../lib/i18n.js";
import { tutorStream, ClaudeError } from "../claude.js";

let mounted = false;

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
  const formEl = el("form.sitechat__form", { onsubmit: (e) => { e.preventDefault(); submit(); } }, [
    inputEl,
    el("button.iconbtn", { type: "submit", "aria-label": t("sitechat.send"), style: { color: "var(--brand)" } }, [icon(ICONS.arrow, 18)]),
  ]);

  const mascotEl = mascot("idle", 32);
  const panel = el("div.sitechat__panel", { role: "dialog", "aria-modal": "false", "aria-label": t("sitechat.title"), hidden: true }, [
    el("div.sitechat__head", {}, [
      mascotEl,
      el("div", { style: { flex: "1", minWidth: "0" } }, [
        el("div.sitechat__title", {}, t("sitechat.title")),
        el("div.sitechat__sub", {}, t("sitechat.sub")),
      ]),
      el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.close"), onclick: close }, [icon(ICONS.close, 16)]),
    ]),
    logEl,
    formEl,
  ]);

  fab.addEventListener("click", () => (opened ? close() : open()));

  document.body.append(fab, panel);

  function paintDormant() {
    clear(logEl);
    const status = !store.proxyUp ? t("set.serverDown")
      : !store.proxyKeyConfigured ? t("set.serverNoKey")
      : t("set.serverLive");
    logEl.appendChild(el("div.sitechat__dormant", {}, [
      el("p", {}, t("sitechat.dormantTitle")),
      el("p.note", {}, t("sitechat.dormantBody", { status })),
    ]));
    formEl.hidden = true;
  }

  function paintIntro() {
    clear(logEl);
    formEl.hidden = false;
    append("ai", t("sitechat.intro"));
  }

  function append(who, text) {
    const node = el(`div.msg.${who}`, {}, []);
    node.innerHTML = who === "me" ? escapeHtml(text) : markdown(text);
    logEl.appendChild(node);
    logEl.scrollTop = logEl.scrollHeight;
    return node;
  }

  function open() {
    opened = true;
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    clear(fab); fab.appendChild(icon(ICONS.close, 22));
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
    append("me", text);
    messages.push({ role: "user", content: text });
    busy = true;
    setMood(mascotEl, "thinking");
    const bubble = append("ai", "");
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;

    abort = new AbortController();
    let acc = "";
    try {
      for await (const chunk of tutorStream({ system: siteHelpSystem(), messages, signal: abort.signal })) {
        acc += chunk;
        bubble.innerHTML = markdown(acc);
        logEl.scrollTop = logEl.scrollHeight;
      }
      messages.push({ role: "assistant", content: acc || "…" });
      setMood(mascotEl, "idle");
      announce(t("sitechat.prefix", { text: acc }));
    } catch (e) {
      const msg = e instanceof ClaudeError ? e.message : t("sitechat.snag");
      bubble.innerHTML = markdown(`_${msg}_`);
      messages.pop();
      setMood(mascotEl, "idle");
    }
    busy = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
