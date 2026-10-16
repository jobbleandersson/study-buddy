import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compile, evaluate, fmtNumber } from "../../js/lib/expr.js";

describe("expr.evaluate: arithmetic and precedence", () => {
  test("basic operator precedence", () => {
    assert.equal(evaluate("2+3*4"), 14);
    assert.equal(evaluate("(2+3)*4"), 20);
    assert.equal(evaluate("2^3^2"), 512); // right-associative: 2^(3^2)
    assert.equal(evaluate("-2^2"), -4); // unary binds looser than ^
    assert.equal(evaluate("2^-2"), 0.25);
  });

  test("implicit multiplication", () => {
    assert.equal(evaluate("2(3+4)"), 14);
    assert.equal(evaluate("2pi") / Math.PI, 2);
  });

  test("division and unary signs", () => {
    assert.equal(evaluate("10/2/5"), 1);
    assert.equal(evaluate("-(-5)"), 5);
    assert.equal(evaluate("+5"), 5);
  });

  test("constants", () => {
    assert.ok(Math.abs(evaluate("pi") - Math.PI) < 1e-12);
    assert.ok(Math.abs(evaluate("e") - Math.E) < 1e-12);
    assert.ok(Math.abs(evaluate("tau") - 2 * Math.PI) < 1e-12);
  });

  test("functions", () => {
    assert.ok(Math.abs(evaluate("sqrt(16)") - 4) < 1e-12);
    assert.ok(Math.abs(evaluate("√(9)") - 3) < 1e-12);   // the calculator keypad inserts the sign
    assert.ok(Math.abs(evaluate("2√(16)") - 8) < 1e-12);
    assert.ok(Math.abs(evaluate("abs(-7)") - 7) < 1e-12);
    assert.ok(Math.abs(evaluate("log2(8)") - 3) < 1e-12);
  });

  test("the x variable is substituted when the compiled function is called", () => {
    const f = compile("x^2 + 1");
    assert.equal(f(3), 10);
    assert.equal(f(0), 1);
  });

  test("degrees mode converts trig input/output", () => {
    const f = compile("sin(x)", { degrees: true });
    assert.ok(Math.abs(f(90) - 1) < 1e-9);
  });
});

describe("expr.compile: error handling", () => {
  test("throws on an unknown character", () => {
    assert.throws(() => compile("2 & 3"));
  });
  test("throws on an unknown function name", () => {
    assert.throws(() => compile("bogus(2)"));
  });
  test("throws on an unknown bare name", () => {
    assert.throws(() => compile("y + 1"));
  });
  test("throws on empty input", () => {
    assert.throws(() => compile(""));
  });
  test("throws on unbalanced parentheses", () => {
    assert.throws(() => compile("(2+3"));
  });
  test("throws on trailing garbage after a valid expression", () => {
    assert.throws(() => compile("2+3)"));
  });
});

describe("expr: decimal comma and number syntax", () => {
  test("a comma between digits is a decimal separator", () => {
    assert.equal(evaluate("3,5+1,5"), 5);
    assert.equal(evaluate(",5*2"), 1);
    assert.equal(evaluate("2,5·4"), 10);
  });
  test("spaces are digit grouping, the way Swedish writes 5 000", () => {
    assert.equal(evaluate("5 000 * 0,02"), 100);
  });
  test("a second decimal separator in one number is an error, not silently dropped", () => {
    assert.throws(() => compile("1.2.3"));
    assert.throws(() => compile("1,2,3"));
  });
});

const LANG_KEY = "studybuddy.lang";
const inLang = (lang, fn) => {
  localStorage.setItem(LANG_KEY, lang);
  try { fn(); } finally { localStorage.removeItem(LANG_KEY); }
};

