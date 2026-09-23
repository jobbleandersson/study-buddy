import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { countdownLabel } from "../../js/lib/date-phrases.js";

function dayKeyFromNow(deltaDays) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("date-phrases.countdownLabel", () => {
  test("a past day key reads as overdue", () => {
    assert.equal(countdownLabel(dayKeyFromNow(-3)), "försenat");
  });

  test("today reads as an hour countdown", () => {
    assert.match(countdownLabel(dayKeyFromNow(0)), /^om ~\d+ h$/);
  });

  test("tomorrow reads as its own phrase, not 'in 1 days'", () => {
    assert.equal(countdownLabel(dayKeyFromNow(1)), "Imorgon");
  });

  test("further out reads as an N-day countdown", () => {
    assert.equal(countdownLabel(dayKeyFromNow(5)), "om 5 dagar");
  });
});
