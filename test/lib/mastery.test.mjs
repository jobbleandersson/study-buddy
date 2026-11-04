import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  firstTryCorrect, masteryByTopic, masteryForSubject, masteryForAssignment,
  deltaFromAttempt, setProgress, weakSpotQuestions, topicKey,
} from "../../js/lib/mastery.js";

describe("mastery: topics are kept per subject (sweep finding L4)", () => {
  // "present tense" exists in both the Spanish and the French set; a miss in Spanish must not make French weak.
  const es = { id: "es", subjectId: "spanska", questions: [{ id: "es1", topic: "present tense" }] };
  const fr = { id: "fr", subjectId: "franska", questions: [{ id: "fr1", topic: "present tense" }] };
  const attempts = [
    { finishedAt: 1, items: [{ questionId: "es1", topic: "present tense", correct: false }] },
    { finishedAt: 2, items: [{ questionId: "fr1", topic: "present tense", correct: true }] },
  ];
  test("masteryByTopic with the sets keys each topic within its subject", () => {
    const tm = masteryByTopic(attempts, { assignments: [es, fr] });
    assert.equal(tm[topicKey("spanska", "present tense")], 0);
    assert.equal(tm[topicKey("franska", "present tense")], 1);
    assert.equal(tm["present tense"], undefined);
  });
  test("weak spots: only the Spanish question, not the French one", () => {
    const weak = weakSpotQuestions([es, fr], attempts);
    assert.deepEqual(weak.map((w) => w.question.id), ["es1"]);
  });
  test("subject mastery and set progress read their own subject", () => {
    const tm = masteryByTopic(attempts, { assignments: [es, fr] });
    assert.equal(masteryForSubject("franska", [es, fr], tm), 1);
    assert.equal(masteryForSubject("spanska", [es, fr], tm), 0);
    assert.equal(setProgress(fr, attempts, tm).weakCount, 0);
    assert.equal(setProgress(es, attempts, tm).weakTopic, "present tense");
  });
  test("deltaFromAttempt still reports by topic name, for its own subject", () => {
    const d = deltaFromAttempt([attempts[0]], attempts[1], { assignments: [es, fr] });
    assert.deepEqual(d, { "present tense": { before: 0, after: 1 } });
  });
  test("deltaFromAttempt: a name two subjects share in one mixed run shows both, the second with its subject", () => {
    const mixedRun = { finishedAt: 3, items: [
      { questionId: "es1", topic: "present tense", correct: true },
      { questionId: "fr1", topic: "present tense", correct: true },
    ] };
    const names = { spanska: "Spanska", franska: "Franska" };
    const d = deltaFromAttempt(attempts, mixedRun, { assignments: [es, fr], subjectName: (id) => names[id] });
    assert.deepEqual(Object.keys(d), ["present tense", "present tense (Franska)"]);
  });
});

describe("mastery.firstTryCorrect", () => {
  test("prefers the explicit firstTry flag", () => {
    assert.equal(firstTryCorrect({ firstTry: false, correct: true }), false);
    assert.equal(firstTryCorrect({ firstTry: true, correct: false }), true);
  });
  test("falls back to correct when firstTry is absent (legacy data)", () => {
    assert.equal(firstTryCorrect({ correct: true }), true);
    assert.equal(firstTryCorrect({ correct: false }), false);
    assert.equal(firstTryCorrect({}), false);
  });
});

describe("mastery.masteryByTopic", () => {
  test("all-correct attempts on one topic converge to 1", () => {
    const attempts = [
      { finishedAt: 1, items: [{ topic: "algebra", correct: true }] },
      { finishedAt: 2, items: [{ topic: "algebra", correct: true }] },
      { finishedAt: 3, items: [{ topic: "algebra", correct: true }] },
    ];
    assert.equal(masteryByTopic(attempts).algebra, 1);
  });

  test("all-wrong attempts converge to 0", () => {
    const attempts = [
      { finishedAt: 1, items: [{ topic: "algebra", correct: false }] },
      { finishedAt: 2, items: [{ topic: "algebra", correct: false }] },
    ];
    assert.equal(masteryByTopic(attempts).algebra, 0);
  });

  test("more recent attempts are weighted more heavily than older ones", () => {
    // Old wrong answers, then a recent streak of right answers: mastery should
    // read closer to "doing well now" than a flat average would (0.5).
    const attempts = [
      { finishedAt: 1, items: [{ topic: "algebra", correct: false }] },
      { finishedAt: 2, items: [{ topic: "algebra", correct: false }] },
      { finishedAt: 3, items: [{ topic: "algebra", correct: true }] },
      { finishedAt: 4, items: [{ topic: "algebra", correct: true }] },
    ];
    assert.ok(masteryByTopic(attempts).algebra > 0.5);
  });

  test("ignores items with no topic and is independent of input attempt order", () => {
    const attempts = [
      { finishedAt: 2, items: [{ topic: "algebra", correct: true }, { correct: false }] },
      { finishedAt: 1, items: [{ topic: "algebra", correct: false }] },
    ];
    const forward = masteryByTopic(attempts);
    const reversed = masteryByTopic([...attempts].reverse());
    assert.deepEqual(forward, reversed);
  });

  test("empty attempts produce an empty map", () => {
    assert.deepEqual(masteryByTopic([]), {});
  });
});

