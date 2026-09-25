import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEWS, publishableReviews } from "../../js/data/reviews.js";

const ok = { name: "Elin", text: "Bra!", lang: "sv", date: "2026-10-01", consent: true, rating: 5 };

test("every review in the shipped list is publishable (no half-filled or unconsented entries)", () => {
  assert.equal(publishableReviews(REVIEWS).length, REVIEWS.length);
});

test("an empty list gives no reviews, so the section stays hidden", () => {
  assert.deepEqual(publishableReviews([]), []);
});

test("entries without explicit consent are never shown", () => {
  assert.deepEqual(publishableReviews([{ ...ok, consent: undefined }, { ...ok, consent: "yes" }]), []);
});

test("entries missing a name, text, known language or valid date are left out", () => {
  const bad = [{ ...ok, name: " " }, { ...ok, text: "" }, { ...ok, lang: "de" }, { ...ok, date: "1 okt" }];
  assert.deepEqual(publishableReviews(bad), []);
});

test("an out-of-range rating drops the stars but keeps the quote", () => {
  const out = publishableReviews([{ ...ok, rating: 7 }, { ...ok, rating: 4.5, date: "2026-09-01" }]);
  assert.deepEqual(out.map((r) => r.rating), [null, null]);
});

test("newest first", () => {
  const out = publishableReviews([{ ...ok, date: "2026-01-01", name: "A" }, { ...ok, date: "2026-03-01", name: "B" }]);
  assert.deepEqual(out.map((r) => r.name), ["B", "A"]);
});
