# Vendored libraries

Third-party code that is copied into the repo instead of installed. `npm audit` does not see any of it, so this
table is the record of what is here and how old it is. Check it once a year (and whenever a security advisory for
one of them turns up).

| File | Library | Version | Used for | Loaded |
|---|---|---|---|---|
| `pdf.min.js`, `pdf.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js) | 3.11.174 | Reading text out of a PDF the student adds (`js/material.js`) | Only when a file is imported |
| `jszip.min.js` | [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | Opening a ZIP of PDFs (`js/material.js`) | Only when a ZIP is imported |
| `katex.min.js`, `katex.min.css`, `fonts/` | [KaTeX](https://github.com/KaTeX/KaTeX) | 0.16.11 | Formulas in questions and Formelsamling (`js/lib/math-render.js`) | On screens with maths |
| `canvas-confetti.min.js` | [canvas-confetti](https://github.com/catdad/canvas-confetti) | 1.9.3 | The celebration after a great result | On the results screen |

## Notes

- **pdf.js** is on the 3.x line; 5.x is current. The known malicious-PDF script bug (CVE-2024-4367) is avoided by
  `getDocument({ isEvalSupported: false })` in `js/material.js`: keep that option on whatever version is here.
  Moving to a newer major means re-testing PDF import (the worker file and the API changed between majors).
- **JSZip** is only given files the student chose themselves. A PDF over 60 MB is skipped, and the PDFs taken from
  a ZIP are limited to 150 MB unpacked in total (`js/lib/zip-limits.js`), so a hostile ZIP can crash at most that
  student's own tab.
- **KaTeX** is past the 0.16.10 security fixes. It runs with `throwOnError: false` and `trust` left at its default (off), so `\href`,
  `\url` and `\includegraphics` produce no live link or image.
- The server's own dependencies are in `server/package.json` and are covered by `npm audit` (CI runs it).

## Updating one

1. Download the minified build of the new version from its release page or from jsDelivr (pinned version).
2. Replace the file here, then update the version in the table above.
3. Add the new service-worker cache name by deploying as usual (the server stamps it from the files' hash).
4. Run `npm test`, then try the feature in a browser: import a PDF and a ZIP, open Formelsamling, finish a set.
