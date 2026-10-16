// A tiny, safe expression evaluator for the calculator + graph plotter.
// No eval / new Function. Grammar (recursive descent):
//   expr  = term (('+'|'-') term)*
//   term  = power (('*'|'/'|implicit) power)*
//   power = unary ('^' power)?          right-associative
//   unary = ('-'|'+') unary | atom
//   atom  = number | const | 'x' | name '(' args ')' | '(' expr ')'
// Supports the variable x, constants pi/π/e/tau, and the functions below.
// compile(src) returns f(x) => Number, or throws with a short message.
//
// For the graphing calculator, compile(src, { params, fns }) also knows named parameters (sliders:
// a, k, …) and the student's own functions (g(x) = f(x) + 1). The result is then called as
// f(x, scope) with scope = { vars: { a: 2 }, fns: { f: (x, scope) => … } }. A run of letters that
// isn't a name it knows, like "ax", is read as a product (a·x) when every letter is one it does
// know. An unknown name throws an error carrying `.unknownName`, so the caller can offer a slider.

import { t, getLang } from "./i18n.js";

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  ln: Math.log, log: (x) => Math.log10(x), lg: (x) => Math.log10(x), log2: Math.log2,
  exp: Math.exp, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const CONSTS = { pi: Math.PI, "π": Math.PI, e: Math.E, tau: 2 * Math.PI };
const TRIG = new Set(["sin", "cos", "tan"]);

/** sin / cos / tan of an angle in degrees. At a multiple of 90° the answer is exact (cos 90° is 0, not
 *  6,1 · 10⁻¹⁷, the float noise of going through radians) and tan 90° is undefined, not 1,6 · 10¹⁶. */
function trigDegrees(name, deg) {
  const k = deg / 90;
  if (Number.isInteger(k)) {
    const q = ((k % 4) + 4) % 4;
    if (name === "sin") return [0, 1, 0, -1][q];
    if (name === "cos") return [1, 0, -1, 0][q];
    return q % 2 === 0 ? 0 : NaN;
  }
  return FUNCS[name](deg * Math.PI / 180);
}
const INVTRIG = new Set(["asin", "acos", "atan"]);

function tokenize(src) {
  const s = String(src || "").replace(/\s+/g, "");
  const tokens = [];
  const isDigit = (c) => c >= "0" && c <= "9";
  const isAlpha = (c) => /[a-zA-Zπ]/.test(c);
  let i = 0;
  // A decimal separator is "." or "," (Swedish students write 3,5) — only between
  // digits and only once per number. No function takes a second argument, so a
  // comma has no other job. Whitespace was dropped above, so "5 000" reads as 5000.
  const isSep = (k) => (s[k] === "." || s[k] === ",") && isDigit(s[k + 1]);
  while (i < s.length) {
    const c = s[i];
    if (isDigit(c) || isSep(i)) {
      let hasSep = !isDigit(c);
      let j = i + 1;
      while (j < s.length && (isDigit(s[j]) || (!hasSep && isSep(j)))) { if (!isDigit(s[j])) hasSep = true; j++; }
      // "5," and "5." are how a number looks half-typed, or written by someone used to "5,0": a separator
      // with no digit after it is part of the number when nothing but an operator, a bracket or the end follows.
      if (!hasSep && (s[j] === "." || s[j] === ",") && (j + 1 >= s.length || "+-*/^)×·÷−".includes(s[j + 1]))) { hasSep = true; j++; }
      // "1.2.3" must not quietly become 1.2 · 0.3 through implicit multiplication.
      if (isSep(j)) throw new Error(t("calc.err.char", { c: s[j] }));
      if ((s[j] === "e" || s[j] === "E") && (isDigit(s[j + 1]) || ((s[j + 1] === "+" || s[j + 1] === "-") && isDigit(s[j + 2])))) {
        j += (s[j + 1] === "+" || s[j + 1] === "-") ? 2 : 1;
        while (j < s.length && isDigit(s[j])) j++;
      }
      tokens.push({ t: "num", v: parseFloat(s.slice(i, j).replace(",", ".")) });   // "5." and "5," parse as 5
      i = j;
    } else if (isAlpha(c)) {
      let j = i + 1;
      while (j < s.length && (isAlpha(s[j]) || isDigit(s[j]))) j++;
      tokens.push({ t: "name", v: s.slice(i, j) });
      i = j;
    } else if ("+-*/^(),".includes(c)) {
      tokens.push({ t: c }); i++;
    } else if (c === "·" || c === "×") { tokens.push({ t: "*" }); i++; }
    else if (c === "÷" || c === "∕") { tokens.push({ t: "/" }); i++; }
    else if (c === "−") { tokens.push({ t: "-" }); i++; }
    else if (c === "√") { tokens.push({ t: "name", v: "sqrt" }); i++; }   // the keypad's √( key
    else throw new Error(t("calc.err.char", { c }));
  }
  return tokens;
}

