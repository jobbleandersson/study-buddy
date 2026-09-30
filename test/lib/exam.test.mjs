import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dayDiff, nextExam, upcomingExams, topicsOf, readiness, practisedSince, buildExamPlan, PLAN_MAX_DAYS,
} from "../../js/lib/exam.js";

const set = (id, subjectId, extra = {}) => ({
  id, subjectId, type: "assignment", dueAt: null,
  questions: [{ id: `${id}-q1`, topic: `${id}-a` }, { id: `${id}-q2`, topic: `${id}-b` }],
  ...extra,
});

describe("exam.dayDiff", () => {
  test("counts whole days, across a month end", () => {
    assert.equal(dayDiff("2026-09-30", "2026-10-02"), 2);
    assert.equal(dayDiff("2026-10-02", "2026-09-30"), -2);
    assert.equal(dayDiff("2026-09-30", "2026-09-30"), 0);
  });
  test("ignores daylight-saving shifts", () => {
    assert.equal(dayDiff("2026-10-24", "2026-10-26"), 2); // EU clocks go back on the 25th
  });
});

describe("exam.nextExam", () => {
  const today = "2026-09-30";
  test("groups every test set on the soonest date", () => {
    const list = [
      set("a", "ma", { type: "test", dueAt: "2026-10-05" }),
      set("b", "ma", { type: "test", dueAt: "2026-10-05" }),
      set("c", "ma", { type: "test", dueAt: "2026-11-01" }),
      set("d", "ma", { dueAt: "2026-10-01" }),            // a deadline, not a test
      set("e", "sv", { type: "test", dueAt: "2026-10-02" }), // another subject
    ];
    const x = nextExam(list, "ma", today);
    assert.equal(x.date, "2026-10-05");
    assert.equal(x.days, 5);
    assert.deepEqual(x.sets.map((a) => a.id), ["a", "b"]);
  });
  test("a test today still counts; a past one doesn't", () => {
    assert.equal(nextExam([set("a", "ma", { type: "test", dueAt: today })], "ma", today).days, 0);
    assert.equal(nextExam([set("a", "ma", { type: "test", dueAt: "2026-09-29" })], "ma", today), null);
  });
});

describe("exam.upcomingExams", () => {
  test("one entry per subject, soonest first", () => {
    const list = [
      set("a", "ma", { type: "test", dueAt: "2026-10-05" }),
      set("b", "ma", { type: "test", dueAt: "2026-10-05" }),
      set("c", "sv", { type: "test", dueAt: "2026-10-02" }),
    ];
    assert.deepEqual(upcomingExams(list, "2026-09-30").map((x) => [x.subjectId, x.sets.length]), [["sv", 1], ["ma", 2]]);
  });
});

describe("exam.readiness", () => {
  test("an untouched topic counts as 0, not as missing", () => {
    const r = readiness([set("a", "ma")], { "a-a": 1 });
    assert.deepEqual(r, { pct: 50, topics: 2, seen: 1 });
  });
  test("topics are shared across sets, counted once", () => {
    const a = set("a", "ma");
    const b = { ...set("b", "ma"), questions: [{ id: "b-q1", topic: "a-a" }] };
    assert.deepEqual(topicsOf([a, b]), ["a-a", "a-b"]);
  });
  test("null when the sets carry no topics", () => {
    assert.equal(readiness([{ id: "x", questions: [{ id: "q" }] }], {}).pct, null);
  });
});

describe("exam.practisedSince", () => {
  const sets = [set("a", "ma")];
  test("true only for an attempt after the cut-off that touched these sets", () => {
    const att = (at, qid) => ({ finishedAt: at, items: [{ questionId: qid }] });
    assert.equal(practisedSince([att(200, "a-q1")], sets, 100), true);
    assert.equal(practisedSince([att(50, "a-q1")], sets, 100), false);
    assert.equal(practisedSince([att(200, "zz")], sets, 100), false);
  });
});

describe("exam.buildExamPlan", () => {
  const today = "2026-09-30";
  const a = set("a", "ma"), b = set("b", "ma");
  test("unopened sets first, then weak topics; fixed mock / evening / test at the end", () => {
    const rows = buildExamPlan({ days: 6, today, untouched: [a], weakTopics: ["x"], softest: [b] });
    assert.deepEqual(rows.map((r) => r.kind), ["start", "drill", "practice", "practice", "mock", "tonight", "testday"]);
    assert.deepEqual([rows[2].set.id, rows[3].set.id], ["b", "a"]);
    assert.equal(rows[0].dayKey, today);
    assert.equal(rows[6].dayKey, "2026-10-06");
  });
  test("a new set is started once, then practised", () => {
    const kinds = buildExamPlan({ days: 6, today, untouched: [a] }).map((r) => r.kind);
    assert.deepEqual(kinds, ["start", "practice", "practice", "practice", "mock", "tonight", "testday"]);
  });
  test("the day before is the evening plan, even with only one day left", () => {
    assert.deepEqual(buildExamPlan({ days: 1, today, softest: [a] }).map((r) => r.kind), ["tonight", "testday"]);
  });
  test("no mock when there aren't enough questions", () => {
    const kinds = buildExamPlan({ days: 3, today, softest: [a], canMock: false }).map((r) => r.kind);
    assert.ok(!kinds.includes("mock"));
  });
  test("null on test day, too far out, or with nothing to practise", () => {
    assert.equal(buildExamPlan({ days: 0, today, softest: [a] }), null);
    assert.equal(buildExamPlan({ days: PLAN_MAX_DAYS + 1, today, softest: [a] }), null);
    assert.equal(buildExamPlan({ days: 5, today }), null);
  });
});
