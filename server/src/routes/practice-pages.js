import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Public, server-rendered pages for the ready-made library, at real paths a search engine can index:
//   /ova                         every level and subject
//   /ova/<subject>               one subject's sets, e.g. /ova/ak9-matematik
//   /ova/<subject>/<set-slug>    one set: what it covers, three sample questions with answers,
//                                and a button that opens the whole set in the app
//   /sitemap.xml, /robots.txt
//
// The app itself uses hash routes (#/library), which a search engine sees as one page. These pages
// are plain HTML built from the same JSON the app serves, so they need no JS to read and stay in
// step with the library automatically.
//
// Indexing is off until PUBLIC_INDEXING=true: every page carries noindex and robots.txt disallows
// everything, so a private test deployment never leaks into search results. (SITE_PASSWORD, when
// set, also puts these pages behind the password like the rest of the site.)

export const practicePages = Router();

const here = path.dirname(fileURLToPath(import.meta.url));

function findLibraryDir() {
  const roots = [process.env.FRONTEND_ROOT, path.join(here, "..", "..", ".."), path.join(process.cwd(), ".."), process.cwd()]
    .filter(Boolean);
  for (const root of roots) {
    const dir = path.join(root, "data", "library");
    if (fs.existsSync(path.join(dir, "index.json"))) return dir;
  }
  return null;
}

const SAMPLE_COUNT = 3;
const indexing = () => process.env.PUBLIC_INDEXING === "true";

/** "Bråk, decimaler & procent" -> "brak-decimaler-procent". */
export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // å ä ö é -> a a o e
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "set";
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Text that may hold $math$ or **bold**: escaped here, then rendered in the browser by js/ova.js
// (KaTeX). Without JS it still reads, just with the raw $...$ showing.
const rich = (s, tag = "span") => `<${tag} data-rich>${esc(s)}</${tag}>`;

/* ---------------- the library, loaded once ---------------- */

let lib = null;

function loadLibrary() {
  if (lib) return lib;
  const dir = findLibraryDir();
  if (!dir) return (lib = { levels: [], subjects: [], sets: [], bySubject: new Map(), byPath: new Map() });
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  const levels = new Map(index.levels.map((l) => [l.id, l]));
  const subjects = index.subjects.filter((s) => levels.has(s.level));
  const subjectIds = new Set(subjects.map((s) => s.id));
  const bySubject = new Map(subjects.map((s) => [s.id, []]));
  const byPath = new Map();

  for (const entry of index.sets) {
    if (!subjectIds.has(entry.subject)) continue;
    const siblings = bySubject.get(entry.subject);
    let slug = slugify(entry.title);
    // Two sets with the same title in one subject: the id keeps them apart.
    if (siblings.some((s) => s.slug === slug)) slug = `${slug}-${slugify(entry.id.replace(/^lib-/, ""))}`;
    const set = { ...entry, slug, path: `/ova/${entry.subject}/${slug}` };
    siblings.push(set);
    byPath.set(set.path, set);
  }
  lib = { levels: index.levels, levelById: levels, subjects, bySubject, byPath, dir };
  return lib;
}

function readSet(set) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lib.dir, path.basename(set.file)), "utf8"));
  } catch {
    return null;
  }
}

/** Up to three questions that show the set's range: a multiple-choice one, a worked problem or
 *  flashcard if there is one, then another multiple-choice. */
export function pickSamples(questions, n = SAMPLE_COUNT) {
  const mc = questions.filter((q) => q.kind === "mc");
  const other = questions.filter((q) => q.kind !== "mc");
  const picked = [mc[0], other[0], mc[1], mc[2], other[1]].filter(Boolean);
  return [...new Set(picked)].slice(0, n);
}

/* ---------------- HTML ---------------- */

function kindCounts(questions) {
  const c = { mc: 0, worked: 0, flashcard: 0, text: 0 };
  for (const q of questions) if (q.kind in c) c[q.kind]++;
  const parts = [];
  if (c.mc) parts.push(`${c.mc} flervalsfrågor`);
  if (c.worked) parts.push(`${c.worked} ${c.worked === 1 ? "uträkning" : "uträkningar"} steg för steg`);
  if (c.text) parts.push(`${c.text} ${c.text === 1 ? "fritextfråga" : "fritextfrågor"}`);
  if (c.flashcard) parts.push(`${c.flashcard} sammanfattningskort`);
  return parts.join(" · ");
}

