// The "long word" fix is CSS-only, so this guards the two things that are easy to undo by accident:
// the session grid column must be allowed to shrink below its content (minmax(0, 1fr)), and the
// content containers must keep their overflow-wrap rule. See the comment in css/app.css.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../css/app.css", import.meta.url), "utf8");

test("the session grid column can shrink below a long word", () => {
  assert.match(css, /\.session \{[^}]*grid-template-columns: minmax\(0, 1fr\) 380px/);
  assert.match(css, /@media \(max-width: 860px\) \{\s*\.session \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("question text, choices and set titles wrap long words", () => {
  const m = css.match(/([^{}]*)\{ overflow-wrap: break-word; overflow-wrap: anywhere; \}/);
  assert.ok(m, "the shared overflow-wrap rule is missing");
  for (const sel of [".question", ".choice", ".acard__title", ".psheet__q", ".shell__main h2"]) {
    assert.ok(m[1].includes(sel), `${sel} is missing from the overflow-wrap list`);
  }
});
