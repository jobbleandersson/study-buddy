import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dayDiff, nextExam, upcomingExams, normalizeExam, examSetDates, examsFromMarkedSets, scopeAttempts,
  topicsOf, readiness, practisedSince, buildExamPlan, prepHashForSet, pickSeedQuestions, newQuestionsOnly, PLAN_MAX_DAYS,
  planStartSets, MAX_SETS_PER_DAY, PLAN_MINUTES, distributeSets, questionsForMinutes, mockCountFor, buildStudyPass, pickMockQuestions,
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
    assert.deepEqual(x, { id: "t", subjectId: "ma", date: "2026-10-05", title: "Prov 3", note: "kap 3–4", setIds: ["a", "b"], createdAt: 0, updatedAt: 0 });
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
  test("unopened sets first, then weak topics; mock, evening and test at the end", () => {
    const rows = buildExamPlan({ days: 6, today, untouched: [a], weakTopics: ["x"], softest: [b] });
    assert.deepEqual(rows.map((r) => r.kind), ["start", "drill", "practice", "practice", "mock", "tonight", "testday"]);
    assert.deepEqual([rows[2].set.id, rows[3].set.id], ["b", "a"]);
    assert.equal(rows[0].dayKey, today);
    assert.equal(rows[6].dayKey, "2026-10-06");
  });
  test("a mock two days out once every set has been opened", () => {
    const kinds = buildExamPlan({ days: 6, today, weakTopics: ["x"], softest: [b] }).map((r) => r.kind);
    assert.deepEqual(kinds, ["drill", "practice", "drill", "practice", "mock", "tonight", "testday"]);
  });
  test("no mock when a new set only fits on the day the mock would take — open it first", () => {
    const kinds = buildExamPlan({ days: 2, today, untouched: [a] }).map((r) => r.kind);
    assert.deepEqual(kinds, ["start", "tonight", "testday"]);
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

  const five = ["s1", "s2", "s3", "s4", "s5"].map((id) => set(id, "hi"));
  test("five sets in three days: every set gets a day, two a day, the evening before carries the last", () => {
    const rows = buildExamPlan({ days: 3, today, untouched: five });
    assert.deepEqual(rows.map((r) => r.tasks.map((t) => t.kind)), [
      ["start", "start"], ["start", "start"], ["start", "tonight"], ["testday"],
    ]);
    assert.deepEqual(planStartSets(rows).map((x) => x.set.id), ["s1", "s2", "s3", "s4", "s5"]);
    assert.deepEqual(planStartSets(rows).map((x) => x.dayOffset), [0, 0, 1, 1, 2]);
  });
  test("more sets than days can hold: a day never asks for more than the cap, and the rest are left out", () => {
    const ten = Array.from({ length: 10 }, (_, i) => set("t" + i, "hi"));
    const rows = buildExamPlan({ days: 2, today, untouched: ten });
    assert.ok(rows.every((r) => r.tasks.filter((t) => t.kind === "start").length <= MAX_SETS_PER_DAY));
    assert.equal(planStartSets(rows).length, 2 * MAX_SETS_PER_DAY);
  });
  test("a row carries its first task's fields and the day's total minutes", () => {
    const rows = buildExamPlan({ days: 3, today, untouched: five });
    assert.equal(rows[0].kind, rows[0].tasks[0].kind);
    assert.equal(rows[0].set.id, "s1");
    assert.equal(rows[0].minutes, rows[0].tasks.reduce((n, t) => n + t.minutes, 0));
    assert.equal(rows[2].minutes, PLAN_MINUTES.start + PLAN_MINUTES.tonight);
  });
  test("sets finished today stay on today and lighten the coming days", () => {
    const rows = buildExamPlan({ days: 3, today, untouched: five.slice(2), doneToday: five.slice(0, 2) });
    assert.deepEqual(rows[0].tasks.map((t) => t.set?.id), ["s1", "s2"]);       // today's share is already done
    assert.deepEqual(planStartSets(rows).map((x) => x.set.id), ["s1", "s2", "s3", "s4", "s5"]);
    const ahead = buildExamPlan({ days: 3, today, untouched: five.slice(4), doneToday: five.slice(0, 4) });
    assert.deepEqual(ahead[0].tasks.map((t) => t.set?.id), ["s1", "s2", "s3", "s4"]);   // ahead of the plan: nothing added today
    assert.deepEqual(planStartSets(ahead).map((x) => x.dayOffset), [0, 0, 0, 0, 1]);
  });
  test("with room, the new sets go before the mock and the mock keeps its day", () => {
    const rows = buildExamPlan({ days: 4, today, untouched: [a, b] });
    assert.deepEqual(rows.map((r) => r.tasks.map((t) => t.kind)), [["start"], ["start"], ["mock"], ["tonight"], ["testday"]]);
  });
});

describe("exam.distributeSets", () => {
  test("spreads evenly with the earliest days taking the extra", () => {
    assert.deepEqual(distributeSets(5, 3), { counts: [2, 2, 1], uncovered: 0 });
    assert.deepEqual(distributeSets(2, 4), { counts: [1, 1, 0, 0], uncovered: 0 });
    assert.deepEqual(distributeSets(0, 3), { counts: [0, 0, 0], uncovered: 0 });
  });
  test("never over the cap; what doesn't fit is reported", () => {
    assert.deepEqual(distributeSets(10, 2, 3), { counts: [3, 3], uncovered: 4 });
    assert.deepEqual(distributeSets(3, 0), { counts: [], uncovered: 3 });
  });
});

