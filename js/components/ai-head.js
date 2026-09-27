// The "Studify AI" identity strip (avatar, name, live/off status) shared by both /solve tabs — the
// chat and "Kolla min uträkning" — so the assistant reads as one identity across both instead of the
// header disappearing on one of them. `paint()` re-reads store.canUseAI()/aiBlockReason() each time,
// so a caller can call it again after a store "change" event (a quota hit, a sign-in) without
// rebuilding the page.

import { el, clear, append } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { mascot } from "./mascot.js";

/** `extra` are appended after the name/status block (Solve's reset/history buttons; none for Check). */
export function aiHead(extra = []) {
  const mascotEl = mascot("idle", 40);
  const statusEl = el("p.solvehead__status");
  const node = el("div.solvehead", {}, [
    mascotEl,
    el("div.solvehead__id", {}, [
      el("h1.solvehead__name", {}, t("solve.aiName")),
      statusEl,
    ]),
    ...extra,
  ]);

  function paint() {
    const on = store.canUseAI();
    const reason = store.aiBlockReason();
    const statusKey = on ? "solve.aiStatus" : reason === "signin" ? "solve.aiSignInStatus" : "solve.aiOffline";
    clear(statusEl);
    append(statusEl, [
      el(`i.solvehead__livedot${on ? "" : ".is-off"}`, { "aria-hidden": "true" }),
      t(statusKey),
    ]);
    return on;
  }
  paint();

  return { node, mascotEl, paint };
}
