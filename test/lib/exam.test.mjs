import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dayDiff, nextExam, upcomingExams, normalizeExam, examSetDates, examsFromMarkedSets, scopeAttempts,
  topicsOf, readiness, practisedSince, buildExamPlan, prepHashForSet, PLAN_MAX_DAYS,
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

const exam = (id, subjectId, date, setIds, extra = {}) => ({ id, subjectId, date, title: "", note: "", setIds, createdAt: 0, ...extra });

describe("exam.nextExam", () => {
  const today = "2026-09-30";
  const sets = [set("a", "ma"), set("b", "ma"), set("c", "ma"), set("e", "sv")];
  test("covers exactly the sets picked for it — never the rest of the subject", () => {
    const x = nextExam([exam("t1", "ma", "2026-10-05", ["a", "b"])], sets, "ma", today);
    assert.equal(x.date, "2026-10-05");
    assert.equal(x.days, 5);
    assert.deepEqual(x.sets.map((a) => a.id), ["a", "b"]);   // "c" is in the subject but not in the test
  });
  test("the soonest of a subject's tests; another subject's test is not its own", () => {
    const exams = [exam("late", "ma", "2026-11-01", ["c"]), exam("soon", "ma", "2026-10-05", ["a"]), exam("sv", "sv", "2026-10-02", ["e"])];
    assert.equal(nextExam(exams, sets, "ma", today).id, "soon");
    assert.equal(nextExam(exams, sets, "sv", today).id, "sv");
    assert.equal(nextExam(exams, sets, "en", today), null);
  });
  test("a set can be in two tests", () => {
    const exams = [exam("one", "ma", "2026-10-05", ["a"]), exam("two", "ma", "2026-10-20", ["a", "b"])];
    assert.deepEqual(upcomingExams(exams, sets, today).map((x) => [x.id, x.sets.length]), [["one", 1], ["two", 2]]);
  });
  test("a test today still counts; a past one doesn't", () => {
    assert.equal(nextExam([exam("t", "ma", today, ["a"])], sets, "ma", today).days, 0);
    assert.equal(nextExam([exam("t", "ma", "2026-09-29", ["a"])], sets, "ma", today), null);
  });
  test("a deleted set drops out of the test instead of failing", () => {
    assert.deepEqual(nextExam([exam("t", "ma", "2026-10-05", ["gone", "a"])], sets, "ma", today).sets.map((a) => a.id), ["a"]);
  });
});

describe("exam.upcomingExams", () => {
  test("soonest first, ties by when they were made", () => {
    const sets = [set("a", "ma"), set("c", "sv")];
    const exams = [
      exam("x", "ma", "2026-10-05", ["a"], { createdAt: 9 }),
      exam("y", "sv", "2026-10-02", ["c"]),
      exam("z", "ma", "2026-10-05", ["a"], { createdAt: 3 }),
    ];
    assert.deepEqual(upcomingExams(exams, sets, "2026-09-30").map((x) => x.id), ["y", "z", "x"]);
  });
});

describe("exam.normalizeExam", () => {
  test("keeps a good record, trims text, de-duplicates set ids", () => {
    const x = normalizeExam({ id: "t", subjectId: "ma", date: "2026-10-05", title: "  Prov 3 ", note: " kap 3–4 ", setIds: ["a", "a", "b", 7, ""] });
    assert.deepEqual(x, { id: "t", subjectId: "ma", date: "2026-10-05", title: "Prov 3", note: "kap 3–4", setIds: ["a", "b"], createdAt: 0 });
  });
  test("rejects what can't be a test", () => {
    for (const bad of [null, "x", {}, { id: "t", subjectId: "ma", date: "soon" }, { id: "", subjectId: "ma", date: "2026-10-05" }, { id: "t", date: "2026-10-05" }]) {
      assert.equal(normalizeExam(bad), null);
    }
  });
});

