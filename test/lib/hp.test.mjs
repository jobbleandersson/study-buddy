import "./helpers.mjs";
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import {
  NORM_TABLES, GENERIC_NORM, PART_MAX, partOf, normedScore, delprovEstimate,
  scoreBand, parseHpSetId, isHpSetId, attemptNormedTotal, rawByPart, buildHpPlan,
} from "../../js/lib/hp.js";
import { localDayKey, addDays } from "../../js/lib/activity.js";

// A test date `n` days from today, as the app keeps it: the student's local calendar day. Not
// toISOString(), whose UTC day is yesterday's between midnight and 02:00 in Sweden.
const inDays = (n) => addDays(localDayKey(), n);

describe("hp normering tables", () => {
  const tables = { ...NORM_TABLES, generic: GENERIC_NORM };

  for (const [id, table] of Object.entries(tables)) {
    test(`${id}: verbal and kvant tables are both length ${PART_MAX + 1} and monotonic non-decreasing`, () => {
      for (const half of ["verbal", "kvant"]) {
        const arr = table[half];
        assert.equal(arr.length, PART_MAX + 1);
        for (let i = 1; i < arr.length; i++) {
          assert.ok(arr[i] >= arr[i - 1], `${id}.${half}[${i}]=${arr[i]} < [${i - 1}]=${arr[i - 1]}`);
        }
        assert.ok(arr[0] >= 0 && arr[arr.length - 1] <= 2);
      }
    });
  }
});

describe("hp normering curve", () => {
  // Fitted to UHR's published tables for real sittings (see the note above NORM_TABLES in hp.js):
  // about 48 of 80 right is 1.0, about 64 is 1.5, about 77 is 2.0, and 31 is 0.5.
  const t = NORM_TABLES["2026v"];
  for (const half of ["verbal", "kvant"]) {
    test(`${half}: lands on the published anchor points`, () => {
      assert.equal(t[half][14], 0);
      assert.equal(t[half][31], 0.5);
      assert.equal(t[half][48], 1);
      assert.equal(t[half][64], 1.5);
      assert.equal(t[half][77], 2);
      assert.equal(t[half][80], 2);
    });
    test(`${half}: the middle of the scale is no longer generous (48 right is not 1.25)`, () => {
      assert.ok(t[half][47] <= 1 && t[half][49] >= 1 && t[half][49] <= 1.05);
      assert.ok(t[half][56] <= 1.3, `56 right gives ${t[half][56]}`);
      assert.ok(t[half][70] <= 1.85, `70 right gives ${t[half][70]}`);
    });
  }
  test("both halves share one curve (no per-test difficulty shift)", () => {
    assert.deepEqual(t.verbal, t.kvant);
  });
});

describe("hp.partOf", () => {
  test("classifies each delprov into verbal or kvant", () => {
    assert.equal(partOf("ord"), "verbal");
    assert.equal(partOf("las"), "verbal");
    assert.equal(partOf("mek"), "verbal");
    assert.equal(partOf("elf"), "verbal");
    assert.equal(partOf("xyz"), "kvant");
    assert.equal(partOf("kva"), "kvant");
    assert.equal(partOf("nog"), "kvant");
    assert.equal(partOf("dtk"), "kvant");
  });
});

describe("hp.normedScore", () => {
  test("a higher raw score never normalizes lower than a smaller raw score", () => {
    const low = normedScore({ verbalRaw: 10, verbalTotal: 20, kvantRaw: 10, kvantTotal: 20 });
    const high = normedScore({ verbalRaw: 18, verbalTotal: 20, kvantRaw: 18, kvantTotal: 20 });
    assert.ok(high.total >= low.total);
  });

  test("scoring only the verbal half returns kvant:null and marks the run estimated", () => {
    const out = normedScore({ verbalRaw: 15, verbalTotal: 20 });
    assert.equal(out.kvant, null);
    assert.ok(out.verbal != null);
    assert.equal(out.estimated, true);
  });

  test("an unknown testId falls back to the generic table and reports no testLabel", () => {
    const out = normedScore({ verbalRaw: 10, verbalTotal: 20, kvantRaw: 10, kvantTotal: 20, testId: "does-not-exist" });
    assert.equal(out.testLabel, null);
    assert.equal(out.estimated, true);
  });

  test("a known testId with both halves covered is not flagged estimated and carries its label", () => {
    const out = normedScore({ verbalRaw: 40, verbalTotal: 40, kvantRaw: 40, kvantTotal: 40, testId: "2026v" });
    assert.equal(out.estimated, false);
    assert.equal(out.testLabel, NORM_TABLES["2026v"].label);
  });

  test("total is the average of verbal and kvant when both are present", () => {
    const out = normedScore({ verbalRaw: 80, verbalTotal: 80, kvantRaw: 0, kvantTotal: 80, testId: "2026v" });
    assert.ok(Math.abs(out.total - (out.verbal + out.kvant) / 2) < 1e-9);
  });

  test("a zero-raw, zero-total run scores 0 without throwing", () => {
    const out = normedScore({});
    assert.equal(out.total, 0);
    assert.equal(out.verbal, null);
    assert.equal(out.kvant, null);
  });
});

