// Grafräknare: type functions, parameters (sliders) and points, and see them drawn on a grid you
// can drag and zoom. Tap a graph to read a point on it (and its tangent); zeros, maximum/minimum
// points and intersections in view are marked and listed. Our own work, on lib/expr.js and
// lib/graph-math.js: no outside library, nothing sent anywhere. Used on #/calculator and in a
// dialog from a maths practice session (openGraphDialog).

import { el, icon, ICONS } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { fmtNumber } from "../lib/expr.js";
import { buildModel, specialPoints, slope, niceStep } from "../lib/graph-math.js";

const STORE_KEY = "studybuddy.graph";
// Graph colours: readable on the light and the dark theme alike.
const COLORS = ["#2C5CD6", "#E4588A", "#1F9FB5", "#E07B1F", "#7A5CFF", "#3B9A47"];
const DEFAULT_SCALE_UNITS = 20;   // the x-axis spans this many units when the view is reset

/* ---------------- state kept for the visit (and the rows across visits) ---------------- */

let nextId = 1;
const newRow = (text = "", extra = {}) => ({ id: nextId++, text, hidden: false, color: null, ...extra });
const state = load();

function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { /* none */ }
  const rows = Array.isArray(saved?.rows) && saved.rows.length
    ? saved.rows.filter((r) => typeof r?.text === "string").slice(0, 30).map((r) => newRow(r.text, {
        hidden: !!r.hidden, color: Number.isInteger(r.color) ? r.color : null,
        min: finiteOr(r.min, null), max: finiteOr(r.max, null), step: finiteOr(r.step, null),
      }))
    : [newRow("f(x) = x^2 - 2x - 3")];
  const tools = { roots: true, extrema: true, intersections: true, tangent: false, ...(saved?.tools || {}) };
  return { rows, tools, view: null };
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      rows: state.rows.filter((r) => r.text.trim()).map(({ text, hidden, color, min, max, step }) => ({ text, hidden, color, min, max, step })),
      tools: state.tools,
    }));
  } catch { /* storage off: the rows last for the visit */ }
}
function finiteOr(v, d) { return Number.isFinite(v) ? v : d; }

/* ---------------- number words ---------------- */

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
// A real minus sign, as in print: "−1", not a hyphen.
const num = (n) => fmtNumber(round(n) === 0 ? 0 : round(n)).replace(/^-/, "−");
const coord = (x, y) => (getLang() === "sv" ? `(${num(x)}; ${num(y)})` : `(${num(x)}, ${num(y)})`);
/** A parameter's value as it goes back into its row: decimal comma in Swedish. */
const rowNumber = (n) => { const s = String(round(n, 6)); return getLang() === "sv" ? s.replace(".", ",") : s; };

/* ---------------- the component ---------------- */

