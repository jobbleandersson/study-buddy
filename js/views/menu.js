// Home menu: a "today" strip, Assignments | Tests tabs, filters, and the card grid.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { masteryByTopic, masteryForAssignment } from "../lib/mastery.js";

// Module-level so the choices survive a re-render (e.g. after deleting a set).
let tab = "assignment";
let subjectFilter = "all";
let sortBy = "recent";
let query = "";

const SORTS = [
  ["recent", "Recently added"],
  ["name", "Name (A–Z)"],
  ["weakest", "Weakest first"],
];

export function renderMenu() {
  const topicMastery = masteryByTopic(store.attempts);

  const grid = el("div.grid");
  const chipsRow = el("div.chips");
  const countLabel = el("p.note");

  const searchInput = el("input.search__input", {
    type: "search", placeholder: "Search sets…", value: query,
    "aria-label": "Search your sets",
    oninput: (e) => { query = e.target.value; paint(); },
  });
  const searchWrap = el("div.search", {}, [icon(ICONS.search, 16), searchInput]);

  const sortSel = el("select.sortsel", {
    "aria-label": "Sort sets",
    onchange: (e) => { sortBy = e.target.value; paint(); },
  }, SORTS.map(([v, l]) => el("option", { value: v }, l)));
  sortSel.value = sortBy;

  const toolsRow = el("div.tools", {}, [searchWrap, sortSel]);

  /* ---------------- painting ---------------- */

  function matchesQuery(a, q) {
    const subject = store.subjects.find((s) => s.id === a.subjectId)?.name || "";
    return (a.title + " " + subject + " " + (a.topics || []).join(" ")).toLowerCase().includes(q);
  }

  function visibleSets() {
    const q = query.trim().toLowerCase();
    let items = store.assignments.filter((a) => a.type === tab);
    if (subjectFilter !== "all") items = items.filter((a) => a.subjectId === subjectFilter);
    if (q) items = items.filter((a) => matchesQuery(a, q));
    if (sortBy === "name") items = [...items].sort((x, y) => x.title.localeCompare(y.title));
    else if (sortBy === "weakest") {
      // Lowest known mastery first. A set you've never studied has *unknown*
      // mastery, not zero, so it sorts after the ones you're measurably weak at.
      items = [...items].sort((x, y) =>
        (masteryForAssignment(x, topicMastery) ?? Infinity) - (masteryForAssignment(y, topicMastery) ?? Infinity));
    } else items = [...items].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    return items;
  }

  function paint() {
    // subject chips, limited to subjects present in this tab
    clear(chipsRow);
    const inTab = store.assignments.filter((a) => a.type === tab);
    chipsRow.appendChild(chip("All", "all", null));
    for (const s of store.subjects) {
      if (!inTab.some((a) => a.subjectId === s.id)) continue;
      chipsRow.appendChild(chip(s.name, s.id, store.subjectColor(s.id)));
    }
    if (subjectFilter !== "all" && !inTab.some((a) => a.subjectId === subjectFilter)) {
      subjectFilter = "all";
    }
    chipsRow.hidden = chipsRow.children.length <= 1;

    // Search + sort only earn their space once there's enough to sift through —
    // but never hide them while a query is active, or the filter becomes
    // invisible state the student can't see or clear.
    toolsRow.hidden = inTab.length < 5 && !query.trim();

    const items = visibleSets();
    clear(grid);
    grid.appendChild(newCard());
    for (const a of items) grid.appendChild(card(a, topicMastery));

    // A search that misses in this tab but hits in the other is a dead end
    // unless we say so — the set the student wants is one click away.
    clear(countLabel);
    const q = query.trim().toLowerCase();
    if (q && !items.length) {
      const otherTab = tab === "assignment" ? "test" : "assignment";
      const otherHits = store.assignments.filter((a) => a.type === otherTab && matchesQuery(a, q)).length;
      countLabel.appendChild(document.createTextNode(
        `No ${tab === "assignment" ? "assignments" : "tests"} match “${query.trim()}”. `));
      if (otherHits) {
        countLabel.appendChild(el("button.linkbtn", {
          type: "button",
          onclick: () => {
            tab = otherTab;
            tabsEl.querySelectorAll(".tab").forEach((b, i) =>
              b.setAttribute("aria-selected", String((i === 0 ? "assignment" : "test") === tab)));
            paint();
          },
        }, `${otherHits} ${otherTab === "test" ? "test" : "assignment"}${otherHits === 1 ? "" : "s"} match — switch to ${otherTab === "test" ? "Tests" : "Assignments"}`));
      }
    }
    countLabel.hidden = !q || !!items.length;

    if (!items.length && !q) grid.appendChild(emptyState());
  }

  function chip(label, value, color) {
    return el("button.chip", {
      type: "button",
      "aria-pressed": String(subjectFilter === value),
      onclick: () => { subjectFilter = value; paint(); },
      style: color ? { "--subject": color.solid, "--subject-ink": color.ink } : {},
    }, [color && el("span.chip__dot"), label].filter(Boolean));
  }

  function card(a, tm) {
    const color = store.subjectColor(a.subjectId);
    const subject = store.subjects.find((s) => s.id === a.subjectId);
    const m = masteryForAssignment(a, tm);
    const attempts = store.attempts.filter((x) => x.assignmentId === a.id).length;
    const open = store.getSession(a.id);
    const openCount = open ? Object.keys(open.items || {}).length : 0;

    const menuBtn = el("button.acard__menu", {
      type: "button", "aria-label": `Options for ${a.title}`, "aria-haspopup": "menu",
      onclick: (e) => { e.stopPropagation(); openCardMenu(e.currentTarget, a); },
    }, [icon(ICONS.dots, 18)]);

    return el("div.acard", {
      role: "button", tabindex: "0",
      style: { "--subject": color.solid, "--subject-ink": color.ink, "--subject-tint": color.tint },
      "aria-label": `${a.title}, ${subject?.name || "General"}, ${a.questions.length} questions${open ? ", in progress" : ""}`,
      onclick: () => { location.hash = `#/session/${a.id}`; },
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.hash = `#/session/${a.id}`; }
      },
    }, [
      menuBtn,
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", paddingRight: "28px" } }, [
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

  function emptyState() {
    const isFirstRun = !store.assignments.length;
    return el("div.empty", { style: { gridColumn: "1 / -1" } }, [
      icon(ICONS.spark, 26),
      el("h3", { style: { marginBottom: "6px" } },
        isFirstRun ? "Your library is empty" : `No ${tab === "assignment" ? "assignments" : "tests"} yet`),
      el("p", {}, isFirstRun
        ? "Make a set from your own notes, a PDF, a photo, or just a topic — or load the demo sets to see how it works."
        : tab === "assignment"
          ? "Make one from your notes, a PDF, a photo, or just a topic."
          : "Create one the same way — just mark it as a test."),
      el("div", { style: { display: "flex", gap: "10px", justifyContent: "center", marginTop: "16px", flexWrap: "wrap" } }, [
        el("a.btn", { href: "#/create" }, [icon(ICONS.plus, 18), "New set"]),
        isFirstRun && store.demoStatus.loaded === 0 && el("button.btn.btn--ghost", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await store.loadDemoContent(); toast("Demo sets added"); }
            catch { toast("Couldn't load the demo sets"); e.currentTarget.disabled = false; }
          },
        }, [icon(ICONS.play, 16), "Try a demo"]),
      ].filter(Boolean)),
    ]);
  }

  /* ---------------- card ⋮ menu ---------------- */

  function openCardMenu(anchor, a) {
    closeCardMenu();
    const menu = el("div.cardmenu", { role: "menu" }, [
      item(ICONS.pencil, "Rename", () => rename(a)),
      item(ICONS.chart, "Edit questions", () => { location.hash = `#/edit/${a.id}`; }),
      item(ICONS.copy, "Duplicate", () => {
        const copy = store.duplicateAssignment(a.id);
        if (copy) toast(`Copied as “${copy.title}”`);
      }),
      item(ICONS.trash, "Delete", () => remove(a), true),
    ]);

    function item(path, label, fn, danger) {
      return el("button.cardmenu__item", {
        type: "button", role: "menuitem",
        class: danger ? "cardmenu__item--danger" : "",
        onclick: (e) => { e.stopPropagation(); closeCardMenu(); fn(); },
      }, [icon(path, 15), label]);
    }

    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + window.scrollY + 4}px`;
    menu.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 190)}px`;
    document.body.appendChild(menu);
    menu.querySelector("button")?.focus();

    setTimeout(() => {
      document.addEventListener("click", closeCardMenu, { once: true });
      document.addEventListener("keydown", escClose);
    }, 0);
  }

  function escClose(e) { if (e.key === "Escape") closeCardMenu(); }

  function closeCardMenu() {
    document.querySelectorAll(".cardmenu").forEach((m) => m.remove());
    document.removeEventListener("keydown", escClose);
  }

  function rename(a) {
    const next = prompt("Rename this set:", a.title);
    if (next == null) return;
    const clean = next.trim();
    if (!clean) { toast("A set needs a name"); return; }
    if (clean === a.title) return;
    store.updateAssignment(a.id, { title: clean });
    toast("Renamed");
  }

  function remove(a) {
    const attempts = store.attempts.filter((x) => x.assignmentId === a.id).length;
    const extra = attempts ? `\n\nThis also removes ${attempts} recorded attempt${attempts === 1 ? "" : "s"} from your history.` : "";
    if (!confirm(`Delete “${a.title}”?${extra}\n\nThis can't be undone.`)) return;
    store.deleteAssignment(a.id);
    toast("Deleted");
  }

  /* ---------------- header + today strip ---------------- */

  const tabsEl = el("div.tabs", { role: "tablist" }, [
    tabBtn("Assignments", "assignment"),
    tabBtn("Tests", "test"),
  ]);
  function tabBtn(label, value) {
    return el("button.tab", {
      role: "tab", "aria-selected": String(tab === value),
      onclick: () => {
        tab = value;
        tabsEl.querySelectorAll(".tab").forEach((b, i) =>
          b.setAttribute("aria-selected", String((i === 0 ? "assignment" : "test") === value)));
        paint();
      },
    }, label);
  }

  paint();

  const node = el("div", {}, [
    el("div.home__head", {}, [
      el("div", {}, [
        el("h1", {}, greeting()),
        el("p.home__hi", {}, store.hasKey()
          ? "Pick something to study, or make a new set."
          : "Running in demo mode — see Settings for how to turn on live mode."),
      ]),
      el("a.btn", { href: "#/create" }, [icon(ICONS.plus, 18), "New set"]),
    ]),
    todayStrip(),
    tabsEl,
    chipsRow,
    toolsRow,
    countLabel,
    grid,
  ]);

  return { title: "Menu", node, cleanup: closeCardMenu };
}

