// Create flow: pick material -> provide it -> generate with Claude -> review/edit -> save.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { markdown } from "../lib/markdown.js";
import { extractPdfText, extractZipText, fitText } from "../material.js";
import { shrinkImage } from "../lib/photo.js";
import { parseCards, cardsToDoc } from "../lib/import.js";
import { parseSharedSet, importSharedSet } from "../lib/share-set.js";
import { detectSections } from "../lib/split.js";
import { homeButton } from "../components/nav.js";
import { generateAssignment, ClaudeError } from "../claude.js";
import { questionEditor } from "../components/question-editor.js";
import { subjectField, subjectChoices, standardSubjectNames } from "../components/subject-field.js";
import { matchSubject } from "../lib/subject-match.js";
import { t, plural } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { foldedDatePicker } from "../components/calendar.js";
import { fileDrop } from "../components/file-drop.js";
import { row, seg, toggle, stepper } from "../components/set-ui.js";
import { aiQuotaNote } from "../components/ai-gate.js";
import { NATIONAL_TEST_LEVELS, NATIONAL_TEST_SUBJECTS, nationalSubjectName } from "../data/national-tests.js";
import { blankQuestions } from "../lib/blank-questions.js";

export { blankQuestions };   // exam-dialog loads it from here

// A generation survives navigating away from #/create — module-level, not
// tied to any one call's local `state`/`paint`, so leaving mid-generation
// (e.g. into Settings) doesn't discard it. Whichever renderCreate() instance
// is mounted when it settles updates itself; if none is, a toast tells the
// student where to find it. At most one generation is tracked at a time —
// starting a new one simply replaces this.
let bg = null; // { promise, doc, error }
// A set generated from the previous student's material must not wait in Skapa for the next one.
store.addEventListener("deviceCleared", () => { bg = null; });

/** The subject a new AI set is filed under. One the student picked themselves (or that is locked to an exam) always stands.
 *  Otherwise what was ticked is only the picker's first choice, so the subject the AI found for the material is used when
 *  it is one the picker offers: a Swedish essay comes back under "Svenska", not "Matematik". */
function chosenSubject(doc, picked, pickedByStudent) {
  const found = pickedByStudent ? null : matchSubject(doc.subject, subjectChoices(), standardSubjectNames());
  return found || (picked || "").trim() || doc.subject || t("common.general");
}

function startGeneration(params) {
  bg = { promise: null, doc: null, error: null };
  bg.promise = generateAssignment(params).then((doc) => {
    doc.subject = chosenSubject(doc, params.subject, params.subjectChosen);
    doc.type = params.type;
    doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
    bg.doc = doc;
    return doc;
  }).catch((e) => {
    bg.error = e;
    throw e;
  });
  return bg;
}

function notifyBgDone() {
  toast(t("create.bgDone"), { actionLabel: t("create.bgDoneAction"), onAction: () => { location.hash = "#/create"; } });
}

/** Resolve/reject handlers for whichever job (fresh or already-running) is
 *  current. Safe to attach more than once — e.g. a generation that outlives
 *  one mount and is picked back up by a later one — since ordinary promises
 *  support any number of independent `.then()` listeners.
 *
 *  Deliberately does NOT clear `bg` itself: whether the finished doc is still
 *  needed depends on whether anyone actually saw it (that first attempt at
 *  this got it backwards — clearing on settlement here discarded the doc the
 *  moment it finished if nobody was looking, so "Show me" on the toast had
 *  nothing left to show). Each caller below clears it once truly consumed. */
function watchGeneration(job, { onDone, onFail }) {
  job.promise.then(onDone, onFail);
}

