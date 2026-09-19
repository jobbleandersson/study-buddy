// Minimal, safe Markdown -> HTML for tutor messages.
// Supports: paragraphs, bold, italic, inline code, fenced/indented code,
// unordered/ordered lists, and $...$ / $$...$$ math via KaTeX when available.
// Everything is HTML-escaped first, so model output can't inject markup.

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function renderMath(src, display) {
  if (typeof window.katex === "undefined") return esc(display ? `$$${src}$$` : `$${src}$`);
  try {
    return window.katex.renderToString(src, { displayMode: display, throwOnError: false });
  } catch {
    return esc(src);
  }
}

function inline(text) {
  // pull math out first so we don't escape TeX
  const parts = [];
  let rest = text;
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/;
  let m;
  while ((m = re.exec(rest))) {
    parts.push({ t: "text", v: rest.slice(0, m.index) });
    parts.push({ t: "math", v: m[1] ?? m[2], display: m[1] != null });
    rest = rest.slice(m.index + m[0].length);
  }
  parts.push({ t: "text", v: rest });

  return parts.map((p) => {
    if (p.t === "math") return renderMath(p.v, p.display);
    return esc(p.v)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  }).join("");
}

/** One list item: its lines joined with line breaks, a lone $$…$$ line kept as its own block. */
function itemHtml(lines) {
  const chunks = [];
  let text = [];
  const flush = () => { if (text.length) { chunks.push(text.map(inline).join("<br>")); text = []; } };
  for (const l of lines) {
    if (/^\$\$[^$]+\$\$$/.test(l.trim())) { flush(); chunks.push(inline(l.trim())); }
    else text.push(l);
  }
  flush();
  return chunks.join("");
}

export function markdown(src) {
  const lines = String(src ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim() === "") { i++; continue; }

    if (/^#{1,6}\s+\S/.test(line)) {
      // A model heading ("# Solving …") has no place in a chat bubble: show it as a bold line.
      out.push(`<p><strong>${inline(line.replace(/^#{1,6}\s+/, "").replace(/\s*#+\s*$/, ""))}</strong></p>`);
      i++;
      continue;
    }

    const bullet = /^\s*[-*]\s+/, numbered = /^\s*(\d+)[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const start = ordered ? Number(line.match(numbered)[1]) : 1;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        const body = [lines[i].replace(re, "")];
        i++;
        // Indented lines under an item (the working, a display equation) belong to
        // it, and so does the next item after a blank line — otherwise every step
        // became its own one-item list and the numbering restarted at 1.
        while (i < lines.length) {
          if (lines[i].trim() === "") {
            let j = i;
            while (j < lines.length && lines[j].trim() === "") j++;
            if (j < lines.length && (re.test(lines[j]) || /^\s{2,}\S/.test(lines[j]))) { i = j; continue; }
            break;
          }
          if (re.test(lines[i]) || !/^\s{2,}\S/.test(lines[i])) break;
          body.push(lines[i].trim());
          i++;
        }
        items.push(`<li>${itemHtml(body)}</li>`);
      }
      out.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ""}>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }

    // paragraph: gather until blank line
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && !/^```/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("");
}
