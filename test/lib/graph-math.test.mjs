import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../js/lib/expr.js";
import { parseRow, splitPair, buildModel, findRoots, findExtrema, specialPoints, slope } from "../../js/lib/graph-math.js";

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

describe("expr with parameters and the student's functions", () => {
  test("a parameter is read from the scope, and 'ax' is a times x", () => {
    const f = compile("ax^2 + bx + c", { params: new Set(["a", "b", "c"]), fns: new Set() });
    assert.equal(f(2, { vars: { a: 1, b: -3, c: 2 } }), 0);
    // The power belongs to x alone: ax^2 is a·x², not (ax)².
    assert.equal(f(2, { vars: { a: -1, b: 0, c: 0 } }), -4);
    assert.equal(compile("-kx^3", { params: new Set(["k"]), fns: new Set() })(2, { vars: { k: 2 } }), -16);
    const g = compile("a(x + 1)", { params: new Set(["a"]), fns: new Set() });
    assert.equal(g(1, { vars: { a: 3 } }), 6);
  });

  test("x(x - 2) is a product, as before only a function name before a bracket is a call", () => {
    assert.equal(compile("x(x - 2)")(5), 15);
    assert.throws(() => compile("bogus(2)"));
  });

  test("an unknown letter is reported, so it can become a slider; sinx is not", () => {
    try { compile("ax^2", { params: new Set(), fns: new Set() }); assert.fail("should throw"); }
    catch (e) { assert.equal(e.unknownName, "a"); }
    try { compile("sinx", { params: new Set(), fns: new Set() }); assert.fail("should throw"); }
    catch (e) { assert.equal(e.unknownName, undefined); }
  });
});

describe("graph rows", () => {
  test("each kind of row", () => {
    assert.deepEqual(parseRow("f(x) = x^2"), { kind: "fn", name: "f", expr: "x^2" });
    assert.deepEqual(parseRow("y = 2x + 1"), { kind: "fn", name: null, expr: "2x + 1" });
    assert.deepEqual(parseRow("2x + 1"), { kind: "fn", name: null, expr: "2x + 1" });
    assert.deepEqual(parseRow("x = 3"), { kind: "vline", expr: "3" });
    assert.deepEqual(parseRow("a = 2"), { kind: "param", name: "a", expr: "2" });
    assert.deepEqual(parseRow("A = (1; 2)"), { kind: "point", name: "A", xExpr: "1", yExpr: "2" });
    assert.deepEqual(parseRow(""), { kind: "empty" });
  });

  test("a point's comma: decimal comma between digits, or the separator", () => {
    assert.deepEqual(splitPair("1, 2"), ["1", "2"]);
    assert.deepEqual(splitPair("1,5, 2"), ["1,5", "2"]);
    assert.deepEqual(splitPair("1,5; 2,5"), ["1,5", "2,5"]);
    assert.deepEqual(splitPair("1,2"), ["1", "2"]);
  });

  test("the model: names, parameters, functions using each other, points and errors", () => {
    const rows = ["a = 2", "f(x) = ax", "y = f(x) + 1", "A = (1; f(1))", "g(x) = g(x) + 1", "a = 3", "k = 2x"]
      .map((text, i) => ({ id: i + 1, text }));
    const { items } = buildModel(rows, (k) => k);
    assert.equal(items[0].value, 2);
    assert.equal(items[1].f(3), 6);
    assert.equal(items[2].name, "h");           // f and g are taken: the unnamed function is h
    assert.equal(items[2].f(3), 7);
    assert.equal(items[3].x, 1); assert.equal(items[3].y, 2);
    assert.equal(items[4].error, "graph.err.loop");
    assert.equal(items[5].error, "graph.err.taken");
    assert.equal(items[6].error, "graph.err.paramX");
  });

  test("letters used but never defined are offered as sliders", () => {
    const { missing } = buildModel([{ id: 1, text: "ax^2 + c" }]);
    assert.deepEqual(missing, ["a"]);
  });
});

describe("special points", () => {
  const f = (x) => x * x - 2 * x - 3;   // zeros -1 and 3, minimum (1, -4)

  test("zeros, including one the graph only touches", () => {
    const r = findRoots(f, -10, 10).map((p) => p.x);
    assert.equal(r.length, 2); close(r[0], -1); close(r[1], 3);
    const pts = specialPoints([{ name: "f", f: (x) => (x - 2) ** 2 }], [], -10, 10, { roots: true, extrema: false, intersections: false });
    assert.equal(pts.length, 1); close(pts[0].x, 2, 1e-4);
  });

  test("a pole is not a zero, and not a turning point", () => {
    assert.deepEqual(findRoots((x) => 1 / x, -5, 5), []);
    assert.deepEqual(findExtrema((x) => 1 / (x * x), -5, 5), []);
  });

  test("maximum and minimum points", () => {
    const e = findExtrema(f, -10, 10);
    assert.equal(e.length, 1); assert.equal(e[0].type, "min"); close(e[0].x, 1, 1e-5); close(e[0].y, -4, 1e-6);
    const s = findExtrema(Math.sin, 0, 7).map((p) => p.type);
    assert.deepEqual(s, ["max", "min"]);
  });

  test("intersections, with each other and with a vertical line; one graph twice has none", () => {
    const pts = specialPoints([{ name: "f", f }, { name: "g", f: (x) => x - 3 }], [{ name: "x = 0", x: 0 }], -10, 10,
      { roots: false, extrema: false, intersections: true });
    const fg = pts.filter((p) => p.other === "g").map((p) => p.x).sort((a, b) => a - b);
    close(fg[0], 0); close(fg[1], 3);
    assert.ok(pts.some((p) => p.other === "x = 0" && p.fn === "f" && p.y === -3));
    assert.equal(specialPoints([{ name: "f", f }, { name: "g", f }], [], -10, 10, { roots: false, extrema: false }).length, 0);
  });

  test("the slope of a tangent", () => {
    close(slope(f, 3), 4, 1e-6);
  });
});
