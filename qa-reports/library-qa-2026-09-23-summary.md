# Library content QA — summary

**Scope:** all 310 curriculum sets (4,650 questions, sv + en) in `data/library/`/`data/library-en/`, plus all 9 Högskoleprovet sets (120 questions) in `data/library/hp-*.json`. 4,770 questions checked in total, by 14 parallel reviewers split by subject family.

**Method per question:** marked answer independently recomputed/fact-checked (not just trusted from the stored explanation); explanation checked for internal correctness; mc choices checked for ambiguity/duplicate values; short-answer (`"text"`) questions checked against how they're actually graded (`js/lib/answer-match.js`: exact match after normalization for answers ≤3 words, else ≥50% keyword overlap); content checked against the stated Swedish curriculum level; sv/en pairs checked for matching substance, not just matching answer index.

**No data was edited.** `tools/validate-library.mjs` and `tools/validate-hp.mjs` both pass before and after this branch (310 sets / 4,650 questions; 9 HP sets) — this PR only adds the report below.

## Result: 21 confirmed issues out of 4,770 questions (99.6% clean)

| Subject | Sets | Questions | Issues | high | medium | low |
|---|---|---|---|---|---|---|
| Matematik | 34 | 510 | 2 | 2 | 0 | 0 |
| Fysik | 15 | 225 | 0 | 0 | 0 | 0 |
| Kemi | 15 | 225 | 1 | 0 | 0 | 1 |
| Biologi / Naturkunskap | 21 | 315 | 0 | 0 | 0 | 0 |
| Historia | 21 | 315 | 1 | 1 | 0 | 0 |
| Geografi | 15 | 225 | 0 | 0 | 0 | 0 |
| Samhällskunskap | 21 | 315 | 3 | 1 | 1 | 1 |
| Religion | 21 | 315 | 1 | 0 | 1 | 0 |
| Svenska | 33 | 495 | 2 | 1 | 0 | 1 |
| Engelska | 33 | 495 | 0 | 0 | 0 | 0 |
| Franska | 27 | 405 | 3 | 0 | 1 | 2 |
| Tyska | 27 | 405 | 1 | 0 | 1 | 0 |
| Spanska | 27 | 405 | 4 | 1 | 3 | 0 |
| Högskoleprovet | 9 | 120 | 3 | 1 | 2 | 0 |
| **Total** | **319** | **4,770** | **21** | **7** | **9** | **5** |

Full machine-readable findings: [`library-qa-2026-09-23.jsonl`](./library-qa-2026-09-23.jsonl) — one JSON object per line: `group`, `file`, `set`, `question`, `problem`, `evidence`, `fix`, `confidence`.

## The high-confidence findings (7), for a quick read

1. **Matematik** `lib-ma7-brak` q-ma7-bra-2 and `lib-ma9-procent` q-ma9-proc-2 — two mc choices are the same number written two ways (`2/4` and `1/2`; `4/8` and `1/2`), so each question really only offers 3 distinct values.
2. **Historia** `lib-hist8-stormaktstiden` q-hist8-sto-10 — explanation says Gotland was ceded via the Peace of Roskilde (1658); it was actually ceded earlier, via Brömsebro (1645).
3. **Samhällskunskap** `lib-sam8-ekonomi` q-sam8-eko-15 — the Swedish opener invents a nonsensical etymology for "strejk" (claims a French origin, contradicted by the English opener for the same question); the word is actually a 19th-century loan from English "strike".
4. **Svenska** `lib-sv1-sprakhistoria` q-sv1-hist-15 — "tack" is given as an example of a medieval Low German (Hanseatic) loanword; it's actually native Old Norse vocabulary.
5. **Spanska** `lib-sp4-reportedspeech` q-sp4-reportedspeech-6 — the sentence stem already contains "que" before the blank, so the correct choice combines into the ungrammatical "preguntó **que si** venía a la fiesta" — directly contradicting the question's own explanation that "si" replaces "que" in this construction.
6. **Högskoleprovet** `lib-hp-ord-bank-01` q-ordbank-11 — the headword "succesiv" is misspelled; correct Swedish is "successiv".

## A cross-cutting pattern worth flagging separately (not a content bug — a grading-mechanics one)

Three Spanska findings (`ak8-sp-time` q-sp8-time-6, `ak8-sp-adjectives` q-sp8-adj-6, `ak9-sp-questions` q-sp9-q-6) share one root cause: the offline short-answer grader (`js/lib/answer-match.js`'s `normalizeAnswer()`) lowercases and trims but never strips accents/diacritics. For any `"text"`-kind question whose ≤3-word model answer needs an accent or ñ (Spanish, and plausibly some French/German answers too, though this pass didn't turn up a concrete instance in those two), a student who types the very common unaccented form is graded wrong under the offline fallback even though the answer is otherwise correct. Fixing individual questions' stored answers only band-aids this one language; the more durable fix is almost certainly in the grader itself (e.g. diacritic-fold both sides before comparing). Flagging this as a separate recommendation rather than a per-question fix, since it's a code change, not a content edit.

## Next steps

This PR is the report only, per the brief — no `data/library*` files are touched. Once these findings are reviewed, confirmed fixes (and, if wanted, the accent-folding grader change) belong in a follow-up commit on this same branch.
