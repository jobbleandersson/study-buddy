import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { stableChoices, keepsChoiceOrder } from "../../js/lib/choices.js";

const q = { id: "q-1", kind: "mc", prompt: "?", choices: ["rätt", "fel 1", "fel 2", "fel 3"], answer: 0, explanation: "För att." };

describe("a fixed shuffled order for print sheets and practice pages", () => {
  test("the same question always gets the same order, and the answer follows its option", () => {
    const a = stableChoices(q), b = stableChoices({ ...q });
    assert.deepEqual(a, b);
    assert.equal(a.choices[a.answer], "rätt");
    assert.deepEqual([...a.choices].sort(), [...q.choices].sort());
  });

  test("the stored question is left as it was", () => {
    stableChoices(q);
    assert.deepEqual(q.choices, ["rätt", "fel 1", "fel 2", "fel 3"]);
    assert.equal(q.answer, 0);
  });

  test("questions that need their order keep it", () => {
    for (const k of [
      { ...q, variant: "kva" },
      { ...q, figure: { src: "a.png" } },
      { ...q, choices: ["1", "2", "Alla ovanstående"] },
      { ...q, explanation: "Alternativ B är rätt." },
    ]) {
      assert.equal(keepsChoiceOrder(k), true);
      assert.deepEqual(stableChoices(k), { choices: k.choices, answer: k.answer });
    }
  });

  test("anything but a multiple-choice question passes through", () => {
    const text = { id: "t", kind: "text", answer: "svar" };
    assert.deepEqual(stableChoices(text), { choices: undefined, answer: "svar" });
  });

  test("across the real library, A is no longer the right answer half the time", () => {
    const dir = new URL("../../data/library/", import.meta.url);
    const at = [0, 0, 0, 0, 0, 0]; let n = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "index.json" || f.startsWith("hp-")) continue;
      for (const x of JSON.parse(fs.readFileSync(new URL(f, dir), "utf8")).questions || []) {
        if (x.kind !== "mc" || keepsChoiceOrder(x)) continue;
        at[stableChoices(x).answer]++; n++;
      }
    }
    assert.ok(n > 3000, `${n} questions`);
    assert.ok(at[0] / n < 0.3, `A is right on ${(100 * at[0] / n).toFixed(1)}%`);
  });
});
