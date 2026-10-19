import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costKr, KR_PER_USD } from "../../js/lib/ai-price.js";
import { budgetShare } from "../../js/lib/check.js";

describe("costKr", () => {
  test("prices a request in kronor from the model's dollar rates", () => {
    assert.equal(KR_PER_USD, 10);
    // Haiku 5.5: $0.10 in, $0.50 out per million. 1,000,000 in + 1,000,000 out = $0.60 = 6 kr
    assert.ok(Math.abs(costKr("claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6 }) - 6) < 1e-9);
    // Sonnet 5: $2 and $10: 100,000 in + 10,000 out = $0.30 = 3 kr
    assert.ok(Math.abs(costKr("claude-sonnet-5", { input_tokens: 100_000, output_tokens: 10_000 }) - 3) < 1e-9);
  });
  test("an unknown model is priced as the dearer one, and missing usage costs nothing", () => {
    assert.ok(Math.abs(costKr("some-new-model", { input_tokens: 1e6, output_tokens: 0 }) - 20) < 1e-9);
    assert.equal(costKr("claude-haiku-5-5", undefined), 0);
  });
});

describe("budgetShare in kronor", () => {
  test("a 0.05 kr check against a 2 kr limit is about 1 in 40", () => {
    assert.equal(budgetShare(0.05, 2), 40);
    assert.equal(budgetShare(0, 2), null);
    assert.equal(budgetShare(0.05, undefined), null);
  });
});
