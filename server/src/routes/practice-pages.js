import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteLocked } from "../gate.js";

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
// Indexing is off until PUBLIC_INDEXING=true: every response carries noindex (meta tag here, plus an
// X-Robots-Tag header on everything in index.js), so a private deployment stays out of search results. (SITE_PASSWORD, when
// set, also hides these pages entirely: see the first route below.)

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
  // Not cached: a dir that isn't found yet (e.g. mounted moments after this process started)
  // should keep being retried on the next request, not lock in an empty library forever.
  if (!dir) return { levels: [], subjects: [], sets: [], bySubject: new Map(), byPath: new Map() };
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

/** Up to n questions that show the set's range, alternating multiple-choice with everything else
 *  (worked problem, flashcard, free text) so a set with few or no mc questions still fills out. */
export function pickSamples(questions, n = SAMPLE_COUNT) {
  const mc = questions.filter((q) => q.kind === "mc");
  const other = questions.filter((q) => q.kind !== "mc");
  const picked = [];
  let mi = 0, oi = 0;
  while (picked.length < n && (mi < mc.length || oi < other.length)) {
    if (mi < mc.length) picked.push(mc[mi++]);
    if (picked.length < n && oi < other.length) picked.push(other[oi++]);
  }
  return picked;
}

/* ---------------- Högskoleprovet, loaded once ---------------- */

// The eight delprov in the test's order: how many a real provpass has and the test's pace (PASS_COUNT
// and SEC_PER_Q in js/lib/hp.js), and what the delprov asks for. Each gets /hogskoleprovet/<dp>.
const HP_DELPROV = [
  { dp: "ord", code: "ORD", name: "Ordförståelse", pass: 10, sec: 18,
    about: "Du får ett ord och fem alternativ och väljer det som ligger närmast i betydelse. Orden kommer ofta från samhälle, vetenskap och kultur, och ett stort ordförråd byggs bäst med regelbunden repetition." },
  { dp: "las", code: "LÄS", name: "Svensk läsförståelse", pass: 10, sec: 132,
    about: "Du läser svenska sakprosatexter och svarar på frågor om huvudtanke, detaljer, slutsatser och ord i sammanhang. Svaret ska alltid gå att belägga i texten." },
  { dp: "mek", code: "MEK", name: "Meningskomplettering", pass: 10, sec: 48,
    about: "En mening har en eller två luckor, och du väljer de ord som passar bäst. Signalord som trots, men och eftersom visar ofta vilket svar som håller." },
  { dp: "elf", code: "ELF", name: "Engelsk läsförståelse", pass: 10, sec: 132,
    about: "Du läser engelska texter och svarar på frågor om innehållet. Frågorna liknar dem i LÄS, men texterna och alternativen är på engelska." },
  { dp: "xyz", code: "XYZ", name: "Matematisk problemlösning", pass: 12, sec: 60,
    about: "Matematiska problem inom aritmetik, algebra, geometri, funktioner, statistik och sannolikhet. Du har inga hjälpmedel, så det gäller att räkna smart." },
  { dp: "kva", code: "KVA", name: "Kvantitativa jämförelser", pass: 10, sec: 60,
    about: "Du jämför två kvantiteter och avgör om den ena är större, om de är lika stora eller om informationen inte räcker för att avgöra det. Svarsalternativen är alltid desamma." },
  { dp: "nog", code: "NOG", name: "Kvantitativa resonemang", pass: 6, sec: 100,
    about: "Du får en fråga och två påståenden och avgör om informationen räcker för att svara: med det ena, det andra, båda tillsammans eller inte ens då. Du behöver inte räkna ut svaret, bara avgöra om det går." },
  { dp: "dtk", code: "DTK", name: "Diagram, tabeller och kartor", pass: 12, sec: 115,
    about: "Du läser av och tolkar diagram, tabeller och kartor. Många frågor handlar om procent, förändringar och att hitta rätt uppgift bland mycket information." },
];
const HP_BY_DP = new Map(HP_DELPROV.map((d) => [d.dp, d]));

