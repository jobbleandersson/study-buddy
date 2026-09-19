// What a friend sees when they open a challenge link (#/utmaning?…): who's
// challenging them, on which ready-made set, and a button to take it on. No
// account or setup — starting adds the set to their library and runs a normal
// session, whose results screen shows how they compare.

import { store } from "../store.js";
import { el, toast } from "../lib/dom.js";
import { t, getLang } from "../lib/i18n.js";
import { loadLibraryIndex, loadLibraryTranslations, isImported, importSet } from "../data/library.js";
import { parseChallenge, challengeSessionQuery, percentOf } from "../lib/challenge.js";

function broken() {
  return {
    title: t("challenge.title"),
    node: el("div.empty", {}, [
      el("h2", {}, t("challenge.broken")),
      el("p", {}, t("challenge.brokenBody")),
      el("a.btn", { href: "#/library", style: { marginTop: "16px" } }, t("challenge.explore")),
    ]),
  };
}

export async function renderChallenge(qs) {
  const ch = parseChallenge(qs);
  if (!ch) return broken();

  let index, translations;
  try {
    index = await loadLibraryIndex();
    translations = getLang() === "en" ? await loadLibraryTranslations() : null;
  } catch {
    return broken();
  }
  const entry = index.sets.find((s) => s.id === ch.setId);
  if (!entry) return broken();

  const title = translations?.sets?.[entry.id]?.title || entry.title;
  const name = ch.name || t("challenge.someone");
  const pct = percentOf(ch.correct, ch.total);

  const startBtn = el("button.btn", {
    type: "button",
    onclick: async () => {
      startBtn.disabled = true;
      try {
        if (!isImported(entry.id)) await importSet(entry);
      } catch {
        toast(t("lib.addFail"));
        startBtn.disabled = false;
        return;
      }
      const size = store.getAssignment(entry.id)?.questions.length || entry.count || ch.total;
      location.hash = `#/session/${entry.id}?${challengeSessionQuery({ ...ch, name }, size)}`;
    },
  }, t("challenge.start"));

  const node = el("div.challenge", {}, [
    el("div.panel.challenge__card", {}, [
      el("p.challenge__from", {}, t("challenge.headline", { name })),
      el("h1.challenge__title", {}, title),
      el("div.challenge__score", {}, [
        el("span.challenge__pct", {}, `${pct} %`),
        el("span.note", {}, t("challenge.scoreLine", { name, score: ch.correct, total: ch.total })),
      ]),
      el("p", { style: { margin: "0 0 var(--s-4)" } }, t("challenge.canYou")),
      el("div.challenge__actions", {}, [
        startBtn,
        el("a.btn.btn--ghost", { href: "#/library" }, t("challenge.explore")),
      ]),
      el("p.note", { style: { marginTop: "var(--s-3)", marginBottom: 0 } }, t("challenge.noAccount", { total: ch.total })),
    ]),
  ]);

  return { title: t("challenge.title"), node };
}
