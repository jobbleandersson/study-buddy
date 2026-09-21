// The practice library: pick a level, then a subject, and see just that
// subject's sets — instead of one endless page. Works with no API key; every
// set is a static file that's copied into the student's own library on "Add".

import { store, PALETTE } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { loadLibraryIndex, loadLibraryTranslations, isImported, importSet } from "../data/library.js";
import { masteryByTopic, setProgress } from "../lib/mastery.js";

export async function renderLibrary(qs = null) {
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

  // Colour-code library subjects the same way the rest of the app does — if
  // this subject's already in the student's own library (by name), reuse its
  // real colour so it matches the home menu / progress page; otherwise assign
  // one by position in its level, so subjects are still visually distinct
  // while browsing, before anything's been added.
  function libSubjectColor(subject, siblings) {
    const name = (subjName(subject) || "").toLowerCase();
    const own = store.subjects.find((s) => s.name.toLowerCase() === name);
    if (own) return store.subjectColor(own.id);
    const idx = Math.max(0, siblings.indexOf(subject));
    const p = PALETTE[idx % PALETTE.length];
    return { solid: `var(--c-${p.name})`, ink: `var(--c-${p.name}-ink)`, tint: `var(--c-${p.name}-tint)` };
  }

  const root = el("div");
  const state = { level: null, subject: null, query: "", examMin: 0, addCounts: {} };
  // Deep links from the welcome quiz: #/library?subject=<id> or ?level=<id>.
  const wantSubject = qs?.get?.("subject") && index.subjects.find((s) => s.id === qs.get("subject"));
  const wantLevel = qs?.get?.("level");
  if (wantSubject) { state.level = wantSubject.level; state.subject = wantSubject.id; }
  else if (wantLevel && index.levels.some((l) => l.id === wantLevel)) state.level = wantLevel;

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

    // Only one back control at a time: the round step-back arrow when you're a
    // level deep, the "← Home" pill at the top level — not both stacked.
    if (!back) headerEl.appendChild(homeButton());
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
      const siblings = index.subjects.filter((s) => s.level === subject?.level);
      const color = libSubjectColor(subject, siblings);
      return el("section.panel", { style: { marginBottom: "20px" } }, [
        el("p.note", { style: { marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" } }, [
          el("span", { style: { width: "8px", height: "8px", borderRadius: "var(--r-full)", background: color.solid, flex: "none" } }),
          [lvlLabel(level), subjName(subject)].filter(Boolean).join(" · "),
        ]),
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
      el("div.source-grid.source-grid--subjects", {}, subjects.map((subject) => {
        const color = libSubjectColor(subject, subjects);
        return el("button.source-opt.source-opt--subject", {
          type: "button", onclick: () => { state.subject = subject.id; paint(); },
          style: { "--subject": color.solid },
        }, [
          icon(ICONS.book, 26), subjName(subject),
          // Hidden on narrow screens (see .source-grid--subjects in app.css) —
          // the same blurb shows on the set-list header you land on.
          el("div.note", { style: { fontWeight: "400", marginTop: "4px" } }, subjDesc(subject)),
        ]);
      })),
    ]);
  }

  /* ---- step 3: sets for the chosen subject ---- */
  function setList() {
    const subject = index.subjects.find((s) => s.id === state.subject);
    const sets = index.sets.filter((s) => s.subject === subject.id);
    const missing = sets.filter((s) => !isImported(s.id));
    const siblings = index.subjects.filter((s) => s.level === subject.level);
    const color = libSubjectColor(subject, siblings);

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

    const examSel = el("select", { "aria-label": t("lib.examLenLabel"), onchange: (e) => { state.examMin = Number(e.target.value) || 0; paint(); } }, [
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
            el("h3", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
              el("span", { style: { width: "10px", height: "10px", borderRadius: "var(--r-full)", background: color.solid, flex: "none" } }),
              subjName(subject),
            ]),
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

  // Attempts don't change while this view is open (studying happens on other
  // routes), so walk them once and let every card reuse the result.
  let topicMasteryCache = null;
  const topicMastery = () => (topicMasteryCache ??= masteryByTopic(store.attempts));

  function lastStudiedText(ts) {
    const days = Math.max(0, Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000));
    if (days === 0) return t("lib.lastToday");
    if (days === 1) return t("lib.lastYesterday");
    if (days < 14) return t("lib.lastDays", { n: days });
    return t("lib.lastWeeks", { n: Math.round(days / 7) });
  }

  function setCard(entry) {
    const imported = isImported(entry.id);
    // Before adding, this reflects whatever's picked below — so it never
    // contradicts the count sitting right next to it — not the moment's full
    // size, which the dropdown itself already shows via its own "15" option.
    const chosenCount = imported ? entry.count : (state.addCounts[entry.id] || entry.count);
    const count = plural(chosenCount, "common.questionOne", "common.questionMany");

    // Added → "Study" is the primary action; "Exam mode" is the secondary. The
    // question count is picked before adding (addCountSel below) and can be
    // changed any time after (countSwitch); either way it's saved on the set as
    // its study default. Exam mode always ignores it and runs the full set.
    const stored = imported ? store.getAssignment(entry.id) : null;
    const total = stored ? stored.questions.length : (entry.count || 0);
    const countQ = stored?._studyCount && stored._studyCount < total ? stored._studyCount : 0;
    const countText = countQ ? t("lib.countOfTotal", { n: countQ, total }) : count;
    const action = imported
      ? el("a.btn.btn--sm", { href: `#/session/${entry.id}${countQ ? `?count=${countQ}` : ""}` }, [icon(ICONS.play, 16), t("lib.study")])
      : el("button.btn.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await importSet(entry, state.addCounts[entry.id]);
              toast(t("lib.added", { title: setTitle(entry) }));
              paint();
            } catch {
              toast(t("lib.addFail"));
              e.currentTarget.disabled = false;
            }
          },
        }, [icon(ICONS.plus, 16), t("lib.add")]);

    // A per-set question-count picker, shown only before adding — once it's
    // in the library the choice above is baked in as its study default.
    const addCountOpts = [5, 10, 15].filter((n) => n <= (entry.count || 0));
    const addCountSel = !imported && addCountOpts.length > 1
      ? el("div.libseg", {}, [
          el("span.libseg__label", {}, t("lib.countLabel")),
          el("div.libseg__group", { role: "group", "aria-label": t("lib.countLabel") }, addCountOpts.map((n) =>
            el("button", {
              type: "button", "aria-pressed": String(n === chosenCount),
              onclick: () => { state.addCounts[entry.id] = n; paint(); },
            }, String(n)))),
        ])
      : null;

    // Exam mode always runs the full set — the question-count picker only
    // applies to study mode, so it's deliberately left off this link.
    const examAction = imported
      ? el("button.btn.btn--ghost.btn--sm", {
          type: "button", title: t(state.examMin ? "lib.examTip" : "lib.examTipUntimed"),
          onclick: () => { location.hash = `#/session/${entry.id}?exam=1${state.examMin ? `&min=${state.examMin}` : ""}`; },
        }, [icon(ICONS.clock, 16), t("lib.exam")])
      : null;

    // A printable worksheet — the classroom distribution wedge.
    const printAction = imported
      ? el("a.iconbtn.iconbtn--sm", {
          href: `#/print/${entry.id}`, "aria-label": t("print.worksheet"), title: t("print.worksheet"),
        }, [icon(ICONS.fileText, 16)])
      : null;

    // How this set is going: a bar of questions you got right last time, when
    // you last studied it, and the topic you miss most.
    const progress = stored ? setProgress(stored, store.attempts, topicMastery()) : null;
    const progressEl = progress
      ? el("div.libprog", {}, [
          el("div.libprog__bar", {
            role: "img",
            "aria-label": progress.seen ? t("lib.progressOf", { n: progress.known, total: progress.total }) : t("lib.notStarted"),
          }, [el("i", { style: { width: `${progress.total ? Math.round((progress.known / progress.total) * 100) : 0}%` } })]),
          el("div.libprog__row", {}, [
            el("span", {}, progress.seen ? t("lib.progressOf", { n: progress.known, total: progress.total }) : t("lib.notStarted")),
            progress.lastAt ? el("span.note", {}, lastStudiedText(progress.lastAt)) : null,
          ].filter(Boolean)),
          progress.weakTopic ? el("span.libprog__weak", {}, t("lib.weakestTopic", { topic: progress.weakTopic })) : null,
        ].filter(Boolean))
      : null;

    // Session length, changeable after adding. 5/10/15 are offered up to the
    // size of the copy in the student's library; the full size clears the limit.
    const switchOpts = stored ? [5, 10, 15].filter((n) => n <= total) : [];
    const perSession = countQ || total;
    const countSwitch = switchOpts.length > 1
      ? el("div.libseg", {}, [
          el("span.libseg__label", {}, t("lib.countLabel")),
          el("div.libseg__group", { role: "group", "aria-label": t("lib.countLabel") }, switchOpts.map((n) =>
            el("button", {
              type: "button", "aria-pressed": String(n === perSession),
              onclick: () => {
                store.updateAssignment(stored.id, { _studyCount: n < total ? n : undefined });
                paint();
              },
            }, String(n)))),
        ])
      : null;

    const weakAction = progress?.weakCount
      ? el("a.btn.btn--ghost.btn--sm", { href: `#/practice-weak?set=${entry.id}`, title: t("lib.weakDrillTip") },
          [icon(ICONS.target, 16), t("lib.weakDrill", { n: progress.weakCount })])
      : null;

    return el("div.libcard" + (imported ? ".libcard--added" : ""), {}, [
      el("div", {}, [
        el("div.libcard__title", {}, setTitle(entry)),
        el("p.note", { style: { margin: "4px 0 0" } }, setSummary(entry)),
      ]),
      progressEl,
      countSwitch,
      el("div.libcard__foot", {}, [
        imported
          ? el("span.libcard__added", {}, [icon(ICONS.check, 14), t("lib.addedTag"), el("span.libcard__count", {}, ` · ${countText}`)])
          : (addCountSel ? null : el("span.note", {}, count)),
        el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" } }, [addCountSel, action, weakAction, examAction, printAction].filter(Boolean)),
      ].filter(Boolean)),
    ].filter(Boolean));
  }

  root.appendChild(headerEl);
  root.appendChild(searchWrap);
  root.appendChild(bodyEl);
  paint();
  return { title: t("lib.title"), node: root };
}
