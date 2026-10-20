// "Report" under an AI answer (the tutor in a session, PluggEra AI in #/solve): a small dialog asks what is
// wrong (wrong answer, offensive, something else) and sends the answer, what the student had written and
// their comment to routes/ai-reports.js, which mails the owner and keeps it for #/admin/ai-reports. The App
// Store asks AI apps for exactly this, and a wrong answer is worth knowing about anyway.
//
//   aiReportButton({ where: "tutor" | "solve", content, prompt })   content/prompt: a string or a () => string

import { el, icon, ICONS, toast } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { AI_REPORTS_URL } from "../config.js";

const REASONS = ["wrong", "harmful", "other"];
const read = (v) => String((typeof v === "function" ? v() : v) || "");

export function aiReportButton({ where, content, prompt }) {
  const btn = el("button.aireport", { type: "button", title: t("aiReport.button") }, [icon(ICONS.flag, 14), el("span", {}, t("aiReport.button"))]);
  btn.addEventListener("click", async () => {
    if (await reportDialog({ where, content: read(content), prompt: read(prompt) })) {
      btn.disabled = true;
      btn.replaceChildren(icon(ICONS.check, 14), el("span", {}, t("aiReport.done")));
    }
  });
  return btn;
}

/** Resolves true once the report is sent, false if the student closes the dialog. */
function reportDialog({ where, content, prompt }) {
  return new Promise((resolve) => {
    let settled = false;
    let reason = null;
    function finish(sent) {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("hashchange", onNav);
      overlay.remove();
      resolve(sent);
    }
    function onNav() { finish(false); }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); finish(false); } }

    const sendBtn = el("button.btn", { type: "submit", disabled: true }, t("aiReport.send"));
    const cancelBtn = el("button.btn.btn--ghost", { type: "button", onclick: () => finish(false) }, t("common.cancel"));
    const err = el("p.note.note--warn", { hidden: true, role: "alert" });
    const note = el("textarea", { id: "aireport-note", rows: 3, maxlength: 500 });
    const choices = REASONS.map((r) => el("label.aireportdlg__choice", {}, [
      el("input", { type: "radio", name: "aireport-reason", value: r, onchange: () => { reason = r; sendBtn.disabled = false; } }),
      el("span", {}, t(`aiReport.reason.${r}`)),
    ]));

    async function onSubmit(e) {
      e.preventDefault();
      if (!reason) return;
      sendBtn.disabled = true;
      err.hidden = true;
      try {
        const res = await fetch(AI_REPORTS_URL, {
          method: "POST", credentials: "include", headers: { "content-type": "application/json" },
          body: JSON.stringify({ where, reason, content, prompt, note: note.value }),
        });
        if (res.ok) { toast(t("aiReport.thanks")); finish(true); return; }
        err.textContent = t(res.status === 401 ? "aiReport.signIn" : "aiReport.failed");
      } catch {
        err.textContent = t("aiReport.failed");
      }
      err.hidden = false;
      sendBtn.disabled = false;
    }

    const overlay = el("div.modal.confirmdlg.aireportdlg", {
      role: "dialog", "aria-modal": "true", "aria-labelledby": "aireport-title",
      onclick: (e) => { if (e.target === overlay) finish(false); },
    }, [
      el("form.modal__card.confirmdlg__card", { onsubmit: onSubmit }, [
        el("h2.aireportdlg__title", { id: "aireport-title" }, t("aiReport.title")),
        el("fieldset.aireportdlg__reasons", {}, [el("legend", {}, t("aiReport.intro")), ...choices]),
        el("label.field.aireportdlg__note", { for: "aireport-note" }, [el("span", {}, t("aiReport.noteLabel")), note]),
        el("p.aireportdlg__privacy", {}, t("aiReport.privacy")),
        err,
        el("div.confirmdlg__actions", {}, [cancelBtn, sendBtn]),
      ]),
    ]);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("hashchange", onNav);
    overlay.querySelector("input[type=radio]")?.focus();
  });
}
