// Settings: look & feel, AI (tutor server + models), account, demo content,
// your data, roadmap.

import { store } from "../store.js";
import { el, clear, toast, icon, ICONS, downloadText } from "../lib/dom.js";
import { localDayKey } from "../lib/activity.js";
import { MODELS } from "../claude.js";
import { getFont, setFont, getTextSize, setTextSize } from "../lib/typeface.js";
import { t, plural, getLang } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { deleteAccountDialog } from "../components/delete-account-dialog.js";
import { openWelcomeQuiz } from "../components/onboarding.js";
import { playFanfare } from "../lib/sound.js";
import { offlineSupported, isLibraryCached, cacheLibraryOffline } from "../lib/offline.js";

export function renderSettings() {
  const s = store.settings;

  // Refresh this month's AI usage in the background — the line below shows the
  // last known figure now and the fresh one on the next visit.
  store.refreshUsage?.();

  // Declared here, ahead of aiSection() being called below — aiSection() is a
  // hoisted function declaration so the call itself is fine wherever it sits,
  // but a `const` it closes over is not: defining this after the call site
  // threw "Cannot access before initialization" the moment a signed-in
  // account with real usage data hit the branch that reads it, which made
  // the whole Settings page fail to render.
  const fmtResetDate = (ts) => ts
    ? new Date(ts).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "long" })
    : "";

  /* ---------------- appearance ----------------
   * Theme + language live in the sidebar footer (and the ⋮ menu on mobile) —
   * not duplicated here. This panel keeps font, text size, sound and the
   * daily goal. */
  const fontSel = el("select", { "aria-label": t("set.font") }, [
    opt("system", t("set.fontSystem")),
    opt("hyperlegible", t("set.fontHyperlegible")),
  ]);
  fontSel.value = getFont();
  fontSel.addEventListener("change", () => { setFont(fontSel.value); toast(t("set.saved")); });

  const sizeSel = el("select", { "aria-label": t("set.textSize") }, [
    opt("s", t("set.textSizeS")),
    opt("m", t("set.textSizeM")),
    opt("l", t("set.textSizeL")),
  ]);
  sizeSel.value = getTextSize();
  sizeSel.addEventListener("change", () => { setTextSize(sizeSel.value); toast(t("set.saved")); });

  /* ---------------- model, per job ----------------
   * Fixed, not a choice: writing a set is saved and reused by everyone who
   * studies it afterward, so it gets a stronger model; tutoring and marking
   * are one-off and forgotten the moment they're done, so they run on the
   * fast, cheap one. See js/claude.js MODELS. */
  const modelTable = el("table.preset-table", {}, [
    el("tbody", {}, [
      modelRow(t("set.jobWriting"), MODELS.generate, t("set.whenPerSet")),
      modelRow(t("set.jobTutoring"), MODELS.tutor, t("set.whenEveryMsg")),
      modelRow(t("set.jobMarking"), MODELS.grade, t("set.whenEveryAnswer")),
    ]),
  ]);
  function modelRow(job, model, when) {
    return el("tr", {}, [el("th", {}, job), el("td", {}, prettyModel(model)), el("td.note", {}, when)]);
  }

  const verbSel = el("select", { "aria-label": t("set.replyLength") }, [
    opt("concise", t("set.verbConcise")),
    opt("normal", t("set.verbNormal")),
    opt("detailed", t("set.verbDetailed")),
  ]);
  verbSel.value = s.tutorVerbosity || "normal";
  verbSel.addEventListener("change", () => {
    store.setSettings({ tutorVerbosity: verbSel.value });
    toast(t("set.tutorStyleUpdated"));
  });

  /* ---------------- sound ---------------- */
  const soundSel = el("select", { "aria-label": t("set.sound") }, [
    opt("on", t("set.soundOn")),
    opt("off", t("set.soundOff")),
  ]);
  soundSel.value = s.sound === false ? "off" : "on";
  soundSel.addEventListener("change", () => {
    const on = soundSel.value === "on";
    store.setSettings({ sound: on });
    toast(t("set.soundUpdated"));
    // Turning it on should demonstrate what "on" sounds like.
    if (on) playFanfare();
  });

  const goalInput = el("input", {
    type: "number", min: "0", max: "100", inputmode: "numeric",
    value: String(s.dailyGoal ?? 10), "aria-label": t("set.dailyGoal"),
  });
  goalInput.addEventListener("change", () => {
    const n = Math.max(0, Math.min(100, Math.round(Number(goalInput.value) || 0)));
    goalInput.value = String(n);
    store.setSettings({ dailyGoal: n });
    toast(t("set.dailyGoalUpdated"));
  });

  /* ---------------- studying ---------------- */
  const hintsSel = el("select", { "aria-label": t("set.testHints") }, [
    opt("0", t("set.testHints0")),
    opt("1", t("set.testHints1")),
    opt("2", t("set.testHints2")),
    opt("3", t("set.testHints3")),
  ]);
  hintsSel.value = String(s.testHints ?? 2);
  hintsSel.addEventListener("change", () => {
    store.setSettings({ testHints: Number(hintsSel.value) });
    toast(t("set.saved"));
  });

  const adaptiveSel = el("select", { "aria-label": t("set.adaptive") }, [
    opt("on", t("set.adaptiveOn")),
    opt("off", t("set.adaptiveOff")),
  ]);
  adaptiveSel.value = s.adaptive === false ? "off" : "on";
  adaptiveSel.addEventListener("change", () => {
    store.setSettings({ adaptive: adaptiveSel.value === "on" });
    toast(t("set.saved"));
  });

  const pomoSel = el("select", { "aria-label": t("set.pomodoro") }, [
    opt("off", t("set.pomodoroOff")),
    opt("25", t("set.pomodoro25")),
    opt("50", t("set.pomodoro50")),
  ]);
  pomoSel.value = String(s.pomodoro || "off");
  pomoSel.addEventListener("change", () => {
    store.setSettings({ pomodoro: pomoSel.value });
    toast(t("set.saved"));
  });

  const voiceSupported = "speechSynthesis" in window;
  const voiceSel = el("select", { "aria-label": t("set.voice"), disabled: !voiceSupported }, [
    opt("off", t("set.voiceOff")),
    opt("on", t("set.voiceOn")),
  ]);
  voiceSel.value = s.voice === true ? "on" : "off";
  voiceSel.addEventListener("change", () => {
    store.setSettings({ voice: voiceSel.value === "on" });
    toast(t("set.saved"));
  });

  const rulesSel = el("select", { "aria-label": t("set.rulePrompts") }, [
    opt("on", t("set.rulePromptsOn")),
    opt("off", t("set.rulePromptsOff")),
  ]);
  rulesSel.value = s.rulePrompts === false ? "off" : "on";
  rulesSel.addEventListener("change", () => {
    store.setSettings({ rulePrompts: rulesSel.value === "on" });
    toast(t("set.saved"));
  });

  /* ---------------- tutor server status ---------------- */
  // The Claude key lives in the backend proxy now, so there's nothing to type
  // here — just whether live mode is available.
  const serverStatus = !store.proxyUp ? t("set.serverDown")
    : !store.proxyKeyConfigured ? t("set.serverNoKey")
    : t("set.serverLive");

  // One field + its own help text directly beneath it, rather than a row of
  // controls with all the notes clumped underneath.
  const noted = (labelKey, control, noteKey) => el("label.field", {}, [
    el("span", {}, t(labelKey)),
    control,
    noteKey ? el("p.note.field__note", {}, typeof noteKey === "function" ? noteKey() : t(noteKey)) : null,
  ].filter(Boolean));

  const lookPanel = el("section.panel", {}, [
      el("h3", {}, t("set.lookFeel")),
      el("p.note", {}, t("set.appearanceElsewhere")),
      el("div.settings__fields", {}, [
        noted("set.sound", soundSel, "set.soundNote"),
        noted("set.dailyGoal", goalInput, "set.dailyGoalNote"),
        noted("set.font", fontSel),
        noted("set.textSize", sizeSel),
      ]),
    ]);

  const studyPanel = el("section.panel", {}, [
      el("h3", {}, t("set.studying")),
      el("div.settings__fields", {}, [
        noted("set.testHints", hintsSel, "set.testHintsNote"),
        noted("set.adaptive", adaptiveSel, "set.adaptiveNote"),
        noted("set.pomodoro", pomoSel, "set.pomodoroNote"),
        noted("set.voice", voiceSel, voiceSupported ? "set.voiceNote" : "set.voiceUnsupported"),
        noted("set.rulePrompts", rulesSel, "set.rulePromptsNote"),
      ]),
      el("div.settings__redo", {}, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => openWelcomeQuiz({ force: true }) }, t("set.welcomeRedo")),
        el("p.note", {}, t("set.welcomeRedoNote")),
      ]),
    ]);

  // Each section gets an anchor so the side menu can jump straight to it.
  const sections = [
    ["appearance", "set.lookFeel", lookPanel],
    ["studying", "set.studying", studyPanel],
    ["ai", "set.aiTitle", aiSection()],
    ["account", "set.acctTitle", accountSection()],
    ["demo", "set.demoTitle", demoSection()],
    ["data", "set.dataTitle", dataSection()],
  ].filter(([, , panel]) => panel);
  for (const [id, , panel] of sections) panel.id = `settings-${id}`;

  const navLinks = sections.map(([id, labelKey], i) => el("a.settings__navlink" + (i === 0 ? ".is-active" : ""), {
    href: `#/settings`,
    onclick: (e) => {
      e.preventDefault();
      document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }, t(labelKey)));

  const node = el("div.settings", {}, [
    homeButton({ grid: true }),
    el("h1", {}, t("set.title")),
    el("div.settings__layout", {}, [
      el("nav.settings__nav", { "aria-label": t("set.title") }, navLinks),
      el("div.settings__sections", {}, [
        ...sections.map(([, , panel]) => panel),
        el("a.btn.btn--ghost.pageback", { href: "#/", style: { justifySelf: "start" } }, [icon(ICONS.back, 16), t("common.backToMenu")]),
      ]),
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
      const idx = sections.findIndex(([, , panel]) => panel === hit.target);
      navLinks.forEach((a, i) => a.classList.toggle("is-active", i === idx));
    }, { rootMargin: "-90px 0px -60% 0px" });
    sections.forEach(([, , panel]) => io.observe(panel));
  }

  /* ---------------- AI ----------------
   * The full model/price panel only shows once the proxy is reachable + keyed,
   * the user is signed in (the proxy requires it), and this month's allowance
   * isn't spent. Otherwise it collapses to a status line and whatever the one
   * missing thing is. */
  function premiumTeaser() {
    return store.isPremium() ? null : el("p.note", { style: { marginTop: "8px" } }, [
      t("set.premiumTeaser") + " ",
      el("a", { href: "#/premium" }, t("set.premiumLink")),
    ]);
  }

  function aiSection() {
    if (!store.canUseAI()) {
      const serverReady = store.proxyUp && store.proxyKeyConfigured;
      let reason;
      if (serverReady && store.aiOverBudget) {
        reason = el("p.note.note--warn", {}, t("set.aiQuotaReached", { date: fmtResetDate(store.aiUsage?.resetsAt) }));
      } else if (serverReady && !store.authed) {
        reason = el("p.note", {}, [
          t("set.aiNeedsAccount"), " ",
          el("a", { href: "#/login" }, t("account.signIn")),
        ]);
      } else {
        reason = el("p.note", {}, t("set.aiDormant"));
      }
      return el("section.panel", {}, [
        el("h3", {}, t("set.aiTitle")),
        el("p.note", { style: { display: "flex", alignItems: "center", gap: "8px", margin: "6px 0 10px" } }, [
          el("span.dot", { style: { background: serverReady ? "var(--ok)" : "var(--ink-faint)" } }),
          serverStatus,
        ]),
        reason,
        // Only when `reason` is actually the quota-reached line above — not just
        // whenever the budget happens to be spent, which could also be true while
        // the server is unreachable (reason would then read "AI isn't connected",
        // and showing a premium upsell right under that reads as contradictory).
        serverReady && store.aiOverBudget ? premiumTeaser() : null,
        el("details.set-ai-how", { style: { marginTop: "12px" } }, [
          el("summary", {}, t("set.aiHowConnect")),
          el("p.note", { style: { margin: "8px 0 0" } }, t("set.serverBody")),
        ]),
      ].filter(Boolean));
    }

    const usage = store.aiUsage;
    return el("section.panel", {}, [
      el("h3", {}, t("set.aiTitle")),
      el("h4.settings__sub", {}, t("set.serverTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, t("set.serverBody")),
      el("p.note", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
        el("span.dot", { style: { background: "var(--ok)" } }),
        serverStatus,
      ]),
      usage ? el("p.note", { style: { marginTop: "8px" } }, [
        t("set.aiUsageLine", { used: usage.used.toLocaleString(), limit: usage.limit.toLocaleString() }),
        usage.resetsAt ? " · " + t("set.aiUsageResets", { date: fmtResetDate(usage.resetsAt) }) : "",
      ]) : null,
      premiumTeaser(),
      el("h4.settings__sub", {}, t("set.modelTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, t("set.modelIntro")),
      modelTable,
      el("label.field", { style: { marginTop: "16px", marginBottom: "0" } }, [el("span", {}, t("set.replyLength")), verbSel]),
    ].filter(Boolean));
  }

  function demoSection() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } });
    const actions = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } });

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
        actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button", style: { color: "var(--retry-ink)" },
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

    return el("section.panel", {}, [
      el("h3", {}, t("set.demoTitle")),
      status,
      actions,
    ]);
  }

  function accountSection() {
    const status = el("p.note", { style: { margin: "6px 0 12px" } });
    const verifyRow = el("p.note", { style: { margin: "0 0 12px" }, hidden: true });
    const actions = el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } });

    function paint() {
      status.textContent = store.authed
        ? t("set.acctSignedIn", { email: store.authEmail })
        : t("set.acctSignedOut");

      // Meaningless while the server has no email set up — hidden entirely then, same as the
      // Google button hides when googleClientId is null.
      const showVerify = store.authed && store.emailConfigured;
      verifyRow.hidden = !showVerify;
      if (showVerify) {
        verifyRow.className = "note" + (store.authEmailVerified ? "" : " note--warn");
        verifyRow.textContent = t(store.authEmailVerified ? "set.acctEmailVerified" : "set.acctEmailNotVerified");
      }

      clear(actions);
      if (store.authed) {
        if (showVerify && !store.authEmailVerified) {
          actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
            type: "button",
            onclick: async (e) => {
              const btn = e.currentTarget;   // e.currentTarget is null once this resumes after the await
              btn.disabled = true;
              try { await store.resendVerification(); toast(t("set.acctVerificationSent")); }
              catch (err) { toast(err.message || t("set.acctVerificationResendFailed")); }
              finally { btn.disabled = false; }
            },
          }, t("set.acctResendVerification")));
        }
        actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            const r = await store.logout();
            toast(t(r?.wiped === false ? "set.acctSignedOutKept" : "set.acctSignedOutToast"));
            paint();
          },
        }, t("set.acctSignOut")));
        actions.appendChild(el("a.btn.btn--ghost.btn--sm", { href: "#/parent" }, t("set.acctParentLink")));
        actions.appendChild(el("a.btn.btn--ghost.btn--sm", { href: "#/rate" }, t("set.acctReviewLink")));
        actions.appendChild(el("button.btn.btn--ghost.btn--sm", {
          type: "button", style: { color: "var(--retry-ink)" },
          onclick: async () => {
            if (await deleteAccountDialog()) { toast(t("set.acctDeleted")); location.hash = "#/"; paint(); }
          },
        }, t("set.acctDelete")));
      } else {
        actions.appendChild(el("a.btn.btn--sm", { href: "#/login" }, t("set.acctSignIn")));
      }
    }
    paint();

    return el("section.panel", {}, [
      el("h3", {}, t("set.acctTitle")),
      !store.proxyUp && el("p.note.note--warn", {}, t("set.acctNoServer")),
      status,
      verifyRow,
      actions,
    ]);
  }

  function dataSection() {
    const recovery = el("p.note.note--warn", { style: { margin: "6px 0 12px" } });
    const importInput = el("input", {
      type: "file", accept: "application/json,.json", style: { display: "none" },
      onchange: onImportFile,
    });
    const importStatus = el("p.note", { style: { margin: "8px 0 0" } });

    function paintRecovery() {
      const blob = store.recoveryBlob;
      if (!blob) { clear(recovery); recovery.hidden = true; return; }
      recovery.hidden = false;
      clear(recovery);
      recovery.appendChild(el("span", {}, t("set.recoveryFound") + " "));
      recovery.appendChild(el("button.linkbtn", {
        type: "button",
        onclick: () => downloadText(`studify-recovered-${localDayKey()}.txt`, blob, "text/plain"),
      }, t("set.recoveryDownload")));
      recovery.appendChild(el("span", {}, " · "));
      recovery.appendChild(el("button.linkbtn", {
        type: "button",
        onclick: () => { store.clearRecoveryBlob(); paintRecovery(); },
      }, t("set.recoveryDismiss")));
    }
    paintRecovery();

    function exportData() {
      downloadText(`studify-backup-${localDayKey()}.json`, store.exportJSON());
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
        importStatus.className = "note note--warn";
        importStatus.textContent = t("set.importReadFail");
        return;
      }
      if (!(await confirmDialog({ message: t("set.importConfirm"), confirmLabel: t("set.import"), danger: true }))) return;
      try {
        store.importJSON(text);
        importStatus.className = "note";
        importStatus.textContent = "";
        toast(t("set.imported"));
        location.hash = "#/";
      } catch {
        importStatus.className = "note note--warn";
        importStatus.textContent = t("set.importBadFile");
      }
    }

    async function wipe() {
      if (!(await confirmDialog({ message: t("set.wipeConfirm"), confirmLabel: t("set.wipe"), danger: true }))) return;
      store.wipe();
      toast(t("set.wiped"));
      location.hash = "#/";
    }

    return el("section.panel", {}, [
      el("h3", {}, t("set.dataTitle")),
      el("p.note", { style: { margin: "6px 0 12px" } }, store.authed ? t("set.dataBodySynced") : t("set.dataBody")),
      recovery,
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: exportData }, t("set.export")),
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => importInput.click() }, t("set.import")),
        importInput,
        el("button.btn.btn--ghost.btn--sm", { type: "button", style: { color: "var(--retry-ink)" }, onclick: wipe }, t("set.wipe")),
      ]),
      importStatus,
      offlineRow(),
    ].filter(Boolean));
  }

  /* ---------------- offline library ---------------- */
  function offlineRow() {
    if (!offlineSupported()) return null;
    const status = el("p.note", { style: { margin: "10px 0 8px" } }, t("set.offlineBody"));
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

    return el("div", { style: { marginTop: "16px" } }, [
      el("h4.settings__sub", {}, t("set.offlineTitle")),
      status, bar, btn,
    ]);
  }

  return { title: t("set.title"), node };
}

function opt(value, label) { return el("option", { value }, label); }

function prettyModel(id) {
  return ({
    "claude-opus-5": "Claude Opus 5",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
  })[id] || id;
}
