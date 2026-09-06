// The practice library: pick a level, then a subject, and see just that
// subject's sets — instead of one endless page. Works with no API key; every
// set is a static file that's copied into the student's own library on "Add".

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { loadLibraryIndex, loadLibraryTranslations, isImported, importSet } from "../data/library.js";

export async function renderLibrary() {
  let index, tr;
  try {
    index = await loadLibraryIndex();
    tr = getLang() === "en" ? await loadLibraryTranslations() : { levels: {}, subjects: {}, sets: {} };
  } catch {
    return {
      title: t("lib.title"),
      node: el("div.empty", {}, [
        el("h2", {}, t("lib.loadFail")),
        el("p", {}, t("lib.loadFailBody")),
        el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
      ]),
    };
  }

  // The library ships Swedish-curriculum content; in English mode these read
  // the index.en.json overlay and fall back to the Swedish original for any id
  // it doesn't cover. Used everywhere a level/subject/set name is shown.
  const lvlLabel = (lvl) => tr.levels[lvl?.id] || lvl?.label;
  const subjName = (s) => tr.subjects[s?.id]?.name || s?.name;
  const subjDesc = (s) => tr.subjects[s?.id]?.description || s?.description;
  const setTitle = (s) => tr.sets[s?.id]?.title || s?.title;
  const setSummary = (s) => tr.sets[s?.id]?.summary || s?.summary;

  const root = el("div");
  const state = { level: null, subject: null, query: "", examMin: 0 };

  // Built once so typing never loses focus — paintBody() only touches bodyEl.
  const searchInput = el("input.search__input", {
    type: "search", placeholder: t("lib.search"), "aria-label": t("lib.searchAria"),
    value: state.query,
    oninput: (e) => { state.query = e.target.value; paintBody(); },
    onkeydown: (e) => {
      if (e.key === "Escape" && state.query) { e.preventDefault(); state.query = ""; searchInput.value = ""; paintBody(); }
    },
  });
  const searchWrap = el("div.search", { style: { marginBottom: "16px" } }, [icon(ICONS.search, 16), searchInput]);
  const headerEl = el("div");
  const bodyEl = el("div");

  function paint() { paintHeader(); paintBody(); }

  function paintHeader() {
    clear(headerEl);
    const back = state.subject
      ? () => { state.subject = null; paint(); }
      : state.level
        ? () => { state.level = null; paint(); }
        : null;

    headerEl.appendChild(homeButton());
    headerEl.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" } }, [
      back && el("button.iconbtn.iconbtn--sm", { type: "button", "aria-label": t("common.back"), onclick: back }, [icon(ICONS.back, 16)]),
      el("h1", {}, t("lib.title")),
    ].filter(Boolean)));
  }

  function paintBody() {
    clear(bodyEl);
    const q = state.query.trim().toLowerCase();
    if (q) bodyEl.appendChild(searchResults(q));
    else if (!state.level) bodyEl.appendChild(levelPicker());
    else if (!state.subject) bodyEl.appendChild(subjectPicker());
    else bodyEl.appendChild(setList());
  }

  /* ---- search across the whole library, wherever you are ---- */
  function searchResults(q) {
    const matches = index.sets.filter((s) => {
      const subject = index.subjects.find((sub) => sub.id === s.subject);
      const level = index.levels.find((l) => l.id === subject?.level);
      return [setTitle(s), setSummary(s), subjName(subject), lvlLabel(level)].filter(Boolean).join(" ").toLowerCase().includes(q);
    });

    if (!matches.length) {
      return el("div.panel", {}, [el("p.note", {}, t("lib.noHits", { q: state.query.trim() }))]);
    }

    const bySubject = new Map();
    for (const s of matches) {
      if (!bySubject.has(s.subject)) bySubject.set(s.subject, []);
      bySubject.get(s.subject).push(s);
    }

    const sections = [...bySubject.entries()].map(([subjId, sets]) => {
      const subject = index.subjects.find((s) => s.id === subjId);
      const level = index.levels.find((l) => l.id === subject?.level);
      return el("section.panel", { style: { marginBottom: "20px" } }, [
        el("p.note", { style: { marginBottom: "8px" } }, [lvlLabel(level), subjName(subject)].filter(Boolean).join(" · ")),
        el("div.libgrid", {}, sets.map(setCard)),
      ]);
    });

    return el("div", {}, [
      el("p.note", { style: { marginBottom: "12px" } }, plural(matches.length, "lib.hitsOne", "lib.hitsMany")),
      ...sections,
    ]);
  }

  /* ---- step 1: pick a level ---- */
  function levelPicker() {
    const levels = index.levels.filter((l) => index.subjects.some((s) => s.level === l.id));
    return el("div.panel", {}, [
      el("p", { style: { marginBottom: "16px" } }, t("lib.intro")),
      el("div.source-grid", {}, levels.map((lvl) =>
        el("button.source-opt", { type: "button", onclick: () => { state.level = lvl.id; paint(); } }, [
          icon(ICONS.graduation, 26), lvlLabel(lvl),
        ]))),
    ]);
  }

  /* ---- step 2: pick a subject ---- */
  function subjectPicker() {
    const level = index.levels.find((l) => l.id === state.level);
    const subjects = index.subjects.filter((s) => s.level === state.level);
    return el("div.panel", {}, [
      el("p", { style: { marginBottom: "16px" } }, t("lib.pickSubject", { level: lvlLabel(level) || "" })),
      el("div.source-grid", {}, subjects.map((subject) =>
        el("button.source-opt", { type: "button", onclick: () => { state.subject = subject.id; paint(); } }, [
          icon(ICONS.book, 26), subjName(subject),
          el("div.note", { style: { fontWeight: "400", marginTop: "4px" } }, subjDesc(subject)),
        ]))),
    ]);
  }

  /* ---- step 3: sets for the chosen subject ---- */
  function setList() {
    const subject = index.subjects.find((s) => s.id === state.subject);
    const sets = index.sets.filter((s) => s.subject === subject.id);
    const missing = sets.filter((s) => !isImported(s.id));

    // The exam-prep page keys off the student's own subject id, which only
    // exists once at least one set from here has been imported.
    const importedHere = sets.find((s) => isImported(s.id));
    const storeSubjectId = importedHere ? store.getAssignment(importedHere.id)?.subjectId : null;
    const examPrepBtn = storeSubjectId
      ? el("a.btn.btn--ghost.btn--sm", { href: `#/exam-prep/${storeSubjectId}` },
          [icon(ICONS.target, 16), t("exam.prepFor", { subject: subjName(subject) })])
      : null;

    const addAllBtn = el("button.btn.btn--sm", {
      type: "button",
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        let added = 0;
        for (const s of missing) {
          try { if (await importSet(s)) added++; } catch { /* skip the ones that fail */ }
        }
        toast(added ? t("lib.addedN", { n: added }) : t("lib.allThere"));
        paint();
      },
    }, [icon(ICONS.plus, 16), t("lib.addAll", { n: missing.length })]);

    const examSel = el("select", { "aria-label": t("lib.examLenLabel"), onchange: (e) => { state.examMin = Number(e.target.value) || 0; } }, [
      el("option", { value: "0" }, t("lib.examLenNone")),
      el("option", { value: "20" }, "20 min"),
      el("option", { value: "40" }, "40 min"),
      el("option", { value: "60" }, "60 min"),
    ]);
    examSel.value = String(state.examMin);

    return el("div", {}, [
      el("section.panel", {}, [
        el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "start", gap: "12px", flexWrap: "wrap", marginBottom: "6px" } }, [
          el("div", {}, [
            el("h3", {}, subjName(subject)),
            el("p.note", { style: { marginTop: "4px" } }, subjDesc(subject)),
          ]),
          el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
            examPrepBtn,
            missing.length ? addAllBtn : el("span.note", { style: { alignSelf: "center" } }, t("lib.allAdded")),
          ].filter(Boolean)),
        ]),
        el("details.libexam", {}, [
          el("summary", {}, [icon(ICONS.clock, 14), t("lib.examOptions")]),
          el("label.field", { style: { maxWidth: "220px", margin: "10px 0 0" } }, [
            el("span", {}, t("lib.examLenLabel")), examSel,
          ]),
        ]),
        el("div.libgrid", {}, sets.map(setCard)),
      ]),
    ]);
  }

  function setCard(entry) {
    const imported = isImported(entry.id);
    const count = plural(entry.count, "common.questionOne", "common.questionMany");

    // Added → "Study" is the primary action; "Exam mode" is the secondary.
    // Not added → "Add" is primary, and exam mode isn't offered yet (it needs
    // the set in the library).
    const action = imported
      ? el("a.btn.btn--sm", { href: `#/session/${entry.id}` }, [icon(ICONS.play, 16), t("lib.study")])
      : el("button.btn.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await importSet(entry);
              toast(t("lib.added", { title: setTitle(entry) }));
              paint();
            } catch {
              toast(t("lib.addFail"));
              e.currentTarget.disabled = false;
            }
          },
        }, [icon(ICONS.plus, 16), t("lib.add")]);

    const examAction = imported
      ? el("button.btn.btn--ghost.btn--sm", {
          type: "button", title: t("lib.examTip"),
          onclick: () => { location.hash = `#/session/${entry.id}?exam=1${state.examMin ? `&min=${state.examMin}` : ""}`; },
        }, [icon(ICONS.clock, 16), t("lib.exam")])
      : null;

    // A printable worksheet — the classroom distribution wedge.
    const printAction = imported
      ? el("a.iconbtn.iconbtn--sm", {
          href: `#/print/${entry.id}`, "aria-label": t("print.worksheet"), title: t("print.worksheet"),
        }, [icon(ICONS.fileText, 16)])
      : null;

    return el("div.libcard" + (imported ? ".libcard--added" : ""), {}, [
      el("div", {}, [
        el("div.libcard__title", {}, setTitle(entry)),
        el("p.note", { style: { margin: "4px 0 0" } }, setSummary(entry)),
      ]),
      el("div.libcard__foot", {}, [
        imported
          ? el("span.libcard__added", {}, [icon(ICONS.check, 14), t("lib.addedTag"), el("span.libcard__count", {}, ` · ${count}`)])
          : el("span.note", {}, count),
        el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" } }, [action, examAction, printAction].filter(Boolean)),
      ]),
    ]);
  }

  root.appendChild(headerEl);
  root.appendChild(searchWrap);
  root.appendChild(bodyEl);
  paint();
  return { title: t("lib.title"), node: root };
}