let hp = null;

function loadHp() {
  if (hp) return hp;
  const dir = findLibraryDir();
  if (!dir || !fs.existsSync(path.join(dir, "hp-index.json"))) return { sets: new Map(), count: new Map(), dir };
  const index = JSON.parse(fs.readFileSync(path.join(dir, "hp-index.json"), "utf8"));
  const sets = new Map(HP_DELPROV.map((d) => [d.dp, []]));
  const count = new Map(HP_DELPROV.map((d) => [d.dp, 0]));
  for (const entry of index.sets) {
    const dp = String(entry.subject || "").replace(/^hp-/, "");
    if (!sets.has(dp)) continue;
    sets.get(dp).push(entry);
    count.set(dp, count.get(dp) + (entry.count || 0));
  }
  hp = { sets, count, dir };
  return hp;
}

/** Three sample questions for a delprov, from its first set. A reading delprov takes them from one
 *  text, which is shown once above them. -> { passage, questions } */
function hpSamples(dp) {
  const { sets, dir } = loadHp();
  const first = sets.get(dp)?.[0];
  if (!first) return { passage: null, questions: [] };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.join(dir, path.basename(first.file)), "utf8")); } catch { return { passage: null, questions: [] }; }
  const questions = (doc.questions || []).filter((q) => q.kind === "mc");
  if (dp === "las" || dp === "elf") {
    const stimulus = questions.find((q) => q.stimulus?.body)?.stimulus;
    if (!stimulus) return { passage: null, questions: questions.slice(0, SAMPLE_COUNT) };
    return { passage: stimulus, questions: questions.filter((q) => q.stimulus?.id === stimulus.id).slice(0, SAMPLE_COUNT) };
  }
  return { passage: null, questions: questions.slice(0, SAMPLE_COUNT) };
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

/** One Högskoleprov question: what it builds on (the two quantities, the two statements, the figure),
 *  then the question, the options and the answer behind a disclosure. */
function hpQuestionHtml(q, i, all) {
  let lead = "";
  const s = q.stimulus || {};
  if (Array.isArray(s.quantities)) {
    lead = `<div class="ova-kva"><div><small>Kvantitet I</small>${rich(s.quantities[0])}</div><div><small>Kvantitet II</small>${rich(s.quantities[1])}</div></div>`
      + (s.given ? `<p class="ova-given"><strong>Givet:</strong> ${rich(s.given)}</p>` : "");
  }
  if (Array.isArray(s.statements)) {
    lead = `<ol class="ova-nog">${s.statements.map((t, k) => `<li><strong>(${k + 1})</strong> ${rich(t)}</li>`).join("")}</ol>`;
  }
  // A figure the question before already showed isn't drawn twice in a row.
  if (q.figure?.src && all?.[i - 1]?.figure?.src === q.figure.src) {
    lead = `<p class="ova-meta">Samma diagram som i fråga ${i}.</p>`;
  } else if (q.figure?.src) {
    lead = `<figure class="ova-fig"><img src="/data/library/figures/${esc(q.figure.src)}" alt="${esc(q.figure.alt || "")}" loading="lazy" /></figure>`;
  }
  return `<li class="ova-q">
    <p class="ova-q__n">Fråga ${i + 1}</p>
    ${Array.isArray(s.statements) ? rich(q.prompt, "p") + lead : lead + rich(q.prompt, "p")}
    <ol class="ova-choices" type="A">${q.choices.map((c) => `<li>${rich(c)}</li>`).join("")}</ol>
    <details class="ova-q__ans"><summary>Visa svar och förklaring</summary>
      <p><strong>Rätt svar: ${"ABCDE"[q.answer] || ""}.</strong> ${rich(q.choices[q.answer])}</p>${q.explanation ? rich(q.explanation, "p") : ""}
    </details>
  </li>`;
}

