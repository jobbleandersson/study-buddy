// Create flow: pick material -> provide it -> generate with Claude -> review/edit -> save.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { extractPdfText, extractZipText, readImageFile, fitText } from "../material.js";
import { parseCards, cardsToDoc } from "../lib/import.js";
import { parseSharedSet, importSharedSet } from "../lib/share-set.js";
import { detectSections } from "../lib/split.js";
import { homeButton } from "../components/nav.js";
import { generateAssignment, ClaudeError } from "../claude.js";
import { questionEditor } from "../components/question-editor.js";
import { subjectField } from "../components/subject-field.js";
import { t, plural } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { datePicker } from "../components/calendar.js";
import { NATIONAL_TEST_LEVELS, NATIONAL_TEST_SUBJECTS, nationalSubjectName } from "../data/national-tests.js";

// Starter questions for a "build it myself" set — one of each kind, cycling.
// Prompts are filled so the set saves and runs straight away; answers are
// placeholders the student can edit (or leave blank while testing).
const BLANK_KINDS = ["mc", "text", "cloze", "flashcard", "worked"];
export function blankQuestions(n) {
  return Array.from({ length: Math.max(1, n || 5) }, (_, i) => {
    const kind = BLANK_KINDS[i % BLANK_KINDS.length];
    const q = { id: uid(), topic: "demo", kind, prompt: t("create.blankQ", { n: i + 1 }) };
    if (kind === "mc") { q.choices = ["A", "B", "C"]; q.answer = 0; }
    else if (kind === "cloze") { q.prompt = t("create.blankCloze", { n: i + 1 }); }
    else if (kind === "worked") { q.answer = ""; q.steps = []; }
    else { q.answer = ""; }
    return q;
  });
}