describe("expr.fmtNumber", () => {
  test("trims floating-point noise, with the language's decimal separator", () => {
    inLang("sv", () => assert.equal(fmtNumber(0.1 + 0.2), "0,3"));
    inLang("en", () => assert.equal(fmtNumber(0.1 + 0.2), "0.3"));
  });
  test("renders +/-Infinity and NaN specially, NaN in the UI language", () => {
    assert.equal(fmtNumber(Infinity), "∞");
    assert.equal(fmtNumber(-Infinity), "−∞");
    inLang("sv", () => assert.equal(fmtNumber(NaN), "odefinierat"));
    inLang("en", () => assert.equal(fmtNumber(NaN), "undefined"));
  });
  test("very large and small numbers use school notation, not 1e+20", () => {
    inLang("sv", () => {
      assert.equal(fmtNumber(1e20), "1 · 10²⁰");
      assert.equal(fmtNumber(2.5e-12), "2,5 · 10⁻¹²");
    });
    inLang("en", () => assert.equal(fmtNumber(-3.25e15), "-3.25 · 10¹⁵"));
  });
  test("no JavaScript exponent notation anywhere in the small range", () => {
    inLang("sv", () => {
      assert.equal(fmtNumber(5e-7), "5 · 10⁻⁷");
      assert.equal(fmtNumber(0.000001234), "0,000001234");
    });
    for (const n of [5e-7, 1.5e-9, 2.5e-8, 7e-11, 3e13]) assert.doesNotMatch(fmtNumber(n), /e[+-]?\d/);
  });
  test("normalizes negative zero to zero", () => {
    assert.equal(fmtNumber(-0), "0");
  });
});

describe("expr: degrees mode is exact at multiples of 90", () => {
  const deg = { degrees: true };
  test("sin and cos at the quarter turns are exactly 0, 1 or -1", () => {
    assert.equal(evaluate("cos(90)", deg), 0);
    assert.equal(evaluate("sin(180)", deg), 0);
    assert.equal(evaluate("sin(90)", deg), 1);
    assert.equal(evaluate("cos(180)", deg), -1);
    assert.equal(evaluate("sin(270)", deg), -1);
    assert.equal(evaluate("cos(360)", deg), 1);
    assert.equal(evaluate("sin(-90)", deg), -1);
    assert.equal(evaluate("cos(-90)", deg), 0);
    assert.equal(evaluate("sin(720)", deg), 0);
  });
  test("tan is 0 at 0 and 180 and undefined at 90 and 270", () => {
    assert.equal(evaluate("tan(0)", deg), 0);
    assert.equal(evaluate("tan(180)", deg), 0);
    assert.ok(Number.isNaN(evaluate("tan(90)", deg)));
    assert.ok(Number.isNaN(evaluate("tan(270)", deg)));
  });
  test("other angles still go through radians", () => {
    assert.ok(Math.abs(evaluate("sin(30)", deg) - 0.5) < 1e-12);
    assert.ok(Math.abs(evaluate("tan(45)", deg) - 1) < 1e-12);
  });
  test("in radians the noise at sin(pi) and cos(pi/2) is cleared, small angles are not", () => {
    assert.equal(evaluate("sin(pi)"), 0);
    assert.equal(evaluate("cos(pi/2)"), 0);
    assert.equal(evaluate("sin(1e-10)"), Math.sin(1e-10));
  });
});

describe("expr: a trailing decimal separator", () => {
  test('"5," and "5." read as 5, also before an operator or a bracket', () => {
    assert.equal(evaluate("5,"), 5);
    assert.equal(evaluate("5."), 5);
    assert.equal(evaluate("5,+3"), 8);
    assert.equal(evaluate("(2.)*4"), 8);
  });
  test("a decimal separator inside a number and the 1.2.3 guard still work", () => {
    assert.equal(evaluate("3,5"), 3.5);
    assert.equal(evaluate(".5"), 0.5);
    assert.throws(() => evaluate("1.2.3"));
  });
});

describe("fmtNumber: twelve significant digits", () => {
  test("float noise is trimmed and small numbers keep their digits", () => {
    assert.equal(fmtNumber(0.1 + 0.2), "0,3");
    assert.equal(fmtNumber(1234567.123456789), "1234567,12346");
    assert.equal(fmtNumber(0.0000123456789), "0,0000123456789");
  });
  test("zero from an exact trig value prints as 0", () => {
    assert.equal(fmtNumber(evaluate("cos(90)", { degrees: true })), "0");
  });
});
