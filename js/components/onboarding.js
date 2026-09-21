// The first-run welcome quiz. A short, skippable run of one-question screens
// (name, who you are, level, subjects, goal, how studying feels, how much per
// day, how the tutor should talk), then a recap of what was set up and an
// optional free account. Shown once, when the library is empty and
// state.onboarded is false; Settings can reopen it.
//
// Nothing here is required. Answers land in state.profile (synced with the
// account) and in the ordinary settings they map to (daily goal, tutor style,
// Högskoleprov date), so the quiz never creates a second source of truth.

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { store } from "../store.js";
import { t, getLang, fmtDate } from "../lib/i18n.js";
import { serverMessage } from "../lib/server-errors.js";
import { loadLibraryIndex, loadLibraryTranslations } from "../data/library.js";
import { baseSubjectName } from "../lib/library-content.js";
import { renderGoogleButton } from "./google-signin.js";
import { openQuickAdd } from "./quick-add.js";

let shownThisSession = false;
let overlayEl = null;

export function maybeShowOnboarding() {
  if (shownThisSession) return;
  if (store.state.onboarded || store.assignments.length) return;
  shownThisSession = true;
  openWelcomeQuiz();
}

/** The library only covers these; anything else falls back to a generic subject list. */
const LIB_LEVEL = { ak7: "ak7", ak8: "ak8", ak9: "ak9", gy: "gymnasiet" };

const LEVELS = ["k16", "ak7", "ak8", "ak9", "gy", "other"];
const GOALS = [
  ["test", ICONS.target], ["grades", ICONS.chart], ["keepup", ICONS.book],
  ["hp", ICONS.award], ["stick", ICONS.layers], ["explore", ICONS.compass],
];
const AMOUNTS = [["light", 5], ["medium", 10], ["heavy", 20]];
const STYLES = [["concise", "concise"], ["normal", "normal"], ["detailed", "detailed"]];
const GENERIC_SUBJECTS = ["math", "swedish", "english", "science", "social", "languages"];

