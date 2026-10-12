// Räknare & grafritare — a scientific calculator and a simple function
// plotter, both fully client-side (js/lib/expr.js does the parsing; the graph
// is drawn on a <canvas>). No key, no network.

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { evaluate, fmtNumber } from "../lib/expr.js";
import { graphCalculator } from "../components/graph-calc.js";

let tab = "calc";                 // survives re-render within a visit
let angle = "deg";                // deg | rad

export function renderCalculator() {
  const tabsEl = el("div.tabs", { role: "tablist" }, [
    tabBtn(t("calc.tabCalc"), "calc"),
    tabBtn(t("calc.tabGraph"), "graph"),
  ]);
  function tabBtn(label, id) {
    return el("button.tab", {
      role: "tab", "aria-selected": String(tab === id),
      onclick: () => { tab = id; render(); },
    }, label);
  }

  const body = el("div", { style: { marginTop: "var(--s-4)" } });
  let graph = null;
  function render() {
    tabsEl.querySelectorAll(".tab").forEach((b, i) =>
      b.setAttribute("aria-selected", String((i === 0 ? "calc" : "graph") === tab)));
    graph?.destroy(); graph = null;
    clear(body);
    // The graphing calculator wants the width the page has; the calculator stays narrow.
    node.classList.toggle("calc--wide", tab === "graph");
    if (tab === "calc") body.appendChild(calcPanel());
    else { graph = graphCalculator(); body.appendChild(graph.el); }
  }
  const node = el("div.calc", {}, [
    homeButton(),
    el("h1", { style: { marginBottom: "4px" } }, t("calc.title")),
    el("p.note", { style: { marginBottom: "16px" } }, t("calc.sub")),
    tabsEl,
    body,
  ]);
  render();

  return {
    title: t("calc.title"),
    node,
    cleanup: () => graph?.destroy(),
  };
}

/* ---------------- scientific calculator ---------------- */

function calcPanel() {
  const input = el("input.calc__input", {
    type: "text", inputmode: "text", autocomplete: "off", spellcheck: "false",
    "aria-label": t("calc.exprAria"), placeholder: "2 · (3 + 4)^2",
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); equals(); } },
  });
  const output = el("div.calc__output", { "aria-live": "polite" }, "0");
  const history = el("div.calc__history");

  const angleBtn = el("button.btn.btn--ghost.btn--sm", {
    type: "button",
    onclick: () => { angle = angle === "deg" ? "rad" : "deg"; angleBtn.textContent = angle.toUpperCase(); live(); },
  }, angle.toUpperCase());

  function live() {
    const src = input.value.trim();
    if (!src) { output.textContent = "0"; output.classList.remove("is-error"); return; }
    try {
      const v = evaluate(src, { degrees: angle === "deg" });
      output.textContent = fmtNumber(v);
      output.classList.remove("is-error");
    } catch {
      output.classList.add("is-error");
    }
  }
  function equals() {
    const src = input.value.trim();
    if (!src) return;
    try {
      const v = evaluate(src, { degrees: angle === "deg" });
      const text = fmtNumber(v);
      output.textContent = text;
      output.classList.remove("is-error");
      history.prepend(el("button.calc__hrow", {
        type: "button", title: t("calc.reuse"),
        onclick: () => { input.value = src; input.focus(); live(); },
      }, [el("span.calc__hexpr", {}, src), el("span.calc__hval", {}, "= " + text)]));
      while (history.children.length > 8) history.lastChild.remove();
    } catch (err) {
      output.textContent = err.message || t("calc.badExpr");
      output.classList.add("is-error");
    }
  }

  function insert(s) {
    const el0 = input;
    const start = el0.selectionStart ?? el0.value.length;
    const end = el0.selectionEnd ?? el0.value.length;
    el0.value = el0.value.slice(0, start) + s + el0.value.slice(end);
    const caret = start + s.length;
    el0.setSelectionRange(caret, caret);
    el0.focus();
    live();
  }

  const KEYS = [
    ["7", "8", "9", "÷", "C"],
    ["4", "5", "6", "×", "("],
    ["1", "2", "3", "−", ")"],
    ["0", getLang() === "sv" ? "," : ".", "^", "+", "⌫"],
    ["π", "e", "√(", "x²", "="],
    ["sin(", "cos(", "tan(", "ln(", "log("],
  ];
  const pad = el("div.calc__pad", {}, KEYS.flat().map((k) => {
    const wide = k === "=";
    return el("button.calc__key" + (wide ? ".calc__key--eq" : "") + (/[+\-×÷^=]/.test(k) || k === "√(" || k === "x²" ? ".calc__key--op" : ""), {
      type: "button",
      onclick: () => {
        if (k === "C") { input.value = ""; output.textContent = "0"; output.classList.remove("is-error"); input.focus(); return; }
        if (k === "⌫") {
          const s = input.selectionStart ?? input.value.length;
          if (s > 0) { input.value = input.value.slice(0, s - 1) + input.value.slice(input.selectionEnd ?? s); input.setSelectionRange(s - 1, s - 1); }
          input.focus(); live(); return;
        }
        if (k === "=") { equals(); return; }
        if (k === "x²") { insert("^2"); return; }
        insert(k);
      },
    }, k);
  }));

  input.addEventListener("input", live);

  return el("div.calc__calc", {}, [
    el("div.calc__screen", {}, [
      el("div.calc__screentop", {}, [input, angleBtn]),
      output,
    ]),
    pad,
    el("p.note", { style: { marginTop: "10px" } }, t("calc.funcsNote")),
    history,
  ]);
}

