import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectSections } from "../../js/lib/split.js";

describe("split.detectSections", () => {
  test("text under 300 characters never splits", () => {
    assert.deepEqual(detectSections("# A\nshort\n\n# B\nshort"), []);
  });

  test("splits on markdown headings", () => {
    const text = [
      "# Kapitel 1",
      "Detta är den första sektionen med tillräckligt mycket text för att räknas som ett riktigt avsnitt och inte bara en rubrik. Här är ännu en mening för att vara säker på att vi passerar det inbyggda minimikravet på trehundra tecken totalt sett.",
      "",
      "# Kapitel 2",
      "Detta är den andra sektionen, också med tillräckligt mycket text för att klara det inbyggda minimikravet på fyrtio tecken per sektion, plus lite till för säkerhets skull i det här testfallet.",
    ].join("\n");
    const out = detectSections(text);
    assert.equal(out.length, 2);
    assert.equal(out[0].title, "Kapitel 1");
    assert.equal(out[1].title, "Kapitel 2");
    assert.ok(out[0].body.length >= 40);
  });

  test("splits on 'Kapitel N' style headings without markdown", () => {
    const text = [
      "Kapitel 1 – Fotosyntes",
      "Växter omvandlar ljusenergi till kemisk energi i sina blad genom en process som kallas fotosyntes och det är väldigt viktigt för allt liv på jorden som vi känner det.",
      "",
      "Kapitel 2 – Cellandning",
      "Cellandning frigör den lagrade energin igen så att cellerna kan använda den till att göra sitt arbete varje dag, i växter, djur och människor.",
    ].join("\n");
    const out = detectSections(text);
    assert.equal(out.length, 2);
    assert.match(out[0].title, /Kapitel 1/);
  });

  test("splits on blank-line-separated blocks with a short heading-like first line", () => {
    const text = [
      "Introduktion",
      "Det här är den första sektionen och den behöver vara lagom lång för att klara minimikravet på fyrtio tecken totalt.",
      "",
      "Fördjupning",
      "Det här är den andra sektionen, också den ganska lång så att den säkert klarar minimikravet på fyrtio tecken.",
      "",
      "Sammanfattning",
      "Den tredje och sista sektionen sammanfattar allt som sagts ovan på ett tydligt och lättläst sätt för läsaren.",
    ].join("\n");
    const out = detectSections(text);
    assert.ok(out.length >= 2);
  });

  test("plain prose with no structure returns no sections", () => {
    const text = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(10);
    assert.deepEqual(detectSections(text), []);
  });

  test("a single markdown heading is not enough to split (needs 2+)", () => {
    const text = "# Only heading\n" + "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(10);
    const out = detectSections(text);
    // Falls through to the blank-line heuristic, which also needs >=2 blocks;
    // either way a single heading alone must not produce a lone one-part split.
    assert.notEqual(out.length, 1);
  });
});
