// The graphing calculator's maths (components/graph-calc.js draws it): what each row the student
// types is, the functions, parameters and points those rows make, and the special points on the
// graphs (zeros, maximum/minimum points, intersections) found numerically in the visible range.
// No DOM, so it can be tested on its own. Parsing is lib/expr.js.
//
// A row is one of:
//   f(x) = x^2 - 3   a named function          y = 2x + 1 / 2x + 1   a function named f, g, h…
//   x = 2            a vertical line           a = 1                 a parameter (a slider)
//   A = (1; 2)       a point (also "(1, 2)": the comma is a decimal comma only between digits)

import { compile } from "./expr.js";

/** Names given to functions typed without one, in this order (as on the board). */
const FN_NAMES = ["f", "g", "h", "p", "q", "r", "s", "u", "v", "w"];
const RESERVED = new Set(["x", "y", "e", "pi", "tau"]);

/** Splits the inside of "(1; 2)", "(1,5, 2)" or "(1, 2)" into its two coordinates, or null. */
export function splitPair(inner) {
  const s = String(inner);
  if (s.includes(";")) {
    const i = s.indexOf(";");
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  const commas = (s.match(/,/g) || []).length;
  if (commas === 1) { const i = s.indexOf(","); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }
  const spaced = s.indexOf(", ");
  if (spaced >= 0) return [s.slice(0, spaced).trim(), s.slice(spaced + 2).trim()];
  return null;
}

/** What one row says. */
export function parseRow(text) {
  const s = String(text || "").trim();
  if (!s) return { kind: "empty" };
  let m;
  if ((m = /^([a-zA-Z][a-zA-Z0-9]*)\s*\(\s*x\s*\)\s*=\s*(.+)$/.exec(s))) return { kind: "fn", name: m[1], expr: m[2] };
  if ((m = /^y\s*=\s*(.+)$/i.exec(s))) return { kind: "fn", name: null, expr: m[1] };
  if ((m = /^x\s*=\s*(.+)$/i.exec(s))) return { kind: "vline", expr: m[1] };
  if ((m = /^([a-zA-Z][a-zA-Z0-9]*)\s*=\s*\((.*)\)$/.exec(s)) && splitPair(m[2])) {
    const [xs, ys] = splitPair(m[2]);
    return { kind: "point", name: m[1], xExpr: xs, yExpr: ys };
  }
  if ((m = /^\((.*)\)$/.exec(s)) && splitPair(m[1])) {
    const [xs, ys] = splitPair(m[1]);
    return { kind: "point", name: null, xExpr: xs, yExpr: ys };
  }
  if ((m = /^([a-zA-Z][a-zA-Z0-9]*)\s*=\s*(.+)$/.exec(s))) return { kind: "param", name: m[1], expr: m[2] };
  return { kind: "fn", name: null, expr: s };
}

/**
 * Everything the rows define. `rows` is [{ id, text, hidden }]; `msg(key, vars)` words the errors.
 * Returns { items, scope, missing }: one item per row ({ id, kind, name, error, … } plus
 *   fn: f(x) · vline: x · point: x, y · param: value), the scope the functions run in, and the
 * single letters used but never defined (offered as new sliders).
 */
export function buildModel(rows, msg = (k) => k) {
  const parsed = (rows || []).map((r) => ({ row: r, ...parseRow(r.text) }));

  // Names: the ones written out, then f, g, h… for functions typed without one.
  const taken = new Set();
  for (const p of parsed) if (p.name && p.kind !== "empty") taken.add(p.name);
  const free = FN_NAMES.filter((n) => !taken.has(n));
  for (const p of parsed) if (p.kind === "fn" && !p.name) { p.name = free.shift() || `f${taken.size}`; p.auto = true; taken.add(p.name); }

  const seen = new Map();
  const items = parsed.map((p) => {
    const item = { id: p.row.id, kind: p.kind, name: p.name || null, hidden: !!p.row.hidden, auto: !!p.auto, error: null };
    if (p.name) {
      if (RESERVED.has(p.name) || (p.kind === "param" && p.name.length > 1 && /^(sin|cos|tan|ln|lg|log|sqrt|abs|exp)$/i.test(p.name))) {
        item.error = msg("graph.err.reserved", { name: p.name });
      } else if (seen.has(p.name)) item.error = msg("graph.err.taken", { name: p.name });
      seen.set(p.name, true);
    }
    return item;
  });

  const params = new Set(parsed.filter((p, i) => p.kind === "param" && !items[i].error).map((p) => p.name));
  const fns = new Set(parsed.filter((p, i) => p.kind === "fn" && !items[i].error).map((p) => p.name));
  const scope = { vars: {}, fns: {}, depth: 0, loop: false };
  const missing = new Set();
  const tryCompile = (src, item) => {
    try { return compile(src, { params, fns }); } catch (e) {
      if (e.unknownName && !params.has(e.unknownName) && !fns.has(e.unknownName)) missing.add(e.unknownName);
      item.error = e.message;
      return null;
    }
  };

  // Parameters: plain numbers (an expression of other numbers is fine, x isn't).
  parsed.forEach((p, i) => {
    const item = items[i];
    if (p.kind !== "param" || item.error) return;
    let c;
    try { c = compile(p.expr); } catch (e) { item.error = e.message; params.delete(p.name); return; }
    const a = c(1.234), b = c(2.345);
    if (!isFinite(a) || a !== b) { item.error = msg("graph.err.paramX"); params.delete(p.name); return; }
    item.value = a;
    scope.vars[p.name] = a;
  });

  // Functions, then what refers to them.
  parsed.forEach((p, i) => {
    const item = items[i];
    if (p.kind !== "fn" || item.error) return;
    const c = tryCompile(p.expr, item);
    if (!c) { fns.delete(p.name); return; }
    scope.fns[p.name] = c;
    item.f = (x) => { scope.depth = 0; return c(x, scope); };
  });
  // One that ends up calling itself (f(x) = f(x) + 1, or f and g calling each other) has no values.
  for (const item of items) {
    if (!item.f) continue;
    scope.loop = false;
    item.f(0.5);
    if (scope.loop) { item.error = msg("graph.err.loop", { name: item.name }); item.f = null; }
  }
  parsed.forEach((p, i) => {
    const item = items[i];
    if (item.error) return;
    if (p.kind === "vline") {
      const c = tryCompile(p.expr, item);
      if (c) { scope.depth = 0; const v = c(0, scope); if (isFinite(v)) item.x = v; else item.error = msg("graph.err.notNumber"); }
    } else if (p.kind === "point") {
      const cx = tryCompile(p.xExpr, item);
      const cy = cx && tryCompile(p.yExpr, item);
      if (cx && cy) {
        scope.depth = 0; const x = cx(0, scope);
        scope.depth = 0; const y = cy(0, scope);
        if (isFinite(x) && isFinite(y)) { item.x = x; item.y = y; } else item.error = msg("graph.err.notNumber");
      }
    }
  });
  return { items, scope, missing: [...missing] };
}

/* ---------------- special points, found numerically ---------------- */

const finite = Number.isFinite;
const MAX_FOUND = 40;   // more than this in view (sin x zoomed far out) is noise, not information

function bisect(g, a, b, ga, iters = 60) {
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2, gm = g(m);
    if (!finite(gm)) return null;
    if (gm === 0) return m;
    if ((gm < 0) === (ga < 0)) { a = m; ga = gm; } else b = m;
  }
  return (a + b) / 2;
}

