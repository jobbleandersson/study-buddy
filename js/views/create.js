// Create flow: pick material -> provide it -> generate with Claude -> review/edit -> save.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { extractPdfText, readImageFile, fitText } from "../material.js";
import { generateAssignment, ClaudeError } from "../claude.js";
import { questionEditor } from "../components/question-editor.js";

export function renderCreate() {
  const root = el("div");
  const state = {
    step: "source",           // source | input | generating | review
    source: null,             // paste | pdf | photo | topic
    material: "",
    topic: "",
    image: null,
    gradeHint: "",
    subject: store.subjects[0]?.name || "General",
    type: "assignment",
    count: 6,
    doc: null,                // generated + editable
  };

  function steps() {
    const map = [["source", "Source"], ["input", "Material"], ["review", "Review"]];
    const activeIdx = state.step === "generating" ? 1 : map.findIndex(([k]) => k === state.step);
    return el("div.steps", {}, map.map(([k, label], i) =>
      el("div", { class: "step" + (i <= activeIdx ? " on" : "") }, [
        el("span.step__n", {}, String(i + 1)), label,
      ])));
  }

  function paint() {
    clear(root);
    root.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" } }, [
      el("a.iconbtn", { href: "#/", "aria-label": "Cancel" }, [icon(ICONS.back, 18)]),
      el("h1", {}, "New study set"),
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
      el("p", { style: { marginBottom: "16px" } }, "Where should the questions come from?"),
      el("div.source-grid", {}, [
        opt("paste", "📝", "Paste text", "Notes, an article, a chapter"),
        opt("pdf", "📄", "Upload PDF", "A worksheet or textbook page"),
        opt("photo", "📷", "Upload photo", "A picture of a page or board"),
        opt("topic", "💡", "Just a topic", "e.g. “Grade 5 fractions”"),
      ]),
      !store.hasKey() && el("p.note.note--warn", { style: { marginTop: "16px" } }, [
        "Generating needs a Claude API key. ", el("a", { href: "#/settings" }, "Add one in Settings"),
        " — or explore the sample set on the menu for now.",
      ]),
    ]);
  }

  /* ---- step 2: material + options ---- */
  function inputStep() {
    const body = el("div");

    if (state.source === "paste") {
      const ta = el("textarea", { placeholder: "Paste your notes or reading here…", oninput: (e) => { state.material = e.target.value; } });
      ta.value = state.material;
      body.appendChild(el("label.field", {}, [el("span", {}, "Study material"), ta]));
    }

    if (state.source === "topic") {
      const ti = el("input", { type: "text", placeholder: "e.g. The water cycle, Grade 4", oninput: (e) => { state.topic = e.target.value; } });
      ti.value = state.topic;
      body.appendChild(el("label.field", {}, [el("span", {}, "Topic"), ti]));
      const gi = el("input", { type: "text", placeholder: "e.g. Year 8 / age 13 (optional)", oninput: (e) => { state.gradeHint = e.target.value; } });
      gi.value = state.gradeHint;
      body.appendChild(el("label.field", {}, [el("span", {}, "Year / age level"), gi]));
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
          status.textContent = "Reading…"; state.material = ""; state.image = null; clear(preview);
          try {
            if (state.source === "pdf") {
              state.material = await extractPdfText(file);
              status.textContent = `Extracted ${state.material.length.toLocaleString()} characters from “${file.name}”.`;
            } else {
              state.image = await readImageFile(file);
              status.textContent = `Loaded “${file.name}”.`;
              preview.appendChild(el("img", { src: state.image.preview, alt: "", style: { maxWidth: "260px", borderRadius: "12px", border: "1px solid var(--line)" } }));
            }
          } catch (err) {
            status.className = "note note--warn";
            status.textContent = err.message || "Could not read that file.";
          }
        },
      });
      body.appendChild(el("label.field", {}, [el("span", {}, state.source === "pdf" ? "PDF file" : "Photo"), input]));
      body.appendChild(status);
      body.appendChild(preview);
    }

    // shared options
    const subjectInput = el("input", { type: "text", list: "subject-list", value: state.subject, oninput: (e) => { state.subject = e.target.value; } });
    const datalist = el("datalist", { id: "subject-list" }, store.subjects.map((s) => el("option", { value: s.name })));
    const typeSel = el("select", { onchange: (e) => { state.type = e.target.value; } }, [
      el("option", { value: "assignment" }, "Assignment (practice)"),
      el("option", { value: "test" }, "Test (quiz)"),
    ]);
    typeSel.value = state.type;
    const countInput = el("input", { type: "number", min: "3", max: "15", value: state.count, oninput: (e) => { state.count = Math.max(3, Math.min(15, +e.target.value || 6)); } });

    const err = el("p.note.note--warn", { hidden: true });
    const genBtn = el("button.btn", { type: "button", disabled: !store.hasKey(), onclick: generate }, [icon(ICONS.spark, 18), "Generate questions"]);

    async function generate() {
      const hasInput = state.material.trim() || state.topic.trim() || state.image;
      if (!hasInput) { err.hidden = false; err.textContent = "Add some material or a topic first."; return; }
      state.step = "generating"; paint();
      try {
        const doc = await generateAssignment({
          material: state.material ? fitText(state.material) : "",
          topic: state.topic.trim(),
          image: state.image ? { mediaType: state.image.mediaType, data: state.image.data } : null,
          count: state.count,
          gradeHint: state.gradeHint.trim(),
        });
        doc.subject = state.subject.trim() || doc.subject || "General";
        doc.type = state.type;
        doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
        state.doc = doc;
        state.step = "review"; paint();
      } catch (e) {
        state.step = "input"; paint();
        const m = root.querySelector(".note--warn");
        const msg = e instanceof ClaudeError ? e.message : "Generation failed. Try again or simplify the material.";
        toast(msg);
        if (m) { m.hidden = false; m.textContent = msg; }
      }
    }

    return el("div.panel", {}, [
      body,
      datalist,
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
        el("label.field", {}, [el("span", {}, "Subject"), subjectInput]),
        el("label.field", {}, [el("span", {}, "Type"), typeSel]),
      ]),
      el("label.field", { style: { maxWidth: "160px" } }, [el("span", {}, "How many questions"), countInput]),
      err,
      el("div.nav-row", {}, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => { state.step = "source"; paint(); } }, "Back"),
        genBtn,
      ]),
    ]);
  }

  /* ---- generating ---- */
  function generatingStep() {
    return el("div.panel", { style: { textAlign: "center" } }, [
      el("div.spinner"),
      el("p", {}, "Writing your questions…"),
      el("p.note", {}, "This usually takes 10–30 seconds."),
    ]);
  }

  /* ---- step 3: review + edit ---- */
  function reviewStep() {
    const doc = state.doc;

    const titleInput = el("input", {
      type: "text", value: doc.title, "aria-label": "Set title",
      oninput: (e) => { doc.title = e.target.value; },
    });
    const subjectInput = el("input", {
      type: "text", value: doc.subject, list: "subject-list", "aria-label": "Subject",
      oninput: (e) => { doc.subject = e.target.value; },
    });

    const countNote = el("p.note");
    const editor = questionEditor(doc, {
      onChange: (n) => { countNote.textContent = `${n} question${n === 1 ? "" : "s"} · edit anything below, then save.`; },
    });

    function save() {
      const questions = editor.commit();
      if (!questions.length) { toast("Add at least one question."); return; }
      if (!doc.title.trim()) { toast("Give the set a name."); titleInput.focus(); return; }
      const saved = store.addAssignmentDoc(doc);
      toast("Saved!");
      location.hash = `#/session/${saved.id}`;
    }

    return el("div", {}, [
      el("div.panel", {}, [
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
          el("label.field", {}, [el("span", {}, "Title"), titleInput]),
          el("label.field", {}, [el("span", {}, "Subject"), subjectInput]),
        ]),
        countNote,
      ]),
      editor.el,
      el("div.nav-row", {}, [
        el("button.btn.btn--ghost", { type: "button", onclick: () => { state.step = "input"; paint(); } }, "Back"),
        el("div", { style: { display: "flex", gap: "10px" } }, [
          el("button.btn.btn--ghost", { type: "button", onclick: () => editor.addQuestion() }, "+ question"),
          el("button.btn.btn--ok", { type: "button", onclick: save }, [icon(ICONS.check, 18), "Save set"]),
        ]),
      ]),
    ]);
  }

  paint();
  return { title: "New set", node: root };
}
