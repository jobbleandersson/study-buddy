// A small symbol palette for written maths answers. Plain-text insertion, not
// a LaTeX editor — the point is that a student on a laptop or phone can type
// "≤" or "√" without hunting through a character map. KaTeX still renders
// $…$ in prompts, so anyone who knows LaTeX can keep using it.

import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

// [what the key shows, what it inserts, how far to pull the caret back]
const KEYS = [
  ["√", "√"], ["²", "²"], ["³", "³"], ["^", "^"],
  ["×", "×"], ["÷", "÷"], ["±", "±"], ["≈", "≈"],
  ["≤", "≤"], ["≥", "≥"], ["≠", "≠"], ["→", "→"],
  ["π", "π"], ["∞", "∞"], ["°", "°"], ["Δ", "Δ"],
  ["a/b", "(  )/(  )", 6],
];

function insertAt(input, text, back = 0) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length - back;
  input.focus();
  try { input.setSelectionRange(pos, pos); } catch { /* not all inputs support it */ }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * mathKeypad(inputEl) -> { toggle, pad }
 * Drop `toggle` next to the other buttons and `pad` under the answer box.
 */
export function mathKeypad(inputEl) {
  const pad = el("div.mathpad", { hidden: true },
    KEYS.map(([label, insert, back = 0]) =>
      el("button.mathpad__key", {
        type: "button", "aria-label": label,
        onclick: () => insertAt(inputEl, insert, back),
      }, label)));

  const toggle = el("button.btn.btn--ghost.btn--sm", {
    type: "button", "aria-expanded": "false", "aria-label": t("q.mathKeypad"),
    title: t("q.mathKeypad"),
    onclick: () => {
      pad.hidden = !pad.hidden;
      toggle.setAttribute("aria-expanded", String(!pad.hidden));
    },
  }, "√x");

  return { toggle, pad };
}
