import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { markdown } from "../../js/lib/markdown.js";

const TABLE = [
  "| Aspekt | Mitos | Meios |",
  "|--------|-------|-------|",
  "| Delningar | En | Två |",
  "| Dotterceller | 2 | 4 |",
].join("\n");

describe("markdown tables", () => {
  test("a pipe table becomes a real table inside a scroll wrapper", () => {
    const html = markdown(TABLE);
    assert.match(html, /^<div class="mdtable"><table>/);
    assert.equal((html.match(/<th>/g) || []).length, 3);
    assert.equal((html.match(/<tr>/g) || []).length, 3);
    assert.match(html, /<th>Mitos<\/th>/);
    assert.match(html, /<td>Delningar<\/td><td>En<\/td><td>Två<\/td>/);
  });

  test("text before and after the table stays in paragraphs", () => {
    const html = markdown(`Här är skillnaderna:\n${TABLE}\n\nMinnesknep: två är fler.`);
    assert.match(html, /^<p>Här är skillnaderna:<\/p><div class="mdtable">/);
    assert.match(html, /<\/div><p>Minnesknep: två är fler\.<\/p>$/);
  });

  test("inline formatting works inside cells and cells are escaped", () => {
    const html = markdown("| A | B |\n|---|---|\n| **fet** | <script>x</script> |");
    assert.match(html, /<td><strong>fet<\/strong><\/td>/);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;/);
  });

  test("alignment colons set the column alignment", () => {
    const html = markdown("| L | C | R |\n|:--|:-:|--:|\n| a | b | c |");
    assert.match(html, /<th>L<\/th><th style="text-align:center">C<\/th><th style="text-align:right">R<\/th>/);
  });

  test("short rows are padded and an escaped pipe stays inside its cell", () => {
    const html = markdown("| A | B |\n|---|---|\n| bara ett |\n| x \\| y | z |");
    assert.match(html, /<td>bara ett<\/td><td><\/td>/);
    assert.match(html, /<td>x \| y<\/td><td>z<\/td>/);
  });

  test("a header with no rows yet (mid-stream) still renders", () => {
    const html = markdown("| A | B |\n|---|---|");
    assert.match(html, /<table><thead>/);
    assert.ok(!html.includes("<tbody>"));
  });

  test("a line with pipes but no separator row is just text", () => {
    const html = markdown("a | b | c");
    assert.equal(html, "<p>a | b | c</p>");
  });

  test("lists and code blocks still work next to tables", () => {
    const html = markdown("- ett\n- två\n\n" + TABLE + "\n\n```\nkod\n```");
    assert.match(html, /^<ul><li>ett<\/li><li>två<\/li><\/ul><div class="mdtable">/);
    assert.match(html, /<pre><code>kod<\/code><\/pre>$/);
  });
});
