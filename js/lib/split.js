// Split a long paste into sections, so one big dump ("here's the whole
// chapter") can become a set per heading instead of a single unwieldy set.
// Detection only — the generating happens in create.js, gated on a key.

/**
 * detectSections(text) -> [{ title, body }]
 * Returns [] when the text doesn't clearly divide into 2+ sections.
 */
export function detectSections(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (src.length < 300) return [];

  // 1. Markdown headings (#, ##, ###).
  const heads = [...src.matchAll(/^(#{1,3})\s+(.+?)\s*#*$/gm)];
  if (heads.length >= 2) {
    return sliceAt(src, heads.map((m) => ({ index: m.index, title: m[2].trim() })));
  }

  // 2. "Chapter 3", "Kapitel 3 – Fotosyntes", "Avsnitt 2", "Part 4".
  const chs = [...src.matchAll(/^(?:chapter|kapitel|avsnitt|part|del|section)\s+\d+\b[ .:–—-]*(.*)$/gim)];
  if (chs.length >= 2) {
    return sliceAt(src, chs.map((m) => ({ index: m.index, title: m[0].trim() })));
  }

  // 3. Blank-line-separated blocks whose first line reads like a heading:
  //    short, and not ending in sentence punctuation.
  const blocks = src.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length >= 3) {
    const secs = [];
    for (const b of blocks) {
      const nl = b.indexOf("\n");
      const lead = (nl === -1 ? b : b.slice(0, nl)).trim();
      if (nl !== -1 && lead.length <= 60 && !/[.!?:]$/.test(lead)) {
        secs.push({ title: lead, body: b.slice(nl + 1).trim() });
      } else if (secs.length) {
        secs[secs.length - 1].body += "\n\n" + b;
      }
    }
    if (secs.length >= 2) return secs.filter((s) => s.body.length >= 40);
  }

  return [];
}

function sliceAt(src, marks) {
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const chunk = src.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : src.length);
    const nl = chunk.indexOf("\n");
    const body = nl === -1 ? "" : chunk.slice(nl + 1).trim();
    if (body.length >= 40) out.push({ title: marks[i].title || `Part ${i + 1}`, body });
  }
  return out.length >= 2 ? out : [];
}