describe("hp.delprovEstimate", () => {
  test("is capped at 1.8 even for a perfect small drill", () => {
    const out = delprovEstimate({ delprov: "ord", correct: 12, total: 12 });
    assert.ok(out.normed <= 1.8);
    assert.equal(out.estimated, true);
  });

  test("more correct answers never scores lower than fewer, for the same total", () => {
    const worse = delprovEstimate({ delprov: "xyz", correct: 2, total: 10 });
    const better = delprovEstimate({ delprov: "xyz", correct: 8, total: 10 });
    assert.ok(better.normed >= worse.normed);
  });

  test("zero total does not throw and returns the shrunk-to-0.5 midpoint", () => {
    const out = delprovEstimate({ delprov: "ord", correct: 0, total: 0 });
    assert.ok(Number.isFinite(out.normed));
  });
});

describe("hp.scoreBand", () => {
  test("bands increase monotonically with score and stay within the documented ranges", () => {
    assert.equal(scoreBand(0).key, "start");
    assert.equal(scoreBand(0.49).key, "start");
    assert.equal(scoreBand(0.5).key, "building");
    assert.equal(scoreBand(0.99).key, "building");
    assert.equal(scoreBand(1.0).key, "solid");
    assert.equal(scoreBand(1.39).key, "solid");
    assert.equal(scoreBand(1.4).key, "strong");
    assert.equal(scoreBand(1.79).key, "strong");
    assert.equal(scoreBand(1.8).key, "top");
    assert.equal(scoreBand(2.0).key, "top");
  });
});

describe("hp.parseHpSetId", () => {
  test("parses a dated set id into test + delprov", () => {
    assert.deepEqual(parseHpSetId("lib-hp-2026v-xyz"), { test: "2026v", delprov: "xyz" });
  });
  test("parses an undated bank id into delprov only", () => {
    assert.deepEqual(parseHpSetId("lib-hp-ord-bank-03"), { test: null, delprov: "ord" });
  });
  test("anything else parses to nulls", () => {
    assert.deepEqual(parseHpSetId("lib-algebra-1"), { test: null, delprov: null });
    assert.deepEqual(parseHpSetId(), { test: null, delprov: null });
  });
});

describe("hp.isHpSetId", () => {
  test("true only for lib-hp- prefixed ids", () => {
    assert.equal(isHpSetId("lib-hp-2026v-xyz"), true);
    assert.equal(isHpSetId("lib-algebra-1"), false);
    assert.equal(isHpSetId(""), false);
  });
});

describe("hp.attemptNormedTotal", () => {
  test("null when the attempt carries no hpParts", () => {
    assert.equal(attemptNormedTotal({}), null);
    assert.equal(attemptNormedTotal({ hpParts: { verbalTotal: 0, kvantTotal: 0 } }), null);
  });

  test("uses the real lookup when both halves are present", () => {
    const attempt = { hpParts: { verbalRaw: 40, verbalTotal: 40, kvantRaw: 40, kvantTotal: 40 } };
    assert.equal(attemptNormedTotal(attempt), normedScore(attempt.hpParts).total);
  });

  test("uses the shrunk delprov estimate for a single-half drill", () => {
    const attempt = { hpParts: { verbalRaw: 8, verbalTotal: 10, kvantTotal: 0 } };
    const expected = delprovEstimate({ delprov: "ord", correct: 8, total: 10 }).normed;
    assert.equal(attemptNormedTotal(attempt), expected);
  });
});

describe("hp.rawByPart", () => {
  test("splits first-try-only answers into verbal/kvant raw and total", () => {
    const items = [
      { questionId: "q1", correct: true }, // verbal, first try correct
      { questionId: "q2", correct: false }, // verbal, wrong
      { questionId: "q3", correct: true }, // kvant, correct
    ];
    const variantOf = (id) => ({ q1: "ord", q2: "las", q3: "xyz" }[id]);
    const out = rawByPart(items, variantOf);
    assert.deepEqual(out, { verbalRaw: 1, verbalTotal: 2, kvantRaw: 1, kvantTotal: 1 });
  });

  test("a retried (not-first-try) correct answer does not count as a raw point", () => {
    const items = [{ questionId: "q1", firstTry: false, correct: true }];
    const out = rawByPart(items, () => "ord");
    assert.deepEqual(out, { verbalRaw: 0, verbalTotal: 1, kvantRaw: 0, kvantTotal: 0 });
  });

  test("items with no known variant are skipped entirely", () => {
    const out = rawByPart([{ questionId: "unknown", correct: true }], () => null);
    assert.deepEqual(out, { verbalRaw: 0, verbalTotal: 0, kvantRaw: 0, kvantTotal: 0 });
  });
});

