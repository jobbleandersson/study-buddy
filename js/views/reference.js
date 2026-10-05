// Formelsamling — a formula reference for Maths, Physics, Chemistry, and constants & units.
// No key, no backend: the content is data/reference/formulas.{sv,en}.json (one entry per formula:
// name, KaTeX formula, what each symbol means with its unit, a level — högstadiet or gymnasiet —
// and an optional note), rendered with the KaTeX that is already vendored. Swedish by default, with
// an English file that falls back to the Swedish one if it can't be fetched.
//
// One subject at a time, grouped, with a contents list beside it on wide screens; a level filter;
// a search that looks through every subject (names, symbols' meanings, notes and keywords); and a
// print button that prints the subject on screen as a clean sheet. ?s=<subject>&n=<level> keeps
// the choice in the address, so a link (or a reload) opens the same view.

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

// Per language — the app switches language in place, so one shared slot would
// keep showing whichever language was loaded first.
const cached = {};

async function loadFormulas() {
  const lang = getLang();
  if (cached[lang]) return cached[lang];
  const primary = lang === "en" ? "data/reference/formulas.en.json" : "data/reference/formulas.sv.json";
  let res = await fetch(primary);
  if (!res.ok && lang === "en") res = await fetch("data/reference/formulas.sv.json");
  if (!res.ok) throw new Error(String(res.status));
  cached[lang] = await res.json();
  return cached[lang];
}

// Each subject's colour and icon, used for its tab, its group headings and the formula panels.
const SUBJECT_STYLE = {
  ma: { c: "var(--brand)", icon: "sigma" },
  fy: { c: "var(--c-ocean)", icon: "atom" },
  ke: { c: "var(--c-leaf)", icon: "flask" },
  ko: { c: "var(--c-grape)", icon: "ruler" },
};
const LEVELS = ["hs", "gy"];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Plain text with every occurrence of `q` marked, for search hits. */
function marked(text, q) {
  const s = String(text || "");
  if (!q) return esc(s);
  const lower = s.toLowerCase();
  let out = "", i = 0, at;
  while ((at = lower.indexOf(q, i)) !== -1) {
    out += esc(s.slice(i, at)) + "<mark>" + esc(s.slice(at, at + q.length)) + "</mark>";
    i = at + q.length;
  }
  return out + esc(s.slice(i));
}
const math = (tex) => renderRich("$" + tex + "$");

/** Everything a search can find an item by. */
function haystack(item, section, group) {
  return [
    item.name, item.note, item.keywords, section.name, group.name,
    ...(item.vars || []).map((v) => v[1]),
    ...(item.table || []).map((r) => `${r[0]} ${r[1]}`),
  ].filter(Boolean).join(" ").toLowerCase();
}

