// Home menu: Assignments | Tests tabs, subject filter chips, card grid.

import { store } from "../store.js";
import { el, clear, icon, ICONS } from "../lib/dom.js";
import { masteryByTopic, masteryForAssignment } from "../lib/mastery.js";

let tab = "assignment";
let subjectFilter = "all";

export function renderMenu() {
  const topicMastery = masteryByTopic(store.attempts);

  const grid = el("div.grid");
  const chipsRow = el("div.chips");

  function paint() {
    // chips
    clear(chipsRow);
    chipsRow.appendChild(chip("All", "all", null));
    const inTab = store.assignments.filter((a) => a.type === tab);
    for (const s of store.subjects) {
      if (!inTab.some((a) => a.subjectId === s.id)) continue;
      chipsRow.appendChild(chip(s.name, s.id, store.subjectColor(s.id)));
    }
    chipsRow.hidden = chipsRow.children.length <= 1;

    // cards
    clear(grid);
    const items = store.assignments.filter((a) =>
      a.type === tab && (subjectFilter === "all" || a.subjectId === subjectFilter));

    grid.appendChild(newCard());
    for (const a of items) grid.appendChild(card(a, topicMastery));

    if (!items.length) {
      grid.appendChild(el("div.empty", { style: { gridColumn: "1 / -1" } }, [
        icon(ICONS.spark, 26),
        el("p", {}, tab === "assignment"
          ? "No assignments yet. Make one from your notes, a PDF, a photo, or just a topic."
          : "No tests yet. Create one the same way — just mark it as a test."),
      ]));
    }
  }

  function chip(label, value, color) {
    const c = el("button.chip", {
      type: "button",
      "aria-pressed": String(subjectFilter === value),
      onclick: () => { subjectFilter = value; paint(); },
      style: color ? { "--subject": color.solid } : {},
    }, [color && el("span.chip__dot"), label].filter(Boolean));
    return c;
  }

  function card(a, tm) {
    const color = store.subjectColor(a.subjectId);
    const subject = store.subjects.find((s) => s.id === a.subjectId);
    const m = masteryForAssignment(a, tm);
    const attempts = store.attempts.filter((x) => x.assignmentId === a.id).length;
    const open = store.getSession(a.id);
    const openCount = open ? Object.keys(open.items || {}).length : 0;

    return el("button.acard", {
      type: "button",
      style: { "--subject": color.solid, "--subject-tint": color.tint },
      "aria-label": `${a.title}, ${subject?.name || "General"}, ${a.questions.length} questions${open ? ", in progress" : ""}`,
      onclick: () => { location.hash = `#/session/${a.id}`; },
    }, [
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, [
        el("span.acard__tag", {}, subject?.name || "General"),
        open && el("span.acard__tag.acard__tag--open", {}, "In progress"),
      ].filter(Boolean)),
      el("div.acard__title", {}, a.title),
      el("div.acard__meta", {}, [
        el("span", {}, open
          ? `${openCount} of ${a.questions.length} answered`
          : `${a.questions.length} question${a.questions.length === 1 ? "" : "s"}${attempts ? ` · done ${attempts}×` : ""}`),
        m == null ? el("span", { style: { color: "var(--subject)" }, "aria-hidden": "true" }, icon(ICONS.arrow, 18))
          : ring(m, color.solid),
      ]),
    ]);
  }

  function newCard() {
    return el("button.acard.acard--new", {
      type: "button",
      onclick: () => { location.hash = "#/create"; },
    }, [icon(ICONS.plus, 22), "New " + (tab === "assignment" ? "assignment" : "test")]);
  }

  const tabsEl = el("div.tabs", { role: "tablist" }, [
    tabBtn("Assignments", "assignment"),
    tabBtn("Tests", "test"),
  ]);
  function tabBtn(label, value) {
    return el("button.tab", {
      role: "tab", "aria-selected": String(tab === value),
      onclick: () => { tab = value; subjectFilter = "all"; tabsEl.querySelectorAll(".tab").forEach((b, i) => b.setAttribute("aria-selected", String((i === 0 ? "assignment" : "test") === value))); paint(); },
    }, label);
  }

  paint();

  const node = el("div", {}, [
    el("div.home__head", {}, [
      el("div", {}, [
        el("h1", {}, greeting()),
        el("p.home__hi", {}, store.hasKey()
          ? "Pick something to study, or make a new set."
          : "Try a sample below. Add a Claude key in Settings to generate your own."),
      ]),
      el("a.btn", { href: "#/create" }, [icon(ICONS.plus, 18), "New set"]),
    ]),
    tabsEl,
    chipsRow,
    grid,
  ]);

  return { title: "Menu", node };
}

function ring(v, color) {
  const pct = Math.round(v * 100);
  const wrap = el("span.ring", { style: { "--v": pct, "--subject": color }, title: `${pct}% mastery`, "aria-label": `${pct}% mastery` });
  wrap.innerHTML = `<svg viewBox="0 0 36 36"><circle class="ring__bg" cx="18" cy="18" r="15.9"/><circle class="ring__fg" cx="18" cy="18" r="15.9" pathLength="100" transform="rotate(-90 18 18)"/></svg>`;
  return wrap;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
