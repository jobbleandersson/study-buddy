import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fresh, fromCorrect, review, isDue, inReview, reviewWindowStart, REVIEW_WINDOW_DAYS, summarizeSchedule, retentionForecast } from "../../js/lib/srs.js";
import { dueQuestions } from "../../js/lib/library.js";

describe("srs.fromCorrect", () => {
  test("wrong answer is always 'again'", () => {
    assert.equal(fromCorrect(false, 0), "again");
    assert.equal(fromCorrect(false, 2), "again");
  });
  test("correct with no hints is 'easy'", () => {
    assert.equal(fromCorrect(true, 0), "easy");
  });
  test("correct with one hint is 'good'", () => {
    assert.equal(fromCorrect(true, 1), "good");
  });
  test("correct with 2+ hints is 'hard'", () => {
    assert.equal(fromCorrect(true, 2), "hard");
    assert.equal(fromCorrect(true, 5), "hard");
  });
});

describe("srs.review", () => {
  test("an 'again' grade resets reps and shrinks the interval to a 10-minute retry", () => {
    const now = 1_000_000;
    const rec = review({ ease: 2.4, intervalDays: 6, dueAt: 0, reps: 3, lapses: 0 }, "again", now);
    assert.equal(rec.reps, 0);
    assert.equal(rec.lapses, 1);
    assert.equal(rec.intervalDays, 0);
    assert.equal(rec.dueAt, now + 10 * 60 * 1000);
    assert.ok(rec.ease < 2.4, "ease should drop after a miss");
  });

  test("ease never drops below 1.3 no matter how many lapses", () => {
    let rec = fresh();
    for (let i = 0; i < 20; i++) rec = review(rec, "again");
    assert.ok(rec.ease >= 1.3);
  });

  test("ease never rises above 3.0 no matter how many easy reviews", () => {
    let rec = fresh();
    for (let i = 0; i < 50; i++) rec = review(rec, "easy");
    assert.ok(rec.ease <= 3.0);
  });

  test("interval grows on repeated 'good' reviews and is clamped to 365 days", () => {
    let rec = fresh();
    let prevInterval = -1;
    for (let i = 0; i < 40; i++) {
      rec = review(rec, "good");
      assert.ok(rec.intervalDays >= prevInterval || rec.intervalDays === 365);
      assert.ok(rec.intervalDays <= 365);
      prevInterval = rec.intervalDays;
    }
    assert.equal(rec.intervalDays, 365);
  });

  test("does not mutate the record it was given", () => {
    const rec = fresh();
    const before = { ...rec };
    review(rec, "good");
    assert.deepEqual(rec, before);
  });

  test("missing record starts from fresh()", () => {
    const rec = review(null, "good", 5000);
    assert.equal(rec.reps, 1);
  });
});

describe("srs.isDue", () => {
  test("no record is always due", () => {
    assert.equal(isDue(null), true);
  });
  test("due at or before now is due", () => {
    assert.equal(isDue({ dueAt: 100 }, 100), true);
    assert.equal(isDue({ dueAt: 100 }, 200), true);
  });
  test("due after now is not due", () => {
    assert.equal(isDue({ dueAt: 200 }, 100), false);
  });
});

describe("srs.inReview: the pile is a week deep", () => {
  const now = new Date(2026, 9, 13, 15, 0).getTime();          // Tue 13 Oct, 15:00 local
  const at = (day, h = 12) => new Date(2026, 9, day, h, 0).getTime();
  test("the window starts at local midnight six days back", () => {
    assert.equal(REVIEW_WINDOW_DAYS, 7);
    assert.equal(reviewWindowStart(now), new Date(2026, 9, 7, 0, 0).getTime());
  });
  test("came due today or in the six days before: in the pile", () => {
    assert.equal(inReview({ dueAt: at(13, 9) }, now), true);
    assert.equal(inReview({ dueAt: at(7, 0) }, now), true);
  });
  test("came due before that: dropped out", () => {
    assert.equal(inReview({ dueAt: at(6, 23) }, now), false);
    assert.equal(inReview({ dueAt: at(1) }, now), false);
  });
  test("not due yet, or no record: not in the pile", () => {
    assert.equal(inReview({ dueAt: at(14) }, now), false);
    assert.equal(inReview(null, now), false);
  });
  test("dueQuestions keeps only the pile, oldest first", () => {
    const sets = [{ id: "s", questions: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }];
    const srs = { a: { dueAt: at(12) }, b: { dueAt: at(2) }, c: { dueAt: at(9) }, d: { dueAt: at(15) } };
    assert.deepEqual(dueQuestions(sets, srs, now).map((x) => x.question.id), ["c", "a"]);
  });
});

describe("srs.summarizeSchedule", () => {
  const DAY = 86400000;
  test("splits relearn (interval 0) from scheduled reviews", () => {
    const now = 1_000_000;
    const srs = {
      a: { dueAt: now + 5 * 60 * 1000, intervalDays: 0, reps: 1, lapses: 1 },
      b: { dueAt: now + DAY, intervalDays: 1, reps: 2, lapses: 0 },
      c: { dueAt: now + 10 * DAY, intervalDays: 10, reps: 2, lapses: 0 },
    };
    const items = [{ questionId: "a" }, { questionId: "b" }, { questionId: "c" }, { questionId: "missing" }];
    const out = summarizeSchedule(items, srs, now);
    assert.equal(out.scheduled, 3);
    assert.equal(out.relearn, 1);
    assert.equal(out.soon + out.later, 2);
    assert.ok(out.nextRec, "nextRec should skip relearn-only items");
    assert.equal(out.nextRec.dueAt, srs.b.dueAt);
  });

  test("relearnOnly is true when every scheduled item is a same-day retry", () => {
    const now = 1_000_000;
    const srs = { a: { dueAt: now + 60_000, intervalDays: 0, reps: 0, lapses: 1 } };
    const out = summarizeSchedule([{ questionId: "a" }], srs, now);
    assert.equal(out.relearnOnly, true);
    assert.equal(out.nextRec, null);
  });
});

describe("srs.retentionForecast", () => {
  test("returns null with fewer than 3 scheduled items", () => {
    const srs = { a: { dueAt: 0, intervalDays: 5 }, b: { dueAt: 0, intervalDays: 5 } };
    assert.equal(retentionForecast([{ questionId: "a" }, { questionId: "b" }], srs), null);
  });

  test("held retention is never below the do-nothing decay estimate", () => {
    const now = 0;
    const srs = {
      a: { dueAt: now + 86400000, intervalDays: 4 },
      b: { dueAt: now + 2 * 86400000, intervalDays: 8 },
      c: { dueAt: now - 86400000, intervalDays: 2 },
    };
    const items = [{ questionId: "a" }, { questionId: "b" }, { questionId: "c" }];
    const out = retentionForecast(items, srs, { now });
    assert.ok(out.held >= out.decayed - 1e-9);
    assert.ok(out.held <= 1 && out.decayed <= 1);
  });
});
