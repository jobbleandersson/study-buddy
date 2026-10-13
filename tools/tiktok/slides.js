// What every TikTok image and video is drawn from: the text markup, the icons and the slide layouts
// (hook, question, answer, text, formula, curve, cta), plus fit() that sizes a slide to TikTok's safe
// area. carousel.html and video.html both import it; KaTeX is the page's global `katex`.

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="3.2"/></svg>',
};
export const SPARKLE = (x, y, size, turn = 0) => `<svg viewBox="-2 -2 28 28" width="${size}" height="${size}" style="left:${x}px;top:${y}px;transform:rotate(${turn}deg)"><path d="M12 0C13 7.5 16.5 11 24 12 16.5 13 13 16.5 12 24 11 16.5 7.5 13 0 12 7.5 11 11 7.5 12 0Z" fill="var(--pop)" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/** **bold**, *italic*, ==highlight==, $math$ and \n, everything else escaped. */
export function rich(s) {
  const parts = String(s ?? "").split(/(\$[^$]+\$)/g);
  return parts.map((p, k) => {
    if (/^\$[^$]+\$$/.test(p)) {
      let html;
      try { html = katex.renderToString(p.slice(1, -1), { throwOnError: true }); } catch { html = esc(p); }
      // Punctuation right after a formula stays on its line ("… = 2^9." never leaves the "." alone).
      const tail = (parts[k + 1] || "").match(/^[.,:;!?)]+/)?.[0];
      if (!tail) return html;
      parts[k + 1] = parts[k + 1].slice(tail.length);
      return `<span class="nobr">${html}${esc(tail)}</span>`;
    }
    // A number keeps its unit ("10 %", "20 g", "2 min") and a ratio stays whole ("1 : 24").
    return esc(p).replace(/(\d) (%|kr|g|km\/h|min|s)(?![\p{L}])/gu, "$1&nbsp;$2").replace(/(\d) : (\d)/g, "$1&nbsp;:&nbsp;$2")
      .replace(/==(.+?)==/g, "<mark>$1</mark>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\n/g, "<br>");
  }).join("");
}

export const topBar = (s) => `
  <div class="top">
    <div class="brand"><img src="../../assets/favicon.svg" alt=""><span>PluggEra</span></div>
    ${s.badge ? `<span class="series">${esc(s.badge)}</span>` : ""}
  </div>`;
export const foot = (s) => {
  const [cur, total] = String(s.count || "").split("/").map(Number);
  const dots = total > 1 ? Array.from({ length: total }, (_, k) => `<i${k + 1 === cur ? ' class="on"' : ""}></i>`).join("") : "";
  return `<div class="foot"><span class="site">${s.footLeft ? rich(s.footLeft) : "pluggera.se"}</span><span class="dots">${dots}</span></div>`;
};
export const deco = () => `<div class="deco"><div class="ring"></div>${SPARKLE(948, 420, 96, 8)}${SPARKLE(870, 560, 50, -12)}${SPARKLE(34, 1520, 70, 14)}</div>`;
export const label = (s) => (s.label ? `<p class="label">${rich(s.label)}</p>` : "");
export const title = (text, tag, max, min) => `<${tag} class="h" data-max="${max}" data-min="${min}">${rich(text)}</${tag}>`;
export const bubble = (text) => `<p class="bubble">${ICON.chat}<span>${rich(text)}</span></p>`;
export const options = (opts, answer, small) => `
  <div class="card opts${small ? " opts--small" : ""}">${answer != null ? `<span class="verdict">${esc(answer.verdict)}</span>` : ""}${opts.map((o, k) => {
    const right = answer != null && k === answer.index;
    return `<div class="opt${right ? " is-right" : ""}"><b>${right ? ICON.check : "ABCDE"[k]}</b><span>${rich(o)}</span></div>`;
  }).join("")}</div>`;
export const stimulus = (s) => [
  s.given ? `<p class="given">Givet: ${rich(s.given)}</p>` : "",
  s.quantities ? `<div class="qty"><div class="card"><small>Kvantitet I</small><span>${rich(s.quantities[0])}</span></div><div class="card"><small>Kvantitet II</small><span>${rich(s.quantities[1])}</span></div></div>` : "",
  s.statements ? `<div class="card stmts">${s.statements.map((t, k) => `<div class="stmt"><b>(${k + 1})</b><span>${rich(t)}</span></div>`).join("")}</div>` : "",
].join("");

export const LAYOUTS = {
  hook: (s) => `
    ${s.label || s.sticker ? `<div class="hook-head">${label(s)}${s.sticker ? `<span class="stamp">${rich(s.sticker)}</span>` : ""}</div>` : ""}
    ${s.big ? `<div class="big">${esc(s.big)}</div>` : ""}
    ${title(s.title, "h1", s.big ? 124 : 184, 78)}
    ${s.sub ? `<p class="p">${rich(s.sub)}</p>` : ""}
    ${s.swipe === false ? "" : `<span class="btn">${esc(s.swipeText || "Svep")}<i>${ICON.arrow}</i></span>`}`,
  question: (s) => `
    ${label(s)}
    ${s.prompt ? `<p class="prompt">${rich(s.prompt)}</p>` : ""}
    ${stimulus(s)}
    ${options(s.options, null, s.small)}
    ${bubble(s.ask || "Vad svarar du? Skriv i kommentarerna.")}`,
  answer: (s) => `
    ${label(s)}
    <div class="is-answer">${options(s.options, { index: s.answer, verdict: s.verdict || `Rätt svar: ${"ABCDE"[s.answer]}` }, true)}</div>
    <div class="card note"><h3>Därför</h3>${rich(s.explanation)}</div>`,
  text: (s) => `
    ${label(s)}
    ${title(s.title, "h2", 100, 62)}
    ${s.body ? `<p class="p">${rich(s.body)}</p>` : ""}
    ${s.vs ? `<div class="vs"><div class="bad"><small><i>${ICON.cross}</i>${rich(s.vs.bad[0])}</small><span>${rich(s.vs.bad[1])}</span></div><div class="good"><small><i>${ICON.check}</i>${rich(s.vs.good[0])}</small><span>${rich(s.vs.good[1])}</span></div></div>` : ""}
    ${s.list ? `<ul class="list">${s.list.map((it, k) => `<li><b>${esc(it[2] ?? k + 1)}</b><div><strong>${rich(it[0])}</strong>${it[1] ? `<span>${rich(it[1])}</span>` : ""}</div></li>`).join("")}</ul>` : ""}
    ${s.note ? bubble(s.note) : ""}`,
  formula: (s) => `
    ${label(s)}
    ${title(s.title, "h2", 100, 62)}
    <div class="card formula${s.long ? " formula--long" : ""}">${katex.renderToString(s.tex, { throwOnError: true, displayMode: true })}</div>
    ${s.legend ? `<dl class="legend">${s.legend.map(([k, v]) => `<div><dt>${rich(k)}</dt><dd>${rich(v)}</dd></div>`).join("")}</dl>` : ""}
    ${s.example ? `<div class="card note"><h3>Exempel</h3>${rich(s.example)}</div>` : ""}`,
  curve: (s) => `
    ${label(s)}
    ${title(s.title, "h2", 100, 62)}
    <div class="card curve">${curveSvg(s.repeats)}<div class="curve__legend">${s.repeats ? `<span><i style="background:var(--on-paper)"></i>Med repetition</span><span><i style="background:#B9C0D0"></i>Utan</span>` : `<span><i style="background:#B9C0D0"></i>Hur mycket du minns</span>`}</div></div>
    ${s.body ? `<p class="p">${rich(s.body)}</p>` : ""}`,
  cta: (s) => `
    <img class="cta-logo" src="../../assets/favicon.svg" alt="">
    ${title(s.title, "h2", 118, 70)}
    ${s.ticks ? `<ul class="ticks">${s.ticks.map((t) => `<li><i>${ICON.check}</i><span>${rich(t)}</span></li>`).join("")}</ul>` : ""}
    <span class="btn url">${ICON.link}${esc(s.url || "pluggera.se")}</span>
    <p class="p">${rich(s.sub || "Länken finns i vår bio.")}</p>`,
};

/** The forgetting curve, schematic: falls fast, and (with repeats) each review lifts it and it falls
 *  slower after. Not data — the slide says so. */
export function curveSvg(repeats) {
  const W = 760, H = 380, x0 = 70, y0 = 30, x1 = W - 20, y1 = H - 50;
  const X = (d) => x0 + (d / 14) * (x1 - x0), Y = (p) => y1 - p * (y1 - y0);
  const pts = (f, a, b) => { let s = ""; for (let d = a; d <= b + 1e-9; d += 0.1) s += `${s ? "L" : "M"}${X(d).toFixed(1)},${Y(f(d)).toFixed(1)}`; return s; };
  const base = pts((d) => 0.25 + 0.75 * Math.exp(-d / 1.6), 0, 14);
  // With repeats: each review (day 1, 3, 7) lifts it back up, and it falls slower each time after.
  let rep = "";
  if (repeats) {
    const reviews = [0, 1, 3, 7], rates = [1.6, 3.5, 8, 22];
    let end = null;
    reviews.forEach((a, k) => {
      const b = reviews[k + 1] ?? 14;
      const f = (d) => 0.3 + 0.7 * Math.exp(-(d - a) / rates[k]);
      if (end != null) rep += `M${X(a).toFixed(1)},${Y(end).toFixed(1)}L${X(a).toFixed(1)},${Y(1).toFixed(1)}`;
      rep += pts(f, a, b);
      end = f(b);
    });
  }
  const grid = [0.25, 0.5, 0.75, 1].map((p) => `<line x1="${x0}" x2="${x1}" y1="${Y(p)}" y2="${Y(p)}" stroke="#E3E7F0" stroke-width="2"/><text x="${x0 - 14}" y="${Y(p) + 9}" text-anchor="end" font-size="24" font-weight="600" fill="#8A91A8">${p * 100}%</text>`).join("");
  const days = [0, 1, 3, 7, 14].map((d) => `<text x="${X(d)}" y="${y1 + 40}" text-anchor="middle" font-size="24" font-weight="600" fill="#8A91A8">${d === 0 ? "Idag" : `Dag ${d}`}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" font-family="Inter, sans-serif">${grid}${days}
    <line x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}" stroke="#0E1330" stroke-width="4"/>
    <path d="${base}" fill="none" stroke="#B9C0D0" stroke-width="7" stroke-dasharray="${repeats ? "14 12" : "0"}" stroke-linecap="round"/>
    ${repeats ? `<path d="${rep}" fill="none" stroke="var(--on-paper)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
  </svg>`;
}