const add = (a, b) => (x, p) => a(x, p) + b(x, p);
const sub = (a, b) => (x, p) => a(x, p) - b(x, p);
const mul = (a, b) => (x, p) => a(x, p) * b(x, p);
const div = (a, b) => (x, p) => a(x, p) / b(x, p);
const pw = (a, b) => (x, p) => Math.pow(a(x, p), b(x, p));
const neg = (a) => (x, p) => -a(x, p);

/** How deep the student's functions may call each other: past it (f(x) = f(x) + 1) the value is NaN
 *  and scope.loop is set, instead of a stack overflow. */
export const MAX_DEPTH = 40;

export function compile(src, { degrees = false, params = null, fns = null } = {}) {
  const isParam = (nm) => !!params && params.has(nm);
  const isFn = (nm) => !!fns && fns.has(nm);
  const tokens = tokenize(src);
  if (!tokens.length) throw new Error(t("calc.err.empty"));
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];
  const expect = (tt) => { if (!peek() || peek().t !== tt) throw new Error(t("calc.err.expected", { t: tt })); return eat(); };

  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = eat().t;
      node = op === "+" ? add(node, parseTerm()) : sub(node, parseTerm());
    }
    return node;
  }
  function parseTerm() {
    let node = parseUnary();
    while (peek() && (peek().t === "*" || peek().t === "/"
      || peek().t === "num" || peek().t === "name" || peek().t === "(")) {
      let op = "*";
      if (peek().t === "*" || peek().t === "/") op = eat().t;
      node = op === "*" ? mul(node, parseUnary()) : div(node, parseUnary());
    }
    return node;
  }
  // Unary minus binds looser than ^, so -2^2 = -(2^2) = -4 (the usual
  // convention); the exponent itself is a unary, so 2^-3 works too.
  function parseUnary() {
    if (peek() && (peek().t === "-" || peek().t === "+")) {
      const op = eat().t;
      return op === "-" ? neg(parseUnary()) : parseUnary();
    }
    return parsePower();
  }
  function parsePower() {
    const base = parseAtom();
    if (peek() && peek().t === "^") { eat(); return pw(base, parseUnary()); }
    return base;
  }
  function parseAtom() {
    const tk = peek();
    if (!tk) throw new Error(t("calc.err.incomplete"));
    if (tk.t === "num") { eat(); return () => tk.v; }
    if (tk.t === "(") { eat(); const e = parseExpr(); expect(")"); return e; }
    if (tk.t === "name") {
      eat();
      const raw = tk.v;
      const nm = raw.toLowerCase();
      const single = (name) => {
        if (name.toLowerCase() === "x" && !isParam(name)) return (x) => x;
        if (isParam(name)) return (x, p) => p.vars[name];
        if (name.toLowerCase() in CONSTS) { const v = CONSTS[name.toLowerCase()]; return () => v; }
        return null;
      };
      // "ax", "kx", "abc": letters the reader knows, written together as a student writes a product.
      // Split into one name each, so the next power belongs to the last letter only (ax^2 = a·x²).
      const product = () => params && raw.length > 1 && [...raw].every(single);
      // A call: a built-in function, or one of the student's own. Anything else the reader knows
      // before a bracket, a(x + 1) or x(x − 2), is a product, left to implicit multiplication.
      const callable = FUNCS[nm] || isFn(raw);
      if (peek() && peek().t === "(" && (callable || !(single(raw) || product()))) {
        eat();
        const args = [parseExpr()];
        while (peek() && peek().t === ",") { eat(); args.push(parseExpr()); }
        expect(")");
        if (!FUNCS[nm] && isFn(raw)) {
          const arg = args[0];
          return (x, p) => {
            if ((p.depth || 0) >= MAX_DEPTH) { p.loop = true; return NaN; }
            p.depth = (p.depth || 0) + 1;
            try { return p.fns[raw](arg(x, p), p); } finally { p.depth--; }
          };
        }
        const fn = FUNCS[nm];
        if (!fn) throw new Error(t("calc.err.fn", { name: raw }));
        return (x, p) => {
          const a = args[0](x, p);
          if (degrees && TRIG.has(nm)) return trigDegrees(nm, a);
          let r = fn(a);
          if (degrees && INVTRIG.has(nm)) r = r * 180 / Math.PI;
          // In radians sin(π) and cos(π/2) come out around 10⁻¹⁶: float noise, not an answer.
          else if ((nm === "sin" || nm === "cos") && Math.abs(r) < 1e-15 && Math.abs(a) > 1e-6) r = 0;
          return r;
        };
      }
      const known = single(raw);
      if (known) return known;
      if (product()) {
        pos--;
        tokens.splice(pos, 1, ...[...raw].map((c) => ({ t: "name", v: c })));
        return parseAtom();
      }
      const err = new Error(t("calc.err.name", { name: raw }));
      // An unknown single letter, alone or in a product ("a" in "ax^2"), is most likely a parameter
      // the student means to vary. Not in "sinx" or "lnx": that's a function without its bracket.
      const paramLetter = (c) => /^[a-wzA-WZ]$/.test(c) && c !== "e";
      if (params && !Object.keys(FUNCS).some((f) => nm.startsWith(f))) {
        const unknown = [...raw].filter((c) => !single(c));
        if (unknown.length && unknown.every(paramLetter)) err.unknownName = unknown[0];
      }
      throw err;
    }
    throw new Error(t("calc.err.unexpected", { what: tk.t === "num" ? tk.v : tk.t }));
  }

  const f = parseExpr();
  if (pos < tokens.length) throw new Error(t("calc.err.trailing"));
  return f;
}

/** Evaluate an expression with no variable. May return NaN / ±Infinity. */
export function evaluate(src, opts) {
  return compile(src, opts)(0);
}

const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

/** A number formatted for a small display — trims float noise, keeps it short.
 *  Decimal comma in Swedish, and very large/small numbers the way school writes
 *  them (2,5 · 10⁸) rather than JavaScript's 2.5e+8. Display only: the
 *  calculator never parses its own output back. */
export function fmtNumber(n) {
  if (!isFinite(n)) return n > 0 ? "∞" : (n < 0 ? "−∞" : t("calc.undefined"));
  if (Object.is(n, -0)) n = 0;
  const dec = (str) => (getLang() === "sv" ? str.replace(".", ",") : str);
  // 1e-6, not smaller: below it String() itself switches to "5e-7".
  if (n !== 0 && (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-6)) {
    const [mant, exp] = n.toExponential(6).split("e");
    return `${dec(mant.replace(/\.?0+$/, ""))} · 10${String(Number(exp)).replace(/[-\d]/g, (ch) => SUPERSCRIPT[ch])}`;
  }
  // Twelve significant digits: 0,1 + 0,2 shows 0,3, and a small number keeps its digits.
  return dec(String(Number(n.toPrecision(12))));
}
