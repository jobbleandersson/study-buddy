// #/solve?mode=check — "Kolla min uträkning". A photo of the student's own
// written working goes in; out comes the first line that doesn't follow, a
// hint ladder that never gives the fix away, and the full solution only when
// they ask for it. Not the answer — the place where it turns.
//
// Honest about its limits: it shows how it read each line (and lets the student
// correct a misreading, then re-checks from the text — no new photo), and says
// so plainly when a photo can't be read.

import { store } from "../store.js";
import { el, icon, ICONS, toast } from "../lib/dom.js";
import { renderRich } from "../lib/rich.js";
import { markdown } from "../lib/markdown.js";
import { announce } from "../lib/a11y.js";
import { t } from "../lib/i18n.js";
import { checkWorking, ClaudeError } from "../claude.js";
import { shrinkImage } from "../lib/photo.js";
import { budgetShare } from "../lib/check.js";
import { homeButton } from "../components/nav.js";
import { solveTabs } from "../components/solve-tabs.js";
import { aiQuotaNote } from "../components/ai-gate.js";
import { bindFileTargets, pasteKey } from "../components/file-drop.js";

export function renderCheck() {
  const root = el("div.check");
  const st = {
    phase: "intro",        // "intro" | "busy" | "result"
    image: null,           // { mediaType, data, preview }
    problem: "",           // the typed problem, if the student gave one
    result: null,          // normalizeCheck() + tokens
    hintsShown: 1,
    solution: false,
    editing: false,        // fixing how a line was read
    error: "",
  };

  const fileInput = el("input", {
    type: "file", accept: "image/*", style: { display: "none" },
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) await attach(file);
    },
  });

  paint();
  bindFileTargets(root, {
    accept: "image/*", paste: store.hasKey(),
    onFiles: ([file]) => { if (st.phase !== "busy") attach(file); },
    onReject: () => toast(t("err.imageType")),
  });
  return { title: t("check.pageTitle"), node: root };

  async function attach(file) {
    if (!store.hasKey()) {
      const why = store.aiBlockReason();
      toast(why === "signin" ? t("err.notSignedIn") : why === "quota" ? t("err.quotaExceeded") : t("solve.noServerHere").trim());
      return;
    }
    try {
      st.image = await shrinkImage(file);
    } catch (err) {
      toast(err.message || t("err.readFile"));
      return;
    }
    st.phase = "intro"; st.result = null; st.error = "";
    paint();
  }

  function paint() {
    const canUse = store.hasKey();
    root.replaceChildren(...[
      homeButton({ grid: true }),
      solveTabs("check"),
      el("h1", {}, t("check.title")),
      canUse ? null : gateNote(),
      st.phase === "intro" ? intro(canUse) : null,
      st.phase === "busy" ? busy() : null,
      st.phase === "result" ? result() : null,
      fileInput,
    ].filter(Boolean));
  }

  function gateNote() {
    if (store.aiBlockReason() === "quota") return aiQuotaNote({ style: { marginBottom: "16px" } });
    return store.aiNeedsSignIn()
      ? el("p.note", { style: { marginBottom: "16px" } }, [
          t("solve.needSignIn"), el("a", { href: "#/login" }, t("solve.needSignInLink")), t("solve.needSignInTail"),
        ])
      : el("p.note.note--warn", { style: { marginBottom: "16px" } }, [
          t("solve.noServerHere"), el("a", { href: "#/library" }, t("solve.noServerAlt")),
        ]);
  }

  /* ---------------- 1. pick a photo ---------------- */
  function intro(canUse) {
    const picker = st.image
      ? el("div.check-photo", {}, [
          el("img", { src: st.image.preview, alt: t("check.photoAlt") }),
          el("button.linkbtn", { type: "button", onclick: () => fileInput.click() }, t("check.changeImage")),
        ])
      : el("button.check-drop", { type: "button", disabled: !canUse, onclick: () => fileInput.click() }, [
          icon(ICONS.camera, 30),
          el("strong", {}, t("check.pick")),
          el("span", {}, t("check.pickHint", { key: pasteKey() })),
        ]);
    return el("div.check-intro", {}, [
      el("p.check-lead", {}, t("check.lead")),
      picker,
      st.image ? null : el("ul.check-tips", {}, [1, 2, 3].map((i) => el("li", {}, t(`check.tip${i}`)))),
      el("details.check-problem", { open: !!st.problem }, [
        el("summary", {}, t("check.problemToggle")),
        el("label.sr-only", { for: "check-problem" }, t("check.problemLabel")),
        el("textarea.answerbox#check-problem", {
          rows: 2, maxlength: "500", placeholder: t("check.problemPlaceholder"), value: st.problem,
          oninput: (e) => { st.problem = e.target.value; },
        }),
      ]),
      st.error ? el("p.note.note--warn", { role: "alert" }, st.error) : null,
      el("button.btn.check-go", { type: "button", disabled: !st.image || !canUse, onclick: () => run() },
        [icon(ICONS.spark, 18), t("check.go")]),
    ].filter(Boolean));
  }

  /* ---------------- 2. waiting ---------------- */
  function busy() {
    return el("div.check-busy", { role: "status" }, [
      st.image ? el("img", { src: st.image.preview, alt: "" }) : null,
      el("p", {}, [el("span.typing", {}, [el("span"), el("span"), el("span")]), " ", t("check.reading")]),
    ].filter(Boolean));
  }

  async function run({ workingText = "" } = {}) {
    st.phase = "busy"; st.error = "";
    paint();
    announce(t("check.reading"));
    try {
      const res = await checkWorking(workingText
        ? { problem: st.problem || st.result?.problem || "", workingText }
        : { image: st.image, problem: st.problem });
      // What this cost, as a share of the month's allowance — worked out before
      // the usage numbers are refreshed, which resets them while it fetches.
      st.result = { ...res, share: budgetShare(res.tokens, store.aiUsage?.limit) };
      st.hintsShown = 1; st.solution = false; st.editing = false;
      st.phase = "result";
      store.refreshUsage?.();          // the allowance moved — keep the numbers in Settings honest
      announce(res.allGood ? t("check.allGood") : res.firstError ? t("check.announceTurn", { n: res.firstError }) : t("check.done"));
    } catch (e) {
      st.error = e instanceof ClaudeError ? e.message : t("tutor.snag");
      st.phase = st.result ? "result" : "intro";
      toast(st.error);
    }
    paint();
  }

  /* ---------------- 3. the result ---------------- */
  function result() {
    const r = st.result;
    const usage = usageNote(r);
    const newPhoto = el("button.btn.btn--ghost.check-btn", { type: "button", onclick: reset },
      [icon(ICONS.camera, 16), t("check.newPhoto")]);

    if (r.status !== "checked") {
      return el("div.check-result", {}, [
        st.image ? el("img.check-thumb", { src: st.image.preview, alt: t("check.photoAlt") }) : null,
        el("div.check-card", {}, [
          el("h2", {}, r.status === "unreadable" ? t("check.unreadable") : t("check.notWorking")),
          el("p", {}, r.reason || (r.status === "unreadable" ? t("check.unreadableTips") : "")),
        ]),
        el("div.check-actions", {}, [newPhoto]),
        usage,
      ].filter(Boolean));
    }

    return el("div.check-result", {}, [
      st.image ? el("img.check-thumb", { src: st.image.preview, alt: t("check.photoAlt") }) : null,
      r.allGood ? goodCard(r) : null,
      el("div.check-linehead", {}, [
        el("h2", {}, t("check.linesTitle")),
        el("button.linkbtn", { type: "button", onclick: () => { st.editing = !st.editing; paint(); } }, t("check.misread")),
      ]),
      st.editing ? editForm(r) : el("ol.check-lines", {}, r.lines.map((l) => lineEl(l, r))),
      r.unclear && !st.editing ? el("p.note", {}, t("check.unclear", { what: r.unclear })) : null,
      st.error ? el("p.note.note--warn", { role: "alert" }, st.error) : null,
      r.allGood ? null : ladder(r),
      st.solution && r.solution ? el("section.check-solution", {}, [
        el("h2", {}, t("check.solutionTitle")),
        el("div", { html: markdown(r.solution) }),
        el("p.note", {}, t("check.solutionNote")),
      ]) : null,
      el("div.check-actions", {}, [newPhoto]),
      usage,
    ].filter(Boolean));
  }

  function goodCard(r) {
    return el("div.check-good", {}, [
      icon(ICONS.check, 18),
      el("div", {}, [
        el("strong", {}, r.praise || t("check.allGood")),
        r.answerCorrect === false ? el("p", {}, t("check.answerOff")) : null,
      ].filter(Boolean)),
    ]);
  }

  function lineEl(l, r) {
    const turn = l.n === r.firstError;
    const state = turn ? "is-turn" : l.ok === true ? "is-ok" : "is-after";
    const hints = turn ? (r.hints.length ? r.hints.slice(0, st.hintsShown) : [l.note || t("check.noHints")]) : [];
    return el(`li.check-line.${state}`, {}, [
      el("span.check-line__mark", { "aria-hidden": "true" }, turn ? String(l.n) : l.ok === true ? [icon(ICONS.check, 14)] : ""),
      el("div.check-line__body", {}, [
        el("div.check-line__text", { html: renderRich(l.text) }),
        turn ? el("div.check-line__turn", {}, [
          el("strong", {}, t("check.turn")),
          ...hints.map((h) => el("p", { html: renderRich(h) })),
        ]) : null,
        !turn && l.ok === null && r.firstError && l.n > r.firstError && l.n === r.firstError + 1
          ? el("span.check-line__after", {}, t("check.after")) : null,
      ].filter(Boolean)),
      el("span.sr-only", {}, turn ? t("check.srTurn", { n: l.n }) : l.ok === true ? t("check.srOk", { n: l.n }) : t("check.srAfter", { n: l.n })),
    ]);
  }

  function ladder(r) {
    const canMore = st.hintsShown < r.hints.length;
    const canSolve = !!r.solution && !st.solution;
    if (!canMore && !canSolve) return null;
    return el("div.check-actions", {}, [
      canMore ? el("button.btn.check-btn", { type: "button", onclick: () => { st.hintsShown++; paint(); } }, t("check.moreHint")) : null,
      canSolve ? el("button.btn.btn--ghost.check-btn", { type: "button", onclick: () => { st.solution = true; paint(); } }, t("check.showSolution")) : null,
    ].filter(Boolean));
  }

  function editForm(r) {
    const ta = el("textarea.answerbox#check-edit", {
      rows: Math.min(10, Math.max(3, r.lines.length + 1)), "aria-label": t("check.editLabel"),
    });
    ta.value = r.lines.map((l) => l.text).join("\n");
    return el("div.check-edit", {}, [
      el("p.note", {}, t("check.editHint")),
      ta,
      el("div.check-actions", {}, [
        el("button.btn.check-btn", { type: "button", onclick: () => run({ workingText: ta.value }) }, t("check.editGo")),
        el("button.linkbtn", { type: "button", onclick: () => { st.editing = false; paint(); } }, t("common.cancel")),
      ]),
    ]);
  }

  function usageNote(r) {
    return r.share ? el("p.check-usage", {}, t("check.usage", { n: r.share })) : null;
  }

  function reset() {
    st.phase = "intro"; st.image = null; st.result = null; st.error = "";
    paint();
  }
}
