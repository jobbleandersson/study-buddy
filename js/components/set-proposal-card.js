// The "Create the set" card under an AI-chat reply that ends in a set proposal (lib/set-brief.js).
// The student reads what is about to be made and taps the button; only then is anything generated
// (a real AI call that counts against their allowance, so it is never started by the model alone).
//
//   idle -> creating -> done          (done: practise / edit)
//        \-> error -> creating ...    (error: try again)
//   idle -> superseded                (a newer proposal in the same chat replaced it)

import { el, icon, ICONS } from "../lib/dom.js";
import { t, plural, fmtDate } from "../lib/i18n.js";

/**
 * @param brief      a normalized brief (set-brief.js normalizeBrief)
 * @param isDone     (setId) => the saved set, or null - so a chat opened later shows "created" only while the set still exists
 * @param create     async (brief) => the saved assignment { id, title, questions } - throws a user-readable Error on failure
 * @param blocked    () => a message when AI is unavailable right now (signed out / quota / no server), else ""
 * @param onCreated  (assignment) => void - called once, so the chat can remember which set this card made
 * @param testFor    (assignment) => the test this set is on, or null
 * @param addTest    (assignment, brief) => puts brief.testDate into Inför provet with the set on it (the exam, or null)
 */
export function setProposalCard({ brief, isDone, create, blocked, onCreated, testFor, addTest }) {
  const root = el("div.setcard");
  let phase = "idle";
  let error = "";
  let made = brief.setId ? isDone?.(brief.setId) || null : null;
  if (made) phase = "done";

  function facts() {
    const bits = [
      plural(brief.count, "common.questionOne", "common.questionMany"),
      brief.flashcards ? t("setgen.flashcards") : "",
      brief.level,
      brief.subject,
      brief.fromNotes ? t("setgen.fromNotes") : "",
    ].filter(Boolean);
    return el("p.setcard__facts", {}, bits.join(" · "));
  }

  async function go() {
    const why = blocked?.();
    if (why) { error = why; paint("error"); return; }
    paint("creating");
    try {
      made = await create(brief);
      onCreated?.(made);
      paint("done");
    } catch (e) {
      error = e?.message || t("setgen.failed");
      paint("error");
    }
  }

  function paint(next = phase) {
    phase = next;
    root.className = `setcard setcard--${phase}`;
    root.setAttribute("aria-busy", String(phase === "creating"));
    const kids = [];
    if (phase === "done" && made) {
      kids.push(
        el("p.setcard__title", {}, [icon(ICONS.check, 16), t("setgen.done", { title: made.title || brief.title })]),
        el("p.setcard__facts", {}, plural(made.questions?.length ?? brief.count, "common.questionOne", "common.questionMany")),
        el("div.setcard__actions", {}, [
          el("a.btn.btn--sm", { href: `#/session/${made.id}` }, [icon(ICONS.play, 14), t("setgen.practise")]),
          testButton(),
          el("a.btn.btn--ghost.btn--sm", { href: `#/edit/${made.id}` }, [icon(ICONS.pencil, 14), t("setgen.edit")]),
        ].filter(Boolean)),
      );
    } else {
      kids.push(
        el("p.setcard__title", {}, [icon(ICONS.layers, 16), brief.title]),
        el("p.setcard__topic", {}, brief.topic),
        facts(),
      );
      if (phase === "creating") kids.push(el("p.setcard__status", { role: "status" }, [el("span.typing", {}, [el("span"), el("span"), el("span")]), t("setgen.creating")]));
      else if (phase === "superseded") kids.push(el("p.setcard__status", {}, t("setgen.superseded")));
      else {
        if (phase === "error" && error) kids.push(el("p.setcard__error", { role: "alert" }, error));
        kids.push(el("div.setcard__actions", {}, [
          el("button.btn.btn--sm", { type: "button", onclick: go }, [icon(ICONS.spark, 14), phase === "error" ? t("setgen.retry") : t("setgen.create")]),
        ]));
        if (phase === "idle") kids.push(el("p.setcard__hint", {}, t("setgen.hint")));
      }
    }
    root.replaceChildren(...kids);
  }

  /** "Lägg in provet …" when the student said when the test is; once it is in, a way to open it. */
  function testButton() {
    const onTest = testFor?.(made);
    if (onTest) return el("a.btn.btn--ghost.btn--sm", { href: `#/exam-prep/${onTest.id}` }, [icon(ICONS.graduation, 14), t("setgen.openTest")]);
    if (!brief.testDate || !addTest) return null;
    return el("button.btn.btn--ghost.btn--sm", {
      type: "button",
      onclick: () => { if (addTest(made, brief)) paint("done"); },
    }, [icon(ICONS.calendar, 14), t("setgen.addTest", { date: fmtDate(brief.testDate) })]);
  }

  paint();
  return {
    node: root,
    /** A newer proposal replaced this one: keep it readable, but no longer offer to create it. */
    supersede() { if (phase === "idle" || phase === "error") paint("superseded"); },
    get busy() { return phase === "creating"; },
  };
}
