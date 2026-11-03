import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCards } from "../../js/lib/import.js";

const pairs = (text) => parseCards(text).map((c) => [c.term, c.definition]);

describe("pasted cards", () => {
  test("tab-separated, as Quizlet and Anki export", () => {
    assert.deepEqual(pairs("hund\tdog\r\nkatt\tcat\r\n"), [["hund", "dog"], ["katt", "cat"]]);
    assert.deepEqual(pairs("﻿hund\tdog"), [["hund", "dog"]]);
  });

  test("a decimal comma in the definition stays", () => {
    assert.deepEqual(pairs("pi, 3,14\nhalv, 0,5"), [["pi", "3,14"], ["halv", "0,5"]]);
  });

  test("a second dash in the definition stays a dash", () => {
    assert.deepEqual(pairs("fotosyntes - växter gör socker - med ljus"), [["fotosyntes", "växter gör socker - med ljus"]]);
  });

  test("a comma in a dash-separated definition doesn't split it", () => {
    assert.deepEqual(pairs("fotosyntes - växter, ljus och vatten\ncell - livets minsta del"),
      [["fotosyntes", "växter, ljus och vatten"], ["cell", "livets minsta del"]]);
  });

  test("quoted spreadsheet rows", () => {
    assert.deepEqual(pairs('"London, England",huvudstad\n"Han sa ""hej""",citat'), [["London, England", "huvudstad"], ['Han sa "hej"', "citat"]]);
    assert.deepEqual(pairs('ord,"en definition, med komma"'), [["ord", "en definition, med komma"]]);
  });

  test("colon-separated notes, one card per line", () => {
    assert.deepEqual(pairs("hund: dog\nkatt: cat\nhäst: horse"), [["hund", "dog"], ["katt", "cat"], ["häst", "horse"]]);
  });

  test("a time isn't a separator", () => {
    assert.deepEqual(pairs("Lektionen börjar\n10:30"), [["Lektionen börjar", "10:30"]]);
  });

  test("semicolons, and nothing usable", () => {
    assert.deepEqual(pairs("hund;dog"), [["hund", "dog"]]);
    assert.deepEqual(pairs(""), []);
    assert.deepEqual(pairs("bara ett ord"), []);
  });
});