describe("exam time sizing", () => {
  test("a pass holds about a question every minute and a half", () => {
    assert.equal(questionsForMinutes(15), 10);
    assert.equal(questionsForMinutes(30), 20);
    assert.equal(questionsForMinutes(60), 40);
    assert.equal(questionsForMinutes(1), 5);
  });
  test("a mock asks more questions the longer it is", () => {
    assert.deepEqual([20, 40, 60].map(mockCountFor), [10, 20, 30]);
    assert.equal(mockCountFor(90), 45);
  });
});

const seededRng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const qset = (id) => ({ id, questions: [0, 1, 2].map((i) => ({ id: `${id}${i}`, topic: id })) });
const answered = (id, at, ok = true) => ({ questionId: id, firstTry: ok });

describe("exam.buildStudyPass", () => {
  const sets = [qset("A"), qset("B")];
  const attempts = [
    { finishedAt: 100, items: [answered("A0", 100, true)] },
    { finishedAt: 300, items: [answered("A1", 300, false)] },
  ];
  const srs = { A0: { dueAt: 50 } };
  test("new questions first, then wrong ones, then reviews that are due", () => {
    const out = buildStudyPass({ sets, attempts, srs, n: 6, now: 1000, rng: seededRng(1) });
    assert.deepEqual([...out.slice(0, 4)].sort(), ["A2", "B0", "B1", "B2"]);
    assert.deepEqual(out.slice(4), ["A1", "A0"]);
  });
  test("a short pass takes the most useful questions and stays inside the cap", () => {
    const out = buildStudyPass({ sets, attempts, srs, n: 3, now: 1000, rng: seededRng(2) });
    assert.equal(out.length, 3);
    assert.ok(out.every((id) => ["A2", "B0", "B1", "B2"].includes(id)));
  });
  test("mixes the sets instead of finishing one first", () => {
    const out = buildStudyPass({ sets: [qset("A"), qset("B")], attempts: [], srs: {}, n: 4, now: 1000, rng: seededRng(3) });
    assert.deepEqual([...new Set(out.map((id) => id[0]))].sort(), ["A", "B"]);
    assert.equal(new Set(out.slice(0, 2).map((id) => id[0])).size, 2);
  });
  test("no more questions than exist, and none twice", () => {
    const out = buildStudyPass({ sets, attempts, srs, n: 100, now: 1000 });
    assert.equal(out.length, 6);
    assert.equal(new Set(out).size, 6);
  });
});

describe("exam.pickMockQuestions", () => {
  const sets = [qset("A"), qset("B")];
  const attempts = [{ finishedAt: 100, items: [answered("B0", 100)] }, { finishedAt: 200, items: [answered("B1", 200)] }];
  test("never-answered questions come first, then the ones answered longest ago", () => {
    const four = pickMockQuestions({ sets, attempts, count: 4, rng: seededRng(4) });
    assert.deepEqual([...four].sort(), ["A0", "A1", "A2", "B2"]);
    const five = pickMockQuestions({ sets, attempts, count: 5, rng: seededRng(4) });
    assert.ok(five.includes("B0") && !five.includes("B1"));
  });
  test("asks only for what exists", () => {
    assert.equal(pickMockQuestions({ sets, attempts, count: 99 }).length, 6);
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

describe("exam.pickSeedQuestions", () => {
  const mk = (id, n) => ({ id, questions: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, kind: "text", topic: id, prompt: `${id} ${i}`, answer: "a", extra: "dropped" })) });
  test("takes from every set round-robin, up to the cap, and keeps only what the generator needs", () => {
    const out = pickSeedQuestions([mk("a", 10), mk("b", 2)], 6, () => 0.5);
    assert.equal(out.length, 6);
    assert.equal(out.filter((q) => q.topic === "b").length, 2);   // the small set is represented, not drowned out
    assert.equal(out.filter((q) => q.topic === "a").length, 4);
    assert.ok(out.every((q) => !("extra" in q) && !("id" in q)));
  });
  test("fewer questions than the cap gives them all; no sets gives none", () => {
    assert.equal(pickSeedQuestions([mk("a", 3)], 14).length, 3);
    assert.deepEqual(pickSeedQuestions([], 14), []);
    assert.deepEqual(pickSeedQuestions(undefined), []);
  });
});

describe("exam.newQuestionsOnly", () => {
  const sets = [{ id: "a", questions: [{ prompt: "Vad är Sveriges huvudstad?" }] }];
  test("drops a question already in the sets (ignoring case and punctuation) and repeats within the batch", () => {
    const out = newQuestionsOnly([
      { prompt: "vad är sveriges huvudstad" }, { prompt: "Nytt?" }, { prompt: "nytt" }, { prompt: "" }, { prompt: "Annat" },
    ], sets);
    assert.deepEqual(out.map((q) => q.prompt), ["Nytt?", "Annat"]);
  });
});