describe("mastery.masteryForSubject / masteryForAssignment", () => {
  const topicMastery = { algebra: 0.8, geometry: 0.4, [topicKey("math", "algebra")]: 0.8, [topicKey("math", "geometry")]: 0.4 };

  test("averages the mastery of a subject's own topics only", () => {
    const assignments = [
      { subjectId: "math", questions: [{ topic: "algebra" }, { topic: "geometry" }] },
      { subjectId: "history", questions: [{ topic: "algebra" }] }, // different subject, ignored
    ];
    assert.ok(Math.abs(masteryForSubject("math", assignments, topicMastery) - 0.6) < 1e-9);
  });

  test("returns null when the subject has no topics", () => {
    assert.equal(masteryForSubject("nothing", [], topicMastery), null);
  });

  test("masteryForAssignment averages just that assignment's topics", () => {
    const assignment = { questions: [{ topic: "algebra" }, { topic: "geometry" }] };
    assert.ok(Math.abs(masteryForAssignment(assignment, topicMastery) - 0.6) < 1e-9);
  });

  test("masteryForAssignment returns null when no topic has a mastery entry yet", () => {
    const assignment = { questions: [{ topic: "unknownTopic" }] };
    assert.equal(masteryForAssignment(assignment, topicMastery), null);
  });
});

describe("mastery.deltaFromAttempt", () => {
  test("only reports on topics the new attempt actually touched", () => {
    const attempts = [{ finishedAt: 1, items: [{ topic: "algebra", correct: false }] }];
    const newAttempt = { finishedAt: 2, items: [{ topic: "geometry", correct: true }] };
    const delta = deltaFromAttempt(attempts, newAttempt);
    assert.deepEqual(Object.keys(delta), ["geometry"]);
    assert.equal(delta.geometry.before, 0); // untouched topic before this attempt
    assert.equal(delta.geometry.after, 1);
  });
});

describe("mastery.setProgress", () => {
  test("counts known questions by their latest first-try result", () => {
    const assignment = { questions: [{ id: "q1", topic: "algebra" }, { id: "q2", topic: "algebra" }] };
    const attempts = [
      { finishedAt: 1, items: [{ questionId: "q1", correct: false }] },
      { finishedAt: 2, items: [{ questionId: "q1", correct: true }] }, // latest for q1: known
    ];
    const out = setProgress(assignment, attempts);
    assert.equal(out.total, 2);
    assert.equal(out.seen, 1);
    assert.equal(out.known, 1);
  });

  test("flags the weakest topic under the threshold", () => {
    const assignment = { questions: [{ id: "q1", topic: "weak" }, { id: "q2", topic: "strong" }] };
    const topicMastery = { weak: 0.2, strong: 0.9 };
    const out = setProgress(assignment, [], topicMastery, { threshold: 0.6 });
    assert.equal(out.weakTopic, "weak");
    assert.equal(out.weakCount, 1);
  });
});

describe("mastery.weakSpotQuestions", () => {
  test("only surfaces topics below the threshold, weakest first", () => {
    const assignments = [
      { questions: [{ id: "q1", topic: "weak" }, { id: "q2", topic: "weaker" }, { id: "q3", topic: "strong" }] },
    ];
    const attempts = [
      { finishedAt: 1, items: [{ topic: "weak", correct: true }, { topic: "weak", correct: false }] },
      { finishedAt: 1, items: [{ topic: "weaker", correct: false }] },
      { finishedAt: 1, items: [{ topic: "strong", correct: true }] },
    ];
    const out = weakSpotQuestions(assignments, attempts, { threshold: 0.6 });
    assert.deepEqual(out.map((o) => o.question.id), ["q2", "q1"]);
  });

  test("untouched topics (no attempts) are not treated as weak", () => {
    const assignments = [{ questions: [{ id: "q1", topic: "neverAttempted" }] }];
    assert.deepEqual(weakSpotQuestions(assignments, []), []);
  });

  test("respects the limit option", () => {
    const assignments = [{
      questions: Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, topic: `t${i}` })),
    }];
    const attempts = assignments[0].questions.map((q) => ({
      finishedAt: 1, items: [{ topic: q.topic, correct: false }],
    }));
    const out = weakSpotQuestions(assignments, attempts, { limit: 2 });
    assert.equal(out.length, 2);
  });
});
