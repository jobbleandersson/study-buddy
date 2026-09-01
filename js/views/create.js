// Create flow: pick material -> provide it -> generate with Claude -> review/edit -> save.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { extractPdfText, readImageFile, fitText } from "../material.js";
import { generateAssignment, ClaudeError } from "../claude.js";
import { questionEditor } from "../components/question-editor.js";
import { t, plural } from "../lib/i18n.js";

export function renderCreate() {
  const root = el("div");
  const state = {
    step: "source",           // source | input | generating | review
    source: null,             // paste | pdf | photo | topic
    material: "",
    topic: "",
    image: null,
    gradeHint: "",
    subject: store.subjects[0]?.name || t("common.general"),
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
    root.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" } }, [
      el("a.iconbtn", { href: "#/", "aria-label": t("common.cancel") }, [icon(ICONS.back, 18)]),
      el("h1", {}, t("create.title")),
    ]));
    root.appendChild(steps());
    root.appendChild(({ source: sourceStep, input: inputStep, generating: generatingStep, review: reviewStep }[state.step])());
  }

  /* ---- step 1: source ---- */
  function sourceStep() {
    const opt = (key, emoji, label, desc) => el("button.source-opt", {
      type: "button",
      onclick: () => { state.source = key; state.step = "input"; paint(); },
    }, [el("span", {}, emoji), label, el("div.note", { style: { fontWeight: "400", marginTop: "4px" } }, desc)]);

    return el("div.panel", {}, [
      el("p", { style: { marginBottom: "16px" } }, t("create.whereFrom")),
      el("div.source-grid", {}, [
        opt("paste", "📝", t("create.optPaste"), t("create.optPasteSub")),
        opt("pdf", "📄", t("create.optPdf"), t("create.optPdfSub")),
        opt("photo", "📷", t("create.optPhoto"), t("create.optPhotoSub")),
        opt("topic", "💡", t("create.optTopic"), t("create.optTopicSub")),
      ]),
      !store.hasKey() && el("p.note.note--warn", { style: { marginTop: "16px" } }, [
        t("create.needKey"), el("a", { href: "#/settings" }, t("create.needKeyLink")),
        t("create.needKeyTail"),
      ]),
    ]);
  }

  /* ---- step 2: material + options ---- */
  function inputStep() {
    const body = el("div");

    if (state.source === "paste") {
      const ta = el("textarea", { placeholder: t("create.materialPlaceholder"), oninput: (e) => { state.material = e.target.value; } });
      ta.value = state.material;
      body.appendChild(el("label.field", {}, [el("span", {}, t("create.material")), ta]));
    }

    if (state.source === "topic") {
      const ti = el("input", { type: "text", placeholder: t("create.topicPlaceholder"), oninput: (e) => { state.topic = e.target.value; } });
      ti.value = state.topic;
      body.appendChild(el("label.field", {}, [el("span", {}, t("create.topic")), ti]));
      const gi = el("input", { type: "text", placeholder: t("create.gradePlaceholder"), oninput: (e) => { state.gradeHint = e.target.value; } });
      gi.value = state.gradeHint;
      body.appendChild(el("label.field", {}, [el("span", {}, t("create.grade")), gi]));
    }

    if (state.source === "pdf" || state.source === "photo") {
      const status = el("p.note", { style: { marginTop: "8px" } });
      const preview = el("div", { style: { marginTop: "10px" } });
      const input = el("input", {
        type: "file",
        accept: state.source === "pdf" ? "application/pdf" : "image/*",
        onchange: async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          status.textContent = t("create.reading"); state.material = ""; state.image = null; clear(preview);
          try {
            if (state.source === "pdf") {
              state.material = await extractPdfText(file);
              status.textContent = t("create.extracted", { n: state.material.length.toLocaleString(), name: file.name });
            } else {
              state.image = await readImageFile(file);
              status.textContent = t("create.loadedFile", { name: file.name });
              preview.appendChild(el("img", { src: state.image.preview, alt: "", style: { maxWidth: "260px", borderRadius: "12px", border: "1px solid var(--line)" } }));
            }
          } catch (err) {
            status.className = "note note--warn";
            status.textContent = err.message || t("create.readFail");
          }
        },
      });
      body.appendChild(el("label.field", {}, [el("span", {}, t(state.source === "pdf" ? "create.pdfFile" : "create.photo")), input]));
      body.appendChild(status);
      body.appendChild(preview);
    }

    // shared options
    const subjectInput = el("input", { type: "text", list: "subject-list", value: state.subject, oninput: (e) => { state.subject = e.target.value; } });
    const datalist = el("datalist", { id: "subject-list" }, store.subjects.map((s) => el("option", { value: s.name })));
    const typeSel = el("select", { onchange: (e) => { state.type = e.target.value; } }, [
      el("option", { value: "assignment" }, t("create.typeAssignment")),
      el("option", { value: "test" }, t("create.typeTest")),
    ]);
    typeSel.value = state.type;
    const countInput = el("input", { type: "number", min: "3", max: "15", value: state.count, oninput: (e) => { state.count = Math.max(3, Math.min(15, +e.target.value || 6)); } });

    const err = el("p.note.note--warn", { hidden: true });
    const genBtn = el("button.btn", { type: "button", disabled: !store.hasKey(), onclick: generate }, [icon(ICONS.spark, 18), t("create.generate")]);

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
      datalist,
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
        el("label.field", {}, [el("span", {}, t("create.subject")), subjectInput]),
        el("label.field", {}, [el("span", {}, t("create.type")), typeSel]),
      ]),
      el("label.field", { style: { maxWidth: "160px" } }, [el("span", {}, t("create.howMany")), countInput]),
      err,
      el("div.nav-row", {}, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => { state.step = "source"; paint(); } }, t("common.back")),
        genBtn,
      ]),
    ]);
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
    const subjectInput = el("input", {
      type: "text", value: doc.subject, list: "subject-list", "aria-label": t("create.subject"),
      oninput: (e) => { doc.subject = e.target.value; },
    });

    const dueInput = el("input", {
      type: "date", value: doc.dueAt || "", "aria-label": t("create.dueDate"),
      min: "2000-01-01", max: "2100-12-31",
    });

    const countNote = el("p.note");
    const editor = questionEditor(doc, {
      onChange: (n) => { countNote.textContent = t("create.countNote", { n: plural(n, "common.questionOne", "common.questionMany") }); },
    });

    function save() {
      const questions = editor.commit();
      if (!questions.length) { toast(t("create.addAtLeastOne")); return; }
      if (!doc.title.trim()) { toast(t("create.giveName")); titleInput.focus(); return; }
      doc.dueAt = dueInput.value || null;
      const saved = store.addAssignmentDoc(doc);
      toast(t("create.saved"));
      location.hash = `#/session/${saved.id}`;
    }

    return el("div", {}, [
      el("div.panel", {}, [
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
          el("label.field", {}, [el("span", {}, t("create.setTitle")), titleInput]),
          el("label.field", {}, [el("span", {}, t("create.subject")), subjectInput]),
        ]),
        el("label.field", { style: { maxWidth: "260px" } }, [el("span", {}, t("create.dueDate")), dueInput]),
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