describe("hp.buildHpPlan", () => {
  test("null with no hpDate", () => {
    assert.equal(buildHpPlan({}), null);
  });

  test("produces one row per day up to and including the test day", () => {
    const rows = buildHpPlan({ hpDate: inDays(5), weakDelprov: ["ord"], dueCount: 3 });
    assert.ok(rows);
    assert.equal(rows.length, 6); // day 0..5 inclusive
    assert.equal(rows[rows.length - 1].kind, "testday");
  });

  test("opens with the quick prognosis once, then brings never-practised delprov in between the weak ones", () => {
    const rows = buildHpPlan({ hpDate: inDays(10), weakDelprov: ["xyz", "ord"], freshDelprov: ["las", "nog", "dtk"], prognosDone: false });
    assert.equal(rows[0].kind, "prognos");
    assert.equal(rows.filter((r) => r.kind === "prognos").length, 1);
    assert.deepEqual(rows.slice(1, 6).map((r) => `${r.kind}:${r.delprov}`),
      ["drill:xyz", "try:las", "drill:ord", "try:nog", "try:dtk"]);
  });

  test("a student who has practised nothing still gets every delprov, not only ORD", () => {
    const fresh = ["ord", "las", "mek", "elf", "xyz", "kva", "nog", "dtk"];
    const rows = buildHpPlan({ hpDate: inDays(12), freshDelprov: fresh, prognosDone: false });
    assert.deepEqual(new Set(rows.filter((r) => r.kind === "try").map((r) => r.delprov)), new Set(fresh));
    assert.ok(!rows.some((r) => r.kind === "ord"));
  });

  test("null when the test date is today, in the past, or more than 45 days out", () => {
    assert.equal(buildHpPlan({ hpDate: inDays(0) }), null);
    assert.equal(buildHpPlan({ hpDate: inDays(-3) }), null);
    assert.equal(buildHpPlan({ hpDate: inDays(46) }), null);
    assert.equal(buildHpPlan({ hpDate: inDays(45) }).length, 46);
  });

  test("half past midnight, the plan still starts today and ends on the test day", () => {
    mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 14, 0, 30) });
    try {
      const rows = buildHpPlan({ hpDate: "2026-10-18", weakDelprov: ["ord"] });
      assert.equal(rows.length, 5);
      assert.equal(rows[0].dayKey, "2026-10-14");
      assert.equal(rows.at(-1).dayKey, "2026-10-18");
      assert.equal(rows.at(-1).kind, "testday");
    } finally {
      mock.timers.reset();
    }
  });
});

import { minutesFor, pickPracticeIds, questionHistory, delprovStats, prognosisMargin, OPTION_COUNT, PASS_COUNT } from "../../js/lib/hp.js";

describe("hp practice helpers", () => {
  test("minutesFor follows the test's pace, longer with extended time", () => {
    assert.equal(minutesFor("xyz", 12), 12);          // 60 s a question
    assert.equal(minutesFor("ord", 10), 3);           // 18 s → 180 s
    assert.equal(minutesFor("xyz", 10, { extended: true }), 15);
    assert.equal(minutesFor("nog", 0), 1);
  });
  test("pickPracticeIds brings unseen, then missed, then the rest", () => {
    const history = { a: { correct: true }, b: { correct: false }, c: { correct: true } };
    const picked = pickPracticeIds(["a", "b", "c", "d"], 3, history, () => 0);
    assert.equal(picked[0], "d");
    assert.equal(picked[1], "b");
    assert.equal(picked.length, 3);
  });
  test("questionHistory keeps the latest result and whether it was timed", () => {
    const h = questionHistory([
      { finishedAt: 2, timeLimitMin: 10, items: [{ questionId: "q", correct: true, firstTry: true }] },
      { finishedAt: 1, items: [{ questionId: "q", correct: false }] },
    ]);
    assert.deepEqual(h.q, { correct: true, at: 2, timed: true });
  });
  test("delprovStats counts timed answers for calibration", () => {
    const s = delprovStats([
      { timeLimitMin: 5, items: [{ questionId: "x1", correct: true }, { questionId: "o1", correct: false }] },
      { items: [{ questionId: "x2", correct: true }] },
    ], (id) => (id.startsWith("x") ? "xyz" : "ord"));
    assert.deepEqual(s.xyz, { timed: 1, answered: 2, correct: 2 });
    assert.deepEqual(s.ord, { timed: 1, answered: 1, correct: 0 });
  });
  test("questions handed in blank count as wrong, like on the results screen", () => {
    const runs = [{ finishedAt: 1, timeLimitMin: 5, items: [{ questionId: "x1", correct: true }], unanswered: ["x2", "x3"] }];
    const variantOf = () => "xyz";
    assert.deepEqual(delprovStats(runs, variantOf).xyz, { timed: 3, answered: 3, correct: 1 });
    assert.equal(questionHistory(runs).x2.correct, false);
  });
  test("prognosisMargin narrows with more answers but never below 0.15", () => {
    assert.equal(prognosisMargin(0), 0.5);
    assert.equal(prognosisMargin(10), 0.5);
    assert.equal(prognosisMargin(40), 0.25);
    assert.equal(prognosisMargin(1000), 0.15);
  });
  test("the format tables cover all eight delprov", () => {
    for (const dp of ["ord", "las", "mek", "elf", "xyz", "kva", "nog", "dtk"]) {
      assert.ok(OPTION_COUNT[dp] >= 4 && PASS_COUNT[dp] > 0, dp);
    }
  });
});