const near = (list, x, tol) => list.some((p) => Math.abs(p.x - x) <= tol);

/** Where g crosses zero in [a, b]: sign changes, refined by bisection. A pole (tan x at π/2) also
 *  changes sign, so a crossing only counts when g really gets close to 0 there. Null when g is 0
 *  across the range (the same graph twice), which has no particular points. */
export function findRoots(g, a, b, n = 800) {
  const out = [];
  const h = (b - a) / n, tol = h / 2;
  let x0 = a, y0 = g(a), zeros = 0;
  for (let i = 1; i <= n; i++) {
    const x1 = a + i * h, y1 = g(x1);
    if (finite(y0) && finite(y1)) {
      if (y0 === 0) { zeros++; if (!near(out, x0, tol)) out.push({ x: x0 }); }
      else if (y0 * y1 < 0) {
        const r = bisect(g, x0, x1, y0);
        if (r != null) {
          const yr = g(r);
          if (finite(yr) && Math.abs(yr) <= Math.min(Math.abs(y0), Math.abs(y1)) && Math.abs(yr) < 1e-6 * (1 + Math.abs(y0) + Math.abs(y1)) && !near(out, r, tol)) out.push({ x: r });
        }
      }
    }
    x0 = x1; y0 = y1;
  }
  if (finite(y0) && y0 === 0 && !near(out, x0, tol)) out.push({ x: x0 });
  if (zeros > n / 4) return null;
  return out.length > MAX_FOUND ? [] : out;
}