export function renderCreate(prefill) {
  const root = el("div");
  const prefillSubject = prefill?.get?.("subject");
  // Flips false once this view is navigated away from — guards the async
  // generation callback against updating a screen that's no longer showing.
  let mounted = true;
  const state = {
    step: "source",           // source | input | generating | review
    source: null,             // paste | pdf | photo | import | blank | nationalprov
    material: "",
    topic: "",
    image: null,
    imageName: "",            // what's shown in the photo drop zone if we come back to it
    pdfName: "",
    gradeHint: "",
    // No fallback to t("common.general") here — that's a real value the
    // subject field would show pre-filled (not placeholder text), inviting a
    // student to type their own subject straight after it and end up with
    // "AllmäntBiologi". The generic-subject fallback only applies at save
    // time (see the .trim() || t("common.general") sites below).
    // The first of the picker's own choices: the subject most of the student's sets are in, or for a new
    // student the first school subject — never a seeded placeholder that would open "+ Nytt ämne".
    subject: prefillSubject || subjectChoices()[0] || "",
    // Locked when the subject came from the Nationellt prov source below (or a
    // ?subject=&lock=1 prefill) — every set for the same exam has to land under
    // one exact subject name so it can be found again by subjectId later.
    subjectLocked: !!prefillSubject && prefill?.get?.("lock") === "1",
    // Did the student pick the subject (or arrive with one)? If not, what is ticked is just the first choice, and the subject the
    // AI finds in the material is used instead (chosenSubject).
    subjectChosen: !!prefillSubject,
    npLevel: null,            // Nationellt prov: chosen level id
    npEntry: null,            // Nationellt prov: chosen subject entry
    npInput: "file",          // Nationellt prov: the material as a "file" or as pasted "text"
    importMode: "paste",      // Importera kort: "paste" the cards or upload a "file"
    preferFlashcards: false,
    type: "assignment",
    count: 6,
    doc: null,                // generated + editable
  };

  // Coming back to #/create (or landing here fresh) while a generation is
  // still running, or finished while nobody was looking: pick it straight
  // back up instead of starting over at "source".
  if (bg) {
    if (bg.doc) { state.doc = { ...bg.doc, ai: true }; state.step = "review"; bg = null; }
    else if (bg.error) { bg = null; } // already toasted when it failed; just land on source
    else {
      state.step = "generating";
      const job = bg;
      watchGeneration(job, {
        onDone: (doc) => {
          if (!mounted) { notifyBgDone(); return; }   // still nobody looking — leave it for next time
          if (bg === job) bg = null;                   // consumed now
          state.doc = { ...doc, ai: true };   // the AI wrote it: its card is marked
          state.step = "review"; paint();
        },
        onFail: (e) => {
          const msg = e instanceof ClaudeError ? e.message : t("create.genFailed");
          if (bg === job) bg = null;   // nothing to resume into either way — the toast is the whole story
          toast(msg);
          if (mounted) { state.step = "source"; paint(); }
        },
      });
    }
  }

  function steps() {
    const map = [["source", t("create.stepSource")], ["input", t("create.stepMaterial")], ["review", t("create.stepReview")]];
    const activeIdx = state.step === "generating" ? 1 : map.findIndex(([k]) => k === state.step);
    // Done steps get a check, the current one is filled, the rest wait — joined by a line.
    return el("ol.steps", { "aria-label": t("create.title") }, map.map(([k, label], i) =>
      el("li", {
        class: "step" + (i < activeIdx ? " is-done" : i === activeIdx ? " on" : ""),
        "aria-current": i === activeIdx ? "step" : null,
      }, [
        el("span.step__n", {}, i < activeIdx ? icon(ICONS.check, 13) : String(i + 1)), label,
      ])));
  }

  function paint() {
    clear(root);
    root.appendChild(homeButton());
    root.appendChild(el("h1.create-title", {}, t("create.title")));
    root.appendChild(steps());
    root.appendChild(({ source: sourceStep, input: inputStep, generating: generatingStep, review: reviewStep }[state.step])());
  }

  /* ---- bulk split: one generated set per detected section ---- */
  async function runSplit(secs) {
    clear(root);
    const log = el("div", { style: { display: "grid", gap: "6px" } });
    // Each section is a full AI call: stoppable, and the page only moves on if the student is still on it.
    let stopped = false;
    const stopBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", style: { marginTop: "12px" }, onclick: () => { stopped = true; stopBtn.disabled = true; } }, t("common.cancel"));
    root.appendChild(el("div.panel", {}, [
      el("h2", { style: { marginBottom: "4px" } }, t("create.splitTitle")),
      el("p.note", { style: { marginBottom: "12px" } }, t("create.splitSub")),
      log,
      stopBtn,
    ]));
    const rows = secs.map((s) => {
      const r = el("p.note", {}, `⏳ ${s.title}`);
      log.appendChild(r);
      return r;
    });
    let made = 0;
    for (let i = 0; i < secs.length; i++) {
      if (stopped || !stopBtn.isConnected) { rows[i].textContent = `— ${secs[i].title}`; continue; }
      try {
        const doc = await generateAssignment({ material: fitText(secs[i].body), count: state.count });
        doc.subject = chosenSubject(doc, state.subject, state.subjectChosen);
        doc.title = secs[i].title || doc.title;
        doc.type = state.type;
        doc.ai = true;
        doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
        store.addAssignmentDoc(doc);
        made++;
        rows[i].textContent = `✅ ${secs[i].title}`;
      } catch (e) {
        rows[i].textContent = `⚠️ ${secs[i].title} — ${e instanceof ClaudeError ? e.message : t("create.genFailed")}`;
      }
    }
    stopBtn.remove();
    toast(made ? plural(made, "create.splitDoneOne", "create.splitDone") : t("create.genFailed"));
    if (made && !stopped && root.isConnected && location.hash.startsWith("#/create")) location.hash = "#/";
  }

  // Each source has its own colour — the home tiles' palette — on its icon and edge.
  const SOURCE_COLORS = {
    paste: "#7650FF", photo: "#EE3D86", pdf: "#FF7426", nationalprov: "#22A35A",
    blank: "#0FA3C2", import: "#3AA4E6",
  };
  // …and its icon and name (step 1's card, step 2's heading). Its line on step 1 is the name's key + "Sub".
  const SOURCE_ICONS = {
    paste: ICONS.pencil, photo: ICONS.camera, pdf: ICONS.fileText, nationalprov: ICONS.graduation,
    blank: ICONS.plus, import: ICONS.clipboard,
  };
  const SOURCE_TITLES = {
    paste: "create.optPaste", photo: "create.optPhoto", pdf: "create.optPdf", nationalprov: "create.optNational",
    blank: "create.optBlank", import: "create.optImport",
  };

  /* ---- step 1: source ----
   * Two groups: the AI-generated sources (marked when there's no server to run
   * them), then the two paths that work with no AI at all. */
  function sourceStep() {
    const noServer = !store.hasKey();
    const needsSignIn = store.aiNeedsSignIn();
    const quotaOut = store.aiBlockReason() === "quota";
    const opt = (key, needsAi) => el("button.srcpick" + (needsAi && noServer ? ".is-locked" : ""), {
      type: "button", style: { "--c": SOURCE_COLORS[key] },
      onclick: () => {
        // Leaving the Nationellt prov source: drop any stale subject lock.
        if (key !== "nationalprov" && state.subjectLocked) {
          state.subjectLocked = false;
          state.subject = subjectChoices()[0] || "";
          state.npLevel = null; state.npEntry = null;
        }
        state.source = key; state.step = "input"; paint();
      },
    }, [
      el("span.srcpick__ic", { "aria-hidden": "true" }, icon(SOURCE_ICONS[key], 20)),
      el("span.srcpick__text", {}, [
        el("strong", {}, t(SOURCE_TITLES[key])),
        el("small", {}, t(`${SOURCE_TITLES[key]}Sub`)),
        needsAi && noServer ? el("span.srcpick__tag", {}, t(needsSignIn ? "create.optNeedsSignIn" : quotaOut ? "create.optQuotaOut" : "create.optNeedsServer")) : null,
      ].filter(Boolean)),
      el("span.srcpick__go", { "aria-hidden": "true" }, icon(ICONS.arrow, 16)),
    ]);
    const group = (iconPath, title, sub, opts) => el("section.srcgroup", {}, [
      el("header.srcgroup__head", {}, [
        el("span.srcgroup__ic", { "aria-hidden": "true" }, icon(iconPath, 15)),
        el("div", {}, [el("h2", {}, title), el("p", {}, sub)]),
      ]),
      el("div.srcgroup__grid", {}, opts),
    ]);

    // AI sources first — that's what most people come here for — then the two
    // that need no AI at all.
    return el("div.panel.srcpanel", {}, [
      el("p.srcpanel__q", {}, t("create.whereFrom")),
      group(ICONS.spark, t("create.groupAi"), t("create.groupAiSub"), [
        opt("paste", true), opt("photo", true), opt("pdf", true), opt("nationalprov", true),
      ]),
      group(ICONS.layers, t("create.groupSelf"), t("create.groupSelfSub"), [
        opt("blank", false), opt("import", false),
      ]),
      noServer && needsSignIn && el("p.note", { style: { marginTop: "16px" } }, [
        t("create.needSignIn"), el("a", { href: "#/login" }, t("create.needSignInLink")),
        t("create.needSignInTail"),
      ]),
      noServer && quotaOut && aiQuotaNote({ altHref: "#/library", altKey: "create.noServerAlt", style: { marginTop: "16px" } }),
      noServer && !needsSignIn && !quotaOut && el("p.note.note--warn", { style: { marginTop: "16px" } }, [
        t("create.needKey"), el("a", { href: "#/settings" }, t("create.needKeyLink")),
        t("create.needKeyTail"),
      ]),
    ]);
  }

  /* A PDF read directly, or every PDF inside a ZIP (e.g. Skolverket's national-exam downloads) with
   * their text joined — shared by the "Ladda upp PDF" source and the Nationellt prov source. The drop
   * zone with a status line under it. */
  function pdfOrZipField() {
    const status = el("p.mk__status", { role: "status" });
    const say = (text, tone = "") => { status.textContent = text; status.className = "mk__status" + (tone ? ` is-${tone}` : ""); };
    let run = 0;   // a newer file wins if an older one is still being read
    const zone = fileDrop({
      accept: "application/pdf,.pdf,application/zip,application/x-zip-compressed,.zip",
      types: t("drop.typesPdf"),
      initial: state.material && state.pdfName ? { name: state.pdfName } : null,
      onFile: async (file) => {
        const mine = ++run;
        state.pdfName = file.name;
        say(t("create.reading")); state.material = "";
        const isZip = /\.zip$/i.test(file.name) || file.type.includes("zip");
        try {
          if (isZip) {
            const { text, pdfCount, totalPdfCount, skippedAudio } = await extractZipText(file);
            if (mine !== run) return;
            state.material = text;
            say(t("create.zipExtracted", {
              n: pdfCount, total: totalPdfCount, name: file.name,
              audio: skippedAudio ? t("create.zipSkippedAudio", { n: skippedAudio }) : "",
            }), "ok");
          } else {
            const text = await extractPdfText(file);
            if (mine !== run) return;
            state.material = text;
            say(t("create.extracted", { n: state.material.length.toLocaleString(), name: file.name }), "ok");
          }
        } catch (err) {
          if (mine !== run) return;
          // pdf.js's own errors are English and technical ("No password given"): say it plainly.
          say(err?.name === "PasswordException" ? t("create.pdfLocked")
            : /Exception$/.test(err?.name || "") ? t("create.readFail")
            : err?.message || t("create.readFail"), "warn");
          zone.reset(); state.pdfName = "";
        }
      },
      onClear: () => { run++; state.material = ""; state.pdfName = ""; say(""); },
    });
    return el("div.mk__field", {}, [zone.el, status]);
  }

  /* Where to get the material, the sets already made for it and "mix all years", for one chosen
   * Nationellt prov subject. */
  function nationalInfoPanel(entry) {
    const name = nationalSubjectName(entry);
    const subject = store.subjects.find((s) => s.name.toLowerCase() === name.toLowerCase());
    const sets = subject ? store.assignments.filter((a) => a.subjectId === subject.id) : [];
    const totalQuestions = sets.reduce((n, a) => n + a.questions.length, 0);
    let mixCount = Math.min(15, totalQuestions);

    return el("div.npcard", {}, [
      el("div.npcard__top", {}, [
        el("div.npcard__name", {}, [
          el("strong", {}, entry.name),
          el("span.npcard__badge", {}, entry.kind === "limited" ? t("create.npBadgeExample") : t("create.npBadgeExternal")),
        ]),
        el("a.btn.btn--ghost.btn--sm", { href: entry.url, target: "_blank", rel: "noopener noreferrer" }, t("create.npGetMaterial")),
      ]),
      el("p.npcard__note", {}, entry.kind === "limited" ? t("create.npInfoLimited") : t("create.npInfoExternal")),
      sets.length ? el("div.npcard__mine", {}, [
        el("p.npcard__label", {}, plural(sets.length, "create.npImportedOne", "create.npImportedMany")),
        el("ul.npcard__sets", {}, sets.map((a) => el("li", {}, [
          el("a", { href: `#/session/${a.id}` }, a.title),
          el("span", {}, plural(a.questions.length, "common.questionOne", "common.questionMany")),
        ]))),
        el("div.npcard__mix", {}, [
          el("span", {}, t("create.npMixLabel")),
          stepper({ label: t("create.npMixLabel"), value: mixCount, min: 3, max: Math.max(3, totalQuestions), onChange: (n) => { mixCount = n; } }),
          el("button.btn.btn--sm", { type: "button", onclick: () => { location.hash = `#/national/mix/${subject.id}?count=${mixCount}`; } }, t("create.npMixStart")),
        ]),
      ]) : null,
    ].filter(Boolean));
  }

  /* ---- step 2: material + settings ----
   * One card for every source: what was chosen at the top, then its material, then the settings as
   * rows (the same rows as Settings), then Back and the main button. Each source shows only what it
   * needs: Bygg själv has no material, Importera kort no question count (the cards are the questions). */
  function inputStep() {
    const ai = !["blank", "import"].includes(state.source);
    const back = () => { state.step = "source"; paint(); };
    const err = el("p.note.note--warn.mk__err", { hidden: true, role: "alert" });
    const showErr = (text) => { err.textContent = text; err.hidden = false; };

    /** A labelled part of the material: a small heading over the control. */
    const group = (label, control) => el("div.mk__group", {}, [el("p.mk__label", {}, label), control]);

    /** Two ways to give the same material, as a segmented choice that shows one pane at a time. */
    function either(label, key, options, panes) {
      const show = (v) => { state[key] = v; for (const [k, p] of Object.entries(panes)) p.hidden = k !== v; };
      const value = state[key] || options[0][0];
      const tabs = seg(label, options, value, show);
      show(value);
      return el("div.mk__field", {}, [tabs, ...Object.values(panes)]);
    }

    function pasteInput() {
      const count = el("span.mk__count");
      const splitBox = el("div.mk__split", { hidden: true });
      const ta = el("textarea.mk__text", {
        rows: 10, placeholder: t("create.materialPlaceholder"), "aria-label": t("create.material"),
        oninput: (e) => { state.material = e.target.value; refresh(); },
      });
      ta.value = state.material;
      function refresh() {
        count.textContent = t("create.chars", { n: state.material.length.toLocaleString() });
        // At most this many sets in one go — each is a full AI call on the student's monthly allowance.
        const secs = detectSections(state.material).slice(0, 8);
        splitBox.hidden = secs.length < 2;
        if (secs.length < 2) return;
        splitBox.replaceChildren(
          el("div.mk__splittext", {}, [
            el("strong", {}, t("create.splitFound", { n: secs.length })),
            el("div.mk__splittags", {}, secs.map((s) => el("span.badge", {}, s.title.length > 32 ? s.title.slice(0, 32) + "…" : s.title))),
          ]),
          el("button.btn.btn--ghost.btn--sm", {
            type: "button", disabled: !store.hasKey(),
            title: store.hasKey() ? "" : t("create.needKeyShort"),
            onclick: () => runSplit(secs),
          }, [icon(ICONS.spark, 16), t("create.splitEach", { n: secs.length })]),
        );
      }
      refresh();
      return el("div.mk__field", {}, [ta, el("div.mk__meta", {}, [count]), splitBox]);
    }

    function photoInput() {
      const status = el("p.mk__status", { role: "status" });
      const say = (text, tone = "") => { status.textContent = text; status.className = "mk__status" + (tone ? ` is-${tone}` : ""); };
      let run = 0;   // a newer picture wins if an older one is still being read
      const zone = fileDrop({
        kind: "image", accept: "image/*", types: t("drop.typesImage"),
        camera: true,   // "Take a photo" on touch devices — a desktop has no camera to ask for
        paste: true,    // a screenshot on the clipboard just works, focused or not
        initial: state.image ? { name: state.imageName || t("drop.pastedName"), thumb: state.image.preview } : null,
        onFile: async (file, { pasted }) => {
          const mine = ++run;
          state.imageName = pasted ? t("drop.pastedName") : file.name;
          say(t("create.reading")); state.image = null;
          try {
            const img = await shrinkImage(file);
            if (mine !== run) return;
            state.image = img;
            say("");
            zone.setThumb(img.preview);
          } catch (e) {
            if (mine !== run) return;
            say(e.message || t("create.readFail"), "warn");
            zone.reset(); state.imageName = "";
          }
        },
        onClear: () => { run++; state.image = null; state.imageName = ""; say(""); },
      });
      return el("div.mk__field", {}, [zone.el, status]);
    }

    function importInput() {
      const status = el("p.mk__status", { role: "status" });
      const ta = el("textarea.mk__text", {
        rows: 8, placeholder: t("create.importPlaceholder"), "aria-label": t("create.importPaste"),
        oninput: (e) => { state.material = e.target.value; refresh(); },
      });
      ta.value = state.material;
      const zone = fileDrop({
        accept: ".csv,.tsv,.txt,.json,text/csv,text/plain,application/json",
        types: t("drop.typesCards"),
        onFile: async (f) => {
          const text = await f.text();
          // A friend's shared set (studybuddy .json) imports straight away —
          // it's already questions, no parsing needed.
          try {
            const doc = parseSharedSet(text);
            if (doc) {
              const a = importSharedSet(doc);
              toast(t("create.sharedSetAdded", { title: a.title }));
              location.hash = `#/edit/${a.id}`;
              return;
            }
          } catch (e) { toast(e.message); zone.reset(); return; }
          state.material = text;
          ta.value = state.material;
          refresh();
        },
      });
      function refresh() {
        const n = parseCards(state.material).length;
        const typed = !!state.material.trim();
        status.className = "mk__status" + (n ? " is-ok" : typed ? " is-warn" : "");
        status.textContent = n ? t("create.importFound", { n }) : typed ? t("create.importNone") : "";
      }
      refresh();
      return el("div.mk__field", {}, [
        either(t("create.importHow"), "importMode", [["paste", t("create.importPaste")], ["file", t("create.inputFile")]], {
          paste: el("div.mk__field", {}, [ta, el("p.mk__hint", {}, t("create.importFormat"))]),
          file: el("div.mk__field", {}, [zone.el]),
        }),
        status,
      ]);
    }

    function nationalInput() {
      const parts = [group(t("create.npLevel"), seg(t("create.npLevel"), NATIONAL_TEST_LEVELS.map((l) => [l.id, l.label]), state.npLevel, (v) => {
        state.npLevel = v;
        state.npEntry = null; state.subjectLocked = false; state.material = ""; state.pdfName = "";
        paint();
      }))];
      if (state.npLevel) {
        const entries = NATIONAL_TEST_SUBJECTS.filter((e) => e.level === state.npLevel);
        parts.push(group(t("create.npSubject"), el("div.subjpick", { role: "group", "aria-label": t("create.npSubject") }, entries.map((entry) =>
          el("button.subjpick__chip", {
            type: "button", "aria-pressed": String(state.npEntry?.id === entry.id),
            onclick: () => {
              state.npEntry = entry;
              state.material = ""; state.pdfName = "";
              state.subject = nationalSubjectName(entry); state.subjectLocked = true;
              paint();
            },
          }, entry.name)))));
      }
      if (state.npEntry) {
        const ta = el("textarea.mk__text", {
          rows: 8, placeholder: t("create.npPastePlaceholder"), "aria-label": t("create.inputText"),
          oninput: (e) => { state.material = e.target.value; },
        });
        ta.value = state.material;
        parts.push(nationalInfoPanel(state.npEntry), group(t("create.npMaterial"),
          either(t("create.npMaterial"), "npInput", [["file", t("create.inputFile")], ["text", t("create.inputText")]], {
            file: pdfOrZipField(),
            text: el("div.mk__field", {}, [ta]),
          })));
      }
      return parts;
    }

    const material = {
      paste: () => [pasteInput()],
      photo: () => [photoInput()],
      pdf: () => [pdfOrZipField()],
      nationalprov: nationalInput,
      import: () => [importInput()],
      blank: () => [],
    }[state.source]();

    // Import needs no AI — the cards *are* the questions. Straight to review.
    function buildFromImport() {
      const cards = parseCards(state.material);
      if (!cards.length) { showErr(t("create.importNone")); return; }
      const doc = cardsToDoc(cards, { title: state.subject !== t("common.general") ? state.subject : t("create.importedCards"), subject: state.subject || t("common.general") });
      doc.subject = state.subject.trim() || t("common.general");
      doc.type = state.type;
      doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
      state.doc = doc;
      state.step = "review"; paint();
    }

    // A blank set — no AI. Drops straight into the editor with a few starter
    // questions of each kind (blank answers OK) to rewrite as your own.
    function buildBlank() {
      state.doc = {
        title: t("create.blankTitle"),
        subject: state.subject.trim() || t("common.general"),
        type: state.type,
        sourceSummary: "",
        topics: ["demo"],
        questions: blankQuestions(state.count),
      };
      state.step = "review"; paint();
    }

    function generate() {
      const hasInput = state.material.trim() || state.topic.trim() || state.image;
      if (!hasInput) { showErr(t("create.needMaterial")); return; }
      state.step = "generating"; paint();
      const job = startGeneration({
        material: state.material ? fitText(state.material) : "",
        topic: state.topic.trim(),
        image: state.image ? { mediaType: state.image.mediaType, data: state.image.data } : null,
        count: state.count,
        gradeHint: state.gradeHint.trim(),
        preferFlashcards: state.preferFlashcards,
        subject: state.subject,
        subjectChosen: state.subjectChosen,
        type: state.type,
      });
      watchGeneration(job, {
        onDone: (doc) => {
          if (!mounted) { notifyBgDone(); return; }   // still nobody looking — leave it for next time
          if (bg === job) bg = null;                   // consumed now
          state.doc = { ...doc, ai: true };
          state.step = "review"; paint();
        },
        onFail: (e) => {
          const msg = e instanceof ClaudeError ? e.message : t("create.genFailed");
          if (bg === job) bg = null;   // nothing to resume into either way — the toast is the whole story
          if (!mounted) { toast(msg); return; }
          state.step = "input"; paint();
          toast(msg);
          const m = root.querySelector(".mk__err");
          if (m) { m.hidden = false; m.textContent = msg; }
        },
      });
    }

    // The subject: tap one (or name a new one); locked to the exam's subject for Nationellt prov.
    const subjectCtl = state.subjectLocked
      ? el("span.mk__locked", {}, [icon(ICONS.lock, 14), state.subject])
      : subjectField({ value: state.subject, onChange: (v) => { state.subject = v; state.subjectChosen = true; } }).el;

    // Spell out why the button is dead — right where it's dead, not just on step 1.
    const aiNote = ai && !store.hasKey() && (store.aiBlockReason() === "quota"
      ? aiQuotaNote({ altHref: "#/library", altKey: "create.noServerAlt" })
      : store.aiNeedsSignIn()
      ? el("p.note", {}, [t("create.genNeedSignIn"), el("a", { href: "#/login" }, t("create.needSignInLink")), t("create.genNeedSignInTail")])
      : el("p.note.note--warn", {}, [t("create.noServerHere") + " ", el("a", { href: "#/library" }, t("create.noServerAlt")), t("create.noServerTail")]));

    const primary = ai
      ? el("button.btn.btn--ai", { type: "button", disabled: !store.hasKey(), onclick: generate }, [icon(ICONS.spark, 18), t("create.generate")])
      : el("button.btn", { type: "button", onclick: state.source === "import" ? buildFromImport : buildBlank }, [icon(ICONS.check, 18), t("create.build")]);

    return el("section.panel.mk", { style: { "--c": SOURCE_COLORS[state.source] } }, [
      el("header.mk__head", {}, [
        el("span.mk__ic", { "aria-hidden": "true" }, icon(SOURCE_ICONS[state.source], 20)),
        el("div", {}, [el("h2", {}, t(SOURCE_TITLES[state.source])), el("p", {}, t(`create.inSub.${state.source}`))]),
      ]),
      material.length ? el("div.mk__body", {}, material) : null,
      el("div.mk__settings", {}, [
        el("h3.mk__label", {}, t("create.settings")),
        row(t("create.subject"), t(state.subjectLocked ? "create.subjectLocked" : "create.subjectNote"), subjectCtl, { stack: true }),
        row(t("create.type"), t("create.typeNote"), seg(t("create.type"), [["assignment", t("create.typeAssignment")], ["test", t("create.typeTest")]], state.type, (v) => { state.type = v; })),
        state.source !== "import" && row(t("create.howMany"), t("create.howManyNote"),
          stepper({ label: t("create.howMany"), value: state.count, min: 3, max: 15, onChange: (n) => { state.count = n; } })),
        ai && row(t("create.preferFlashcards"), t("create.flashNote"),
          toggle(t("create.preferFlashcards"), state.preferFlashcards, (on) => { state.preferFlashcards = on; })),
        err,
        aiNote,
      ].filter(Boolean)),
      el("footer.mk__foot", {}, [
        el("button.btn.btn--ghost", { type: "button", onclick: back }, [icon(ICONS.back, 16), t("common.back")]),
        primary,
      ]),
    ].filter(Boolean));
  }

  /* ---- generating ---- */
  function generatingStep() {
    return el("div.panel", { style: { textAlign: "center" } }, [
      el("div.spinner"),
      el("p", {}, t("create.generating")),
      el("p.note", {}, t("create.generatingSub")),
    ]);
  }

  /* ---- step 3: review + edit ---- */
  function reviewStep() {
    const doc = state.doc;

    const titleInput = el("input", {
      type: "text", value: doc.title, "aria-label": t("create.setTitleAria"),
      oninput: (e) => { doc.title = e.target.value; },
    });
    const subjectFld = state.subjectLocked
      ? { el: el("input", { type: "text", value: doc.subject, "aria-label": t("create.subject"), disabled: true }) }
      : subjectField({ value: doc.subject, onChange: (v) => { doc.subject = v; } });

    const duePicker = foldedDatePicker({ label: t("create.dueDate"), value: doc.dueAt || "", min: localDayKey() });
    // A date alone is only a deadline. Ticked, the set is a test: countdown, plan, and a place in Inför provet.
    const testToggle = el("input", { type: "checkbox" });
    const testRow = el("label.due-dialog__test", {}, [testToggle, el("span", {}, [icon(ICONS.graduation, 15), t("due.markTest")])]);

    const countNote = el("p.note");
    const editor = questionEditor(doc, {
      onChange: (n) => { countNote.textContent = t("create.countNote", { n: plural(n, "common.questionOne", "common.questionMany") }); },
    });

    function save() {
      const questions = editor.commit();
      if (!questions.length) { toast(t("create.addAtLeastOne")); return; }
      if (!doc.title.trim()) { toast(t("create.giveName")); titleInput.focus(); return; }
      doc.dueAt = duePicker.getValue() || null;
      if (testToggle.checked && !doc.dueAt) { toast(t("create.testNeedsDate")); return; }
      const saved = store.addAssignmentDoc(doc);
      if (testToggle.checked) store.markAsTest(saved.id);
      toast(t("create.saved"));
      location.hash = `#/session/${saved.id}`;
    }

    return el("div", {}, [
      el("div.panel", {}, [
        el("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "12px", alignItems: "start" } }, [
          el("label.field", {}, [el("span", {}, t("create.setTitle")), titleInput]),
          el("div.field", {}, [el("span", {}, t("create.subject")), subjectFld.el]),
        ]),
        duePicker.el,
        testRow,
        countNote,
      ]),
      // Blank/imported sets never call AI and always carry sourceSummary: ""
      // (buildBlank() above, lib/import.js's cardsToDoc) — nothing to show them.
      doc.sourceSummary ? el("div.panel.set-summary", {}, [
        el("h3", {}, t("create.summaryLabel")),
        el("div", { html: markdown(doc.sourceSummary) }),
      ]) : null,
      editor.el,
      el("div.nav-row", {}, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => { state.step = "input"; paint(); } }, t("common.back")),
        el("div", { style: { display: "flex", gap: "10px" } }, [
          el("button.btn.btn--ghost", { type: "button", onclick: () => editor.addQuestion() }, t("create.addQuestion")),
          el("button.btn.btn--ok", { type: "button", onclick: save }, [icon(ICONS.check, 18), t("create.saveSet")]),
        ]),
      ]),
    ]);
  }

  paint();
  return { title: t("create.title"), node: root, cleanup: () => { mounted = false; } };
}
