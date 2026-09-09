# Högskoleprovet — content format

How to add Högskoleprovet content. Two kinds of set:

- **Delprov sets** — `"type": "test"`, one delprov, ~10–12 questions. Ids
  `lib-hp-<YYYY><v|h>-<delprov>` (e.g. `lib-hp-2026v-xyz`). The `<YYYY><v|h>`
  segment must match a key in `NORM_TABLES` in `js/lib/hp.js` for the normed
  estimate to use that test's real table; anything else falls back to the
  blended `GENERIC_NORM`.
- **ORD word banks** — `"type": "assignment"`, ids `lib-hp-ord-bank-NN`. These
  feed spaced repetition, not a timed test.

Every set also needs an entry in `data/library/index.json` (`sets[]`) and, for
browse text, in `data/library/index.en.json` (`sets`).

## Question shape

All 8 delprov are `kind: "mc"` graded by exact index match (`answer` is
0-based). The delprov is set with `variant`:

| delprov | variant | choices | extra fields |
|---|---|---|---|
| ORD | `ord` | 5 | — |
| LÄS | `las` | 4 | `stimulus: { id, title, body }` — same object on every question of a text group |
| MEK | `mek` | 4 | gapped sentence goes in `prompt` (use `______` for a gap) |
| ELF | `elf` | 4 | `stimulus` (English), instructions in English |
| XYZ | `xyz` | 5 | `$…$` KaTeX; optional `figure`; author `steps[]` for the hint ladder |
| KVA | `kva` | 4 | `stimulus: { quantities: [I, II], given? }`; **choices are the 4 canonical strings, order fixed** |
| NOG | `nog` | 5 | `stimulus: { statements: ["(1) …", "(2) …"] }`; **choices are the 5 canonical sufficiency options, order fixed** |
| DTK | `dtk` | 5 | `figure: { src, alt }` (mandatory) |

`figure.src` is a path under `data/library/figures/` with **no leading slash**,
e.g. `"hp/2026v/dtk-03.svg"`. `figure.alt` is **mandatory** and must carry the
data needed to answer the question (it is what a screen reader, the printed
worksheet, and the 404 fallback all show).

Figures should be **SVG, redrawn clean** — not scanned exam pages. Use a neutral
palette that reads on both light and dark grounds (slate `#6b7280` strokes,
`#8aa0c8` bars) plus an internal `@media (prefers-color-scheme: dark)` block;
see `data/library/figures/hp/2026v/dtk-01.svg`.

`explanation` is authored in Swedish (English for ELF).

## KVA canonical choices (verbatim, in this order)

```
"Kvantitet I är större"
"Kvantitet II är större"
"Kvantitet I och II är lika stora"
"Informationen är otillräcklig"
```

## NOG canonical choices (verbatim, in this order)

```
"(1) ensam är tillräcklig men inte (2) ensam"
"(2) ensam är tillräcklig men inte (1) ensam"
"(1) och (2) tillsammans är tillräckliga men inte var för sig"
"(1) respektive (2) ensam är tillräcklig"
"(1) och (2) tillsammans är inte tillräckliga"
```

## Transcribing a released test (studera.nu)

UHR releases each prov (frågehäften + facit + normeringstabell +
källförteckning) ~6 months after the sitting. ORD / MEK / XYZ / KVA / NOG / DTK
are low copyright risk. **LÄS and ELF reading passages are a redistribution
question** — get written clearance from UHR, or use UHR's freely published
`exempeluppgifter` for those two delprov until then.

Norm table: transcribe `norm<XX><a|b>_verb.pdf` and `norm<XX><a|b>_kvant.pdf`
row by row into `NORM_TABLES` in `js/lib/hp.js` — index = raw score 0..80, value
= normed score. Must be non-decreasing and within `[0, 2.00]`.

## Validate

```
node tools/validate-hp.mjs
```

Checks choice counts per delprov, `answer` in range, KVA/NOG canonical choices,
`figure.src` files exist, `stimulus` identical within a group, `count` matches
`index.json`, and norm-table monotonicity.