/** The slope of f at x (central difference). */
export function slope(f, x) {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return (f(x + h) - f(x - h)) / (2 * h);
}

/** Maximum and minimum points of f in [a, b]: where its slope changes sign. A pole (1/x² at 0) also
 *  turns the slope around, so a turning point only counts when f there isn't far beyond its neighbours. */
export function findExtrema(f, a, b, n = 800) {
  const out = [];
  const h = (b - a) / n;
  const dh = Math.max(1e-9, (b - a) * 1e-6);
  const d = (x) => (f(x + dh) - f(x - dh)) / (2 * dh);
  // Compared with the last sample whose slope wasn't exactly 0: a sample landing right on the turning
  // point (x = 1 for x² − 2x − 3) has slope 0 and says nothing about which way it turns.
  let x0 = a, d0 = d(a);
  for (let i = 1; i <= n; i++) {
    const x1 = a + i * h, d1 = d(x1);
    if (!finite(d1)) { x0 = x1; d0 = NaN; continue; }   // a break in the graph starts afresh
    if (d1 === 0) continue;
    if (finite(d0) && d0 !== 0 && (d0 > 0) !== (d1 > 0)) {
      const xm = bisect(d, x0, x1, d0, 50);
      if (xm != null) {
        const ym = f(xm), ya = f(x0), yb = f(x1);
        const room = (Math.abs(d0) + Math.abs(d1)) * (x1 - x0) + 1e-9 * (1 + Math.abs(ya));
        const max = d0 > 0;
        const fits = finite(ym) && finite(ya) && finite(yb)
          && (max ? ym <= Math.max(ya, yb) + room : ym >= Math.min(ya, yb) - room);
        if (fits && !near(out, xm, h)) out.push({ x: xm, y: ym, type: max ? "max" : "min" });
      }
    }
    x0 = x1; d0 = d1;
  }
  return out.length > MAX_FOUND ? [] : out;
}

/** Everything worth marking on the visible graphs, per kind. `fns` is [{ name, f }], `vlines` [{ name, x }]. */
export function specialPoints(fns, vlines, a, b, { roots = true, extrema = true, intersections = true } = {}) {
  const out = [];
  for (const { name, f } of fns) {
    const ext = extrema || roots ? findExtrema(f, a, b) : [];
    if (roots) {
      const rs = findRoots(f, a, b) || [];
      // A zero the graph only touches (x² at 0) has no sign change: it is a turning point at y = 0.
      const scale = 1e-7 * (1 + Math.max(...ext.map((p) => Math.abs(p.y)), 0));
      for (const p of ext) if (Math.abs(p.y) < scale && !near(rs, p.x, (b - a) / 800)) rs.push({ x: p.x });
      for (const r of rs.sort((p, q) => p.x - q.x)) out.push({ kind: "root", fn: name, x: r.x, y: 0 });
    }
    if (extrema) for (const p of ext) out.push({ kind: p.type, fn: name, x: p.x, y: p.y });
  }
  if (intersections) {
    for (let i = 0; i < fns.length; i++) {
      for (let j = i + 1; j < fns.length; j++) {
        const F = fns[i], G = fns[j];
        const xs = findRoots((x) => F.f(x) - G.f(x), a, b) || [];
        for (const p of xs) out.push({ kind: "cross", fn: F.name, other: G.name, x: p.x, y: F.f(p.x) });
      }
      for (const v of vlines) {
        if (v.x < a || v.x > b) continue;
        const y = fns[i].f(v.x);
        if (finite(y)) out.push({ kind: "cross", fn: fns[i].name, other: v.name, x: v.x, y });
      }
    }
  }
  return out;
}

/** A tick spacing near `raw` that reads well: 1, 2 or 5 times a power of ten. */
export function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