/** Sizes a slide to its safe area: the title as big as its longest word and the height allow, a
 *  sparse slide scaled up (so a short tip doesn't float small in the middle), a crowded one down. */
export function fit(main, grow) {
  const h = main.querySelector(".h[data-max]");
  const wide = () => h && h.scrollWidth > h.clientWidth + 1;
  const tall = () => main.scrollHeight > main.clientHeight + 2;
  if (h) {
    const min = Number(h.dataset.min);
    let size = Number(h.dataset.max);
    const set = () => { h.style.fontSize = `${size}px`; };
    set();
    while (wide() && size > min) { size -= 3; set(); }
    while (tall() && size > min) { size -= 4; set(); }
  }
  let scale = 1;
  const zoom = (z) => { scale = Math.round(z * 100) / 100; main.style.zoom = String(scale); };
  // How much of the main area the content fills (scrollHeight never reports less than the box).
  const filled = () => (main.lastElementChild.getBoundingClientRect().bottom - main.firstElementChild.getBoundingClientRect().top) / main.getBoundingClientRect().height;
  while (grow && scale < 1.3 && filled() < 0.8) {
    zoom(scale + 0.04);
    if (tall() || wide()) { zoom(scale - 0.04); break; }
  }
  while (tall() && scale > 0.72) zoom(scale - 0.04);
  return scale;
}
