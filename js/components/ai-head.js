// The "Studify AI" identity strip (avatar, name, live/off status) shared by both /solve tabs — the
// chat and "Kolla min uträkning" — so the assistant reads as one identity across both instead of the
// header disappearing on one of them. `paint()` re-reads store.canUseAI()/aiBlockReason() each time,
// so a caller can call it again after a store "change" event (a quota hit, a sign-in) without
// rebuilding the page.

import { el, clear, append } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { store } from "../store.js";
import { mascot } from "./mascot.js";
import { wordmarkText } from "../lib/wordmark.js";

/** `extra` are appended after the name/status block (Solve's reset/history buttons; none for Check).
 *  `statusInHead: false` leaves the live status out of the header (the caller shows `heroStatus`, the same line, in the
 *  greeting instead); a status that says the AI is NOT available (signed out, offline, quota used) always stays in the header,
 *  so the reason is on screen for as long as the page is. */
export function aiHead(extra = [], { statusInHead = true } = {}) {
  const mascotEl = mascot("idle", 44);
  const statusEl = el("p.solvehead__status");
  const heroStatus = el("p.solvehead__status.solvehead__status--line");
  const node = el("div.solvehead", {}, [
    mascotEl,
    el("div.solvehead__id", {}, [
      // "PluggEra" set like the logo and an outlined "AI" tag; read as one name, "PluggEra AI".
      el("h1.solvehead__name", { "aria-label": t("solve.aiName") }, [wordmarkText(), el("i.solvehead__tag", { "aria-hidden": "true" }, "AI")]),
      statusEl,
    ]),
    ...extra,
  ]);

  function paint() {
    const on = store.canUseAI();
    const reason = store.aiBlockReason();
    const statusKey = on ? "solve.aiStatus" : reason === "signin" ? "solve.aiSignInStatus" : "solve.aiOffline";
    for (const node of [statusEl, heroStatus]) {
      clear(node);
      append(node, [
        el(`i.solvehead__livedot${on ? "" : ".is-off"}`, { "aria-hidden": "true" }),
        // The text trims on its own, so the dot's pulse ring isn't cut off with it.
        el("span.solvehead__statustext", {}, t(statusKey)),
      ]);
    }
    statusEl.hidden = !statusInHead && on;
    heroStatus.hidden = !on;   // when the AI is not available the header says so; the greeting does not repeat it
    return on;
  }
  paint();

  return { node, mascotEl, heroStatus, paint };
}
