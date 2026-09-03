// A Cmd/Ctrl-K launcher. Jump to any set, or run a common action, without
// touching the mouse. Mounted once from main.js.

import { el, clear } from "../lib/dom.js";
import { store } from "../store.js";
import { t, getLang, setLang, LANGS } from "../lib/i18n.js";
import { getTheme, setTheme } from "../lib/theme.js";

let overlay = null;

function actions() {
  const other = LANGS.find(([c]) => c !== getLang());
  return [
    { label: t("cmd.review"), run: () => (location.hash = "#/review") },
    { label: t("cmd.weak"), run: () => (location.hash = "#/practice-weak") },
    { label: t("cmd.new"), run: () => (location.hash = "#/create") },
    { label: t("cmd.gallery"), run: () => (location.hash = "#/gallery") },
    { label: t("cmd.progress"), run: () => (location.hash = "#/progress") },
    { label: t("cmd.settings"), run: () => (location.hash = "#/settings") },
    other && { label: t("cmd.lang", { lang: other[1] }), run: () => setLang(other[0]) },
    { label: t("cmd.theme"), run: () => setTheme(getTheme() === "dark" ? "light" : "dark") },
  ].filter(Boolean);
}

/** Loose subsequence match — "arh" matches "Ancient Rome History". */
function matches(needle, hay) {
  needle = needle.toLowerCase(); hay = hay.toLowerCase();
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

function close() {
  overlay?.remove();
  overlay = null;
}

export function openPalette() {
  if (overlay) return;
  const rows = [
    ...store.assignments.map((a) => ({ label: a.title, sub: t("cmd.openSet"), run: () => (location.hash = `#/session/${a.id}`) })),
    ...actions().map((a) => ({ ...a, sub: t("cmd.action") })),
  ];
  let filtered = rows, sel = 0;

  const list = el("div.cmd__list");
  const input = el("input.cmd__input", {
    type: "text", placeholder: t("cmd.placeholder"), "aria-label": t("cmd.placeholder"),
    autocomplete: "off", spellcheck: "false",
    oninput: () => { paint(input.value.trim()); },
    onkeydown: (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); highlight(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); highlight(); }
      else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
      else if (e.key === "Escape") { close(); }
    },
  });

  function paint(q) {
    filtered = q ? rows.filter((r) => matches(q, r.label) || matches(q, r.sub)) : rows;
    sel = 0;
    clear(list);
    filtered.slice(0, 30).forEach((r, i) => {
      list.appendChild(el("button.cmd__row", {
        type: "button", onclick: () => pick(i),
        onmousemove: () => { sel = i; highlight(); },
      }, [el("span", {}, r.label), el("span.cmd__sub", {}, r.sub)]));
    });
    highlight();
  }
  function highlight() {
    [...list.children].forEach((c, i) => c.classList.toggle("is-sel", i === sel));
    list.children[sel]?.scrollIntoView({ block: "nearest" });
  }
  function pick(i) {
    const r = filtered[i];
    if (!r) return;
    close();
    r.run();
  }

  overlay = el("div.modal.cmd", {
    role: "dialog", "aria-modal": "true", "aria-label": t("cmd.placeholder"),
    onclick: (e) => { if (e.target === overlay) close(); },
    onkeydown: (e) => { if (e.key === "Escape") close(); },
  }, [el("div.cmd__card", {}, [input, list])]);
  document.body.appendChild(overlay);
  paint("");
  input.focus();
}

export function mountCommandPalette() {
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const typing = /^(input|textarea|select)$/i.test(e.target?.tagName) || e.target?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && k === "k") { e.preventDefault(); overlay ? close() : openPalette(); }
    else if (k === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !overlay) { e.preventDefault(); openPalette(); }
  });
}
