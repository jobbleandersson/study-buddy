// A paper worksheet for a set: numbered questions with room to write, then a
// page break and the answer key. `@media print` in css/app.css hides the rest
// of the app so window.print() / "Save as PDF" gives a clean handout.

import { store } from "../store.js";
import { el, icon, ICONS } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { parseCloze, clozeToUnderscores } from "../components/questions.js";
import { t } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";

export function renderPrint(id) {
  const a = store.getAssignment(id);
  if (!a) {
    return el("div.empty", {}, [
      el("h2", {}, t("edit.gone")),
      el("a.btn.btn--ghost", { href: "#/", style: { marginTop: "16px" } }, t("common.backToMenu")),
    ]);
  }

  const questionEl = (q, i) => {
    const head = el("div.psheet__q", {}, [el("b", {}, `${i + 1}.`), " ", promptText(q)]);
    const body = [];
    if (q.kind === "mc" && Array.isArray(q.choices)) {
      body.push(el("ol.psheet__choices", {}, q.choices.map((c) =>
        el("li", { html: renderRich(c) }))));
    } else if (q.kind !== "cloze") {
      body.push(el("div.psheet__lines"));
    }
    return el("div.psheet__item", {}, [head, ...body]);
  };

  const answerEl = (q, i) => el("div.psheet__akey", {}, [
    el("b", {}, `${i + 1}.`), " ",
    q.kind === "mc"
      ? `${String.fromCharCode(65 + (q.answer ?? 0))} — ` + strip(q.choices?.[q.answer ?? 0] || "")
      : q.kind === "cloze"
        ? parseCloze(q.prompt).filter((p) => p.blank).map((p) => p.blank[0]).join(", ")
        : strip(q.answer || ""),
  ]);

  const node = el("div.printsheet", {}, [
    el("div.psheet__bar", { "data-noprint": "" }, [
      homeButton(),
      el("a.btn.btn--ghost.btn--sm", { href: `#/edit/${id}` }, [icon(ICONS.back, 16), t("common.back")]),
      el("button.btn.btn--sm", { type: "button", onclick: () => window.print() }, [icon(ICONS.play, 16), t("print.action")]),
    ]),
    el("h1.psheet__title", {}, a.title),
    el("p.psheet__meta", {}, [
      subjectName(a), "  ·  ",
      t("print.name"), " ______________________   ",
      t("print.date"), " __________",
    ]),
    el("div", {}, a.questions.map((q, i) => questionEl(q, i))),
    el("div.psheet__break", {}, [
      el("h2", {}, t("print.answerKey")),
      el("div", {}, a.questions.map((q, i) => answerEl(q, i))),
    ]),
  ]);

  return { title: a.title, node };

  function promptText(q) {
    const span = el("span");
    span.innerHTML = renderRich(q.kind === "cloze" ? clozeToUnderscores(q.prompt, "________") : q.prompt);
    return span;
  }
}

function subjectName(a) {
  return store.subjects.find((s) => s.id === a.subjectId)?.name || "";
}
function strip(html) { return String(html).replace(/<[^>]+>/g, ""); }
