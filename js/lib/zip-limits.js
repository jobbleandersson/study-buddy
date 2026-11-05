// How much of a ZIP the app will unpack. Each file is capped on its own (material.js MAX_PDF_BYTES), but twenty
// files at that cap are over a gigabyte in the student's browser tab: a few KB of hostile zip is enough to
// crash it. So the files taken are also limited by their total unpacked size.

/** The files to unpack, in order, stopping before their unpacked sizes add up to more than `maxTotal`.
 *  `sizeOf(file)` is the size the zip declares for it. A file that alone is over `maxTotal` is skipped; the
 *  ones after it can still be taken. */
export function withinTotal(files, maxTotal, sizeOf) {
  const out = [];
  let total = 0;
  for (const f of files) {
    const size = Math.max(0, Number(sizeOf(f)) || 0);
    if (total + size > maxTotal) continue;
    total += size;
    out.push(f);
  }
  return out;
}
