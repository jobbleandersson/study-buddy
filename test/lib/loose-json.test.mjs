import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseLooseJSON } from "../../js/lib/loose-json.js";

describe("loose-json.parseLooseJSON", () => {
  test("parses plain JSON untouched", () => {
    assert.deepEqual(parseLooseJSON('{"a":1}'), { a: 1 });
  });

  test("strips a ```json fenced code block", () => {
    const text = "```json\n{\"a\":1}\n```";
    assert.deepEqual(parseLooseJSON(text), { a: 1 });
  });

  test("strips a bare ``` fence with no language tag", () => {
    const text = "```\n[1,2,3]\n```";
    assert.deepEqual(parseLooseJSON(text), [1, 2, 3]);
  });

  test("pulls the object out of surrounding prose", () => {
    const text = 'Here is the answer:\n{"ok":true}\nHope that helps!';
    assert.deepEqual(parseLooseJSON(text), { ok: true });
  });

  test("pulls an array out of surrounding prose", () => {
    const text = 'Sure, here you go: [1, 2, 3] - enjoy';
    assert.deepEqual(parseLooseJSON(text), [1, 2, 3]);
  });

  test("throws like JSON.parse when nothing parseable is present", () => {
    assert.throws(() => parseLooseJSON("just some words"));
  });

  test("throws on genuinely malformed JSON", () => {
    assert.throws(() => parseLooseJSON("{not: valid}"));
  });
});
