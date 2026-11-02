// Inline rich text for short strings (prompts, choices, answers):
// HTML-escapes, then renders $...$ / $$...$$ math (KaTeX), **bold**, *italic*, `code`.
// No block elements — safe to drop inside buttons, spans, list items.

import { mathHtml } from "./math-render.js";

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function math(src, display) {
  return mathHtml(src, display, esc(src));
}

export function renderRich(input) {
  const text = String(input ?? "");
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/;
  let out = "", rest = text, m;
  while ((m = re.exec(rest))) {
    out += formatInline(esc(rest.slice(0, m.index)));
    out += math(m[1] ?? m[2], m[1] != null);
    rest = rest.slice(m.index + m[0].length);
  }
  out += formatInline(esc(rest));
  return out;
}

function formatInline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
}