/** First names only, plain letters — this text is shown back and handed to the tutor. */
export function cleanName(s) {
  return String(s || "").replace(/[^\p{L}\p{M}\s'’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

export function openWelcomeQuiz({ force = false } = {}) {
  if (overlayEl) return;
  const prior = force ? (store.profile || {}) : {};
  const a = {
    name: prior.name || "",
    role: prior.role || null,
    level: prior.level || null,
    subjects: Array.isArray(prior.subjects) ? [...prior.subjects] : [],
    goal: prior.goal || null,
    testDate: prior.testDate || "",
    amount: Number(store.settings.dailyGoal) || 10,
    amountSet: false,
    style: store.settings.tutorVerbosity || "normal",
    styleSet: false,
  };
  const libIds = new Map();                 // subject label -> library subject id (for the recap's "see practice" link)
  const noPin = new Set();                  // labels that must not become a pinned home chip (grouped course names)

  let stepIdx = 0;
  let recap = false;
  let advTimer = 0;   // the short pause after a single-pick answer before moving on
  let committed = false;

  const stage = el("div.welcome__stage");
  const barFill = el("i");
  const stepLabel = el("span.welcome__step");
  const skipBtn = el("button.linkbtn", { type: "button", onclick: () => toRecap() }, t("welcome.skipAll"));
  const top = el("div.welcome__top", {}, [
    el("div.welcome__brand", {}, [el("img", { src: "assets/favicon.svg", alt: "" }), "Studify"]),
    stepLabel,
    skipBtn,
  ]);
  const bar = el("div.welcome__bar", { "aria-hidden": "true" }, [barFill]);

  overlayEl = el("div.welcome", { role: "dialog", "aria-modal": "true", "aria-label": t("welcome.aria") }, [bar, top, stage]);
  document.body.appendChild(overlayEl);
  document.body.classList.add("has-welcome");
  document.addEventListener("keydown", onKey);

  function onKey(e) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (document.querySelector(".cmd, .confirmdlg, .popover")) return;   // that overlay owns this Escape
    recap ? close() : toRecap();
  }
  function close() {
    clearTimeout(advTimer);
    document.removeEventListener("keydown", onKey);
    document.body.classList.remove("has-welcome");
    overlayEl?.remove();
    overlayEl = null;
  }

  /* ---------- flow ---------- */
  function steps() {
    return a.role && a.role !== "student" ? ["name", "role"] : ["name", "role", "level", "subjects", "goal", "amount", "style"];
  }
  function go(n) {
    const list = steps();
    if (n < 0) return;
    if (n >= list.length) { toRecap(); return; }
    stepIdx = n;
    paintStep(list[n]);
  }
  function next() { clearTimeout(advTimer); go(stepIdx + 1); }

  function commit() {
    if (committed) return;
    committed = true;
    const name = cleanName(a.name);
    const student = !a.role || a.role === "student";
    store.saveProfile({
      name, role: a.role || "student", level: a.level, subjects: a.subjects, goal: a.goal,
      testDate: a.testDate || "", completedAt: Date.now(),
    });
    const settings = {};
    if (student && a.amountSet) settings.dailyGoal = a.amount;
    if (student && a.styleSet) settings.tutorVerbosity = a.style;
    if (a.goal === "hp" && a.testDate) settings.hpDate = a.testDate;
    if (Object.keys(settings).length) store.setSettings(settings);
    for (const s of a.subjects) if (!noPin.has(s)) store.addSubject(s);
    store.markOnboarded();
  }

  function toRecap() {
    recap = true;
    commit();
    barFill.style.width = "100%";
    stepLabel.textContent = "";
    skipBtn.hidden = true;
    paintRecap();
  }

  /* ---------- shared bits ---------- */
  function frame({ eyebrow, title, body, content, canSkip = true, canContinue = true, onContinue }) {
    const list = steps();
    barFill.style.width = `${(stepIdx / list.length) * 100}%`;
    stepLabel.textContent = t("welcome.stepOf", { n: stepIdx + 1, total: list.length });
    skipBtn.hidden = false;
    const h = el("h2#welcome-title", { tabindex: "-1" }, title);
    const contBtn = el("button.btn", { type: "button", disabled: !canContinue, onclick: onContinue || next }, t("welcome.next"));
    const card = el("div.welcome__card.is-entering", {}, [
      eyebrow ? el("div.welcome__eyebrow", {}, eyebrow) : null,
      h,
      body ? el("p.welcome__body", {}, body) : null,
      content,
      el("div.welcome__nav", {}, [
        stepIdx > 0 ? el("button.btn.btn--ghost", { type: "button", onclick: () => go(stepIdx - 1) }, [icon(ICONS.back, 16), t("common.back")]) : el("span"),
        el("span.welcome__spacer"),
        canSkip ? el("button.linkbtn", { type: "button", onclick: next }, t("welcome.skipStep")) : null,
        contBtn,
      ].filter(Boolean)),
    ].filter(Boolean));
    stage.replaceChildren(card);
    return { h, contBtn, card };
  }

  function optionButton({ title, desc, iconPath, dot, pressed, onclick }) {
    return el("button.welcome__opt", { type: "button", "aria-pressed": String(!!pressed), onclick }, [
      iconPath ? el("span.welcome__ic", {}, icon(iconPath, 20)) : null,
      dot ? el("span.welcome__dot", { style: { background: dot } }) : null,
      el("span.welcome__opt-text", {}, [el("b", {}, title), desc ? el("small", {}, desc) : null].filter(Boolean)),
      el("span.welcome__tick", {}, icon(ICONS.check, 16)),
    ].filter(Boolean));
  }

  /** A pick-one screen. Choosing an option moves on after a beat. */
  function singleStep({ eyebrow, title, body, options, value, onPick, extra, needsContinue = false }) {
    const grid = el("div.welcome__opts");
    const f = frame({ eyebrow, title, body, content: extra ? el("div", {}, [grid, extra]) : grid, canContinue: !!value });
    function paintOpts(cur) {
      grid.replaceChildren(...options.map((o) => optionButton({
        ...o, pressed: cur === o.key,
        onclick: () => {
          onPick(o.key);
          paintOpts(o.key);
          f.contBtn.disabled = false;
          if (!needsContinue) { clearTimeout(advTimer); advTimer = setTimeout(() => { if (overlayEl && !recap) next(); }, 260); }
        },
      })));
    }
    paintOpts(value);
    f.h.focus({ preventScroll: true });
    return f;
  }

  /* ---------- steps ---------- */
  function paintStep(id) {
    if (id === "name") return stepName();
    if (id === "role") return stepRole();
    if (id === "level") return stepLevel();
    if (id === "subjects") return stepSubjects();
    if (id === "goal") return stepGoal();
    if (id === "amount") return stepAmount();
    return stepStyle();
  }

  function stepName() {
    const input = el("input.welcome__input", {
      type: "text", autocomplete: "given-name", maxlength: "24", value: a.name,
      placeholder: t("welcome.namePlaceholder"), "aria-labelledby": "welcome-title",
      oninput: () => { a.name = input.value; },
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } },
    });
    const f = frame({ title: t("welcome.nameTitle"), body: t("welcome.nameBody"), content: input });
    input.focus({ preventScroll: true });
    return f;
  }

  function stepRole() {
    return singleStep({
      title: t("welcome.roleTitle"), body: t("welcome.roleBody"), value: a.role, needsContinue: false,
      options: [
        { key: "student", title: t("welcome.roleStudent"), desc: t("welcome.roleStudentD"), iconPath: ICONS.book },
        { key: "parent", title: t("welcome.roleParent"), desc: t("welcome.roleParentD"), iconPath: ICONS.users },
        { key: "teacher", title: t("welcome.roleTeacher"), desc: t("welcome.roleTeacherD"), iconPath: ICONS.graduation },
      ],
      onPick: (k) => { a.role = k; },
    });
  }

  function stepLevel() {
    return singleStep({
      title: t("welcome.levelTitle"), body: t("welcome.levelBody"), value: a.level,
      options: LEVELS.map((k) => ({ key: k, title: t(`welcome.level.${k}`), desc: k === "k16" ? t("welcome.levelFewSets") : null })),
      onPick: (k) => { a.level = k; a.subjects = []; },
    });
  }

  function stepSubjects() {
    const wrap = el("div.welcome__chips", { role: "group", "aria-labelledby": "welcome-title" }, [el("span.note", {}, t("welcome.subjectsLoading"))]);
    const f = frame({ title: t("welcome.subjectsTitle"), body: t("welcome.subjectsBody"), content: wrap, canContinue: true });
    subjectOptions(a.level).then((opts) => {
      if (!wrap.isConnected) return;
      for (const o of opts) { if (o.libId) libIds.set(o.label, o.libId); if (o.pin === false) noPin.add(o.label); }
      wrap.replaceChildren(...opts.map((o) => {
        const b = el("button.welcome__chip", {
          type: "button", "aria-pressed": String(a.subjects.includes(o.label)),
          onclick: () => {
            const on = !a.subjects.includes(o.label);
            a.subjects = on ? [...a.subjects, o.label] : a.subjects.filter((x) => x !== o.label);
            b.setAttribute("aria-pressed", String(on));
          },
        }, [el("span.welcome__chip-mark", {}, icon(ICONS.check, 12)), o.label]);
        return b;
      }));
    });
    f.h.focus({ preventScroll: true });
    return f;
  }

  function stepGoal() {
    const dateWrap = el("label.welcome__date", { hidden: !(a.goal === "test" || a.goal === "hp") }, [
      el("span", {}, t("welcome.dateLabel")),
      el("input", {
        type: "date", value: a.testDate, min: new Date().toISOString().slice(0, 10),
        onchange: (e) => { a.testDate = e.target.value; },
      }),
    ]);
    const f = singleStep({
      title: t("welcome.goalTitle"), body: t("welcome.goalBody"), value: a.goal, needsContinue: true,
      options: GOALS.map(([k, ic]) => ({ key: k, title: t(`welcome.goal.${k}`), iconPath: ic })),
      onPick: (k) => { a.goal = k; dateWrap.hidden = !(k === "test" || k === "hp"); },
      extra: dateWrap,
    });
    return f;
  }

  function stepAmount() {
    return singleStep({
      title: t("welcome.amountTitle"), body: t("welcome.amountBody"), value: a.amountSet ? a.amount : null,
      options: AMOUNTS.map(([k, n]) => ({ key: n, title: t(`welcome.amount.${k}`), desc: t("welcome.amountPerDay", { n }) })),
      onPick: (n) => { a.amount = n; a.amountSet = true; },
    });
  }

  function stepStyle() {
    return singleStep({
      title: t("welcome.styleTitle"), body: t("welcome.styleBody"), value: a.styleSet ? a.style : null, needsContinue: true,
      options: STYLES.map(([k]) => ({ key: k, title: t(`welcome.style.${k}`), desc: t(`welcome.style.${k}D`) })),
      onPick: (k) => { a.style = k; a.styleSet = true; },
    });
  }

  /* ---------- recap + account ---------- */
  function paintRecap() {
    const student = !a.role || a.role === "student";
    const name = cleanName(a.name);
    const rows = [];
    if (student) {
      if (a.level) rows.push([ICONS.graduation, t(`welcome.level.${a.level}`)]);
      if (a.subjects.length) rows.push([ICONS.book, a.subjects.join(", ")]);
      if (a.goal) rows.push([ICONS.target, t(`welcome.goal.${a.goal}`) + (a.testDate ? ` · ${fmtDate(a.testDate)}` : "")]);
      if (a.amountSet) rows.push([ICONS.clock, t("welcome.amountPerDay", { n: a.amount })]);
      if (a.styleSet) rows.push([ICONS.message, t(`welcome.style.${a.style}`)]);
    } else {
      rows.push([a.role === "parent" ? ICONS.users : ICONS.graduation, t(a.role === "parent" ? "welcome.roleParent" : "welcome.roleTeacher")]);
    }

    const primary = primaryAction();
    const acct = accountCard();
    const card = el("div.welcome__card.is-entering", {}, [
      el("div.welcome__done", {}, icon(ICONS.check, 26)),
      el("h2#welcome-title", { tabindex: "-1" }, name ? t("welcome.recapTitleName", { name }) : t("welcome.recapTitle")),
      el("p.welcome__body", {}, t(student ? "welcome.recapBody" : (a.role === "parent" ? "welcome.recapBodyParent" : "welcome.recapBodyTeacher"))),
      rows.length ? el("ul.welcome__recap", {}, rows.map(([ic, text]) => el("li", {}, [icon(ic, 16), el("span", {}, text)])))
        : el("p.note", { style: { margin: "0 0 20px" } }, t("welcome.recapEmpty")),
      acct,
      el("div.welcome__cta", {}, [
        el("a.btn", { href: primary.href, onclick: () => close() }, primary.label),
        el("button.btn.btn--ghost", { type: "button", onclick: () => { close(); location.hash = "#/"; } }, t("welcome.ctaHome")),
      ]),
      student && a.goal === "test" && a.testDate
        ? el("button.linkbtn", { type: "button", style: { marginTop: "12px" }, onclick: () => { close(); openQuickAdd(a.testDate); } }, t("welcome.addTestToCalendar"))
        : null,
    ].filter(Boolean));
    stage.replaceChildren(card);
    card.querySelector("h2").focus({ preventScroll: true });
  }

  function primaryAction() {
    if (a.role === "parent") return { href: "#/parent", label: t("welcome.ctaParent") };
    if (a.role === "teacher") return { href: "#/classes", label: t("welcome.ctaTeacher") };
    if (a.goal === "hp") return { href: "#/hp", label: t("welcome.ctaHp") };
    const lib = LIB_LEVEL[a.level];
    const subj = a.subjects.map((s) => libIds.get(s)).find(Boolean);
    const qs = subj ? `?subject=${encodeURIComponent(subj)}` : lib ? `?level=${lib}` : "";
    return { href: `#/library${qs}`, label: t("welcome.ctaLibrary") };
  }

  /** Optional free account, right where the student has just told us about
   *  themselves. Only offered when the server is there and they're signed out. */
  function accountCard() {
    if (!store.proxyUp || store.authed) return null;
    const email = el("input", { type: "email", autocomplete: "email", placeholder: t("login.emailPlaceholder"), "aria-label": t("login.email") });
    const pass = el("input", { type: "password", autocomplete: "new-password", placeholder: t("login.passwordHint"), "aria-label": t("login.password") });
    const err = el("p.note.note--warn", { hidden: true });
    const submit = el("button.btn", { type: "submit" }, t("login.createAccount"));
    const googleBox = el("div.gbtn");
    const googleSection = el("div.login-google", { hidden: true }, [googleBox, el("div.login-or", {}, [el("span", {}, t("login.or"))])]);
    const box = el("section.welcome__acct");

    function done() {
      box.replaceChildren(el("div.welcome__acct-done", {}, [icon(ICONS.check, 18), el("span", {}, t("welcome.accDone"))]));
    }
    async function onGoogle(credential) {
      err.hidden = true;
      try { await store.loginWithGoogle(credential); toast(t("login.googleCreatedToast")); done(); }
      catch (e) { err.textContent = e.message || t("login.googleFailed"); err.hidden = false; }
    }
    const form = el("form", {
      onsubmit: async (ev) => {
        ev.preventDefault();
        if (!email.value.trim() || !pass.value) return;
        submit.disabled = true; err.hidden = true;
        try { await store.signup(email.value.trim(), pass.value); toast(t("login.createdToast")); done(); }
        catch (e) { err.textContent = e.message || t("login.somethingWrong"); err.hidden = false; submit.disabled = false; }
      },
    }, [
      el("div.welcome__acct-fields", {}, [email, pass, submit]),
      err,
    ]);
    box.append(el("h3", {}, t("welcome.accTitle")), el("p.note", {}, t("welcome.accBody")), googleSection, form);
    if (store.googleClientId) {
      googleSection.hidden = false;
      renderGoogleButton(googleBox, { clientId: store.googleClientId, mode: "signup", handler: onGoogle })
        .then((ok) => { if (!ok) googleSection.hidden = true; });
    }
    return box;
  }

  go(0);
}

/** Subject choices for a level: the practice library's own subjects where it has
 *  that level (so a pick can link straight to matching sets), otherwise a short
 *  generic list. */
async function subjectOptions(level) {
  const libLevel = LIB_LEVEL[level];
  if (libLevel) {
    try {
      const index = await loadLibraryIndex();
      const tr = getLang() === "en" ? await loadLibraryTranslations() : { subjects: {} };
      // One chip per subject: gymnasium courses (Matematik 1/2/3) collapse to "Matematik",
      // and the chip links to the first course. Only un-grouped names are pinned as home chips,
      // since a pinned "Matematik" would sit beside the real "Matematik 1" once it is added.
      const seen = new Map();
      for (const s of index.subjects || []) {
        if (s.level !== libLevel) continue;
        const full = tr.subjects?.[s.id]?.name || s.name;
        const label = baseSubjectName(full);
        if (!seen.has(label)) seen.set(label, { label, libId: s.id, pin: label === full });
      }
      const list = [...seen.values()];
      if (list.length) return list;
    } catch { /* fall through to the generic list */ }
  }
  return GENERIC_SUBJECTS.map((k) => ({ label: t(`welcome.subj.${k}`), pin: true }));
}