function page({ title, description, canonical, crumbs, body, noindex = false }) {
  const robots = indexing() && !noindex ? "index, follow" : "noindex, nofollow";
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
  <meta property="og:site_name" content="PluggEra" />
  <meta property="og:locale" content="sv_SE" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(new URL("/assets/og-pluggera.jpg", canonical).href)}" />
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
    <a class="ova-brand" href="/"><img src="/assets/favicon.svg" alt="" width="28" height="28" />PluggEra</a>
    <a class="ova-btn ova-btn--ghost" href="/#/">Öppna appen</a>
  </div></header>
  <main class="ova-wrap" id="main">
    ${crumbNav}
    ${body}
  </main>
  <footer class="ova-foot"><div class="ova-wrap ova-foot__inner">
    <span>PluggEra — gratis, utan reklam, byggt på den svenska läroplanen.</span>
    <nav aria-label="Sidfot">
      <a href="/ova">Alla övningar</a>
      <a href="/hogskoleprovet">Högskoleprovet</a>
      <a href="/#/about">Om oss</a>
      <a href="/#/privacy">Integritetspolicy</a>
    </nav>
  </div></footer>
</body>
</html>`;
}

const origin = (req) => `${req.protocol}://${req.get("host")}`;

// A stale/mistyped /ova/... link: answer a real 404 (never indexed, whatever PUBLIC_INDEXING says)
// instead of falling through to the app shell, which a search engine would read as a live 200 page.
function sendNotFound(req, res) {
  const o = origin(req);
  res.status(404);
  send(res, page({
    title: "Sidan hittades inte | PluggEra",
    description: "Den här övningssidan finns inte, eller har flyttats.",
    canonical: `${o}${req.path}`,
    crumbs: [["Övningsfrågor", `${o}/ova`]],
    noindex: true,
    body: `<h1>Sidan hittades inte</h1>
      <p class="ova-lead">Vi kunde inte hitta den övningssidan. Den kan ha tagits bort eller bytt namn.</p>
      <p><a class="ova-btn" href="/ova">Se alla övningsämnen</a></p>`,
  }));
}

function send(res, html) {
  // Private while SITE_PASSWORD gates the site: a shared proxy/CDN must not cache and replay an
  // authenticated response to a later visitor who hasn't entered the password.
  res.set("Cache-Control", process.env.SITE_PASSWORD ? "private, max-age=600" : "public, max-age=600");
  res.type("html").send(html);
}

/* ---------------- routes ---------------- */

// Private site (see ../gate.js): the public practice pages are part of what's kept private.
practicePages.use((req, res, next) => {
  if (!siteLocked()) return next();
  // Lower-cased: Express matches routes case-insensitively, so /OVA and /Sitemap.xml reach them too.
  const p = req.path.toLowerCase();
  if (p === "/sitemap.xml") return res.status(404).end();
  if (p === "/ova" || p.startsWith("/ova/") || p === "/hogskoleprovet" || p.startsWith("/hogskoleprovet/")) return res.redirect(302, "/");
  next();
});

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
    title: "Övningsfrågor med förklaringar – åk 7 till gymnasiet | PluggEra",
    description: `Över ${Math.floor(total / 100) * 100} gratis övningsfrågor med förklaringar, byggda på den svenska läroplanen. Matematik, svenska, engelska, NO, SO och språk för åk 7–9 och gymnasiet.`,
    canonical: `${o}/ova`,
    crumbs: [["Övningsfrågor", `${o}/ova`]],
    body: `<h1>Övningsfrågor för åk 7 till gymnasiet</h1>
      <p class="ova-lead">Färdiga övningsset byggda på den svenska läroplanen, med förklaring till varje fråga.
      Välj ämne, se exempelfrågor och öva på hela setet gratis i PluggEra.</p>${blocks}`,
  }));
});

