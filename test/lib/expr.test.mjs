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

describe("expr.fmtNumber", () => {
  test("trims floating-point noise", () => {
    assert.equal(fmtNumber(0.1 + 0.2), "0.3");
  });
  test("renders +/-Infinity and NaN specially", () => {
    assert.equal(fmtNumber(Infinity), "∞");
    assert.equal(fmtNumber(-Infinity), "−∞");
    assert.equal(fmtNumber(NaN), "odefinierat");
  });
  test("normalizes negative zero to zero", () => {
    assert.equal(fmtNumber(-0), "0");
  });
});
