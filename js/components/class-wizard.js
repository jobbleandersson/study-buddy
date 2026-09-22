// The guided "get this class going" checklist on a brand-new class page:
// create (always done, since the teacher is looking at it), share the code,
// give the class something to do. Each step shows what's done and, while it
// isn't, a way to jump straight to it. Hides itself once both real steps are
// done, or if the teacher dismisses it — either way, for good (per class,
// via localStorage; best-effort, like every other client-side preference).

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

const dismissKey = (id) => `studybuddy.classWizardHidden.${id}`;
function isDismissed(id) {
  try { return localStorage.getItem(dismissKey(id)) === "1"; } catch { return false; }
}
function dismiss(id) {
  try { localStorage.setItem(dismissKey(id), "1"); } catch { /* private mode — fine, it'll just show again */ }
}

/**
 * Returns `{ el, refresh(cls), setDaily(hasOne) }`.
 *   - refresh(cls) — call after anything that changes cls.members or
 *     cls.assignments (a student joins, a set is assigned or removed…).
 *   - setDaily(hasOne) — whether the class has a daily question, so step 3
 *     counts one as "something to do" too, not just an assigned set. The
 *     caller feeds this in from class-daily-panel.js's own load, which
 *     already fetches that list for its own display — asking the server
 *     again here would just be a second request for the same fact.
 */
export function classWizard(classId, initialCls, { onOpenShare, onJumpToAssign }) {
  const root = el("section.panel.classwiz", { hidden: true });
  let cls = initialCls;
  let hasDaily = false;

  function step({ done, title, body, ctaLabel, onCta }) {
    return el("li.classwiz__step" + (done ? ".is-done" : ""), {}, [
      el("span.classwiz__mark", { "aria-hidden": "true" }, done ? [icon(ICONS.check, 15)] : "•"),
      el("div.classwiz__body", {}, [
        el("h4", {}, title),
        body ? el("p", {}, body) : null,
        !done && ctaLabel ? el("button.btn.btn--sm.classwiz__cta", { type: "button", onclick: onCta }, ctaLabel) : null,
      ].filter(Boolean)),
    ]);
  }

  function paint() {
    if (isDismissed(classId)) { root.hidden = true; return; }
    const shared = cls.members.length > 0;
    const busy = cls.assignments.length > 0 || hasDaily;
    if (shared && busy) { root.hidden = true; return; }   // fully set up — stop asking

    root.hidden = false;
    root.replaceChildren(
      el("div.classwiz__head", {}, [
        el("h3", {}, t("classes.wizardTitle")),
        el("button.linkbtn.classwiz__dismiss", { type: "button", onclick: () => { dismiss(classId); root.hidden = true; } },
          t("classes.wizardDismiss")),
      ]),
      el("ol.classwiz__steps", {}, [
        step({ done: true, title: t("classes.wizardCreated") }),
        step({
          done: shared, title: t("classes.wizardShareTitle"),
          body: shared ? t("classes.wizardShareDone", { n: cls.members.length }) : t("classes.wizardShareBody"),
          ctaLabel: t("classes.wizardShareCta"), onCta: onOpenShare,
        }),
        step({
          done: busy, title: t("classes.wizardAssignTitle"),
          body: busy ? t("classes.wizardAssignDone") : t("classes.wizardAssignBody"),
          ctaLabel: t("classes.wizardAssignCta"), onCta: onJumpToAssign,
        }),
      ]),
    );
  }

  paint();

  function refresh(newCls) {
    cls = newCls;
    paint();
  }
  function setDaily(hasOne) {
    hasDaily = hasOne;
    paint();
  }

  return { el: root, refresh, setDaily };
}
