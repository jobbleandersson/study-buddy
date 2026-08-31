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

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
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
