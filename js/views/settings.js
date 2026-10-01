// Settings: look & feel, studying, AI (tutor server + models), account, demo
// content, your data.
//
// Laid out like a settings screen rather than a form: each section is a card
// of rows — what the setting is and does on the left, its control on the
// right — with real switches for on/off, segmented buttons for short choices
// and a stepper for the daily goal.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS, downloadText } from "../lib/dom.js";
import { localDayKey } from "../lib/activity.js";
import { MODELS } from "../claude.js";
import { getFont, setFont, getTextSize, setTextSize } from "../lib/typeface.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { voiceControls } from "../components/voice-controls.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { deleteAccountDialog } from "../components/delete-account-dialog.js";
import { twofaSetupDialog } from "../components/twofa-setup-dialog.js";
import { passwordConfirmDialog } from "../components/password-confirm-dialog.js";
import { setPasswordDialog } from "../components/set-password-dialog.js";
import { openWelcomeQuiz } from "../components/onboarding.js";
import { playFanfare } from "../lib/sound.js";
import { offlineSupported, isLibraryCached, cacheLibraryOffline } from "../lib/offline.js";

/* ---------------- building blocks ---------------- */

/** One setting: its name and what it does on the left, the control on the right.
 *  `stack` puts the control under the text (for wide controls). */
function row(label, note, control, { stack = false, danger = false } = {}) {
  return el("div.set-row" + (stack ? ".set-row--stack" : "") + (danger ? ".set-row--danger" : ""), {}, [
    el("div.set-row__text", {}, [
      el("span.set-row__label", {}, label),
      note ? el("p.set-row__note", {}, note) : null,
    ].filter(Boolean)),
    control ? el("div.set-row__ctl", {}, Array.isArray(control) ? control : [control]) : null,
  ].filter(Boolean));
}

/** A section card with an icon, a title and one line on what's in it. */
function card(iconPath, title, sub, body) {
  return el("section.set-card", {}, [
    el("header.set-card__head", {}, [
      el("span.set-card__ic", { "aria-hidden": "true" }, icon(iconPath, 18)),
      el("div", {}, [el("h2", {}, title), sub ? el("p", {}, sub) : null].filter(Boolean)),
    ]),
    ...body.filter(Boolean),
  ]);
}

/** An on/off switch. */
function toggle(label, on, onChange, { disabled = false } = {}) {
  const b = el("button.set-switch", {
    type: "button", role: "switch", "aria-checked": String(!!on), "aria-label": label, disabled,
  }, [el("span.set-switch__knob")]);
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return b;
}