function questionHtml(q, i) {
  let body = "";
  let answer = "";
  if (q.kind === "mc") {
    body = `<ol class="ova-choices" type="A">${q.choices.map((c) => `<li>${rich(c)}</li>`).join("")}</ol>`;
    answer = `<p><strong>Rätt svar: ${"ABCDE"[q.answer] || ""}.</strong> ${rich(q.choices[q.answer])}</p>`
      + (q.explanation ? rich(q.explanation, "p") : "");
  } else if (q.kind === "worked") {
    answer = `<ol class="ova-steps">${(q.steps || []).map((s) => `<li>${rich(s)}</li>`).join("")}</ol>`
      + `<p><strong>Svar:</strong> ${rich(q.answer)}</p>`;
  } else {
    answer = rich(q.answer, "p");
  }
  return `<li class="ova-q">
    <p class="ova-q__n">Fråga ${i + 1}</p>
    ${rich(q.prompt, "p")}
    ${body}
    <details class="ova-q__ans"><summary>Visa svar och förklaring</summary>${answer}</details>
  </li>`;
}

function page({ title, description, canonical, crumbs, body }) {
  const robots = indexing() ? "index, follow" : "noindex, nofollow";
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
  };
  const crumbNav = crumbs.length > 1
    ? `<nav class="ova-crumbs" aria-label="Brödsmulor">${crumbs.map(([name, url], i) => (i === crumbs.length - 1
      ? `<span aria-current="page">${esc(name)}</span>`
      : `<a href="${esc(new URL(url).pathname)}">${esc(name)}</a>`)).join(" <span aria-hidden=\"true\">›</span> ")}</nav>`
    : "";
  return `<!doctype html>
<html lang="sv" data-theme="system">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="${robots}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Studify" />
  <meta property="og:locale" content="sv_SE" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(new URL("/assets/og-image.png", canonical).href)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" href="/assets/favicon.svg" />
  <link rel="stylesheet" href="/css/fonts.css" />
  <link rel="stylesheet" href="/vendor/katex.min.css" />
  <link rel="stylesheet" href="/css/tokens.css" />
  <link rel="stylesheet" href="/css/ova.css" />
  <script src="/js/boot.js"></script>
  <script src="/vendor/katex.min.js" defer></script>
  <script type="module" src="/js/ova.js"></script>
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <header class="ova-head"><div class="ova-wrap ova-head__inner">
    <a class="ova-brand" href="/"><img src="/assets/favicon.svg" alt="" width="28" height="28" />Studify</a>
    <a class="ova-btn ova-btn--ghost" href="/#/">Öppna appen</a>
  </div></header>
  <main class="ova-wrap" id="main">
    ${crumbNav}
    ${body}
  </main>
  <footer class="ova-foot"><div class="ova-wrap ova-foot__inner">
    <span>Studify — gratis, utan reklam, byggt på den svenska läroplanen.</span>
    <nav aria-label="Sidfot">
      <a href="/ova">Alla övningar</a>
      <a href="/#/about">Om oss</a>
      <a href="/#/privacy">Integritetspolicy</a>
    </nav>
  </div></footer>
</body>
</html>`;
}

const origin = (req) => `${req.protocol}://${req.get("host")}`;

function send(res, html) {
  res.set("Cache-Control", "public, max-age=600");
  res.type("html").send(html);
}

/* ---------------- routes ---------------- */

practicePages.get(["/ova", "/ova/"], (req, res) => {
  const { levels, subjects, bySubject } = loadLibrary();
  const o = origin(req);
  const total = [...bySubject.values()].reduce((n, sets) => n + sets.reduce((m, s) => m + (s.count || 0), 0), 0);
  const blocks = levels.map((level) => {
    const own = subjects.filter((s) => s.level === level.id);
    if (!own.length) return "";
    return `<section class="ova-level"><h2>${esc(level.label)}</h2><ul class="ova-grid">${own.map((s) => `
      <li><a class="ova-card" href="/ova/${esc(s.id)}"><strong>${esc(s.name)}</strong>
      <span>${bySubject.get(s.id).length} övningsset</span></a></li>`).join("")}</ul></section>`;
  }).join("");
  send(res, page({
    title: "Övningsfrågor med förklaringar – åk 7 till gymnasiet | Studify",
    description: `Över ${Math.floor(total / 100) * 100} gratis övningsfrågor med förklaringar, byggda på den svenska läroplanen. Matematik, svenska, engelska, NO, SO och språk för åk 7–9 och gymnasiet.`,
    canonical: `${o}/ova`,
    crumbs: [["Övningsfrågor", `${o}/ova`]],
    body: `<h1>Övningsfrågor för åk 7 till gymnasiet</h1>
      <p class="ova-lead">Färdiga övningsset byggda på den svenska läroplanen, med förklaring till varje fråga.
      Välj ämne, se exempelfrågor och öva på hela setet gratis i Studify.</p>${blocks}`,
  }));
});