practicePages.get("/ova/:subject", (req, res) => {
  const { subjects, bySubject, levelById } = loadLibrary();
  const subject = subjects.find((s) => s.id === req.params.subject);
  if (!subject) return sendNotFound(req, res);
  const level = levelById.get(subject.level);
  const o = origin(req);
  const sets = bySubject.get(subject.id);
  send(res, page({
    title: `${subject.name} ${level.label.toLowerCase()} – övningsfrågor med förklaringar | PluggEra`,
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

practicePages.get("/ova/:subject/:slug", (req, res) => {
  const { bySubject, subjects, levelById, byPath } = loadLibrary();
  const set = byPath.get(`/ova/${req.params.subject}/${req.params.slug}`);
  if (!set) return sendNotFound(req, res);
  const doc = readSet(set);
  if (!doc) return sendNotFound(req, res);
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
    title: `${set.title} – ${subject.name} ${level.label.toLowerCase()}: ${n} övningsfrågor | PluggEra`,
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
        <p>I PluggEra får du tips när du kör fast, en handledare som förklarar i stället för att bara rätta,
        och repetition som tar tillbaka varje fråga precis innan du hade glömt den. Gratis, utan konto.</p>
        <a class="ova-btn" href="${esc(start)}">Starta setet</a>
      </aside>
      ${others.length ? `<h2>Fler set i ${esc(subject.name.toLowerCase())}, ${esc(level.label.toLowerCase())}</h2>
        <ul class="ova-list ova-list--compact">${others.map((s) => `<li><a href="${esc(s.path)}">${esc(s.title)}</a></li>`).join("")}</ul>` : ""}`,
  }));
});

// Högskoleprovet: one page for the whole test and one per delprov, at addresses a search for
// "högskoleprovet NOG" can land on. The practice itself happens in the app (#/hp, #/hp/<dp>).
const HP_NOTE = "Alla uppgifter är egenskrivna övningsuppgifter i provets format, inte officiella provfrågor.";

practicePages.get(["/hogskoleprovet", "/hogskoleprovet/"], (req, res) => {
  const { count } = loadHp();
  const o = origin(req);
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  const card = (d) => `<li><a class="ova-card" href="/hogskoleprovet/${d.dp}"><strong>${esc(d.code)} – ${esc(d.name)}</strong>
    <span>${count.get(d.dp) || 0} övningsuppgifter</span></a></li>`;
  send(res, page({
    title: "Högskoleprovet – gratis övning på alla åtta delprov | PluggEra",
    description: `${total} gratis övningsuppgifter till högskoleprovet med förklaringar: ORD, LÄS, MEK, ELF, XYZ, KVA, NOG och DTK. Öva i provformat och få en uppskattad normerad poäng.`,
    canonical: `${o}/hogskoleprovet`,
    crumbs: [["Högskoleprovet", `${o}/hogskoleprovet`]],
    body: `<h1>Plugga till högskoleprovet</h1>
      <p class="ova-lead">Öva på alla åtta delprov i provets format, med en förklaring till varje uppgift. Gör ett helt provpass
      på 55 minuter och få en uppskattad normerad poäng. Gratis.</p>
      <p><a class="ova-btn" href="/#/hp">Börja öva</a></p>
      <h2>Verbal del</h2>
      <ul class="ova-grid ova-grid--four">${HP_DELPROV.slice(0, 4).map(card).join("")}</ul>
      <h2>Kvantitativ del</h2>
      <ul class="ova-grid ova-grid--four">${HP_DELPROV.slice(4).map(card).join("")}</ul>
      <h2>Så är provet uppbyggt</h2>
      <p>Högskoleprovet har en verbal och en kvantitativ del. Fyra provpass räknas, två av varje slag, och varje pass har
      40 uppgifter och 55 minuter. Resultatet ges som en normerad poäng mellan 0,00 och 2,00, för varje del och för hela provet.</p>
      <aside class="ova-cta">
        <h2>Öva som på riktigt</h2>
        <p>I PluggEra kan du träna ett delprov i taget med lösningar direkt, eller göra ett provpass under provets villkor:
        klocka, inga tips och rättning i slutet. Frågor du missar kommer tillbaka tills de sitter. ${HP_NOTE}</p>
        <a class="ova-btn" href="/#/hp/prov">Gör ett provpass</a>
      </aside>`,
  }));
});

practicePages.get("/hogskoleprovet/:dp", (req, res) => {
  const d = HP_BY_DP.get(String(req.params.dp).toLowerCase());
  if (!d) return sendNotFound(req, res);
  const { count } = loadHp();
  const o = origin(req);
  const n = count.get(d.dp) || 0;
  const { passage, questions } = hpSamples(d.dp);
  const lang = d.dp === "elf" ? ` lang="en"` : "";
  const others = HP_DELPROV.filter((x) => x !== d);
  send(res, page({
    title: `${d.code} – ${d.name}: övningsuppgifter till högskoleprovet | PluggEra`,
    description: `${d.about.split(". ")[0]}. ${n} gratis övningsuppgifter i ${d.code} med förklaringar. Se exempel och öva i provformat.`,
    canonical: `${o}/hogskoleprovet/${d.dp}`,
    crumbs: [["Högskoleprovet", `${o}/hogskoleprovet`], [`${d.code} – ${d.name}`, `${o}/hogskoleprovet/${d.dp}`]],
    body: `<p class="ova-eyebrow">Högskoleprovet · ${d.dp === "ord" || d.dp === "las" || d.dp === "mek" || d.dp === "elf" ? "verbal del" : "kvantitativ del"}</p>
      <h1>${esc(d.code)} – ${esc(d.name)}</h1>
      <p class="ova-lead">${esc(d.about)}</p>
      <p class="ova-meta">På provet: ${d.pass} uppgifter per provpass, ungefär ${d.sec} sekunder per uppgift. Hos oss: ${n} övningsuppgifter med förklaringar.</p>
      <p><a class="ova-btn" href="/#/hp/${d.dp}">Öva på ${esc(d.code)} gratis</a></p>
      <h2>Exempeluppgifter</h2>
      ${passage ? `<article class="ova-passage"${lang}><h3>${esc(passage.title || "")}</h3>${String(passage.body || "").split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")}</article>` : ""}
      <ol class="ova-qs"${lang}>${questions.map(hpQuestionHtml).join("")}</ol>
      <aside class="ova-cta">
        <h2>Fler uppgifter väntar i appen</h2>
        <p>Välj hur många uppgifter du vill göra, träna med lösningar direkt eller på provets tid. Uppgifter du missar kommer
        tillbaka tills de sitter. ${HP_NOTE}</p>
        <a class="ova-btn" href="/#/hp/${d.dp}">Öva på ${esc(d.code)}</a>
      </aside>
      <h2>Fler delprov</h2>
      <ul class="ova-list ova-list--compact">${others.map((x) => `<li><a href="/hogskoleprovet/${x.dp}">${esc(x.code)} – ${esc(x.name)}</a></li>`).join("")}</ul>`,
  }));
});

practicePages.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  // Private: crawlers may fetch pages but every response says noindex (see the X-Robots-Tag header
  // in index.js). A "Disallow: /" here would backfire — a crawler that may not fetch a page never
  // sees its noindex, so the bare address can still be listed when something links to it.
  if (!indexing()) return res.send("User-agent: *\nAllow: /\n");
  res.send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin(req)}/sitemap.xml\n`);
});

practicePages.get("/sitemap.xml", (req, res) => {
  const { subjects, bySubject } = loadLibrary();
  const o = origin(req);
  const urls = [`${o}/`, `${o}/ova`, `${o}/hogskoleprovet`, ...HP_DELPROV.map((d) => `${o}/hogskoleprovet/${d.dp}`),
    ...subjects.map((s) => `${o}/ova/${s.id}`),
    ...[...bySubject.values()].flat().map((s) => `${o}${s.path}`)];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>
`);
});
