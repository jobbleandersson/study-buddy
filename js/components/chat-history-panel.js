// The "Tidigare chattar" view inside Studify AI: past chats (searchable, grouped by day) and the
// answers you bookmarked. Data lives in lib/chat-history.js; this only draws it and reports clicks.

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { markdown } from "../lib/markdown.js";
import { STUDY_MODES } from "../lib/study-modes.js";
import { loadChats, deleteChat, groupByDay, searchChats, loadSaved, removeSaved } from "../lib/chat-history.js";

const locale = () => (getLang() === "sv" ? "sv-SE" : "en-GB");

function whenText(ts, groupKey) {
  const d = new Date(ts);
  return groupKey === "earlier"
    ? d.toLocaleDateString(locale(), { day: "numeric", month: "short" })
    : d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

/** `onOpen(chat)`, `onNew()` and `onBack()` are the panel's three ways out. `activeId` marks the chat on screen. */
export function chatHistoryPanel({ activeId = null, onOpen, onNew, onBack, onDeleted } = {}) {
  const search = el("input", {
    type: "search", placeholder: t("solve.historySearch"), "aria-label": t("solve.historySearch"),
    oninput: () => paint(),
  });
  const count = el("p.history__count");
  const listEl = el("div.history__list");
  const savedEl = el("div.history__saved");

  function chatRow(c, groupKey) {
    const mode = STUDY_MODES.find((m) => m.id === c.mode);
    const modeLabel = mode ? t(`chat.mode.${mode.id}`) : t("solve.historyModeFree");
    const n = c.messages.length;
    return el("div.history__item" + (c.id === activeId ? ".is-active" : ""), {}, [
      el("button.history__open", { type: "button", onclick: () => onOpen?.(c) }, [
        el("span.history__ic", {}, icon(ICONS[mode?.icon] || ICONS.spark, 16)),
        el("span.history__txt", {}, [
          el("b", {}, c.title || modeLabel),
          el("small", {}, [modeLabel, plural(n, "solve.historyMessagesOne", "solve.historyMessagesMany", { n }), whenText(c.updatedAt, groupKey)].join(" · ")),
        ]),
      ]),
      el("button.iconbtn.iconbtn--sm.history__del", {
        type: "button", "aria-label": `${t("solve.historyDelete")}: ${c.title}`, title: t("solve.historyDelete"),
        onclick: () => { deleteChat(c.id); onDeleted?.(c); paint(); },
      }, icon(ICONS.trash, 14)),
    ]);
  }

  function paintSaved(chats) {
    clear(savedEl);
    const saved = loadSaved();
    savedEl.appendChild(el("h3.history__h", {}, [icon(ICONS.bookmark, 16), `${t("solve.savedTitle")} · ${saved.length}`]));
    if (!saved.length) { savedEl.appendChild(el("p.note", {}, t("solve.savedEmpty"))); return; }
    for (const s of saved) {
      const chat = chats.find((c) => c.id === s.chatId);
      const first = s.text.replace(/\s+/g, " ").slice(0, 110);
      savedEl.appendChild(el("details.history__answer", {}, [
        el("summary", {}, [first, s.text.length > 110 ? "…" : ""].join("")),
        el("div.history__answerbody", { html: markdown(s.text) }),
        el("div.history__answeractions", {}, [
          s.chatTitle ? el("small", {}, t("solve.savedFrom", { title: s.chatTitle })) : null,
          chat ? el("button.linkbtn", { type: "button", onclick: () => onOpen?.(chat) }, t("solve.savedOpenChat")) : null,
          el("button.linkbtn", { type: "button", onclick: () => { removeSaved(s.id); paint(); } }, t("solve.unsaveAnswer")),
        ].filter(Boolean)),
      ]));
    }
  }

  function paint() {
    const all = loadChats();
    const shown = searchChats(all, search.value);
    clear(listEl);
    count.textContent = all.length ? plural(all.length, "solve.historyCountOne", "solve.historyCountMany", { n: all.length }) : "";
    if (!all.length) listEl.appendChild(el("p.note", {}, t("solve.historyEmpty")));
    else if (!shown.length) listEl.appendChild(el("p.note", {}, t("solve.historyNone")));
    for (const g of groupByDay(shown)) {
      listEl.appendChild(el("h3.history__h", {}, t(`solve.history${g.key[0].toUpperCase()}${g.key.slice(1)}`)));
      for (const c of g.chats) listEl.appendChild(chatRow(c, g.key));
    }
    paintSaved(all);
  }

  const node = el("section.history", { "aria-label": t("solve.historyOpen") }, [
    el("div.history__top", {}, [
      el("button.linkbtn", { type: "button", onclick: () => onBack?.() }, [icon(ICONS.back, 14), t("solve.historyBack")]),
      el("button.btn.btn--sm", { type: "button", onclick: () => onNew?.() }, [icon(ICONS.plus, 15), t("solve.historyNew")]),
    ]),
    count,
    el("div.history__search", {}, search),
    listEl,
    savedEl,
  ]);
  paint();
  return { node, refresh: paint };
}
