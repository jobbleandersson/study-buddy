// A three-card first-run walkthrough. Shown once, when the library is empty and
// state.onboarded is false — dismissing (or finishing) sets the flag.

import { el, icon, ICONS } from "../lib/dom.js";
import { store } from "../store.js";
import { t } from "../lib/i18n.js";

let shownThisSession = false;

export function maybeShowOnboarding() {
  if (shownThisSession) return;
  if (store.state.onboarded || store.assignments.length) return;
  shownThisSession = true;
  open();
}

function open() {
  const slides = [
    { emoji: "📚", title: t("onb.s1title"), body: t("onb.s1body") },
    { emoji: "✍️", title: t("onb.s2title"), body: t("onb.s2body") },
    { emoji: "🔁", title: t("onb.s3title"), body: t("onb.s3body") },
  ];
  let i = 0;

  const body = el("div.onb__body");
  const dots = el("div.onb__dots", {}, slides.map(() => el("span.onb__dot")));
  const backBtn = el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => go(i - 1) }, t("common.back"));
  const nextBtn = el("button.btn.btn--sm", { type: "button", onclick: () => go(i + 1) }, t("onb.next"));

  function finish() {
    store.markOnboarded();
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") finish(); }

  function go(n) {
    if (n < 0) return;
    if (n >= slides.length) { location.hash = "#/gallery"; finish(); return; }
    i = n;
    const s = slides[i];
    body.replaceChildren(
      el("div.onb__emoji", {}, s.emoji),
      el("h2", {}, s.title),
      el("p", {}, s.body),
    );
    dots.querySelectorAll(".onb__dot").forEach((d, k) => d.classList.toggle("is-on", k === i));
    backBtn.hidden = i === 0;
    nextBtn.textContent = i === slides.length - 1 ? t("onb.browse") : t("onb.next");
  }

  const overlay = el("div.modal.onb", {
    role: "dialog", "aria-modal": "true", "aria-label": t("onb.s1title"),
  }, [
    el("div.modal__card", {}, [
      body,
      dots,
      el("div.onb__nav", {}, [
        el("button.linkbtn", { type: "button", onclick: () => { store.markOnboarded(); location.hash = "#/create"; finish(); } }, t("onb.makeFirst")),
        el("span", { style: { flex: "1" } }),
        backBtn, nextBtn,
      ]),
      el("button.onb__x", { type: "button", "aria-label": t("common.close"), onclick: finish }, "×"),
    ]),
  ]);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
  go(0);
}
