// Editable list of questions. Shared by the Create flow (reviewing what Claude
// generated) and the Edit screen (changing a set you already saved), so the two
// can't drift apart.
//
//   const editor = questionEditor(doc);
//   editor.el          -> the list node
//   editor.addQuestion()
//   editor.commit()    -> drops blank questions, returns the cleaned list

import { el, clear, icon, ICONS, uid } from "../lib/dom.js";

const KINDS = [
  ["mc", "Multiple choice"],
  ["text", "Short answer"],
  ["flashcard", "Flashcard"],
  ["worked", "Worked problem"],
];

export function questionEditor(doc, { onChange } = {}) {
  const list = el("div");

  function changed() { onChange?.(doc.questions.length); }

  function paint() {
    clear(list);
    if (!doc.questions.length) {
      list.appendChild(el("p.note", { style: { padding: "16px 0" } },
        "No questions yet — add one below."));
    }
    doc.questions.forEach((q, i) => list.appendChild(questionBlock(q, i)));
    changed();
  }

  function questionBlock(q, idx) {
    const wrap = el("div.qedit");

    const promptTa = el("textarea", {
      rows: "2", "aria-label": `Question ${idx + 1} text`,
      oninput: (e) => { q.prompt = e.target.value; },
    });
    promptTa.value = q.prompt || "";

    const body = el("div");

    function paintBody() {
      clear(body);
      if (q.kind === "mc") {
        if (!Array.isArray(q.choices) || q.choices.length < 2) q.choices = ["", ""];
        if (typeof q.answer !== "number") q.answer = 0;
        q.choices.forEach((c, ci) => {
          const radio = el("input", {
            type: "radio", name: `correct-${q.id}`, checked: q.answer === ci,
            "aria-label": `Choice ${String.fromCharCode(65 + ci)} is correct`,
            onchange: () => { q.answer = ci; },
          });
          const text = el("input", {
            type: "text", value: c, style: { flex: "1" },
            "aria-label": `Choice ${String.fromCharCode(65 + ci)}`,
            oninput: (e) => { q.choices[ci] = e.target.value; },
          });
          body.appendChild(el("div.qedit__row", {}, [
            radio, text,
            q.choices.length > 2 && el("button.iconbtn.iconbtn--sm", {
              type: "button", "aria-label": `Remove choice ${String.fromCharCode(65 + ci)}`,
              onclick: () => {
                q.choices.splice(ci, 1);
                if (q.answer >= q.choices.length) q.answer = 0;
                else if (q.answer > ci) q.answer -= 1;
                paintBody();
              },
            }, "×"),
          ].filter(Boolean)));
        });
        body.appendChild(el("p.note", { style: { marginTop: "4px" } }, "Select the radio button next to the correct choice."));
        if (q.choices.length < 5) {
          body.appendChild(el("button.btn.btn--ghost.btn--sm", {
            type: "button", style: { marginTop: "8px" },
            onclick: () => { q.choices.push(""); paintBody(); },
          }, "+ choice"));
        }
      } else {
        const ansTa = el("textarea", {
          rows: "2", "aria-label": "Answer",
          oninput: (e) => { q.answer = e.target.value; },
        });
        ansTa.value = typeof q.answer === "string" ? q.answer : "";
        body.appendChild(el("label.field", { style: { marginTop: "8px", marginBottom: "0" } }, [
          el("span", {}, q.kind === "flashcard" ? "Back of card" : "Model answer"),
          ansTa,
        ]));
      }
    }
    paintBody();

    const kindSel = el("select", {
      "aria-label": "Question type",
      onchange: (e) => {
        q.kind = e.target.value;
        if (q.kind === "mc") {
          if (!Array.isArray(q.choices)) q.choices = ["", ""];
          if (typeof q.answer !== "number") q.answer = 0;
        } else if (typeof q.answer !== "string") {
          q.answer = "";
        }
        paintBody();
      },
    }, KINDS.map(([v, l]) => el("option", { value: v }, l)));
    kindSel.value = q.kind;

    const topicInput = el("input", {
      type: "text", value: q.topic || "", style: { maxWidth: "170px" },
      placeholder: "topic", "aria-label": "Topic tag",
      oninput: (e) => { q.topic = e.target.value.toLowerCase(); },
    });

    wrap.appendChild(el("div.qedit__row", {}, [
      el("span.badge", {}, `Q${idx + 1}`),
      kindSel,
      topicInput,
      el("span", { style: { flex: "1" } }),
      el("button.iconbtn.iconbtn--sm", {
        type: "button", "aria-label": `Delete question ${idx + 1}`, title: "Delete question",
        style: { color: "var(--retry-ink)" },
        onclick: () => { doc.questions.splice(idx, 1); paint(); },
      }, [icon(ICONS.trash, 15)]),
    ]));
    wrap.appendChild(el("label.field", { style: { marginBottom: "8px" } }, [
      el("span", {}, "Question"), promptTa,
    ]));
    wrap.appendChild(body);
    return wrap;
  }

  function addQuestion() {
    doc.questions.push({
      id: uid(),
      kind: "text",
      topic: (doc.topics && doc.topics[0]) || "general",
      prompt: "",
      answer: "",
    });
    paint();
    list.lastElementChild?.querySelector("textarea")?.focus();
  }

  function commit() {
    doc.questions = doc.questions.filter((q) => (q.prompt || "").trim());
    for (const q of doc.questions) {
      if (q.kind === "mc") q.choices = (q.choices || []).map((c) => c.trim()).filter(Boolean);
      q.topic = (q.topic || "general").trim().toLowerCase() || "general";
    }
    return doc.questions;
  }

  paint();
  return { el: list, paint, addQuestion, commit };
}