/** A compact row of what actually matters today: review, streak, and the
 *  session you walked away from. Only renders the tiles that apply. */
function todayStrip() {
  const due = store.dueQuestions().length;
  const streak = store.streak;
  const openKey = Object.keys(store.state.sessions)[0];
  const open = openKey ? store.state.sessions[openKey] : null;
  const tiles = [];

  if (due) {
    tiles.push(el("a.tile.tile--accent", { href: "#/review" }, [
      el("span.tile__icon", {}, icon(ICONS.spark, 18)),
      el("span", {}, [
        el("strong", {}, `${due} question${due === 1 ? "" : "s"} due`),
        el("span.tile__sub", {}, "Review across all sets"),
      ]),
    ]));
  }

  if (open) {
    const answered = Object.keys(open.items || {}).length;
    tiles.push(el("a.tile", { href: open.retryHash || (open.isReview ? "#/review" : `#/session/${open.assignmentId}`) }, [
      el("span.tile__icon", {}, icon(ICONS.play, 18)),
      el("span", {}, [
        el("strong", {}, "Continue"),
        el("span.tile__sub", {}, `${open.title} · ${answered} of ${open.order.length} answered`),
      ]),
    ]));
  }

  if (streak > 0) {
    tiles.push(el("a.tile", { href: "#/progress" }, [
      el("span.tile__icon", {}, icon(ICONS.flame, 18)),
      el("span", {}, [
        el("strong", {}, `${streak}-day streak`),
        el("span.tile__sub", {}, "See your progress"),
      ]),
    ]));
  }

  const strip = el("div.today", {}, tiles);
  strip.hidden = !tiles.length;
  return strip;
}

function ring(v, color) {
  const pct = Math.round(v * 100);
  const wrap = el("span.ring", {
    style: { "--v": pct, "--subject": color },
    title: `${pct}% mastery — how well you've been answering this set's topics`,
  });
  wrap.innerHTML =
    `<svg viewBox="0 0 36 36" aria-hidden="true">` +
    `<circle class="ring__bg" cx="18" cy="18" r="15.9"/>` +
    `<circle class="ring__fg" cx="18" cy="18" r="15.9" pathLength="100" transform="rotate(-90 18 18)"/>` +
    `<text class="ring__label" x="18" y="18" text-anchor="middle" dominant-baseline="central">${pct}</text>` +
    `</svg>`;
  return wrap;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