export async function renderReference(qs) {
  let data;
  try {
    data = await loadFormulas();
  } catch {
    return {
      title: t("ref.title"),
      node: el("div.empty", {}, [
        icon(ICONS.sigma, 26),
        el("h2", {}, t("ref.loadFail")),
        el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
      ]),
    };
  }

  const sections = data.sections || [];
  const total = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0);
  let activeId = sections.some((s) => s.id === qs?.get?.("s")) ? qs.get("s") : sections[0]?.id || "";
  let level = LEVELS.includes(qs?.get?.("n")) ? qs.get("n") : "";
  let query = "";

  const fits = (item) => !level || item.level === level;
  const countIn = (section) => section.groups.reduce((n, g) => n + g.items.filter(fits).length, 0);

  /** Keep the subject and level in the address without a navigation (and without a re-render). */
  function remember() {
    const p = new URLSearchParams();
    if (activeId !== sections[0]?.id) p.set("s", activeId);
    if (level) p.set("n", level);
    const hash = `#/reference${p.toString() ? `?${p}` : ""}`;
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
  }

  /* ---------- controls ---------- */
  const searchInput = el("input.search__input", {
    type: "search", placeholder: t("ref.search"), "aria-label": t("ref.search"),
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); paint(); },
  });
  const tabsEl = el("div.ref__tabs", { role: "tablist", "aria-label": t("ref.subjects") });
  const levelsEl = el("div.ref__levels", { role: "group", "aria-label": t("ref.levels") });
  const tocEl = el("nav.ref__toc", { "aria-label": t("ref.toc") });
  const resultEl = el("p.ref__result", { role: "status" });
  const body = el("div.ref__body");

  function paintControls() {
    clear(tabsEl);
    for (const s of sections) {
      const style = SUBJECT_STYLE[s.id] || SUBJECT_STYLE.ma;
      const on = s.id === activeId && !query;
      tabsEl.appendChild(el("button.ref__tab", {
        type: "button", role: "tab", "aria-selected": String(on), style: { "--c": style.c },
        onclick: () => {
          activeId = s.id;
          if (query) { query = ""; searchInput.value = ""; }
          remember();
          paint();
        },
      }, [
        el("span.ref__tabic", { "aria-hidden": "true" }, [icon(ICONS[style.icon] || ICONS.sigma, 17)]),
        el("span.ref__tabname", {}, s.name),
        el("span.ref__tabcount", {}, String(countIn(s))),
      ]));
    }
    clear(levelsEl);
    for (const v of ["", ...LEVELS]) {
      levelsEl.appendChild(el("button.ref__level", {
        type: "button", "aria-pressed": String(v === level),
        onclick: () => { level = v; remember(); paint(); },
      }, t(v ? `ref.level.${v}` : "ref.levelAll")));
    }
  }

  /* ---------- formulas ---------- */
  function card(item, q) {
    const vars = item.vars || [];
    return el("article.ref__card", { id: `ref-${item.id}` }, [
      el("div.ref__cardhead", {}, [
        el("h3.ref__name", { html: marked(item.name, q) }),
        el(`span.ref__lvl.is-${item.level}`, {}, t(`ref.level.${item.level}`)),
      ]),
      // A formula with several parts ("…, \quad …") is set as separate pieces, so a narrow card wraps
      // between them instead of breaking one in the middle.
      item.formula ? el("div.ref__math", {}, item.formula.split(/,\s*\\quad\s*/).map((part) => el("span.ref__part", { html: math(part) }))) : null,
      item.table ? el("table.ref__table", {}, [
        el("thead", {}, [el("tr", {}, [el("th", {}, t("ref.colPrefix")), el("th", {}, t("ref.colName")), el("th", {}, t("ref.colFactor"))])]),
        el("tbody", {}, item.table.map(([sym, name, val]) => el("tr", {}, [
          el("td.ref__sym", {}, sym), el("td", { html: marked(name, q) }), el("td", { html: math(val) }),
        ]))),
      ]) : null,
      vars.length ? el("dl.ref__vars", { "aria-label": t("ref.symbols") }, vars.flatMap(([sym, meaning, unit]) => [
        el("dt", { html: math(sym) }),
        el("dd", {}, [el("span", { html: marked(meaning, q) }), unit ? el("span.ref__unit", {}, unit) : null].filter(Boolean)),
      ])) : null,
      item.note ? el("p.ref__note", { html: marked(item.note, q) }) : null,
    ].filter(Boolean));
  }

  function groupBlock(section, group, items, { label = group.name, q = "" } = {}) {
    const style = SUBJECT_STYLE[section.id] || SUBJECT_STYLE.ma;
    return el("section.ref__group", { id: `ref-g-${section.id}-${group.id}`, style: { "--c": style.c } }, [
      el("header.ref__grouphead", {}, [
        el("h2", {}, [el("i", { "aria-hidden": "true" }), label]),
        el("span", {}, String(items.length)),
      ]),
      el("div.ref__grid", {}, items.map((it) => card(it, q))),
    ]);
  }

  function paintToc(section, groups) {
    clear(tocEl);
    tocEl.hidden = !!query || groups.length < 2;
    if (tocEl.hidden) return;
    tocEl.append(
      el("p.ref__tochead", {}, t("ref.toc")),
      el("ol", {}, groups.map(({ group, items }) => el("li", {}, [
        el("button", {
          type: "button",
          onclick: () => document.getElementById(`ref-g-${section.id}-${group.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
        }, [el("span", {}, group.name), el("span.ref__toccount", {}, String(items.length))]),
      ]))),
    );
  }

  function paint() {
    paintControls();
    clear(body);

    if (query) {
      const hits = [];
      for (const s of sections) {
        for (const g of s.groups) {
          const items = g.items.filter((it) => fits(it) && haystack(it, s, g).includes(query));
          if (items.length) hits.push({ s, g, items });
        }
      }
      const n = hits.reduce((m, h) => m + h.items.length, 0);
      resultEl.hidden = false;
      resultEl.textContent = n ? plural(n, "ref.hitOne", "ref.hitMany") : t("ref.noHits", { q: searchInput.value.trim() });
      paintToc(null, []);
      for (const h of hits) body.appendChild(groupBlock(h.s, h.g, h.items, { label: `${h.s.name} · ${h.g.name}`, q: query }));
      return;
    }

    resultEl.hidden = true;
    const section = sections.find((s) => s.id === activeId) || sections[0];
    const groups = section.groups.map((group) => ({ group, items: group.items.filter(fits) })).filter((x) => x.items.length);
    paintToc(section, groups);
    for (const { group, items } of groups) body.appendChild(groupBlock(section, group, items));
  }

  paint();

  return {
    title: t("ref.title"),
    node: el("div.ref", {}, [
      homeButton(),
      el("header.ref__head", {}, [
        el("div", {}, [el("h1", {}, t("ref.title")), el("p.ref__sub", {}, t("ref.sub", { n: total }))]),
        el("button.btn.btn--ghost.btn--sm.ref__print", { type: "button", onclick: () => window.print() },
          [icon(ICONS.fileText, 16), t("ref.print")]),
      ]),
      el("div.ref__controls", {}, [
        el("div.search.ref__search", {}, [icon(ICONS.search, 16), searchInput]),
        tabsEl,
        levelsEl,
      ]),
      resultEl,
      el("div.ref__layout", {}, [tocEl, body]),
    ]),
  };
}
