import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compactAttempts, answeredCount, rightCount, KEEP_FULL } from "../../js/lib/history.js";
import { setProgress, masteryByTopic } from "../../js/lib/mastery.js";
import { mergeStates } from "../../js/lib/merge-state.js";

const set = { id: "s1", subjectId: "ma", questions: [{ id: "q1", topic: "t" }, { id: "q2", topic: "t" }] };
const hpSet = { id: "lib-hp-2026v-ord", subjectId: "hp", questions: [{ id: "h1", topic: "ord" }] };
const attempt = (i, items, extra = {}) => ({ id: `a${i}`, assignmentId: "s1", finishedAt: 1000 + i, scorePct: 50, items, ...extra });

function stateWith(n) {
  const attempts = [];
  for (let i = 0; i < n; i++) attempts.push(attempt(i, [{ questionId: "q1", topic: "t", correct: i % 2 === 0, firstTry: i % 2 === 0 }, { questionId: "q2", topic: "t", correct: true }]));
  return { assignments: [set, hpSet], attempts };
}

describe("history.compactAttempts", () => {
  test("keeps the newest 300 in full and shortens the rest to a summary", () => {
    const s = stateWith(KEEP_FULL + 5);
    assert.equal(compactAttempts(s), 5);
    const shortened = s.attempts.filter((a) => a.compact);
    assert.equal(shortened.length, 5);
    assert.deepEqual(shortened.map((a) => a.id), ["a0", "a1", "a2", "a3", "a4"], "the oldest ones");
    for (const a of shortened) {
      assert.equal(a.items, undefined);
      assert.equal(a.answered, 2);
      assert.deepEqual(a.subjects, ["ma"]);
      assert.equal(a.scorePct, 50, "score, date and set are kept");
    }
    assert.equal(s.attempts.filter((a) => Array.isArray(a.items)).length, KEEP_FULL);
  });

  test("is a no-op at or under the limit, and idempotent", () => {
    const s = stateWith(KEEP_FULL);
    assert.equal(compactAttempts(s), 0);
    const t = stateWith(KEEP_FULL + 2);
    compactAttempts(t);
    const once = JSON.stringify(t);
    assert.equal(compactAttempts(t), 0);
    assert.equal(JSON.stringify(t), once);
  });

  test("each question's latest result moves to lastAnswers", () => {
    const s = stateWith(KEEP_FULL + 3);   // a0..a2 shortened; a2 is the latest of them: q1 right (2 % 2 === 0)
    compactAttempts(s);
    assert.deepEqual(s.lastAnswers.q1, [1002, 1]);
    assert.deepEqual(s.lastAnswers.q2, [1002, 1]);
  });

  test("Högskoleprov attempts, and any attempt with an HP question, stay whole", () => {
    const s = stateWith(KEEP_FULL + 2);
    s.attempts.unshift(
      { id: "hp1", assignmentId: "lib-hp-2026v-ord", hp: true, finishedAt: 1, items: [{ questionId: "h1", correct: true }] },
      { id: "rev", assignmentId: "__review__", isReview: true, finishedAt: 2, items: [{ questionId: "h1", correct: false }] },
    );
    compactAttempts(s);
    assert.ok(Array.isArray(s.attempts.find((a) => a.id === "hp1").items));
    assert.ok(Array.isArray(s.attempts.find((a) => a.id === "rev").items));
  });

  test("statistics read the summary: counts and right answers", () => {
    const s = stateWith(KEEP_FULL + 1);
    const before = s.attempts.reduce((n, a) => n + answeredCount(a), 0);
    const rightBefore = s.attempts.reduce((n, a) => n + rightCount(a), 0);
    compactAttempts(s);
    assert.equal(s.attempts.reduce((n, a) => n + answeredCount(a), 0), before);
    assert.equal(s.attempts.reduce((n, a) => n + rightCount(a), 0), rightBefore);
  });

  test("set progress (known / seen) is unchanged by shortening", () => {
    const s = { assignments: [set], attempts: [attempt(0, [{ questionId: "q1", correct: true }, { questionId: "q2", correct: true }])] };
    for (let i = 1; i <= KEEP_FULL; i++) s.attempts.push({ id: `o${i}`, assignmentId: "other", finishedAt: 5000 + i, items: [{ questionId: "x", correct: true }] });
    const before = setProgress(set, s.attempts, masteryByTopic(s.attempts, { assignments: s.assignments }));
    compactAttempts(s);
    assert.equal(s.attempts[0].compact, true, "the set's only attempt was shortened");
    const after = setProgress(set, s.attempts, masteryByTopic(s.attempts, { assignments: s.assignments }), { lastAnswers: s.lastAnswers });
    assert.deepEqual([after.known, after.seen, after.total], [before.known, before.seen, before.total]);
  });
});

describe("mergeStates: lastAnswers", () => {
  test("per question, the later answer wins, from either side", () => {
    const m = mergeStates(
      { attempts: [], assignments: [], lastAnswers: { q1: [10, 0], q2: [30, 1] } },
      { attempts: [], assignments: [], lastAnswers: { q1: [20, 1], q2: [5, 0], q3: [7, 1] } },
    );
    assert.deepEqual(m.lastAnswers, { q1: [20, 1], q2: [30, 1], q3: [7, 1] });
  });
});
