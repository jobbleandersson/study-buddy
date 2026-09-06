// A tiny, safe expression evaluator for the calculator + graph plotter.
// No eval / new Function. Grammar (recursive descent):
//   expr  = term (('+'|'-') term)*
//   term  = power (('*'|'/'|implicit) power)*
//   power = unary ('^' power)?          right-associative
//   unary = ('-'|'+') unary | atom
//   atom  = number | const | 'x' | name '(' args ')' | '(' expr ')'
// Supports the variable x, constants pi/π/e/tau, and the functions below.
// compile(src) returns f(x) => Number, or throws with a short message.

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
const INVTRIG = new Set(["asin", "acos", "atan"]);

function tokenize(src) {
  const s = String(src || "").replace(/\s+/g, "");
  const tokens = [];
  const isDigit = (c) => c >= "0" && c <= "9";
  const isAlpha = (c) => /[a-zA-Zπ]/.test(c);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isDigit(c) || (c === "." && isDigit(s[i + 1]))) {
      let j = i + 1;
      while (j < s.length && (isDigit(s[j]) || s[j] === ".")) j++;
      if ((s[j] === "e" || s[j] === "E") && (isDigit(s[j + 1]) || ((s[j + 1] === "+" || s[j + 1] === "-") && isDigit(s[j + 2])))) {
        j += (s[j + 1] === "+" || s[j + 1] === "-") ? 2 : 1;
        while (j < s.length && isDigit(s[j])) j++;
      }
      tokens.push({ t: "num", v: parseFloat(s.slice(i, j)) });
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
    else throw new Error("Oväntat tecken: " + c);
  }
  return tokens;
}

const add = (a, b) => (x) => a(x) + b(x);
const sub = (a, b) => (x) => a(x) - b(x);
const mul = (a, b) => (x) => a(x) * b(x);
const div = (a, b) => (x) => a(x) / b(x);
const pw = (a, b) => (x) => Math.pow(a(x), b(x));
const neg = (a) => (x) => -a(x);

export function compile(src, { degrees = false } = {}) {
  const tokens = tokenize(src);
  if (!tokens.length) throw new Error("Skriv ett uttryck");
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];
  const expect = (t) => { if (!peek() || peek().t !== t) throw new Error("Förväntade '" + t + "'"); return eat(); };

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
    if (!tk) throw new Error("Uttrycket är ofullständigt");
    if (tk.t === "num") { eat(); return () => tk.v; }
    if (tk.t === "(") { eat(); const e = parseExpr(); expect(")"); return e; }
    if (tk.t === "name") {
      eat();
      const nm = tk.v.toLowerCase();
      if (peek() && peek().t === "(") {
        eat();
        const args = [parseExpr()];
        while (peek() && peek().t === ",") { eat(); args.push(parseExpr()); }
        expect(")");
        const fn = FUNCS[nm];
        if (!fn) throw new Error("Okänd funktion: " + tk.v);
        return (x) => {
          let a = args[0](x);
          if (degrees && TRIG.has(nm)) a = a * Math.PI / 180;
          let r = fn(a);
          if (degrees && INVTRIG.has(nm)) r = r * 180 / Math.PI;
          return r;
        };
      }
      if (nm === "x") return (x) => x;
      if (nm in CONSTS) { const v = CONSTS[nm]; return () => v; }
      throw new Error("Okänt namn: " + tk.v);
    }
    throw new Error("Oväntat: " + (tk.t === "num" ? tk.v : tk.t));
  }

  const f = parseExpr();
  if (pos < tokens.length) throw new Error("Oväntat efter uttrycket");
  return f;
}

/** Evaluate an expression with no variable. May return NaN / ±Infinity. */
export function evaluate(src, opts) {
  return compile(src, opts)(0);
}

/** A number formatted for a small display — trims float noise, keeps it short. */
export function fmtNumber(n) {
  if (!isFinite(n)) return n > 0 ? "∞" : (n < 0 ? "−∞" : "odefinierat");
  if (Object.is(n, -0)) n = 0;
  if (n !== 0 && (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, "e");
  const r = Math.round(n * 1e10) / 1e10;
  return String(r);
}