practicePages.get("/ova/:subject", (req, res, next) => {
  const { subjects, bySubject, levelById } = loadLibrary();
  const subject = subjects.find((s) => s.id === req.params.subject);
  if (!subject) return next();
  const level = levelById.get(subject.level);
  const o = origin(req);
  const sets = bySubject.get(subject.id);
  send(res, page({
    title: `${subject.name} ${level.label.toLowerCase()} – övningsfrågor med förklaringar | Studify`,
    description: `${sets.length} gratis övningsset i ${subject.name.toLowerCase()} för ${level.label.toLowerCase()}. ${subject.description || ""}`.trim(),
    canonical: `${o}/ova/${subject.id}`,
    crumbs: [["Övningsfrågor", `${o}/ova`], [`${subject.name}, ${level.label.toLowerCase()}`, `${o}/ova/${subject.id}`]],
    body: `<h1>${esc(subject.name)} – ${esc(level.label.toLowerCase())}</h1>
      ${subject.description ? `<p class="ova-lead">${esc(subject.description)}</p>` : ""}
      <ul class="ova-list">${sets.map((s) => `<li><a class="ova-card" href="${esc(s.path)}">
        <strong>${esc(s.title)}</strong><span>${esc(s.summary || "")}</span>
        <small>${s.count || 0} frågor</small></a></li>`).join("")}</ul>`,
  }));
});

practicePages.get("/ova/:subject/:slug", (req, res, next) => {
  const { bySubject, subjects, levelById, byPath } = loadLibrary();
  const set = byPath.get(`/ova/${req.params.subject}/${req.params.slug}`);
  if (!set) return next();
  const doc = readSet(set);
  if (!doc) return next();
  const subject = subjects.find((s) => s.id === set.subject);
  const level = levelById.get(subject.level);
  const o = origin(req);
  const questions = doc.questions || [];
  const samples = pickSamples(questions);
  const topics = [...new Set(questions.map((q) => q.topic).filter(Boolean))];
  const others = bySubject.get(subject.id).filter((s) => s !== set);
  const start = `/#/start/${encodeURIComponent(set.id)}`;
  const n = questions.length;

  send(res, page({
    title: `${set.title} – ${subject.name} ${level.label.toLowerCase()}: ${n} övningsfrågor | Studify`,
    description: `${set.summary || doc.sourceSummary || ""} ${n} frågor med förklaringar för ${level.label.toLowerCase()}. Se exempel och öva gratis.`.trim(),
    canonical: `${o}${set.path}`,
    crumbs: [["Övningsfrågor", `${o}/ova`], [`${subject.name}, ${level.label.toLowerCase()}`, `${o}/ova/${subject.id}`], [set.title, `${o}${set.path}`]],
    body: `<p class="ova-eyebrow">${esc(subject.name)} · ${esc(level.label)}</p>
      <h1>${esc(set.title)}</h1>
      <p class="ova-lead">${esc(set.summary || doc.sourceSummary || "")}</p>
      <p class="ova-meta">${n} frågor: ${esc(kindCounts(questions))}</p>
      ${topics.length ? `<ul class="ova-topics" aria-label="Moment">${topics.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      <p><a class="ova-btn" href="${esc(start)}">Öva på alla ${n} frågor gratis</a></p>
      <h2>Exempelfrågor</h2>
      <ol class="ova-qs">${samples.map(questionHtml).join("")}</ol>
      <aside class="ova-cta">
        <h2>Resten av setet väntar i appen</h2>
        <p>I Studify får du tips när du kör fast, en handledare som förklarar i stället för att bara rätta,
        och repetition som tar tillbaka varje fråga precis innan du hade glömt den. Gratis, utan konto.</p>
        <a class="ova-btn" href="${esc(start)}">Starta setet</a>
      </aside>
      ${others.length ? `<h2>Fler set i ${esc(subject.name.toLowerCase())}, ${esc(level.label.toLowerCase())}</h2>
        <ul class="ova-list ova-list--compact">${others.map((s) => `<li><a href="${esc(s.path)}">${esc(s.title)}</a></li>`).join("")}</ul>` : ""}`,
  }));
});

practicePages.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  if (!indexing()) return res.send("User-agent: *\nDisallow: /\n");
  res.send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`);
});

practicePages.get("/sitemap.xml", (req, res) => {
  const { subjects, bySubject } = loadLibrary();
  const o = origin(req);
  const urls = [`${o}/`, `${o}/ova`, ...subjects.map((s) => `${o}/ova/${s.id}`),
    ...[...bySubject.values()].flat().map((s) => `${o}${s.path}`)];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>
`);
});
