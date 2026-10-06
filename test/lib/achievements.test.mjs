import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { achievementMetrics } from "../../js/lib/achievements.js";

describe("achievements.achievementMetrics", () => {
  test("the Högskoleprovet track counts prognoses, provpass and the old mini-mock, not practice runs", () => {
    const attempts = [
      { assignmentId: "hp-prognos", hp: true, hpPrognos: true, items: [] },
      { assignmentId: "hp-pass-verbal", hp: true, hpPass: "verbal", items: [] },
      { assignmentId: "hp-pass-kvant", hp: true, hpPass: "kvant", hpFull: "x1", items: [] },
      { assignmentId: "__hpmock__", hp: true, items: [] },
      { assignmentId: "hp-ova-xyz", hp: true, items: [] },
      { assignmentId: "lib-hp-2026v-ord", hp: true, items: [] },
    ];
    assert.equal(achievementMetrics({ attempts }).hp, 4);
  });
});
