// After a Google sign-in the email box is never filled in. On the code step it is hidden, so if it stays
// `required` the browser refuses to submit the form and "Verify" silently does nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/views/login.js", import.meta.url), "utf8");

test("the email input is only required while its row is visible", () => {
  assert.match(src, /emailInput\.required = !emailRow\.hidden;/);
  assert.doesNotMatch(src, /id: "auth-email"[^)]*required: true/);
});
