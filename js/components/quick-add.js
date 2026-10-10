// Quick-add dialog: tap a day in any calendar → name a set, pick
// assignment vs test and a subject, and it's created with that due date and a
// few blank starter questions. Drops you straight into the editor to fill it
// in. A lightweight front door to the Create flow for the "I have a test on
// the 14th" case — no source picker, no AI.

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { store } from "../store.js";
import { t, getLang } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { dayDiff } from "../lib/exam.js";
import { subjectField } from "./subject-field.js";
import { blankQuestions } from "../lib/blank-questions.js";

let dialogEl = null;
function onEsc(e) { if (e.key === "Escape") close(); }

export function closeQuickAdd() {
  dialogEl?.remove();
  dialogEl = null;
  document.removeEventListener("keydown", onEsc);
}
const close = closeQuickAdd;

/** `dayKey` — "YYYY-MM-DD". `onDone(assignment)` optional. */
export function openQuickAdd(dayKey, { onDone } = {}) {
  closeQuickAdd();

  let type = "assignment";
  const titleInput = el("input.quickadd__input", {
    type: "text", id: "quickadd-title",
    placeholder: t("quickadd.titlePlaceholder"),
    onkeydown: (e) => { if (e.key === "Enter") create(); },
  });

  // Assignment or test, as two cards that say what the choice means.
  const TYPES = [
    ["assignment", ICONS.clipboard, t("create.typeAssignment"), t("quickadd.typeAssignmentSub")],
    ["test", ICONS.graduation, t("create.typeTest"), t("quickadd.typeTestSub")],
  ];
  const typeRow = el("div.quickadd__types", { role: "radiogroup", "aria-label": t("create.type") },
    TYPES.map(([val, iconPath, label, sub]) => el("button.quickadd__type", {
      type: "button", role: "radio", "aria-checked": String(val === type), dataset: { type: val },
      onclick: () => {
        type = val;
        typeRow.querySelectorAll(".quickadd__type").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.type === val)));
        dateTile.classList.toggle("is-test", val === "test");
      },
    }, [
      el("span.quickadd__typeic", { "aria-hidden": "true" }, icon(iconPath, 18)),
      el("span.quickadd__typetxt", {}, [el("strong", {}, label), el("small", {}, sub)]),
      el("span.quickadd__check", { "aria-hidden": "true" }, icon(ICONS.check, 12)),
    ])));

  // The day, as a small calendar page: month on top, the date large, the weekday under it.
  const locale = getLang() === "sv" ? "sv-SE" : "en-GB";
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const fmt = (opts) => new Intl.DateTimeFormat(locale, opts).format(date).replace(".", "");
  const dateTile = el("div.quickadd__date", { "aria-hidden": "true" }, [
    el("span.quickadd__month", {}, fmt({ month: "short" })),
    el("strong", {}, String(d)),
    el("span.quickadd__wday", {}, fmt({ weekday: "short" })),
  ]);
  const days = dayDiff(localDayKey(), dayKey);
  const when = days === 0 ? t("date.today") : days === 1 ? t("date.tomorrow") : days > 1 ? t("date.inDays", { n: days }) : null;
  const longDate = fmt({ weekday: "long", day: "numeric", month: "long" });

  // Default to the subject of the most recent set, if any — most people add a
  // run of deadlines for the same course.
  const recentSubjectId = store.assignments[0]?.subjectId;
  const subjectFld = subjectField({
    value: store.subjects.find((s) => s.id === recentSubjectId)?.name || "",
  });

  function create() {
    const title = titleInput.value.trim()
      || t(type === "test" ? "quickadd.defaultTest" : "quickadd.defaultAssignment");
    const subject = subjectFld.getValue() || t("common.general");
    const a = store.addAssignmentDoc({
      type, subject, title, dueAt: dayKey,
      questions: blankQuestions(3),
    });
    closeQuickAdd();
    toast(t("quickadd.created", { title: a.title }));
    onDone?.(a);
    location.hash = `#/edit/${a.id}`;
  }

  dialogEl = el("div.modal", {
    role: "dialog", "aria-modal": "true", "aria-labelledby": "quickadd-heading",
    onclick: (e) => { if (e.target === dialogEl) close(); },
  }, [
    el("div.modal__card.quickadd", {}, [
      el("header.quickadd__head", {}, [
        dateTile,
        el("div.quickadd__headtxt", {}, [
          el("h3", { id: "quickadd-heading" }, t("quickadd.title")),
          el("p", {}, [
            t("quickadd.on", { date: longDate }),
            when ? el("span.quickadd__when", {}, when) : null,
          ].filter(Boolean)),
        ]),
        el("button.iconbtn.iconbtn--sm.quickadd__close", { type: "button", "aria-label": t("common.close"), title: t("common.close"), onclick: close },
          [icon(ICONS.close, 16)]),
      ]),
      el("div.quickadd__body", {}, [
        el("div.quickadd__field", {}, [el("label", { for: "quickadd-title" }, t("quickadd.titleLabel")), titleInput]),
        el("div.quickadd__field", {}, [el("span.quickadd__label", {}, t("create.type")), typeRow]),
        el("div.quickadd__field", {}, [el("span.quickadd__label", {}, t("create.subject")), subjectFld.el]),
      ]),
      el("footer.quickadd__foot", {}, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: close }, t("common.cancel")),
        el("button.btn.btn--sm", { type: "button", onclick: create }, [icon(ICONS.plus, 16), t("quickadd.create")]),
      ]),
    ]),
  ]);
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onEsc);
  titleInput.focus();
}
