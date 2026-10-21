import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchSubject, standardKey } from "../../js/lib/subject-match.js";

const NAMES = { math: "Matematik", swedish: "Svenska", english: "Engelska", biology: "Biologi", chemistry: "Kemi", physics: "Fysik",
  history: "Historia", civics: "Samhällskunskap", geography: "Geografi", religion: "Religionskunskap" };
const CHOICES = ["Matematik", "Spanska", "Internationell ekonomi", "Historia", "Svenska", "Kemi", "Biologi", "Engelska"];

describe("which subject an AI set belongs to", () => {
  test("a Swedish essay's set comes back under Svenska, whichever way the model spells it", () => {
    for (const said of ["Svenska", "svenska", "Swedish", "Svenska 2", "Svenska, uppsatsskrivande", "  SVENSKA "]) {
      assert.equal(matchSubject(said, CHOICES, NAMES), "Svenska", said);
    }
  });

  test("the other usual subjects, in Swedish or English", () => {
    assert.equal(matchSubject("Math", CHOICES, NAMES), "Matematik");
    assert.equal(matchSubject("Matematik 3c", CHOICES, NAMES), "Matematik");
    assert.equal(matchSubject("History", CHOICES, NAMES), "Historia");
    assert.equal(matchSubject("Chemistry", CHOICES, NAMES), "Kemi");
    assert.equal(matchSubject("English", CHOICES, NAMES), "Engelska");
  });

  test("a subject of the student's own that matches by name is used as it is spelt", () => {
    assert.equal(matchSubject("internationell ekonomi", CHOICES, NAMES), "Internationell ekonomi");
    assert.equal(matchSubject("Spanska", CHOICES, NAMES), "Spanska");
  });

  test("nothing that fits means nothing is chosen for them", () => {
    assert.equal(matchSubject("Science", CHOICES, NAMES), null);
    assert.equal(matchSubject("Allmänt", CHOICES, NAMES), null);
    assert.equal(matchSubject("", CHOICES, NAMES), null);
    assert.equal(matchSubject(undefined, CHOICES, NAMES), null);
    // a usual subject the picker does not offer (the student has no such chip) is not invented
    assert.equal(matchSubject("Fysik", ["Matematik", "Svenska"], NAMES), null);
  });

  test("only the start of a name counts, so a topic that merely mentions a subject does not match", () => {
    assert.equal(standardKey("Svenska"), "swedish");
    assert.equal(standardKey("Historia och samhälle"), "history");
    assert.equal(standardKey("Matematikens historia"), null);
    assert.equal(standardKey("Kemisk analys"), null);
  });
});
