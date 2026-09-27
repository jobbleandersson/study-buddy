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

describe("markdown emphasis, quotes and rules", () => {
  test("_italic_ works at word edges", () => {
    assert.equal(markdown("Detta är _viktigt_ att veta"), "<p>Detta är <em>viktigt</em> att veta</p>");
    assert.equal(markdown("_Hela raden_"), "<p><em>Hela raden</em></p>");
    assert.equal(markdown("Se (_här_)."), "<p>Se (<em>här</em>).</p>");
  });

  test("underscores inside words, snake_case and URLs are left alone", () => {
    assert.equal(markdown("variabeln snake_case_namn"), "<p>variabeln snake_case_namn</p>");
    assert.equal(markdown("https://sv.wikipedia.org/wiki/Fotosyntes_och_cellandning_i_växter"), "<p>https://sv.wikipedia.org/wiki/Fotosyntes_och_cellandning_i_växter</p>");
  });

  test("nothing inside inline code gets bold or italic treatment", () => {
    assert.equal(markdown("Skriv `_x_` och `**y**` här"), "<p>Skriv <code>_x_</code> och <code>**y**</code> här</p>");
  });

  test("bold and *italic* still work", () => {
    assert.equal(markdown("**fet** och *kursiv*"), "<p><strong>fet</strong> och <em>kursiv</em></p>");
  });

  test("a > line becomes a blockquote, and its text is formatted", () => {
    assert.equal(markdown("> Ett **citat**\n> på två rader"), "<blockquote><p>Ett <strong>citat</strong> på två rader</p></blockquote>");
  });

  test("--- and *** are horizontal rules, also straight after a paragraph", () => {
    assert.equal(markdown("före\n\n---\n\nefter"), "<p>före</p><hr><p>efter</p>");
    assert.equal(markdown("Rubrik\n---"), "<p>Rubrik</p><hr>");
    assert.equal(markdown("***"), "<hr>");
  });

  test("a table separator is not mistaken for a rule", () => {
    assert.match(markdown("| A | B |\n|---|---|\n| 1 | 2 |"), /^<div class="mdtable">/);
  });

  test("a bullet list is not mistaken for a rule", () => {
    assert.equal(markdown("- ett\n- två"), "<ul><li>ett</li><li>två</li></ul>");
  });
});

describe("markdown • bullets", () => {
  // Field-test failure: the tutor wrote four tips as separate "• " lines, and they were glued into one
  // paragraph with the bullets inline, because only "- " and "* " counted as list markers.
  test("separate • lines become a real list", () => {
    assert.equal(markdown("• ett\n• två"), "<ul><li>ett</li><li>två</li></ul>");
  });

  test("the real reply shape: intro line, then • items with bold lead-ins", () => {
    const html = markdown("Här är 4 tips:\n\n• **Öva** — gamla uppgifter\n• **Läs** — noga\n\nBehöver du mer hjälp?");
    assert.equal(html, "<p>Här är 4 tips:</p><ul><li><strong>Öva</strong> — gamla uppgifter</li><li><strong>Läs</strong> — noga</li></ul><p>Behöver du mer hjälp?</p>");
  });

  test("a • list straight after a text line (no blank line) still splits off", () => {
    assert.equal(markdown("Tips:\n• ett\n• två"), "<p>Tips:</p><ul><li>ett</li><li>två</li></ul>");
  });

  test("• needs no space after it, and a • in the middle of a line is left alone", () => {
    assert.equal(markdown("•ett\n•två"), "<ul><li>ett</li><li>två</li></ul>");
    assert.equal(markdown("A • B • C"), "<p>A • B • C</p>");
  });
});
