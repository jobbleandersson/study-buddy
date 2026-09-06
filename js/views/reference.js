// Formelsamling — a static formula reference for Maths / Physics / Chemistry.
// No key, no backend: the content is a JSON file, rendered with the KaTeX that
// is already vendored. Swedish by default, with an English file that falls
// back to the Swedish one if a translation isn't there.

import { el, clear, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { t, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

let cached = null;

async function loadFormulas() {
  if (cached) return cached;
  const lang = getLang();
  const primary = lang === "en" ? "data/reference/formulas.en.json" : "data/reference/formulas.sv.json";
  let res = await fetch(primary);
  if (!res.ok && lang === "en") res = await fetch("data/reference/formulas.sv.json");
  if (!res.ok) throw new Error(String(res.status));
  cached = await res.json();
  return cached;
}

export async function renderReference() {
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
  let activeId = sections[0]?.id || "";
  let query = "";

  const body = el("div.ref__body");
  const tabsEl = el("div.tabs.ref__tabs", { role: "tablist" });
  const searchInput = el("input.search__input", {
    type: "search", placeholder: t("ref.search"), "aria-label": t("ref.search"),
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); paint(); },
  });

  function paintTabs() {
    clear(tabsEl);
    tabsEl.hidden = !!query;
    for (const s of sections) {
      tabsEl.appendChild(el("button.tab", {
        role: "tab", "aria-selected": String(s.id === activeId),
        onclick: () => { activeId = s.id; paint(); },
      }, s.name));
    }
  }

  function formulaRow(item) {
    return el("div.ref__item", {}, [
      el("div.ref__item-head", {}, [
        el("span.ref__name", {}, item.name),
        el("span.ref__formula", { html: renderRich("$" + item.formula + "$") }),
      ]),
      item.note ? el("p.ref__note", { html: renderRich(item.note) }) : null,
    ].filter(Boolean));
  }

  function groupBlock(group) {
    return el("section.ref__group", {}, [
      el("h3", {}, group.name),
      el("div.ref__items", {}, group.items.map(formulaRow)),
    ]);
  }

  function paint() {
    paintTabs();
    clear(body);

    if (query) {
      const hits = [];
      for (const s of sections) {
        for (const g of s.groups || []) {
          const items = (g.items || []).filter((i) =>
            (i.name + " " + (i.note || "") + " " + s.name + " " + g.name).toLowerCase().includes(query));
          if (items.length) hits.push({ label: `${s.name} · ${g.name}`, items });
        }
      }
      if (!hits.length) {
        body.appendChild(el("p.note", {}, t("ref.noHits", { q: searchInput.value.trim() })));
        return;
      }
      for (const h of hits) {
        body.appendChild(el("section.ref__group", {}, [
          el("h3", {}, h.label),
          el("div.ref__items", {}, h.items.map(formulaRow)),
        ]));
      }
      return;
    }

    const section = sections.find((s) => s.id === activeId) || sections[0];
    for (const g of section.groups || []) body.appendChild(groupBlock(g));
  }

  paint();

  return {
    title: t("ref.title"),
    node: el("div.ref", {}, [
      homeButton(),
      el("h1", { style: { marginBottom: "4px" } }, t("ref.title")),
      el("p.note", { style: { marginBottom: "16px" } }, t("ref.sub")),
      el("div.search", { style: { marginBottom: "14px" } }, [icon(ICONS.search, 16), searchInput]),
      tabsEl,
      body,
    ]),
  };
}
