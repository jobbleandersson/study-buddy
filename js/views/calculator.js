// Räknare & grafritare — a scientific calculator and a simple function
// plotter, both fully client-side (js/lib/expr.js does the parsing; the graph
// is drawn on a <canvas>). No key, no network.

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { compile, evaluate, fmtNumber } from "../lib/expr.js";

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
  function render() {
    tabsEl.querySelectorAll(".tab").forEach((b, i) =>
      b.setAttribute("aria-selected", String((i === 0 ? "calc" : "graph") === tab)));
    clear(body);
    body.appendChild(tab === "calc" ? calcPanel() : graphPanel());
  }
  render();

  return {
    title: t("calc.title"),
    node: el("div.calc", {}, [
      homeButton(),
      el("h1", { style: { marginBottom: "4px" } }, t("calc.title")),
      el("p.note", { style: { marginBottom: "16px" } }, t("calc.sub")),
      tabsEl,
      body,
    ]),
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
    ["0", ".", "^", "+", "⌫"],
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

/* ---------------- function plotter ---------------- */

function graphPanel() {
  const fInput = el("input.calc__input", {
    type: "text", autocomplete: "off", spellcheck: "false",
    "aria-label": t("calc.fnAria"), placeholder: "x^2 - 3",
    value: "sin(x)",
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); draw(); } },
  });
  const xminIn = numField("-10");
  const xmaxIn = numField("10");
  const msg = el("p.note.calc__gmsg");
  const canvas = el("canvas.calc__canvas", { width: 640, height: 380, role: "img", "aria-label": t("calc.canvasAria") });

  function numField(v) {
    return el("input.calc__num", { type: "number", step: "any", value: v, onchange: draw });
  }

  function draw() {
    const src = fInput.value.trim();
    clear(msg);
    let f;
    try { f = compile(src || "x", { degrees: false }); }
    catch (err) { msg.textContent = err.message || t("calc.badExpr"); msg.classList.add("is-error"); return; }
    msg.classList.remove("is-error");

    let xmin = Number(xminIn.value), xmax = Number(xmaxIn.value);
    if (!(xmax > xmin)) { xmin = -10; xmax = 10; xminIn.value = "-10"; xmaxIn.value = "10"; }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 560, H = 380;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const cLine = css.getPropertyValue("--line-strong").trim() || "#ccc";
    const cAxis = css.getPropertyValue("--ink-faint").trim() || "#888";
    const cCurve = css.getPropertyValue("--brand").trim() || "#2C5CD6";
    const cText = css.getPropertyValue("--ink-faint").trim() || "#888";

    // sample first so we can auto-fit y
    const N = Math.max(200, Math.floor(W));
    const xs = [], ys = [];
    for (let i = 0; i <= N; i++) {
      const x = xmin + (i / N) * (xmax - xmin);
      let y = NaN;
      try { y = f(x); } catch { y = NaN; }
      xs.push(x); ys.push(y);
    }
    const finite = ys.filter((y) => isFinite(y));
    let ymin = -6, ymax = 6;
    if (finite.length) {
      finite.sort((a, b) => a - b);
      const lo = finite[Math.floor(finite.length * 0.02)];
      const hi = finite[Math.floor(finite.length * 0.98)];
      if (isFinite(lo) && isFinite(hi) && hi > lo) {
        const pad = (hi - lo) * 0.12 || 1;
        ymin = lo - pad; ymax = hi + pad;
      }
    }
    if (ymin > 0) ymin = -0.5;
    if (ymax < 0) ymax = 0.5;

    const px = (x) => ((x - xmin) / (xmax - xmin)) * W;
    const py = (y) => H - ((y - ymin) / (ymax - ymin)) * H;

    // grid
    g.strokeStyle = cLine; g.lineWidth = 1; g.font = "10px Inter, system-ui";
    g.fillStyle = cText;
    const step = niceStep((xmax - xmin) / 10);
    for (let x = Math.ceil(xmin / step) * step; x <= xmax; x += step) {
      const X = px(x);
      g.globalAlpha = 0.5; g.beginPath(); g.moveTo(X, 0); g.lineTo(X, H); g.stroke(); g.globalAlpha = 1;
      if (Math.abs(x) > 1e-9) g.fillText(trimNum(x), X + 2, py(0) - 3);
    }
    const ystep = niceStep((ymax - ymin) / 8);
    for (let y = Math.ceil(ymin / ystep) * ystep; y <= ymax; y += ystep) {
      const Y = py(y);
      g.globalAlpha = 0.5; g.beginPath(); g.moveTo(0, Y); g.lineTo(W, Y); g.stroke(); g.globalAlpha = 1;
      if (Math.abs(y) > 1e-9) g.fillText(trimNum(y), px(0) + 3, Y - 2);
    }
    // axes
    g.strokeStyle = cAxis; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, py(0)); g.lineTo(W, py(0)); g.stroke();
    g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), H); g.stroke();

    // curve
    g.strokeStyle = cCurve; g.lineWidth = 2.5; g.lineJoin = "round";
    g.beginPath();
    let pen = false;
    for (let i = 0; i <= N; i++) {
      const y = ys[i];
      if (!isFinite(y) || y < ymin - (ymax - ymin) || y > ymax + (ymax - ymin)) { pen = false; continue; }
      const X = px(xs[i]), Y = py(y);
      if (!pen) { g.moveTo(X, Y); pen = true; } else g.lineTo(X, Y);
    }
    g.stroke();

    msg.textContent = t("calc.range", { min: trimNum(ymin), max: trimNum(ymax) });
  }

  // The node isn't mounted yet when this runs. Draw once it's on the page,
  // and redraw whenever the canvas actually gets (or changes) a width.
  let tries = 0;
  (function firstDraw() {
    if (canvas.isConnected && (canvas.clientWidth || tries >= 15)) { draw(); return; }
    if (tries++ < 40) setTimeout(firstDraw, 60);
  })();
  try {
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      if (w && Math.abs(w - lastW) > 4) { lastW = w; draw(); }
    });
    ro.observe(canvas);
  } catch { /* no ResizeObserver — the retry loop above still covers first paint */ }

  return el("div.calc__graph", {}, [
    el("label.field", { style: { marginBottom: "10px" } }, [
      el("span", {}, t("calc.fnLabel")), fInput,
    ]),
    el("div.calc__grange", {}, [
      el("label", {}, ["x min ", xminIn]),
      el("label", {}, ["x max ", xmaxIn]),
      el("button.btn.btn--sm", { type: "button", onclick: draw }, [icon(ICONS.chart, 15), t("calc.plot")]),
    ]),
    el("div.calc__canvaswrap", {}, [canvas]),
    msg,
    el("p.note", { style: { marginTop: "6px" } }, t("calc.funcsNote")),
  ]);
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
function trimNum(n) {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}
