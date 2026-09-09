// A bare SVG line chart — no library, same build as the results-screen ring
// (SVG via innerHTML). Extracted from progress.js so #/hp can reuse it for the
// normed-score trend.
//
//   sparkline([72, 68, 81, 90], { ariaLabel: "…" })                 // 0–100
//   sparkline([0.9, 1.1, 1.35], { max: 2, ariaLabel: "…" })         // 0–2.0

import { el } from "./dom.js";

export function sparkline(values, { max, ariaLabel = "" } = {}) {
  const w = 600, h = 60, pad = 6;
  const top = max || Math.max(1, ...values.map((v) => Number(v) || 0));
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v) => h - pad - (Math.max(0, Math.min(top, Number(v) || 0)) / top) * (h - 2 * pad);
  const poly = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const wrap = el("div", { role: "img", "aria-label": ariaLabel });
  wrap.innerHTML =
    `<svg class="sparkline" viewBox="0 0 ${w} ${h}">` +
    `<polyline points="${poly}"/>` +
    values.map((v, i) => {
      const last = i === values.length - 1;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${last ? 5 : 3.5}"${last ? ' class="last"' : ""}/>`;
    }).join("") +
    `</svg>`;
  return wrap;
}