/** A short choice as segmented buttons (a radio group; arrow keys move it). */
function seg(label, options, value, onChange) {
  const group = el("div.set-seg", { role: "radiogroup", "aria-label": label });
  const btns = options.map(([v, text]) => el("button.set-seg__opt", {
    type: "button", role: "radio", "aria-checked": String(v === value), tabindex: v === value ? "0" : "-1",
  }, text));
  const pick = (b, focus) => {
    btns.forEach((x) => { x.setAttribute("aria-checked", String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    if (focus) b.focus();
    onChange(options[btns.indexOf(b)][0]);
  };
  btns.forEach((b, i) => {
    b.addEventListener("click", () => { if (b.getAttribute("aria-checked") !== "true") pick(b); });
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      pick(btns[(i + step + btns.length) % btns.length], true);
    });
  });
  if (!btns.some((b) => b.tabIndex === 0) && btns[0]) btns[0].tabIndex = 0;
  group.append(...btns);
  return group;
}

/** The short form of an option label: "Kortfattat — korta tips" → "Kortfattat". */
const short = (label) => String(label).split(/ — | \(/)[0];

export function renderSettings() {
  const s = store.settings;

  // Refresh this month's AI usage in the background — the line below shows the
  // last known figure now and the fresh one on the next visit.
  store.refreshUsage?.();

  // Declared ahead of aiSection() — a `const` it closes over can't be read before
  // this line runs (that once made the whole page fail to render).
  const fmtResetDate = (ts) => ts
    ? new Date(ts).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "long" })
    : "";

  /* ---------------- appearance & sound ----------------
   * Theme + language live in the sidebar footer / topbar (and the ⋮ menu on
   * mobile) — not duplicated here. */
  const soundCtl = toggle(t("set.sound"), s.sound !== false, (on) => {
    store.setSettings({ sound: on });
    toast(t("set.soundUpdated"));
    // Turning it on should demonstrate what "on" sounds like.
    if (on) playFanfare();
  });

  const goalInput = el("input", {
    type: "number", min: "0", max: "100", inputmode: "numeric", id: "set-goal",
    value: String(s.dailyGoal ?? 10), "aria-label": t("set.dailyGoal"),
  });
  const setGoal = (raw) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    goalInput.value = String(n);
    store.setSettings({ dailyGoal: n });
    toast(t("set.dailyGoalUpdated"));
  };
  goalInput.addEventListener("change", () => setGoal(goalInput.value));
  const goalCtl = el("div.set-stepper", {}, [
    el("button", { type: "button", "aria-label": "−5", onclick: () => setGoal(Number(goalInput.value) - 5) }, "−"),
    goalInput,
    el("button", { type: "button", "aria-label": "+5", onclick: () => setGoal(Number(goalInput.value) + 5) }, "+"),
  ]);

  const fontCtl = seg(t("set.font"), [
    ["system", t("set.fontSystem")],
    ["hyperlegible", t("set.fontHyperlegible")],
  ], getFont(), (v) => { setFont(v); toast(t("set.saved")); });

  const sizeCtl = seg(t("set.textSize"), [
    ["s", t("set.textSizeS")], ["m", t("set.textSizeM")], ["l", t("set.textSizeL")],
  ], getTextSize(), (v) => { setTextSize(v); toast(t("set.saved")); });

  const lookPanel = card(ICONS.sun, t("set.lookFeel"), t("set.lookSub"), [
    row(t("set.sound"), t("set.soundNote"), soundCtl),
    row(t("set.dailyGoal"), t("set.dailyGoalNote"), goalCtl),
    row(t("set.font"), t("set.fontNote"), fontCtl),
    row(t("set.textSize"), null, sizeCtl),
    el("p.set-card__foot", {}, t("set.appearanceElsewhere")),
  ]);

  /* ---------------- studying ---------------- */
  const hintsCtl = seg(t("set.testHints"), [
    ["0", short(t("set.testHints0"))], ["1", "1"], ["2", "2"], ["3", "3"],
  ], String(s.testHints ?? 2), (v) => { store.setSettings({ testHints: Number(v) }); toast(t("set.saved")); });

  const adaptiveCtl = toggle(t("set.adaptive"), s.adaptive !== false, (on) => {
    store.setSettings({ adaptive: on });
    toast(t("set.saved"));
  });

  const pomoCtl = seg(t("set.pomodoro"), [
    ["off", t("set.pomodoroOff")], ["25", t("set.pomodoro25")], ["50", t("set.pomodoro50")],
  ], String(s.pomodoro || "off"), (v) => { store.setSettings({ pomodoro: v }); toast(t("set.saved")); });

  const voiceSupported = "speechSynthesis" in window;
  const voiceCtl = toggle(t("set.voice"), s.voice === true, (on) => {
    store.setSettings({ voice: on });
    toast(t("set.saved"));
  }, { disabled: !voiceSupported });

  const rulesCtl = toggle(t("set.rulePrompts"), s.rulePrompts !== false, (on) => {
    store.setSettings({ rulePrompts: on });
    toast(t("set.saved"));
  });

  const studyPanel = card(ICONS.book, t("set.studying"), t("set.studySub"), [
    row(t("set.adaptive"), t("set.adaptiveNote"), adaptiveCtl),
    row(t("set.testHints"), t("set.testHintsNote"), hintsCtl),
    row(t("set.pomodoro"), t("set.pomodoroNote"), pomoCtl),
    row(t("set.rulePrompts"), t("set.rulePromptsNote"), rulesCtl),
    row(t("set.voice"), t(voiceSupported ? "set.voiceNote" : "set.voiceUnsupported"), voiceCtl),
    // Which voice reads aloud, a sample of it, its speed, and how to get a better one.
    voiceSupported ? row(t("voice.title"), null, voiceControls(), { stack: true }) : null,
    row(t("set.welcomeRedo"), t("set.welcomeRedoNote"),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => openWelcomeQuiz({ force: true }) }, t("set.welcomeRedoBtn"))),
  ]);

  // Each section gets an anchor so the side menu can jump straight to it.
  const sections = [
    ["appearance", "set.lookFeel", ICONS.sun, lookPanel],
    ["studying", "set.studying", ICONS.book, studyPanel],
    ["ai", "set.aiTitle", ICONS.spark, aiSection()],
    ["account", "set.acctTitle", ICONS.user, accountSection()],
    ["demo", "set.demoTitle", ICONS.play, demoSection()],
    ["data", "set.dataTitle", ICONS.download, dataSection()],
  ].filter(([, , , panel]) => panel);
  for (const [id, , , panel] of sections) panel.id = `settings-${id}`;

  const navLinks = sections.map(([id, labelKey, ic], i) => el("a.settings__navlink" + (i === 0 ? ".is-active" : ""), {
    href: "#/settings",
    onclick: (e) => {
      e.preventDefault();
      document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }, [icon(ic, 16), t(labelKey)]));

  const node = el("div.settings", {}, [
    homeButton({ grid: true }),
    el("header.settings__head", {}, [
      el("h1", {}, t("set.title")),
      el("p", {}, t("set.pageSub")),
    ]),
    el("div.settings__layout", {}, [
      el("nav.settings__nav", { "aria-label": t("set.title") }, navLinks),
      el("div.settings__sections", {}, sections.map(([, , , panel]) => panel)),
    ]),
  ]);

  // Highlight the section in view. Disconnects itself once the page is gone.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (!node.isConnected && node.dataset.mounted) { io.disconnect(); return; }
      if (node.isConnected) node.dataset.mounted = "1";
      const hit = entries.filter((en) => en.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!hit) return;
      const idx = sections.findIndex(([, , , panel]) => panel === hit.target);
      navLinks.forEach((a, i) => a.classList.toggle("is-active", i === idx));
    }, { rootMargin: "-90px 0px -60% 0px" });
    sections.forEach(([, , , panel]) => io.observe(panel));
  }

  /* ---------------- AI ----------------
   * The full model panel only shows once the proxy is reachable + keyed, the
   * user is signed in (the proxy requires it), and this month's allowance
   * isn't spent. Otherwise it's a status row and whatever the one missing
   * thing is. */
  function statusPill(ok, text) {
    return el("span.set-pill", {}, [el("span.dot", { style: { background: ok ? "var(--ok)" : "var(--ink-faint)" } }), text]);
  }

  function premiumTeaser() {
    return store.isPremium() ? null : el("p.set-row__note", {}, [
      t("set.premiumTeaser") + " ",
      el("a", { href: "#/premium" }, t("set.premiumLink")),
    ]);
  }

  function aiSection() {
    const serverStatus = !store.proxyUp ? t("set.serverDown")
      : !store.proxyKeyConfigured ? t("set.serverNoKey")
      : t("set.serverLive");

    if (!store.canUseAI()) {
      const serverReady = store.proxyUp && store.proxyKeyConfigured;
      let reason;
      if (serverReady && store.aiOverBudget) {
        reason = t("set.aiQuotaReached", { date: fmtResetDate(store.aiUsage?.resetsAt) });
      } else if (serverReady && !store.authed) {
        reason = el("span", {}, [t("set.aiNeedsAccount"), " ", el("a", { href: "#/login" }, t("account.signIn"))]);
      } else {
        reason = t("set.aiDormant");
      }
      return card(ICONS.spark, t("set.aiTitle"), t("set.aiSub"), [
        row(t("set.statusLabel"), reason, statusPill(serverReady, serverStatus)),
        // Only when the reason is the quota-reached line — not merely whenever the
        // budget is spent while the server is down (an upsell under "AI isn't
        // connected" reads as contradictory).
        serverReady && store.aiOverBudget ? premiumTeaser() : null,
        el("details.set-details", {}, [
          el("summary", {}, t("set.aiHowConnect")),
          el("p.set-row__note", {}, t("set.serverBody")),
        ]),
      ]);
    }

    const usage = store.aiUsage;
    const pct = usage?.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
    const verbCtl = seg(t("set.replyLength"), [
      ["concise", short(t("set.verbConcise"))],
      ["normal", short(t("set.verbNormal"))],
      ["detailed", short(t("set.verbDetailed"))],
    ], s.tutorVerbosity || "normal", (v) => {
      store.setSettings({ tutorVerbosity: v });
      toast(t("set.tutorStyleUpdated"));
    });
    const modelTable = el("table.preset-table", {}, [
      el("tbody", {}, [
        modelRow(t("set.jobWriting"), MODELS.generate, t("set.whenPerSet")),
        modelRow(t("set.jobTutoring"), MODELS.tutor, t("set.whenEveryMsg")),
        modelRow(t("set.jobMarking"), MODELS.grade, t("set.whenEveryAnswer")),
      ]),
    ]);

    return card(ICONS.spark, t("set.aiTitle"), t("set.aiSub"), [
      row(t("set.statusLabel"), t("set.serverBody"), statusPill(true, serverStatus)),
      usage ? row(t("set.usageLabel"), [
        t("set.aiUsageLine", { used: usage.used.toLocaleString(), limit: usage.limit.toLocaleString() }),
        usage.resetsAt ? " · " + t("set.aiUsageResets", { date: fmtResetDate(usage.resetsAt) }) : "",
      ].join(""), el("div.set-usage", { role: "img", "aria-label": `${pct}%` }, [el("i", { style: { width: `${pct}%` } })])) : null,
      premiumTeaser(),
      row(t("set.replyLength"), null, verbCtl),
      row(t("set.modelTitle"), t("set.modelIntro"), modelTable, { stack: true }),
    ]);
  }

  function modelRow(job, model, when) {
    return el("tr", {}, [el("th", {}, job), el("td", {}, prettyModel(model)), el("td.note", {}, when)]);
  }

  /* ---------------- demo sets ---------------- */
  function demoSection() {
    const status = el("p.set-row__note");
    const actions = el("div.set-row__ctl");

    function paint() {
      const { loaded, total } = store.demoStatus;
      status.textContent = loaded === 0 ? t("set.demoNone")
        : loaded < total ? t("set.demoPartial", { loaded, total })
        : t("set.demoAll");

      clear(actions);
      if (loaded < total) {
        actions.appendChild(el("button.btn.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const n = await store.loadDemoContent();
              toast(n ? plural(n, "set.demoAddedOne", "set.demoAddedMany") : t("set.demoAlready"));
            } catch {
              toast(t("set.demoFailed"));
            }
            paint();
          },
        }, [icon(ICONS.play, 16), t(loaded ? "set.demoAddMissing" : "set.demoLoad")]));
      }
      if (loaded > 0) {
        actions.appendChild(el("button.btn.btn--ghost.btn--sm.set-danger", {
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog({ message: t("set.demoRemoveConfirm"), confirmLabel: t("set.demoRemove"), danger: true }))) return;
            store.removeDemoContent();
            toast(t("set.demoRemoved"));
            paint();
          },
        }, t("set.demoRemove")));
      }
    }
    paint();

    return card(ICONS.play, t("set.demoTitle"), t("set.demoSub"), [
      el("div.set-row", {}, [
        el("div.set-row__text", {}, [el("span.set-row__label", {}, t("set.demoTitle")), status]),
        actions,
      ]),
    ]);
  }

  /* ---------------- account ---------------- */
  function accountSection() {
    const body = el("div.set-acct");

    function paint() {
      clear(body);
      if (!store.authed) {
        body.append(...[
          !store.proxyUp ? el("p.note.note--warn", {}, t("set.acctNoServer")) : null,
          row(t("set.acctSignedOutLabel"), t("set.acctSignedOut").split(" — ").slice(-1)[0], el("a.btn.btn--sm", { href: "#/login" }, t("set.acctSignIn"))),
        ].filter(Boolean));
        return;
      }

      // Meaningless while the server has no email set up — hidden entirely then.
      const showVerify = store.emailConfigured;
      // Only a password account has a local sign-in step to gate — a Google-linked
      // one re-authenticates via Google every time.
      const showTwofa = !store.authPasswordless;
      const email = store.authEmail || "";

      const chips = el("div.set-chips", {}, [
        showVerify ? el("span.set-chip" + (store.authEmailVerified ? ".is-ok" : ".is-warn"), {},
          t(store.authEmailVerified ? "set.chipVerified" : "set.chipUnverified")) : null,
        showTwofa ? el("span.set-chip" + (store.totpEnabled ? ".is-ok" : ""), {},
          t(store.totpEnabled ? "set.chip2faOn" : "set.chip2faOff")) : null,
      ].filter(Boolean));

      const actions = [];
      if (showVerify && !store.authEmailVerified) {
        actions.push(el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget;   // null once this resumes after the await
            btn.disabled = true;
            try { await store.resendVerification(); toast(t("set.acctVerificationSent")); }
            catch (err) { toast(err.message || t("set.acctVerificationResendFailed")); }
            finally { btn.disabled = false; }
          },
        }, t("set.acctResendVerification")));
      }
      actions.push(el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          const r = await store.logout();
          toast(t(r?.wiped === false ? "set.acctSignedOutKept" : "set.acctSignedOutToast"));
          paint();
        },
      }, t("set.acctSignOut")));

      body.append(...[
        el("div.set-profile", {}, [
          el("span.set-avatar", { "aria-hidden": "true" }, (email[0] || "?").toUpperCase()),
          el("div.set-profile__text", {}, [
            el("strong", {}, email),
            chips.childNodes.length ? chips : null,
          ].filter(Boolean)),
          el("div.set-row__ctl", {}, actions),
        ]),
        store.authPasswordless
          ? row(t("setpw.add"), t("set.pwNote"), el("button.btn.btn--ghost.btn--sm", {
              type: "button",
              onclick: async () => { if (await setPasswordDialog()) { toast(t("setpw.addedToast")); paint(); } },
            }, t("setpw.add")))
          : null,
        showTwofa
          ? row(t("set.twofaLabel"), t("set.twofaNote"),
              store.totpEnabled
                ? el("button.btn.btn--ghost.btn--sm", {
                    type: "button",
                    onclick: async () => {
                      const ok = await passwordConfirmDialog({
                        title: t("twofa.disableTitle"), body: t("twofa.disableBody"), confirmLabel: t("twofa.disableConfirm"),
                        submit: (password) => store.disable2fa(password),
                      });
                      if (ok) { toast(t("twofa.disabledToast")); paint(); }
                    },
                  }, t("twofa.disable"))
                : el("button.btn.btn--sm", {
                    type: "button",
                    onclick: async () => { if (await twofaSetupDialog()) paint(); },
                  }, t("twofa.enable")))
          : null,
        row(t("set.acctParentLabel"), t("set.acctParentNote"),
          el("a.btn.btn--ghost.btn--sm", { href: "#/parent" }, t("set.acctParentLink"))),
        row(t("set.acctReviewLabel"), t("set.acctReviewNote"),
          el("a.btn.btn--ghost.btn--sm", { href: "#/rate" }, t("set.acctReviewLink"))),
        row(t("set.acctDelete"), t("set.acctDeleteNote"), el("button.btn.btn--ghost.btn--sm.set-danger", {
          type: "button",
          onclick: async () => {
            if (await deleteAccountDialog()) { toast(t("set.acctDeleted")); location.hash = "#/"; paint(); }
          },
        }, t("set.acctDelete")), { danger: true }),
      ].filter(Boolean));
    }
    paint();

    return card(ICONS.user, t("set.acctTitle"), t("set.acctSub"), [body]);
  }

  /* ---------------- your data ---------------- */
  function dataSection() {
    const recovery = el("p.note.note--warn.set-recovery");
    const importInput = el("input", {
      type: "file", accept: "application/json,.json", style: { display: "none" },
      onchange: onImportFile,
    });
    const importStatus = el("p.set-row__note");

    function paintRecovery() {
      const blob = store.recoveryBlob;
      if (!blob) { clear(recovery); recovery.hidden = true; return; }
      recovery.hidden = false;
      clear(recovery);
      recovery.appendChild(el("span", {}, t("set.recoveryFound") + " "));
      recovery.appendChild(el("button.linkbtn", {
        type: "button",
        onclick: () => downloadText(`pluggera-recovered-${localDayKey()}.txt`, blob, "text/plain"),
      }, t("set.recoveryDownload")));
      recovery.appendChild(el("span", {}, " · "));
      recovery.appendChild(el("button.linkbtn", {
        type: "button",
        onclick: () => { store.clearRecoveryBlob(); paintRecovery(); },
      }, t("set.recoveryDismiss")));
    }
    paintRecovery();

    function exportData() {
      downloadText(`pluggera-backup-${localDayKey()}.json`, store.exportJSON());
      store.markBackedUp();
      toast(t("set.backupDownloaded"));
    }

    async function onImportFile(e) {
      const file = e.target.files[0];
      e.target.value = ""; // allow re-picking the same file later
      if (!file) return;
      let text;
      try { text = await file.text(); }
      catch {
        importStatus.className = "set-row__note note--warn";
        importStatus.textContent = t("set.importReadFail");
        return;
      }
      if (!(await confirmDialog({ message: t("set.importConfirm"), confirmLabel: t("set.import"), danger: true }))) return;
      try {
        store.importJSON(text);
        importStatus.className = "set-row__note";
        importStatus.textContent = "";
        toast(t("set.imported"));
        location.hash = "#/";
      } catch {
        importStatus.className = "set-row__note note--warn";
        importStatus.textContent = t("set.importBadFile");
      }
    }

    async function wipe() {
      if (!(await confirmDialog({ message: t("set.wipeConfirm"), confirmLabel: t("set.wipe"), danger: true }))) return;
      store.wipe();
      toast(t("set.wiped"));
      location.hash = "#/";
    }

    const importRow = row(t("set.import"), t("set.importNote"), [
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => importInput.click() }, t("set.import")),
      importInput,
    ]);
    importRow.querySelector(".set-row__text").append(importStatus);

    return card(ICONS.download, t("set.dataTitle"), store.authed ? t("set.dataBodySynced") : t("set.dataBody"), [
      recovery,
      row(t("set.export"), t("set.exportNote"),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: exportData }, [icon(ICONS.download, 15), t("set.export")])),
      importRow,
      offlineRow(),
      row(t("set.wipe"), t("set.wipeNote"),
        el("button.btn.btn--ghost.btn--sm.set-danger", { type: "button", onclick: wipe }, t("set.wipe")), { danger: true }),
    ]);
  }

  /* ---------------- offline library ---------------- */
  function offlineRow() {
    if (!offlineSupported()) return null;
    const status = el("p.set-row__note", {}, t("set.offlineBody"));
    const bar = el("div.offline-bar", { hidden: true }, [el("i")]);
    const btn = el("button.btn.btn--ghost.btn--sm", { type: "button" });

    function label(cached) {
      clear(btn);
      btn.append(icon(ICONS.download, 15), cached ? t("set.offlineRefresh") : t("set.offlineGet"));
    }
    async function paint() {
      const cached = await isLibraryCached();
      status.textContent = cached ? t("set.offlineDone") : t("set.offlineBody");
      label(cached);
    }
    label(false);
    paint();

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      bar.hidden = false;
      bar.firstChild.style.width = "0%";
      const res = await cacheLibraryOffline((done, total) => {
        bar.firstChild.style.width = `${Math.round((done / total) * 100)}%`;
        status.textContent = t("set.offlineProgress", { done, total });
      });
      bar.hidden = true;
      btn.disabled = false;
      toast(res.ok ? t("set.offlineOk")
        : res.reason === "no-sw" ? t("set.offlineNoSw") : t("set.offlineFail"));
      paint();
    });

    const r = el("div.set-row", {}, [
      el("div.set-row__text", {}, [el("span.set-row__label", {}, t("set.offlineTitle")), status, bar]),
      el("div.set-row__ctl", {}, [btn]),
    ]);
    return r;
  }

  return { title: t("set.title"), node };
}

function prettyModel(id) {
  return ({
    "claude-opus-5": "Claude Opus 5",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
  })[id] || id;
}