export function renderCreate(prefill) {
  const root = el("div");
  const prefillSubject = prefill?.get?.("subject");
  const state = {
    step: "source",           // source | input | generating | review
    source: null,             // paste | pdf | photo | import | blank | nationalprov
    material: "",
    topic: "",
    image: null,
    gradeHint: "",
    subject: prefillSubject || store.subjects[0]?.name || t("common.general"),
    // Locked when the subject came from the Nationellt prov source below (or a
    // ?subject=&lock=1 prefill) — every set for the same exam has to land under
    // one exact subject name so it can be found again by subjectId later.
    subjectLocked: !!prefillSubject && prefill?.get?.("lock") === "1",
    npLevel: null,            // Nationellt prov: chosen level id
    npEntry: null,            // Nationellt prov: chosen subject entry
    preferFlashcards: false,
    type: "assignment",
    count: 6,
    doc: null,                // generated + editable
  };

  function steps() {
    const map = [["source", t("create.stepSource")], ["input", t("create.stepMaterial")], ["review", t("create.stepReview")]];
    const activeIdx = state.step === "generating" ? 1 : map.findIndex(([k]) => k === state.step);
    return el("div.steps", {}, map.map(([k, label], i) =>
      el("div", { class: "step" + (i <= activeIdx ? " on" : "") }, [
        el("span.step__n", {}, String(i + 1)), label,
      ])));
  }

  function paint() {
    clear(root);
    root.appendChild(homeButton());
    root.appendChild(el("h1", { style: { marginBottom: "8px" } }, t("create.title")));
    root.appendChild(steps());
    root.appendChild(({ source: sourceStep, input: inputStep, generating: generatingStep, review: reviewStep }[state.step])());
  }

  /* ---- bulk split: one generated set per detected section ---- */
  async function runSplit(secs) {
    clear(root);
    const log = el("div", { style: { display: "grid", gap: "6px" } });
    root.appendChild(el("div.panel", {}, [
      el("h2", { style: { marginBottom: "4px" } }, t("create.splitTitle")),
      el("p.note", { style: { marginBottom: "12px" } }, t("create.splitSub")),
      log,
    ]));
    const rows = secs.map((s) => {
      const r = el("p.note", {}, `⏳ ${s.title}`);
      log.appendChild(r);
      return r;
    });
    let made = 0;
    for (let i = 0; i < secs.length; i++) {
      try {
        const doc = await generateAssignment({ material: fitText(secs[i].body), count: state.count });
        doc.subject = state.subject.trim() || doc.subject || t("common.general");
        doc.title = secs[i].title || doc.title;
        doc.type = state.type;
        doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
        store.addAssignmentDoc(doc);
        made++;
        rows[i].textContent = `✅ ${secs[i].title}`;
      } catch (e) {
        rows[i].textContent = `⚠️ ${secs[i].title} — ${e instanceof ClaudeError ? e.message : t("create.genFailed")}`;
      }
    }
    toast(made ? t("create.splitDone", { n: made }) : t("create.genFailed"));
    if (made) location.hash = "#/";
  }

  /* ---- step 1: source ----
   * The two paths that work with no server (build it / import cards) lead;
   * the AI-generated ones follow, marked when there's no server to run them. */
  function sourceStep() {
    const noServer = !store.hasKey();
    const opt = (key, iconPath, label, desc, needsAi) => el("button.source-opt" + (needsAi && noServer ? ".source-opt--locked" : ""), {
      type: "button",
      onclick: () => {
        // Leaving the Nationellt prov source: drop any stale subject lock.
        if (key !== "nationalprov" && state.subjectLocked) {
          state.subjectLocked = false;
          state.subject = store.subjects[0]?.name || t("common.general");
          state.npLevel = null; state.npEntry = null;
        }
        state.source = key; state.step = "input"; paint();
      },
    }, [
      icon(iconPath, 26), label,
      el("div.note", { style: { fontWeight: "400", marginTop: "4px" } }, desc),
      needsAi && noServer ? el("span.source-opt__tag", {}, t("create.optNeedsServer")) : null,
    ].filter(Boolean));

    return el("div.panel", {}, [
      el("p", { style: { marginBottom: "16px" } }, t("create.whereFrom")),
      el("div.source-grid", {}, [
        opt("blank", ICONS.plus, t("create.optBlank"), t("create.optBlankSub"), false),
        opt("import", ICONS.clipboard, t("create.optImport"), t("create.optImportSub"), false),
        opt("paste", ICONS.pencil, t("create.optPaste"), t("create.optPasteSub"), true),
        opt("photo", ICONS.camera, t("create.optPhoto"), t("create.optPhotoSub"), true),
        opt("pdf", ICONS.fileText, t("create.optPdf"), t("create.optPdfSub"), true),
        opt("nationalprov", ICONS.graduation, t("create.optNational"), t("create.optNationalSub"), true),
      ]),
      noServer && el("p.note.note--warn", { style: { marginTop: "16px" } }, [
        t("create.needKey"), el("a", { href: "#/settings" }, t("create.needKeyLink")),
        t("create.needKeyTail"),
      ]),
    ]);
  }

  /* A file input that reads a PDF directly, or unpacks every PDF inside a ZIP
   * (e.g. Skolverket's national-exam downloads) and concatenates their text —
   * shared by the "Upload PDF" source and the Nationellt prov source. */
  function appendPdfOrZipField(body) {
    const status = el("p.note", { style: { marginTop: "8px" } });
    const input = el("input", {
      type: "file",
      accept: "application/pdf,.pdf,application/zip,application/x-zip-compressed,.zip",
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        status.className = "note";
        status.textContent = t("create.reading"); state.material = "";
        const isZip = /\.zip$/i.test(file.name) || file.type.includes("zip");
        try {
          if (isZip) {
            const { text, pdfCount, totalPdfCount, skippedAudio } = await extractZipText(file);
            state.material = text;
            status.textContent = t("create.zipExtracted", {
              n: pdfCount, total: totalPdfCount, name: file.name,
              audio: skippedAudio ? t("create.zipSkippedAudio", { n: skippedAudio }) : "",
            });
          } else {
            state.material = await extractPdfText(file);
            status.textContent = t("create.extracted", { n: state.material.length.toLocaleString(), name: file.name });
          }
        } catch (err) {
          status.className = "note note--warn";
          status.textContent = err.message || t("create.readFail");
        }
      },
    });
    body.appendChild(el("label.field", {}, [el("span", {}, t("create.pdfOrZipFile")), input]));
    body.appendChild(status);
  }

  /* Where to get the material + already-imported years + "mix all years",
   * for one chosen Nationellt prov subject entry. */
  function nationalInfoPanel(entry) {
    const name = nationalSubjectName(entry);
    const subject = store.subjects.find((s) => s.name.toLowerCase() === name.toLowerCase());
    const sets = subject ? store.assignments.filter((a) => a.subjectId === subject.id) : [];
    const totalQuestions = sets.reduce((n, a) => n + a.questions.length, 0);

    const extra = [];
    if (sets.length) {
      const countInput = el("input", {
        type: "number", min: "3", max: String(Math.max(3, totalQuestions)),
        value: String(Math.min(15, totalQuestions)), style: { width: "80px" },
      });
      const startBtn = el("button.btn.btn--sm", { type: "button" }, t("create.npMixStart"));
      startBtn.addEventListener("click", () => {
        const n = Math.max(3, Math.min(+countInput.value || 15, totalQuestions));
        location.hash = `#/national/mix/${subject.id}?count=${n}`;
      });
      extra.push(
        el("p.note", { style: { fontWeight: 700, marginTop: "10px" } },
          plural(sets.length, "create.npImportedOne", "create.npImportedMany")),
        el("div", { style: { display: "grid", gap: "4px", marginBottom: "8px" } }, sets.map((a) =>
          el("a", { href: `#/session/${a.id}`, class: "note" }, `→ ${a.title} (${plural(a.questions.length, "common.questionOne", "common.questionMany")})`))),
        el("label.field", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "0" } }, [
          el("span", { style: { fontWeight: 400 } }, t("create.npMixLabel")),
          countInput, startBtn,
        ]),
      );
    }

    return el("div", { style: { border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "var(--s-4)", marginTop: "4px" } }, [
      el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" } }, [
        el("span", {}, [entry.name, el("span.badge", { style: { marginLeft: "8px" } }, entry.kind === "limited" ? t("create.npBadgeExample") : t("create.npBadgeExternal"))]),
        el("a.btn.btn--ghost.btn--sm", { href: entry.url, target: "_blank", rel: "noopener noreferrer" }, t("create.npGetMaterial")),
      ]),
      el("p.note", { style: { margin: "8px 0 0" } },
        entry.kind === "limited" ? t("create.npInfoLimited") : t("create.npInfoExternal")),
      ...extra,
    ]);
  }

  /* ---- step 2: material + options ---- */
  function inputStep() {
    const body = el("div");

    if (state.source === "paste") {
      const splitBox = el("div", { style: { marginTop: "10px" } });
      const ta = el("textarea", {
        placeholder: t("create.materialPlaceholder"),
        oninput: (e) => { state.material = e.target.value; refreshSplit(); },
      });
      ta.value = state.material;
      body.appendChild(el("label.field", {}, [el("span", {}, t("create.material")), ta]));
      body.appendChild(splitBox);

      function refreshSplit() {
        clear(splitBox);
        const secs = detectSections(state.material);
        if (secs.length < 2) return;
        splitBox.appendChild(el("p.note", {}, t("create.splitFound", { n: secs.length })));
        splitBox.appendChild(el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", margin: "6px 0" } },
          secs.map((s) => el("span.badge", {}, s.title.length > 32 ? s.title.slice(0, 32) + "…" : s.title))));
        splitBox.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button", disabled: !store.hasKey(),
          title: store.hasKey() ? "" : t("create.needKeyShort"),
          onclick: () => runSplit(secs),
        }, [icon(ICONS.spark, 16), t("create.splitEach", { n: secs.length })]));
      }
      refreshSplit();
    }

    if (state.source === "pdf") appendPdfOrZipField(body);

    if (state.source === "photo") {
      const status = el("p.note", { style: { marginTop: "8px" } });
      const preview = el("div", { style: { marginTop: "10px" } });
      const onFile = async (file) => {
        if (!file) return;
        status.className = "note";
        status.textContent = t("create.reading"); state.image = null; clear(preview);
        try {
          state.image = await readImageFile(file);
          status.textContent = t("create.loadedFile", { name: file.name });
          preview.appendChild(el("img", { src: state.image.preview, alt: "", style: { maxWidth: "260px", borderRadius: "12px", border: "1px solid var(--line)" } }));
        } catch (err) {
          status.className = "note note--warn";
          status.textContent = err.message || t("create.readFail");
        }
      };
      // capture="environment" opens the camera on mobile; ignored on desktop.
      const camInput = el("input", { type: "file", accept: "image/*", capture: "environment",
        onchange: (e) => onFile(e.target.files[0]) });
      const fileInput = el("input", { type: "file", accept: "image/*",
        onchange: (e) => onFile(e.target.files[0]) });
      body.appendChild(el("label.field", {}, [el("span", {}, t("create.takePhoto")), camInput]));
      body.appendChild(el("label.field", {}, [el("span", {}, t("create.choosePhoto")), fileInput]));
      body.appendChild(status);
      body.appendChild(preview);
    }

    if (state.source === "import") {
      const status = el("p.note", { style: { marginTop: "8px" } });
      const ta = el("textarea", {
        placeholder: t("create.importPlaceholder"),
        oninput: (e) => { state.material = e.target.value; refresh(); },
      });
      ta.value = state.material;
      const fileInput = el("input", {
        type: "file", accept: ".csv,.tsv,.txt,.json,text/csv,text/plain,application/json",
        onchange: async (e) => {
          const f = e.target.files[0];
          if (!f) return;
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
          } catch (err) { toast(err.message); return; }
          state.material = text;
          ta.value = state.material;
          refresh();
        },
      });
      body.append(
        el("p.note", {}, t("create.importHint")),
        el("label.field", {}, [el("span", {}, t("create.importPaste")), ta]),
        el("label.field", {}, [el("span", {}, t("create.importFile")), fileInput]),
        status,
      );
      function refresh() {
        const cards = parseCards(state.material);
        status.className = cards.length ? "note" : "note note--warn";
        status.textContent = cards.length
          ? t("create.importFound", { n: cards.length })
          : (state.material.trim() ? t("create.importNone") : "");
      }
      refresh();
    }

    if (state.source === "nationalprov") {
      const levelSel = el("select", {
        onchange: (e) => {
          state.npLevel = e.target.value || null;
          state.npEntry = null; state.subjectLocked = false; state.material = "";
          paint();
        },
      }, [
        el("option", { value: "" }, t("create.npLevelPlaceholder")),
        ...NATIONAL_TEST_LEVELS.map((lvl) => el("option", { value: lvl.id }, lvl.label)),
      ]);
      levelSel.value = state.npLevel || "";
      body.appendChild(el("label.field", {}, [el("span", {}, t("create.npLevel")), levelSel]));

      if (state.npLevel) {
        const subjectEntries = NATIONAL_TEST_SUBJECTS.filter((e) => e.level === state.npLevel);
        const subjSel = el("select", {
          onchange: (e) => {
            const entry = subjectEntries.find((s) => s.id === e.target.value) || null;
            state.npEntry = entry;
            state.material = "";
            if (entry) { state.subject = nationalSubjectName(entry); state.subjectLocked = true; }
            else state.subjectLocked = false;
            paint();
          },
        }, [
          el("option", { value: "" }, t("create.npSubjectPlaceholder")),
          ...subjectEntries.map((s) => el("option", { value: s.id }, s.name)),
        ]);
        subjSel.value = state.npEntry?.id || "";
        body.appendChild(el("label.field", {}, [el("span", {}, t("create.npSubject")), subjSel]));
      }

      if (state.npEntry) {
        body.appendChild(nationalInfoPanel(state.npEntry));

        const ta = el("textarea", { placeholder: t("create.npPastePlaceholder"), oninput: (e) => { state.material = e.target.value; } });
        ta.value = state.material;
        body.appendChild(el("label.field", { style: { marginTop: "12px" } }, [el("span", {}, t("create.npPasteText")), ta]));

        appendPdfOrZipField(body);
      }
    }

    // shared options
    const subjectFld = state.subjectLocked
      ? { el: el("input", { type: "text", value: state.subject, disabled: true, "aria-label": t("create.subject") }) }
      : subjectField({ value: state.subject, onChange: (v) => { state.subject = v; } });
    const typeSel = el("select", { onchange: (e) => { state.type = e.target.value; } }, [
      el("option", { value: "assignment" }, t("create.typeAssignment")),
      el("option", { value: "test" }, t("create.typeTest")),
    ]);
    typeSel.value = state.type;
    const countInput = el("input", { type: "number", min: "3", max: "15", value: state.count, oninput: (e) => { state.count = Math.max(3, Math.min(15, +e.target.value || 6)); } });
    const flashcardsCheck = el("input", { type: "checkbox", checked: state.preferFlashcards, onchange: (e) => { state.preferFlashcards = e.target.checked; } });

    const err = el("p.note.note--warn", { hidden: true });
    const genBtn = el("button.btn", { type: "button", disabled: !store.hasKey(), onclick: generate }, [icon(ICONS.spark, 18), t("create.generate")]);

    // Import needs no AI — the cards *are* the questions. Straight to review.
    function buildFromImport() {
      const cards = parseCards(state.material);
      if (!cards.length) { err.hidden = false; err.textContent = t("create.importNone"); return; }
      const doc = cardsToDoc(cards, { title: state.subject !== t("common.general") ? state.subject : "", subject: state.subject });
      doc.subject = state.subject.trim() || t("common.general");
      doc.type = state.type;
      doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
      state.doc = doc;
      state.step = "review"; paint();
    }

    if (state.source === "import") {
      return el("div.panel", {}, [
        body,
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "8px", alignItems: "start" } }, [
          el("label.field", {}, [el("span", {}, t("create.subject")), subjectFld.el]),
          el("label.field", {}, [el("span", {}, t("create.type")), typeSel]),
        ]),
        err,
        el("div.nav-row", {}, [
          el("button.btn.btn--ghost", { type: "button", onclick: () => { state.step = "source"; paint(); } }, t("common.back")),
          el("button.btn", { type: "button", onclick: buildFromImport }, [icon(ICONS.check, 18), t("create.importBuild")]),
        ]),
      ]);
    }

    // A blank set — no AI. Drops straight into the editor with a few starter
    // questions of each kind (blank answers OK), for trying the app out.
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

    if (state.source === "blank") {
      return el("div.panel", {}, [
        el("p.note", { style: { marginBottom: "12px" } }, t("create.blankHint")),
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", alignItems: "start" } }, [
          el("label.field", {}, [el("span", {}, t("create.subject")), subjectFld.el]),
          el("label.field", {}, [el("span", {}, t("create.type")), typeSel]),
        ]),
        el("label.field", { style: { maxWidth: "160px" } }, [el("span", {}, t("create.howMany")), countInput]),
        el("div.nav-row", {}, [
          el("button.btn.btn--ghost", { type: "button", onclick: () => { state.step = "source"; paint(); } }, t("common.back")),
          el("button.btn", { type: "button", onclick: buildBlank }, [icon(ICONS.check, 18), t("create.blankBuild")]),
        ]),
      ]);
    }

    async function generate() {
      const hasInput = state.material.trim() || state.topic.trim() || state.image;
      if (!hasInput) { err.hidden = false; err.textContent = t("create.needMaterial"); return; }
      state.step = "generating"; paint();
      try {
        const doc = await generateAssignment({
          material: state.material ? fitText(state.material) : "",
          topic: state.topic.trim(),
          image: state.image ? { mediaType: state.image.mediaType, data: state.image.data } : null,
          count: state.count,
          gradeHint: state.gradeHint.trim(),
          preferFlashcards: state.preferFlashcards,
        });
        doc.subject = state.subject.trim() || doc.subject || t("common.general");
        doc.type = state.type;
        doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
        state.doc = doc;
        state.step = "review"; paint();
      } catch (e) {
        state.step = "input"; paint();
        const m = root.querySelector(".note--warn");
        const msg = e instanceof ClaudeError ? e.message : t("create.genFailed");
        toast(msg);
        if (m) { m.hidden = false; m.textContent = msg; }
      }
    }

    return el("div.panel", {}, [
      body,
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", alignItems: "start" } }, [
        el("label.field", {}, [
          el("span", {}, t("create.subject")), subjectFld.el,
          state.subjectLocked && el("span.note", { style: { display: "block", marginTop: "4px" } }, t("create.subjectLocked")),
        ]),
        el("label.field", {}, [el("span", {}, t("create.type")), typeSel]),
      ]),
      el("div", { style: { display: "flex", alignItems: "flex-end", gap: "24px", flexWrap: "wrap" } }, [
        el("label.field", { style: { maxWidth: "160px", marginBottom: "0" } }, [el("span", {}, t("create.howMany")), countInput]),
        el("label", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "var(--s-4)" } }, [
          flashcardsCheck, el("span", {}, t("create.preferFlashcards")),
        ]),
      ]),
      err,
      // Spell out why the button is dead — right where it's dead, not just on step 1.
      !store.hasKey() && el("p.note.note--warn", { style: { marginBottom: "12px" } }, [
        t("create.noServerHere") + " ",
        el("a", { href: "#/library" }, t("create.noServerAlt")),
        t("create.noServerTail"),
      ]),
      el("div.nav-row", {}, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => { state.step = "source"; paint(); } }, t("common.back")),
        genBtn,
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

    const duePicker = datePicker({ value: doc.dueAt || "", min: localDayKey() });

    const countNote = el("p.note");
    const editor = questionEditor(doc, {
      onChange: (n) => { countNote.textContent = t("create.countNote", { n: plural(n, "common.questionOne", "common.questionMany") }); },
    });

    function save() {
      const questions = editor.commit();
      if (!questions.length) { toast(t("create.addAtLeastOne")); return; }
      if (!doc.title.trim()) { toast(t("create.giveName")); titleInput.focus(); return; }
      doc.dueAt = duePicker.getValue() || null;
      const saved = store.addAssignmentDoc(doc);
      toast(t("create.saved"));
      location.hash = `#/session/${saved.id}`;
    }

    return el("div", {}, [
      el("div.panel", {}, [
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", alignItems: "start" } }, [
          el("label.field", {}, [el("span", {}, t("create.setTitle")), titleInput]),
          el("label.field", {}, [el("span", {}, t("create.subject")), subjectFld.el]),
        ]),
        el("div.field", { style: { maxWidth: "320px" } }, [el("span", {}, t("create.dueDate")), duePicker.el]),
        countNote,
      ]),
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
  return { title: t("create.title"), node: root };
}
