// Högskoleprovet under test conditions, at #/hp/prov: the quick prognosis, a single provpass (the
// verbal or the quantitative half, 55 minutes), a whole test (both, one after the other), a test made
// only of questions the student hasn't seen, the runs left unfinished, and the results so far.

import { store, HP_MOCK_ID } from "../store.js";
import { el, icon, ICONS, uid } from "../lib/dom.js";
import { t, fmtDate } from "../lib/i18n.js";
import { localDayKey } from "../lib/activity.js";
import { ensureHpSets, hpQuestionIndex } from "../data/hp-content.js";
import { VERBAL_DELPROV, KVANT_DELPROV, PASS_COUNT, questionHistory, attemptNormedTotal } from "../lib/hp.js";

const fmtN = (n) => (n == null ? "–" : Number(n).toFixed(2).replace(".", ","));
const PASS_SIZE = (list) => list.reduce((n, dp) => n + PASS_COUNT[dp], 0);

/** Per half: how many questions a provpass of it would get (each delprov only fills its own share),
 *  and how many questions of it haven't been answered yet. */
function availability() {
  const hist = questionHistory(store.attempts);
  const { byDelprov } = hpQuestionIndex();
  const half = (list) => {
    let inPass = 0, fresh = 0;
    for (const dp of list) {
      const qs = byDelprov[dp] || [];
      inPass += Math.min(qs.length, PASS_COUNT[dp]);
      fresh += qs.filter(({ q }) => !hist[q.id]).length;
    }
    return { inPass, fresh };
  };
  return { verbal: half(VERBAL_DELPROV), kvant: half(KVANT_DELPROV) };
}

function card(title, sub, children, extraClass = "") {
  return el(`section.set-card.hp-prov__card${extraClass}`, {}, [
    el("h2", {}, title),
    sub ? el("p.note", {}, sub) : null,
    ...children,
  ].filter(Boolean));
}

export async function renderHpProv() {
  await ensureHpSets();
  const avail = availability();
  const vSize = PASS_SIZE(VERBAL_DELPROV), kSize = PASS_SIZE(KVANT_DELPROV);

  // Unfinished runs under test conditions: the prognosis, a provpass, the old mini-mock.
  const open = Object.entries(store.state.sessions || {})
    .filter(([key, s]) => s && (key === "hp-prognos" || key.startsWith("hp-pass-") || key === HP_MOCK_ID))
    .map(([key, s]) => ({ key, s, done: Object.keys(s.items || {}).length, total: (s.order || []).length }))
    .sort((a, b) => (b.s.savedAt || 0) - (a.s.savedAt || 0));

  const runs = store.attempts
    .filter((a) => a.hp && (a.hpPass || a.hpPrognos || a.assignmentId === HP_MOCK_ID))
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
    .slice(0, 20);

  const node = el("div.hp-prov", {}, [
    el("a.homebtn", { href: "#/hp" }, [icon(ICONS.back, 16), t("hp.pageTitle")]),
    el("header.hp-prov__head", {}, [el("h1", {}, t("hp.provTitle")), el("p", {}, t("hp.provLede"))]),

    open.length ? card(t("hp.provOpen"), null, [
      el("ul.hp-prov__open", {}, open.map(({ key, s, done, total }) => el("li", {}, [
        el("span", {}, [el("strong", {}, s.title || key), " ", el("span.note", {}, t("hp.provOpenProgress", { n: done, total }))]),
        s.resumeHash || s.retryHash ? el("a.btn.btn--sm", { href: s.resumeHash || s.retryHash }, t("hp.provContinue")) : null,
      ].filter(Boolean)))),
    ], ".is-open") : null,

    card(t("hp.prognosTitle"), t("hp.prognosSub"), [
      el("a.btn", { href: "#/hp/prognos" }, [icon(ICONS.target, 16), t("hp.prognosStart")]),
    ]),

    card(t("hp.passCardTitle"), t("hp.passCardSub"), [
      el("div.hp-prov__pair", {}, [
        el("a.btn.btn--ghost", { href: "#/hp/pass/verbal" }, [icon(ICONS.clock, 16), t("hp.passStart.verbal")]),
        el("a.btn.btn--ghost", { href: "#/hp/pass/kvant" }, [icon(ICONS.clock, 16), t("hp.passStart.kvant")]),
      ]),
      avail.verbal.inPass < vSize || avail.kvant.inPass < kSize
        ? el("p.note", {}, t("hp.passShort", { v: avail.verbal.inPass, vs: vSize, k: avail.kvant.inPass, ks: kSize }))
        : null,
    ].filter(Boolean)),

    card(t("hp.fullTitle"), t("hp.fullSub"), [
      el("a.btn.btn--ghost", { href: `#/hp/pass/verbal?full=${uid()}` }, [icon(ICONS.play, 16), t("hp.fullStart")]),
    ]),

    card(t("hp.ownTitle"), t("hp.ownSub"), [
      el("div.hp-prov__pair", {}, [
        el("a.btn.btn--ghost", { href: "#/hp/pass/verbal?unseen=1" }, t("hp.ownStart.verbal", { n: avail.verbal.fresh })),
        el("a.btn.btn--ghost", { href: "#/hp/pass/kvant?unseen=1" }, t("hp.ownStart.kvant", { n: avail.kvant.fresh })),
      ]),
      avail.verbal.fresh < vSize || avail.kvant.fresh < kSize
        ? el("p.note", {}, [t("hp.ownFew"), " ", el("a", { href: "#/hp" }, t("hp.ownFewLink"))])
        : null,
    ].filter(Boolean)),

    card(t("hp.provResults"), runs.length ? null : t("hp.provResultsNone"), runs.length ? [
      el("ol.hp-hist", {}, runs.map((a) => el("li", {}, [
        el("a.hp-hist__row", { href: `#/results/${a.id}` }, [
          el("span.hp-hist__date", {}, fmtDate(localDayKey(new Date(a.finishedAt || Date.now())))),
          el("span", {}, a.title),
          el("strong", {}, fmtN(attemptNormedTotal(a))),
          icon(ICONS.chevronRight, 14),
        ]),
      ]))),
    ] : []),
  ].filter(Boolean));

  return { title: t("hp.provTitle"), node };
}