/** The graphing calculator. Returns { el, destroy }. */
export function graphCalculator() {
  let model = null;
  let found = [];           // special points in view, with their screen positions while drawn
  let selected = null;      // { type: "trace", fn, x } | { type: "point", p }
  const colorOf = (row) => COLORS[(row.color ?? 0) % COLORS.length];
  for (const r of state.rows) if (r.color == null) r.color = nextColor();
  function nextColor() {
    const used = new Set(state.rows.map((r) => r.color).filter((c) => c != null));
    for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i;
    return state.rows.length % COLORS.length;
  }

  /* ---- rows ---- */

  const rowsEl = el("div.gcalc__rows");
  const inputs = new Map();   // row id -> input
  const parts = new Map();    // row id -> { node, swatch, del, extras }

  function ensureEmptyLast() {
    const last = state.rows[state.rows.length - 1];
    if (!last || last.text.trim()) { state.rows.push(newRow("", { color: nextColor() })); return true; }
    return false;
  }

  /** Every row anew: after adding, deleting or reordering rows. */
  function paintRows(focusId = null) {
    ensureEmptyLast();
    inputs.clear(); parts.clear();
    rowsEl.replaceChildren(...state.rows.map((row) => rowEl(row)));
    refreshRows();
    if (focusId != null) inputs.get(focusId)?.focus();
  }

  /** What changes as a row is typed (its error, its slider, its colour button) without replacing
   *  the input being typed in, which would close a phone's keyboard. */
  function refreshRows() {
    if (ensureEmptyLast()) { const r = state.rows[state.rows.length - 1]; rowsEl.appendChild(rowEl(r)); }
    state.rows.forEach((row, i) => {
      const p = parts.get(row.id);
      if (!p) return;
      const item = model?.items.find((it) => it.id === row.id);
      const empty = !row.text.trim();
      const drawable = !!item && !item.error && ["fn", "vline", "point"].includes(item.kind);
      const label = item?.name || (item?.kind === "vline" ? row.text.trim() : "") || t("graph.row", { n: i + 1 });
      p.node.classList.toggle("is-hidden", !!row.hidden);
      p.swatch.disabled = !drawable;
      p.swatch.setAttribute("aria-pressed", String(!row.hidden));
      p.swatch.setAttribute("aria-label", t(row.hidden ? "graph.show" : "graph.hide", { name: label }));
      p.del.hidden = empty;
      p.del.setAttribute("aria-label", t("graph.delete", { name: label }));
      inputs.get(row.id)?.setAttribute("aria-label", t("graph.inputAria", { n: i + 1 }));
      inputs.get(row.id)?.setAttribute("placeholder", empty && i === state.rows.length - 1 ? t("graph.placeholder") : "");
      const extras = [];
      if (item?.kind === "param" && !item.error) extras.push(sliderEl(row, item));
      if (item?.error && !empty) extras.push(el("p.gcalc__err", { role: "status" }, item.error));
      p.extras.replaceChildren(...extras);
    });
  }

  function rowEl(row) {
    const swatch = el("button.gcalc__swatch", {
      type: "button", style: { "--c": colorOf(row) },
      onclick: () => { row.hidden = !row.hidden; save(); rebuild(); refreshRows(); draw(); },
    });
    const input = el("input.gcalc__input", {
      type: "text", value: row.text, autocomplete: "off", spellcheck: "false", autocapitalize: "off",
      oninput: (e) => { row.text = e.target.value; scheduleRebuild(); },
      onchange: () => { addMissingSliders(); },
      onkeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addMissingSliders();
          const next = state.rows[state.rows.indexOf(row) + 1];
          if (next) inputs.get(next.id)?.focus();
        }
      },
    });
    inputs.set(row.id, input);
    const del = el("button.gcalc__del", {
      type: "button",
      onclick: () => {
        const at = state.rows.indexOf(row);
        state.rows = state.rows.filter((r) => r !== row);
        save(); rebuild(); paintRows(state.rows[Math.min(at, state.rows.length - 1)]?.id);
        draw();
      },
    }, icon(ICONS.close, 14));
    const extras = el("div.gcalc__extras");
    const node = el("div.gcalc__row", {}, [el("div.gcalc__line", {}, [swatch, input, del]), extras]);
    parts.set(row.id, { node, swatch, del, extras });
    return node;
  }

  function sliderEl(row, item) {
    const v = item.value;
    // A range around the value: -10…10 for everyday numbers, wider for big ones; kept once set.
    if (row.min == null || row.max == null || v < row.min || v > row.max) {
      const span = Math.abs(v) <= 10 ? 10 : niceStep(Math.abs(v)) * 2;
      row.min = Math.min(-span, v); row.max = Math.max(span, v); row.step = span <= 10 ? 0.1 : niceStep(span / 100);
    }
    const out = el("output.gcalc__val", {}, num(v));
    const range = el("input.gcalc__range", {
      type: "range", min: String(row.min), max: String(row.max), step: String(row.step || 0.1), value: String(v),
      "aria-label": t("graph.sliderAria", { name: item.name }),
      oninput: (e) => {
        const val = Number(e.target.value);
        row.text = `${item.name} = ${rowNumber(val)}`;
        const inp = inputs.get(row.id);
        if (inp) inp.value = row.text;
        out.textContent = num(val);
        rebuild();
        draw();
      },
      onchange: () => save(),
    });
    return el("div.gcalc__slider", {}, [el("span.gcalc__min", {}, num(row.min)), range, el("span.gcalc__max", {}, num(row.max)), out]);
  }

  /** Letters used but never defined become sliders ("a" in "ax^2 + c" → a = 1), once the student
   *  has finished the row (Enter or leaving it), not while still typing "abs(". */
  function addMissingSliders() {
    clearTimeout(timer);
    rebuild();
    if (!model.missing.length) { save(); refreshRows(); draw(); return; }
    const active = [...inputs].find(([, inp]) => inp === document.activeElement)?.[0];
    // The reader stops at the first unknown letter, so "ax^2 + c" takes two rounds: a, then c.
    for (let round = 0; model.missing.length && round < 6; round++) {
      const at = state.rows.length - 1;   // before the empty row at the end
      state.rows.splice(at, 0, ...model.missing.map((name) => newRow(`${name} = 1`, { color: nextColor() })));
      rebuild();
    }
    save(); paintRows(active); draw();
  }

  let timer = null;
  function scheduleRebuild() {
    clearTimeout(timer);
    timer = setTimeout(() => { rebuild(); save(); refreshRows(); draw(); }, 180);
  }

  function rebuild() {
    model = buildModel(state.rows, t);
    if (selected?.type === "trace" && !fnByName(selected.fn)) selected = null;
    if (selected?.type === "point") selected = null;
  }

  /* ---- tools ---- */

  const toolChip = (key) => el("button.chip.gcalc__tool", {
    type: "button", "aria-pressed": String(!!state.tools[key]),
    onclick: (e) => {
      state.tools[key] = !state.tools[key];
      e.currentTarget.setAttribute("aria-pressed", String(state.tools[key]));
      save(); draw();
    },
  }, t(`graph.tool.${key}`));
  const tools = el("div.chips.gcalc__tools", { role: "group", "aria-label": t("graph.toolsLabel") },
    ["roots", "extrema", "intersections", "tangent"].map(toolChip));

  /* ---- examples: folded away, and one tap puts one in a row instead of a paragraph to read ---- */

  const EXAMPLES = [
    ["x^2 - 3", "fn"], ["y = 2x + 1", "line"], ["x = 2", "vline"], ["ax^2", "slider"],
    [getLang() === "sv" ? "A = (1; 2)" : "A = (1, 2)", "point"],
  ];
  function addExample(text) {
    const last = state.rows[state.rows.length - 1];
    if (last && !last.text.trim()) last.text = text;
    else state.rows.push(newRow(text, { color: nextColor() }));
    rebuild(); paintRows();
    addMissingSliders();   // "ax^2" brings its slider for a
  }
  const examples = el("details.gcalc__ex", {}, [
    el("summary.gcalc__label", {}, t("graph.examples")),
    el("div.gcalc__exlist", {}, EXAMPLES.map(([text, kind]) => el("button.gcalc__exbtn", {
      type: "button", "aria-label": t("graph.exAdd", { expr: text }), onclick: () => addExample(text),
    }, [el("code", {}, text), el("span", {}, t(`graph.ex.${kind}`))]))),
  ]);

  /* ---- canvas ---- */

  const canvas = el("canvas.gcalc__canvas", { tabindex: "0", role: "img" });
  const readout = el("div.gcalc__readout", { "aria-live": "polite" });
  const zoomBtn = (ic, label, fn) => el("button.gcalc__zbtn", { type: "button", "aria-label": label, title: label, onclick: fn }, icon(ic, 16));
  const stage = el("div.gcalc__stage", {}, [
    canvas,
    readout,
    el("div.gcalc__zoom", {}, [
      zoomBtn(ICONS.plus, t("graph.zoomIn"), () => zoomAt(1.5)),
      zoomBtn(ICONS.minus, t("graph.zoomOut"), () => zoomAt(1 / 1.5)),
      zoomBtn(ICONS.home, t("graph.reset"), () => { state.view = null; draw(); }),
    ]),
  ]);
  const pointsSum = el("summary.gcalc__label");
  const pointsList = el("ul.gcalc__plist");
  const pointsEl = el("details.gcalc__points", {}, [pointsSum, pointsList]);
  pointsEl.hidden = true;

  let W = 0, H = 0;
  const view = () => state.view || (state.view = { cx: 0, cy: 0, scale: Math.max(20, (W || 600) / DEFAULT_SCALE_UNITS) });
  const toPx = (x) => W / 2 + (x - view().cx) * view().scale;
  const toPy = (y) => H / 2 - (y - view().cy) * view().scale;
  const fromPx = (px) => view().cx + (px - W / 2) / view().scale;
  const fromPy = (py) => view().cy - (py - H / 2) / view().scale;
  const fnByName = (name) => model?.items.find((it) => it.kind === "fn" && it.name === name && it.f && !it.error);
  const visibleFns = () => (model?.items || []).filter((it) => it.kind === "fn" && it.f && !it.error && !it.hidden);
  const rowColor = (id) => colorOf(state.rows.find((r) => r.id === id) || {});

  function zoomAt(factor, px = W / 2, py = H / 2) {
    const v = view();
    const wx = fromPx(px), wy = fromPy(py);
    v.scale = Math.min(1e6, Math.max(1e-4, v.scale * factor));
    v.cx = wx - (px - W / 2) / v.scale;
    v.cy = wy + (py - H / 2) / v.scale;
    draw();
  }

  function draw() {
    if (!canvas.isConnected) return;
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    if (!model) rebuild();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue("--ink").trim() || "#222";
    const faint = css.getPropertyValue("--ink-faint").trim() || "#888";
    const line = css.getPropertyValue("--line").trim() || "#ddd";
    const surface = css.getPropertyValue("--surface").trim() || "#fff";
    g.fillStyle = surface; g.fillRect(0, 0, W, H);

    const xmin = fromPx(0), xmax = fromPx(W), ymin = fromPy(H), ymax = fromPy(0);
    const step = niceStep(80 / view().scale);

    // grid: minor lines a fifth of a step apart when there's room, then the steps
    const gridLines = (s, alpha) => {
      g.strokeStyle = line; g.globalAlpha = alpha; g.lineWidth = 1; g.beginPath();
      for (let i = Math.ceil(xmin / s), n = 0; i * s <= xmax && n < 400; i++, n++) { const X = Math.round(toPx(i * s)) + 0.5; g.moveTo(X, 0); g.lineTo(X, H); }
      for (let i = Math.ceil(ymin / s), n = 0; i * s <= ymax && n < 400; i++, n++) { const Y = Math.round(toPy(i * s)) + 0.5; g.moveTo(0, Y); g.lineTo(W, Y); }
      g.stroke(); g.globalAlpha = 1;
    };
    if (step / 5 * view().scale >= 12) gridLines(step / 5, 0.45);
    gridLines(step, 1);

    // axes, with numbers along them (kept on screen when an axis has scrolled away)
    const ax = Math.min(H - 1, Math.max(0, toPy(0))), ay = Math.min(W - 1, Math.max(0, toPx(0)));
    g.strokeStyle = faint; g.lineWidth = 1.5; g.beginPath();
    g.moveTo(0, Math.round(ax) + 0.5); g.lineTo(W, Math.round(ax) + 0.5);
    g.moveTo(Math.round(ay) + 0.5, 0); g.lineTo(Math.round(ay) + 0.5, H); g.stroke();
    g.fillStyle = faint; g.font = "11px Inter, system-ui, sans-serif";
    const labelY = Math.min(H - 4, Math.max(14, ax + 14));
    g.textAlign = "center";
    for (let i = Math.ceil(xmin / step), n = 0; i * step <= xmax && n < 200; i++, n++) {
      if (i === 0) continue;
      g.fillText(num(i * step), toPx(i * step), labelY);
    }
    g.textAlign = ay > W - 40 ? "right" : "left";
    const labelX = ay > W - 40 ? ay - 5 : ay + 5;
    for (let i = Math.ceil(ymin / step), n = 0; i * step <= ymax && n < 200; i++, n++) {
      if (i === 0) continue;
      g.fillText(num(i * step), labelX, toPy(i * step) + 4);
    }
    g.textAlign = "left";

    // graphs
    const fns = visibleFns();
    for (const it of fns) {
      g.strokeStyle = rowColor(it.id); g.lineWidth = 2.5; g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath();
      let pen = false, prevY = null, prevX = null;
      for (let X = 0; X <= W; X += 1) {
        const x = fromPx(X);
        const y = it.f(x);
        if (!Number.isFinite(y)) { pen = false; prevY = null; continue; }
        const Y = Math.max(-1e5, Math.min(1e5, toPy(y)));
        // A big jump between two pixels is a break (tan x at π/2) when the curve between them doesn't
        // pass through the values in between; a steep but unbroken stretch does.
        if (pen && Math.abs(Y - prevY) > H) {
          const mid = it.f((prevX + x) / 2);
          const lo = Math.min(fromPy(prevY), y), hi = Math.max(fromPy(prevY), y);
          if (!Number.isFinite(mid) || mid < lo || mid > hi) pen = false;
        }
        if (!pen) { g.moveTo(X, Y); pen = true; } else g.lineTo(X, Y);
        prevY = Y; prevX = x;
      }
      g.stroke();
    }
    // vertical lines
    const vlines = (model?.items || []).filter((it) => it.kind === "vline" && !it.error && !it.hidden && Number.isFinite(it.x));
    for (const it of vlines) {
      const X = Math.round(toPx(it.x)) + 0.5;
      g.strokeStyle = rowColor(it.id); g.lineWidth = 2.5; g.beginPath(); g.moveTo(X, 0); g.lineTo(X, H); g.stroke();
    }

    // special points in view
    found = specialPoints(fns.map((it) => ({ name: it.name, f: it.f })),
      vlines.map((it) => ({ name: `x = ${num(it.x)}`, x: it.x })), xmin, xmax, state.tools)
      .filter((p) => p.y >= ymin && p.y <= ymax);
    const showLabels = found.length <= 8;
    for (const p of found) {
      const X = toPx(p.x), Y = toPy(p.y);
      p.X = X; p.Y = Y;
      const it = fnByName(p.fn);
      g.fillStyle = p.kind === "root" ? surface : it ? rowColor(it.id) : ink;
      g.strokeStyle = it ? rowColor(it.id) : ink; g.lineWidth = 2;
      g.beginPath(); g.arc(X, Y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      if (showLabels || (selected?.type === "point" && selected.p.x === p.x && selected.p.fn === p.fn)) labelAt(g, coord(p.x, p.y), X, Y, ink, surface);
    }

    // the student's own points
    for (const it of (model?.items || []).filter((x) => x.kind === "point" && !x.error && !x.hidden && Number.isFinite(x.x))) {
      const X = toPx(it.x), Y = toPy(it.y);
      g.fillStyle = rowColor(it.id); g.beginPath(); g.arc(X, Y, 5, 0, Math.PI * 2); g.fill();
      labelAt(g, it.name ? `${it.name} ${coord(it.x, it.y)}` : coord(it.x, it.y), X, Y, ink, surface);
    }

    // a point the student tapped on a graph, and its tangent
    let text = "";
    if (selected?.type === "trace") {
      const it = fnByName(selected.fn);
      const y = it?.f(selected.x);
      if (it && Number.isFinite(y)) {
        const X = toPx(selected.x), Y = toPy(y);
        const k = slope(it.f, selected.x);
        if (state.tools.tangent && Number.isFinite(k)) {
          g.save(); g.setLineDash([6, 5]); g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath();
          g.moveTo(0, toPy(y + k * (xmin - selected.x))); g.lineTo(W, toPy(y + k * (xmax - selected.x))); g.stroke(); g.restore();
        }
        g.fillStyle = rowColor(it.id); g.strokeStyle = surface; g.lineWidth = 2;
        g.beginPath(); g.arc(X, Y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
        text = t("graph.trace", { name: it.name, x: num(selected.x), y: num(y) })
          + (state.tools.tangent && Number.isFinite(k) ? ` · ${t("graph.slope", { k: num(k) })}` : "");
      }
    } else if (selected?.type === "point") {
      text = pointWords(selected.p);
    }
    readout.textContent = text;
    readout.hidden = !text;

    canvas.setAttribute("aria-label", t("graph.canvasAria", {
      list: fns.map((it) => it.name).concat(vlines.map((it) => `x = ${num(it.x)}`)).join(", ") || t("graph.none"),
    }));
    paintPoints();
  }

  function labelAt(g, text, X, Y, ink, surface) {
    g.font = "600 11.5px Inter, system-ui, sans-serif";
    const w = g.measureText(text).width + 8;
    let lx = X + 8, ly = Y - 22;
    if (lx + w > W - 4) lx = X - 8 - w;
    if (ly < 4) ly = Y + 8;
    g.fillStyle = surface; g.globalAlpha = 0.9; g.fillRect(lx, ly, w, 17); g.globalAlpha = 1;
    g.fillStyle = ink; g.fillText(text, lx + 4, ly + 12.5);
  }

  function pointWords(p) {
    const what = p.kind === "root" ? t("graph.root", { name: p.fn })
      : p.kind === "max" ? t("graph.max", { name: p.fn })
      : p.kind === "min" ? t("graph.min", { name: p.fn })
      : t("graph.cross", { a: p.fn, b: p.other });
    return `${what}: ${coord(p.x, p.y)}`;
  }

  // The points in view, as text: for reading off, copying, and screen readers. Folded away, since
  // the graph already labels them; open, it stays open while the view changes.
  function paintPoints() {
    pointsEl.hidden = !found.length;
    if (!found.length) return;
    pointsSum.textContent = t("graph.pointsTitle", { n: found.length });
    pointsList.replaceChildren(...found.slice(0, 30).map((p) => el("li", {}, pointWords(p))));
  }

  /* ---- pointer: drag to move the view, pinch or wheel to zoom, tap a graph to read it ---- */

  const pointers = new Map();
  let drag = null;   // { mode: "pan" | "trace", ... }

  function hit(X, Y) {
    for (const p of found) if (Math.hypot(p.X - X, p.Y - Y) <= 12) return { type: "point", p };
    let best = null;
    for (const it of visibleFns()) {
      const y = it.f(fromPx(X));
      if (!Number.isFinite(y)) continue;
      const d = Math.abs(toPy(y) - Y);
      if (d <= 14 && (!best || d < best.d)) best = { d, fn: it.name };
    }
    return best ? { type: "trace", fn: best.fn, x: fromPx(X) } : null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    const r = canvas.getBoundingClientRect();
    pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { mode: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const X = e.clientX - r.left, Y = e.clientY - r.top;
    const h = hit(X, Y);
    if (h?.type === "trace") { selected = h; drag = { mode: "trace" }; draw(); return; }
    if (h?.type === "point") { selected = h; drag = null; draw(); return; }
    drag = { mode: "pan", x: X, y: Y, moved: false };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const r = canvas.getBoundingClientRect();
    const X = e.clientX - r.left, Y = e.clientY - r.top;
    pointers.set(e.pointerId, { x: X, y: Y });
    if (drag?.mode === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.dist > 0) zoomAt(dist / drag.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      drag.dist = dist;
    } else if (drag?.mode === "trace") {
      selected = { type: "trace", fn: selected.fn, x: fromPx(X) };
      draw();
    } else if (drag?.mode === "pan") {
      const v = view();
      v.cx -= (X - drag.x) / v.scale; v.cy += (Y - drag.y) / v.scale;
      if (Math.abs(X - drag.x) + Math.abs(Y - drag.y) > 0) drag.moved = true;
      drag.x = X; drag.y = Y;
      draw();
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    // A tap on empty grid (no drag) lets go of what was selected.
    if (drag?.mode === "pan" && !drag.moved && selected) { selected = null; draw(); }
    drag = pointers.size ? drag : null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const v = view(), stepPx = 40 / v.scale;
    const moves = { ArrowLeft: [-stepPx, 0], ArrowRight: [stepPx, 0], ArrowUp: [0, stepPx], ArrowDown: [0, -stepPx] };
    if (moves[e.key]) { e.preventDefault(); v.cx += moves[e.key][0]; v.cy += moves[e.key][1]; draw(); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(1.25); }
    else if (e.key === "-") { e.preventDefault(); zoomAt(0.8); }
    else if (e.key === "0") { e.preventDefault(); state.view = null; draw(); }
  });

  // Drawn once it's on the page, and again whenever its size changes.
  let ro = null;
  try { ro = new ResizeObserver(() => draw()); ro.observe(canvas); } catch { /* old browser: drawn below */ }
  // and, where the browser holds back frames (a tab in the background), as soon as it has a size.
  requestAnimationFrame(() => draw());
  let tries = 0;
  (function firstDraw() {
    if (canvas.isConnected && canvas.clientWidth) { draw(); return; }
    if (tries++ < 40) setTimeout(firstDraw, 50);
  })();
  const onTheme = () => draw();
  window.addEventListener("sb:themechange", onTheme);

  rebuild();
  paintRows();

  const node = el("div.gcalc", {}, [
    el("div.gcalc__side", {}, [
      rowsEl,
      el("div", {}, [el("p.gcalc__label", { "aria-hidden": "true" }, t("graph.toolsLabel")), tools]),
      examples,
    ]),
    el("div.gcalc__main", {}, [stage, el("p.note.gcalc__hint", {}, t("graph.hint"))]),
    // Its own block: on a phone it comes after the rows, so a long list never pushes them away.
    pointsEl,
  ]);
  return {
    el: node,
    destroy() { ro?.disconnect(); window.removeEventListener("sb:themechange", onTheme); clearTimeout(timer); },
  };
}

/* ---------------- as a dialog, from a practice session ---------------- */

let dialog = null;

/** Opens the graphing calculator over the current screen; the rows are the same as on #/calculator. */
export function openGraphDialog() {
  if (dialog) return;
  const back = document.activeElement;
  const calc = graphCalculator();
  const close = () => {
    calc.destroy();
    node.remove();
    document.removeEventListener("keydown", onKey, true);
    dialog = null;
    back?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const node = el("div.modal.gcalc-modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": "gcalc-title",
    onclick: (e) => { if (e.target === node) close(); },
  }, [
    el("div.modal__card.gcalc-modal__card", {}, [
      el("div.gcalc-modal__head", {}, [
        el("h2", { id: "gcalc-title" }, t("graph.title")),
        el("button.iconbtn", { type: "button", "aria-label": t("graph.close"), title: t("graph.close"), onclick: close }, icon(ICONS.close, 18)),
      ]),
      calc.el,
    ]),
  ]);
  // Keys pressed in here (arrows on the graph, digits in a row) are the calculator's, not shortcuts
  // for the practice question behind it.
  node.addEventListener("keydown", (e) => e.stopPropagation());
  document.body.appendChild(node);
  document.addEventListener("keydown", onKey, true);
  dialog = { close };
  node.querySelector(".gcalc__input")?.focus();
}

export function closeGraphDialog() { dialog?.close(); }
