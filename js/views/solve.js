// Instant photo-solve: snap a photo of ONE problem, get a clear step-by-step
// explanation back in seconds. Deliberately separate from the Create flow —
// that one builds a whole study set (source, material, subject, count,
// review); this one is a single focused answer, closer to "point your camera
// at it and go." Needs the tutor server (store.hasKey()); until then the
// button is disabled and the reason is spelled out, exactly like Create.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { readImageFile } from "../material.js";
import { solveProblem, ClaudeError } from "../claude.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

export function renderSolve() {
  const root = el("div.solve");
  const state = {
    step: "idle",   // idle | loading | result
    image: null,    // { mediaType, data, preview }
    note: "",
    result: null,   // { restated, answer, steps, topic, subject }
    error: "",
  };

  function paint() {
    clear(root);
    root.appendChild(homeButton({ grid: true }));
    root.appendChild(el("h1", { style: { marginTop: "8px" } }, t("solve.title")));
    root.appendChild(
      state.step === "loading" ? loadingPanel()
        : state.step === "result" ? resultPanel()
        : idlePanel(),
    );
  }

  function reset() {
    state.step = "idle"; state.image = null; state.note = ""; state.result = null; state.error = "";
    paint();
  }

  async function solve() {
    state.step = "loading"; state.error = ""; paint();
    try {
      state.result = await solveProblem({ image: state.image, note: state.note });
      state.step = "result"; paint();
    } catch (e) {
      state.error = e instanceof ClaudeError ? e.message : t("create.genFailed");
      state.step = "idle"; paint();
      toast(state.error);
    }
  }

  function idlePanel() {
    const fileInput = el("input", {
      type: "file", accept: "image/*", capture: "environment", style: { display: "none" },
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        state.error = "";
        try {
          state.image = await readImageFile(file);
        } catch (err) {
          state.image = null;
          state.error = err.message || t("err.readFile");
        }
        paint();
      },
    });

    const dropzone = el("label.solve-dropzone" + (state.image ? ".has-image" : ""), {}, [
      fileInput,
      state.image
        ? el("img", { src: state.image.preview, alt: "" })
        : el("div.solve-dropzone__inner", {}, [
            icon(ICONS.camera, 32),
            el("span.solve-dropzone__cta", {}, t("solve.uploadCta")),
            el("span.note", {}, t("solve.uploadHint")),
          ]),
    ]);

    const noteInput = el("textarea", {
      placeholder: t("solve.notePlaceholder"), rows: 2, style: { minHeight: "60px" },
      oninput: (e) => { state.note = e.target.value; },
    });
    noteInput.value = state.note;

    return el("div.panel", {}, [
      el("p", { style: { marginBottom: "16px" } }, t("solve.intro")),
      el("div.field", {}, [el("span", {}, t("solve.uploadLabel")), dropzone]),
      state.image
        ? el("button.linkbtn", { type: "button", style: { marginTop: "8px" }, onclick: () => fileInput.click() }, t("solve.retake"))
        : null,
      el("label.field", { style: { marginTop: "16px" } }, [el("span", {}, t("solve.noteLabel")), noteInput]),
      state.error ? el("p.note.note--warn", { style: { marginTop: "12px" } }, state.error) : null,
      !store.hasKey() ? el("p.note.note--warn", { style: { marginTop: "16px" } }, [
        t("create.needKey"), el("a", { href: "#/settings" }, t("create.needKeyLink")), t("create.needKeyTail"),
      ]) : null,
      el("div", { style: { marginTop: "20px", textAlign: "center" } }, [
        el("button.btn", { type: "button", disabled: !state.image || !store.hasKey(), onclick: solve },
          [icon(ICONS.spark, 18), t("solve.solveButton")]),
      ]),
    ].filter(Boolean));
  }

  function loadingPanel() {
    return el("div.panel", { style: { textAlign: "center" } }, [
      el("div.spinner"),
      el("p", {}, t("solve.loading")),
    ]);
  }

  function resultPanel() {
    const r = state.result;
    return el("div.panel", {}, [
      el("div.solve-result", {}, [
        state.image ? el("img.solve-result__thumb", { src: state.image.preview, alt: "" }) : null,
        el("div", { style: { flex: "1", minWidth: "220px" } }, [
          r.restated ? el("p.solve-restated", {}, [t("solve.restatedLabel"), " “", el("span", { html: renderRich(r.restated) }), "”"]) : null,
          el("div.solve-answer", {}, [
            el("span.solve-answer__label", {}, t("solve.answerLabel")),
            el("div.solve-answer__value", { html: renderRich(r.answer) }),
          ]),
        ].filter(Boolean)),
      ].filter(Boolean)),

      r.steps.length ? el("div", { style: { marginTop: "20px", textAlign: "left" } }, [
        el("h3", { style: { marginBottom: "8px" } }, t("solve.stepsLabel")),
        el("ol.solve-steps", {}, r.steps.map((s) => el("li", { html: renderRich(s) }))),
      ]) : null,

      el("div", { style: { display: "flex", gap: "12px", justifyContent: "center", marginTop: "24px", flexWrap: "wrap" } }, [
        el("button.btn.btn--ghost", { type: "button", onclick: reset }, [icon(ICONS.camera, 16), t("solve.another")]),
        el("a.btn.btn--ghost", { href: `#/create?subject=${encodeURIComponent(r.subject)}` }, t("solve.practiceMore", { subject: r.subject })),
      ]),
    ]);
  }

  paint();
  return { title: t("solve.pageTitle"), node: root };
}
