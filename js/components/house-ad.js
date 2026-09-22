// "Concept A" from the free-tier ad review: Studify promoting Studify on its own home screen —
// never a third party, never tracked, never shown once a real paid plan exists (store.isPremium()).
// One of a few messages, picked deterministically by day so it doesn't feel identical every visit;
// dismissible for the rest of the browser session (sessionStorage, not synced — this is a per-device
// nicety, not study data, so it doesn't belong in the state blob).

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";

const DISMISS_KEY = "studybuddy.houseAdDismissed";

// Each variant needs a set already imported to link to — no point promoting a mode with nothing in it.
const VARIANTS = [
  {
    id: "hp", href: "#/hp", icon: ICONS.award,
    show: () => store.assignments.some((a) => /^lib-hp-/.test(a.id)),
    titleKey: "menu.houseAdHpTitle", bodyKey: "menu.houseAdHpBody",
  },
  {
    id: "examPrep", href: "#/exam-prep", icon: ICONS.graduation,
    show: () => store.assignments.some((a) => a.type === "test" && a.dueAt),
    titleKey: "menu.houseAdExamTitle", bodyKey: "menu.houseAdExamBody",
  },
  {
    id: "library", href: "#/library", icon: ICONS.book,
    show: () => true,
    titleKey: "menu.houseAdLibTitle", bodyKey: "menu.houseAdLibBody",
  },
];

function dismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}
function dismiss() {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode — just won't stick */ }
}

/** A dismissible card promoting one of Studify's own features, or null when there's nothing to
 *  show (premium, already dismissed this session, or no eligible variant has content to point at). */
export function houseAd() {
  if (store.isPremium() || dismissed()) return null;
  const eligible = VARIANTS.filter((v) => v.show());
  if (!eligible.length) return null;
  const day = new Date().getDate();
  const variant = eligible[day % eligible.length];

  const card = el("div.house-ad", {}, [
    el("span.house-ad__ic", {}, icon(variant.icon, 20)),
    el("a.house-ad__body", { href: variant.href }, [
      el("strong", {}, t(variant.titleKey)),
      el("span", {}, t(variant.bodyKey)),
    ]),
    el("button.house-ad__x", {
      type: "button", "aria-label": t("menu.houseAdDismiss"),
      onclick: () => { dismiss(); card.remove(); },
    }, icon(ICONS.close, 16)),
  ]);
  return card;
}
