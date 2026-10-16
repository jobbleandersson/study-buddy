import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { choicesDependOnOrder, explanationNamesOptions, shuffledIndexes, shuffleMc } from "../../js/lib/choices.js";

// A tiny seeded generator, so these never flake.
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

describe("choices.choicesDependOnOrder", () => {
  test("options that point at the others are order-dependent", () => {
    for (const set of [
      ["Fel", "Rätt", "Alla ovanstående"], ["1", "2", "Både A och B"], ["x", "y", "None of the above"],
      ["a", "b", "All of the above"], ["x", "Alternativ B och C", "z"], ["Inget av alternativen", "ett", "två"],
      ["A and B", "C", "D"], ["x", "y", "see the options below"],
    ]) assert.equal(choicesDependOnOrder(set), true, set.join(" | "));
  });
  test("ordinary options are not", () => {
    for (const set of [["Stockholm", "Oslo", "Helsingfors"], ["2x + 3", "x + 5", "5x"], ["Vitamin D", "Järn", "Kalcium"], []]) {
      assert.equal(choicesDependOnOrder(set), false, set.join(" | "));
    }
  });
});

describe("choices.explanationNamesOptions", () => {
  const says = (explanation, extra = {}) => explanationNamesOptions({ explanation, ...extra });
  test("an explanation that points at an option by letter or position is caught", () => {
    for (const e of [
      "Svar C visar bara mellansteget.", "Att välja negativa tal (svar B) blandar ihop tecknet.", "Alternativ 2 fångar balansen; 3 och 4 är för tvärsäkra.",
      "Det första alternativet är precis missuppfattningen.", "De två första alternativen med som är liknelser.", "Både det första och det andra alternativet är för tvärsäkra.",
      "Det fångar rubrik 2.", "Answer B mixes up the signs.", "Option C ($0.92$) is the change factor for a decrease.", "The last option isn't even a question.",
      "Answers C and D only take out x.", "Please compare option A with the text.",
    ]) assert.equal(says(e), true, e);
  });
  test("the opener and the steps count too", () => {
    assert.equal(explanationNamesOptions({ explanation: "Rätt.", opener: "Titta på alternativ B." }), true);
    assert.equal(explanationNamesOptions({ explanation: "Rätt.", steps: ["Steg ett", "Svar C är fel"] }), true);
  });
  test("numbers that are values, lower-case letters and ordinary prose are not", () => {
    for (const e of [
      "Svaret 5 är differensen men med fel tecken.", "Svaret 2 460 är avrundning till närmaste tiotal.", "Meningen börjar med stor bokstav.", "Ny mening börjar alltid med versal.",
      "Texten säger att svar a väntar.", "The first sentence of the text sets the scene.", "Hon valde alternativ vägar.", "Use the second law of thermodynamics.", "", undefined,
    ]) assert.equal(says(e), false, String(e));
  });
});

describe("choices.shuffleMc", () => {
  const q = { choices: ["rätt", "fel 1", "fel 2", "fel 3"], answer: 0 };
  test("the answer index follows the correct option", () => {
    for (let s = 1; s <= 40; s++) {
      const out = shuffleMc(q, seeded(s));
      assert.deepEqual([...out.choices].sort(), [...q.choices].sort());
      assert.equal(out.choices[out.answer], "rätt");
    }
  });
  test("the correct option no longer always comes first", () => {
    const spots = new Set();
    for (let s = 1; s <= 60; s++) spots.add(shuffleMc(q, seeded(s)).answer);
    assert.deepEqual([...spots].sort(), [0, 1, 2, 3]);
  });
  test("a question whose explanation names an option by letter keeps its order", () => {
    const named = { choices: ["rätt", "fel 1", "fel 2", "fel 3"], answer: 0, explanation: "Svar B är vanligt misstag." };
    assert.deepEqual(shuffleMc(named, seeded(1)), { choices: named.choices, answer: 0 });
    const plain = { ...named, explanation: "Svaret är rätt eftersom reglerna säger det." };
    assert.notDeepEqual(shuffleMc(plain, seeded(7)).choices, plain.choices);
  });
  test("order-dependent and malformed questions come back untouched", () => {
    const dep = { choices: ["a", "b", "Alla ovanstående"], answer: 2 };
    assert.deepEqual(shuffleMc(dep, seeded(1)), dep);
    assert.deepEqual(shuffleMc({ choices: ["only"], answer: 0 }), { choices: ["only"], answer: 0 });
    assert.deepEqual(shuffleMc({ choices: ["a", "b"], answer: 5 }), { choices: ["a", "b"], answer: 5 });
    assert.deepEqual(shuffleMc({ choices: undefined, answer: 0 }), { choices: undefined, answer: 0 });
  });
});

describe("choices.shuffledIndexes", () => {
  test("is a permutation", () => {
    assert.deepEqual(shuffledIndexes(5, seeded(3)).sort(), [0, 1, 2, 3, 4]);
    assert.deepEqual(shuffledIndexes(0), []);
  });
});