describe("exam.examSetDates", () => {
  test("a set in two coming tests gets the sooner date; past tests don't count", () => {
    const m = examSetDates([
      exam("one", "ma", "2026-10-20", ["a"]), exam("two", "ma", "2026-10-05", ["a", "b"]), exam("old", "ma", "2026-09-01", ["c"]),
    ], "2026-09-30");
    assert.deepEqual([...m], [["a", "2026-10-05"], ["b", "2026-10-05"]]);
  });
});

describe("exam.examsFromMarkedSets", () => {
  test("one test per subject and date, covering just the sets already marked", () => {
    let n = 0;
    const out = examsFromMarkedSets([
      set("a", "ma", { type: "test", dueAt: "2026-10-05" }),
      set("b", "ma", { type: "test", dueAt: "2026-10-05" }),
      set("c", "ma", { type: "test", dueAt: "2026-11-01" }),
      set("d", "ma", { dueAt: "2026-10-05" }),               // a deadline, not a test
      set("e", "ma"),                                        // untouched subject set — not swept in
      set("f", "sv", { type: "test", dueAt: "2026-10-05" }),
    ], () => `id${++n}`);
    assert.deepEqual(out.map((x) => [x.subjectId, x.date, x.setIds]), [
      ["ma", "2026-10-05", ["a", "b"]], ["ma", "2026-11-01", ["c"]], ["sv", "2026-10-05", ["f"]],
    ]);
    assert.deepEqual(out.map((x) => x.id), ["id1", "id2", "id3"]);
  });
});

describe("exam.scopeAttempts", () => {
  const sets = [set("a", "ma")];
  const attempts = [
    { id: "1", finishedAt: 1, items: [{ questionId: "a-q1", topic: "a-a" }, { questionId: "other-q", topic: "a-a" }] },
    { id: "2", finishedAt: 2, items: [{ questionId: "other-q", topic: "a-a" }] },
  ];
  test("keeps only the answers to the test's own questions, and drops attempts with none", () => {
    const out = scopeAttempts(attempts, sets);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].items.map((i) => i.questionId), ["a-q1"]);
  });
  test("practice on the same topic in another set does not count", () => {
    assert.deepEqual(scopeAttempts([attempts[1]], sets), []);
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
  test("unopened sets first, then weak topics; evening and test at the end", () => {
    const rows = buildExamPlan({ days: 6, today, untouched: [a], weakTopics: ["x"], softest: [b] });
    assert.deepEqual(rows.map((r) => r.kind), ["start", "drill", "practice", "practice", "drill", "tonight", "testday"]);
    assert.deepEqual([rows[2].set.id, rows[3].set.id], ["b", "a"]);
    assert.equal(rows[0].dayKey, today);
    assert.equal(rows[6].dayKey, "2026-10-06");
  });
  test("a mock two days out once every set has been opened", () => {
    const kinds = buildExamPlan({ days: 6, today, weakTopics: ["x"], softest: [b] }).map((r) => r.kind);
    assert.deepEqual(kinds, ["drill", "practice", "drill", "practice", "mock", "tonight", "testday"]);
  });
  test("no mock while a set is still unopened — open it first", () => {
    const kinds = buildExamPlan({ days: 2, today, untouched: [a] }).map((r) => r.kind);
    assert.deepEqual(kinds, ["start", "tonight", "testday"]);
  });
  test("a new set is started once, then practised", () => {
    const kinds = buildExamPlan({ days: 6, today, untouched: [a] }).map((r) => r.kind);
    assert.deepEqual(kinds, ["start", "practice", "practice", "practice", "practice", "tonight", "testday"]);
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

describe("exam.prepHashForSet", () => {
  const a = set("a", "ma", { type: "test", dueAt: "2026-10-05" });
  test("goes to the test that covers the set, preferring the one on its date", () => {
    const exams = [exam("later", "ma", "2026-11-01", ["a"]), exam("on-date", "ma", "2026-10-05", ["a"])];
    assert.equal(prepHashForSet(exams, a), "#/exam-prep/on-date");
  });
  test("with no test, opens the subject with the set and date ready to fill in", () => {
    assert.equal(prepHashForSet([], a), "#/exam-prep/ma?date=2026-10-05&set=a");
  });
});
