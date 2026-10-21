// Settings: look & feel, studying, AI (tutor server + models), account, your
// data.
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
import { t, getLang, setLang, LANGS, fmtDate } from "../lib/i18n.js";
import { getTheme, setTheme } from "../lib/theme.js";
import { homeButton } from "../components/nav.js";
import { voiceControls } from "../components/voice-controls.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { deleteAccountDialog } from "../components/delete-account-dialog.js";
import { twofaSetupDialog } from "../components/twofa-setup-dialog.js";
import { passwordConfirmDialog } from "../components/password-confirm-dialog.js";
import { setPasswordDialog } from "../components/set-password-dialog.js";
import { changePasswordDialog } from "../components/change-password-dialog.js";
import { changeEmailDialog } from "../components/change-email-dialog.js";
import { openWelcomeQuiz } from "../components/onboarding.js";
import { hasAiConsent, withdrawAiConsent, askAiConsent } from "../components/ai-consent.js";
import { playFanfare } from "../lib/sound.js";
import { offlineSupported, isLibraryCached, cacheLibraryOffline } from "../lib/offline.js";
import { row, card, pageHead, toggle, seg } from "../components/set-ui.js";
import { openAvatarEditor } from "../components/avatar-editor.js";

/* ---------------- building blocks ---------------- */
// toggle() and seg() live in components/set-ui.js, shared with Skapa.

/** A quiet "Saved ✓" beside the row's name, instead of a toast on every change.
 *  role=status so a screen reader still hears it. */
function saved(node) {
  const r = node?.closest?.(".set-row");
  if (!r) return;
  let tag = r.querySelector(".set-saved");
  if (!tag) {
    tag = el("span.set-saved", { role: "status" }, [icon(ICONS.check, 13), t("set.savedShort")]);
    r.querySelector(".set-row__label")?.append(tag);
  }
  tag.classList.remove("is-on");
  void tag.offsetWidth;            // restart the fade if it's already showing
  tag.classList.add("is-on");
  clearTimeout(tag._hide);
  tag._hide = setTimeout(() => tag.classList.remove("is-on"), 1800);
}

/** Tiny painted previews of each theme: page, card, accent. */
const THEME_SWATCHES = {
  light: ["#F5F7FC", "#FFFFFF", "#2C5CD6"],
  paper: ["#F1E7D0", "#FBF4E2", "#2C5CD6"],
  dark: ["#0A0C11", "#121620", "#3A6AE0"],
};
function swatch(theme) {
  const [bg, card, accent] = THEME_SWATCHES[theme] || [];
  const paint = theme === "system"
    ? { background: "linear-gradient(90deg, #F5F7FC 50%, #0A0C11 50%)" }
    : { background: bg };
  return el("span.set-theme__art", { "aria-hidden": "true", style: paint }, [
    el("i", { style: { background: theme === "system" ? "linear-gradient(90deg, #FFFFFF 50%, #121620 50%)" : card } }),
    el("b", { style: { background: theme === "system" ? "#2C5CD6" : accent } }),
  ]);
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

  /* ---------------- appearance & sound ---------------- */
  const themeCtl = seg(t("set.theme"), ["light", "paper", "dark", "system"].map((v) => [v, [
    swatch(v),
    el("span.set-theme__name", {}, t(`set.theme${v[0].toUpperCase()}${v.slice(1)}`)),
  ]]), getTheme(), (v) => { setTheme(v); saved(themeCtl); }, { cls: "set-themes", opt: "set-theme" });
  // Follow a theme change made elsewhere (the sidebar's theme button) while this page is open.
  const themeOrder = ["light", "paper", "dark", "system"];
  const onThemeChange = () => {
    if (!themeCtl.isConnected) { window.removeEventListener("sb:themechange", onThemeChange); return; }
    const cur = getTheme();
    themeCtl.querySelectorAll(".set-theme").forEach((b, i) => {
      b.setAttribute("aria-checked", String(themeOrder[i] === cur));
      b.tabIndex = themeOrder[i] === cur ? 0 : -1;
    });
  };
  window.addEventListener("sb:themechange", onThemeChange);

  const langCtl = seg(t("common.language"), LANGS.map(([code, name]) => [code, name]), getLang(), (v) => {
    // The whole app re-renders in the new language (main.js, sb:langchange). A switch that didn't
    // happen (offline, or overtaken by a later pick) puts the control back on the language in use.
    setLang(v).then((ok) => {
      if (ok) return;
      const cur = getLang();
      langCtl.querySelectorAll(".set-seg__opt").forEach((b, i) => {
        b.setAttribute("aria-checked", String(LANGS[i][0] === cur));
        b.tabIndex = LANGS[i][0] === cur ? 0 : -1;
      });
    });
  });

  const fontCtl = seg(t("set.font"), [
    ["system", t("set.fontSystem")],
    ["hyperlegible", t("set.fontHyperlegible")],
  ], getFont(), (v) => { setFont(v); saved(fontCtl); });

  const sizeCtl = seg(t("set.textSize"), [
    ["s", t("set.textSizeS")], ["m", t("set.textSizeM")], ["l", t("set.textSizeL")],
  ], getTextSize(), (v) => { setTextSize(v); saved(sizeCtl); });

  // What a question looks like with the chosen typeface and size — the app's
  // own type settings apply to it live, like everywhere else.
  const preview = el("div.set-preview", { "aria-hidden": "true" }, [
    el("span.set-preview__tag", {}, t("set.previewSubject")),
    el("p.set-preview__q", {}, t("set.previewQ")),
    el("div.set-preview__opts", {}, [
      el("span.is-right", {}, [icon(ICONS.check, 14), t("set.previewA")]),
      el("span", {}, t("set.previewB")),
      el("span", {}, t("set.previewC")),
    ]),
  ]);

  const soundCtl = toggle(t("set.sound"), s.sound !== false, (on) => {
    store.setSettings({ sound: on });
    saved(soundCtl);
    // Turning it on should demonstrate what "on" sounds like.
    if (on) playFanfare();
  });

  const lookPanel = card(ICONS.sun, t("set.lookFeel"), t("set.lookSub"), [
    row(t("set.theme"), t("set.themeNote"), themeCtl, { stack: true }),
    row(t("common.language"), t("set.languageNote"), langCtl),
    row(t("set.font"), t("set.fontNote"), fontCtl),
    row(t("set.textSize"), null, sizeCtl),
    row(t("set.previewLabel"), t("set.previewNote"), preview, { stack: true }),
    row(t("set.sound"), t("set.soundNote"), soundCtl),
  ]);

  /* ---------------- studying ---------------- */
  const goalInput = el("input", {
    type: "number", min: "0", max: "100", inputmode: "numeric", id: "set-goal",
    value: String(s.dailyGoal ?? 10), "aria-label": t("set.dailyGoal"),
  });
  const setGoal = (raw) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    goalInput.value = String(n);
    store.setSettings({ dailyGoal: n });
    saved(goalInput);
  };
  goalInput.addEventListener("change", () => setGoal(goalInput.value));
  const goalCtl = el("div.set-stepper", {}, [
    el("button", { type: "button", "aria-label": "−5", onclick: () => setGoal(Number(goalInput.value) - 5) }, "−"),
    goalInput,
    el("button", { type: "button", "aria-label": "+5", onclick: () => setGoal(Number(goalInput.value) + 5) }, "+"),
  ]);

  const hintsCtl = seg(t("set.testHints"), [
    ["0", short(t("set.testHints0"))], ["1", "1"], ["2", "2"], ["3", "3"],
  ], String(s.testHints ?? 2), (v) => { store.setSettings({ testHints: Number(v) }); saved(hintsCtl); });

  const adaptiveCtl = toggle(t("set.adaptive"), s.adaptive !== false, (on) => {
    store.setSettings({ adaptive: on });
    saved(adaptiveCtl);
  });

  const pomoCtl = seg(t("set.pomodoro"), [
    ["off", t("set.pomodoroOff")], ["25", t("set.pomodoro25")], ["50", t("set.pomodoro50")],
  ], String(s.pomodoro || "off"), (v) => { store.setSettings({ pomodoro: v }); saved(pomoCtl); });

  const voiceSupported = "speechSynthesis" in window;
  const voiceCtl = toggle(t("set.voice"), s.voice === true, (on) => {
    store.setSettings({ voice: on });
    saved(voiceCtl);
  }, { disabled: !voiceSupported });

  const rulesCtl = toggle(t("set.rulePrompts"), s.rulePrompts !== false, (on) => {
    store.setSettings({ rulePrompts: on });
    saved(rulesCtl);
  });

  const studyPanel = card(ICONS.book, t("set.studying"), t("set.studySub"), [
    row(t("set.dailyGoal"), t("set.dailyGoalNote"), goalCtl),
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
    pageHead(t("set.title"), t("set.pageSub")),
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
    return el("span.set-pill" + (ok ? ".is-on" : ""), {}, [el("span.dot", { style: { background: ok ? "var(--ok)" : "var(--ink-faint)" } }), text]);
  }

  function premiumLink() {
    if (store.isPremium()) return null;
    // With Stripe set up (and this account allowed to use it) the button goes to the real Plus page; otherwise
    // it is still the waitlist.
    return store.billing?.canCheckout
      ? el("a.btn.btn--ghost.btn--sm", { href: "#/plus" }, t("set.planGet"))
      : el("a.btn.btn--ghost.btn--sm", { href: "#/premium" }, t("set.premiumLink"));
  }

  /** The "Plan" row: Plus with a manage link, or free with a way to get Plus. Nothing when the server has no
   *  paid plan (or this account can't use it yet) - the free plan is not worth a row of its own then. */
  function planRow() {
    const b = store.billing;
    if (!b) return null;
    if (b.plus) return row(t("set.planLabel"), t("set.planPlus"), el("a.btn.btn--ghost.btn--sm", { href: "#/plus" }, t("set.planManage")));
    if (!b.canCheckout) return null;
    return row(t("set.planLabel"), t("set.planFree"), el("a.btn.btn--ghost.btn--sm", { href: "#/plus" }, t("set.planGet")));
  }

  function aiSection() {
    if (!store.canUseAI()) {
      const serverReady = store.proxyUp && store.proxyKeyConfigured;
      const resets = fmtResetDate(store.aiUsage?.resetsAt);
      let body;
      if (serverReady && store.aiOverBudget) {
        body = row(t("set.aiOutLabel"), resets ? t("set.aiOutNote", { date: resets }) : t("set.aiOutNoteNoDate"), [statusPill(false, t("set.aiPillOut")), premiumLink()].filter(Boolean));
      } else if (serverReady && !store.authed) {
        body = row(t("set.aiSignInLabel"), t("set.aiSignInNote"), el("a.btn.btn--sm", { href: "#/login" }, t("account.signIn")));
      } else {
        body = row(t("set.aiDownLabel"), t("set.aiDownNote"), statusPill(false, t("set.aiPillOff")));
      }
      return card(ICONS.spark, t("set.aiTitle"), t("set.aiSub"), [body]);
    }

    const usage = store.aiUsage;
    // kronor, one decimal while small (0,4 of 2), none once it is a whole figure (30)
    const krText = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB");
    const pct = usage?.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : null;
    const verbCtl = seg(t("set.replyLength"), [
      ["concise", short(t("set.verbConcise"))],
      ["normal", short(t("set.verbNormal"))],
      ["detailed", short(t("set.verbDetailed"))],
    ], s.tutorVerbosity || "normal", (v) => {
      store.setSettings({ tutorVerbosity: v });
      saved(verbCtl);
    });
    const modelTable = el("table.preset-table", {}, [
      el("tbody", {}, [
        modelRow(t("set.jobWriting"), MODELS.generate, t("set.whenPerSet")),
        modelRow(t("set.jobReview"), MODELS.review, t("set.whenPerSet")),
        modelRow(t("set.jobHpWriting"), MODELS.generateHp, t("set.whenPerBatch")),
        modelRow(t("set.jobTutoring"), MODELS.tutor, t("set.whenEveryMsg")),
        modelRow(t("set.jobMarking"), MODELS.grade, t("set.whenEveryAnswer")),
      ]),
    ]);

    return card(ICONS.spark, t("set.aiTitle"), t("set.aiSub"), [
      row(t("set.aiOnLabel"), t("set.aiOnNote"), statusPill(true, t("set.aiPillOn"))),
      planRow(),
      pct != null ? row(t("set.aiMonthLabel"), [
        t("set.aiUsedKr", { pct, used: krText(usage.used), limit: krText(usage.limit) }),
        usage.resetsAt ? " " + t("set.aiRefills", { date: fmtResetDate(usage.resetsAt) }) : "",
      ].join(""), [
        el("div.set-usage", { role: "img", "aria-label": t("set.aiUsedPct", { pct }) }, [el("i", { style: { width: `${pct}%` } })]),
        el("span.set-usage__pct", {}, `${pct} %`),
      ]) : null,
      row(t("set.replyLength"), t("set.replyLengthNote"), verbCtl),
      consentRow(),
      el("details.set-details", {}, [
        el("summary", {}, t("set.modelsLabel")),
        el("p.set-row__note", {}, t("set.modelIntro")),
        modelTable,
      ]),
    ]);
  }

  /** Whether the student has allowed sending to Anthropic (components/ai-consent.js), with the way to change it. */
  function consentRow() {
    const on = hasAiConsent();
    const at = store.state.settings.aiConsentAt;
    const btn = el("button.btn.btn--ghost.btn--sm", {
      type: "button",
      onclick: async () => {
        if (on) { withdrawAiConsent(); toast(t("set.aiConsentWithdrawn")); }
        else await askAiConsent();
        // This page isn't rebuilt on a settings change (it would steal focus from its fields): redraw the row.
        const fresh = consentRow();
        node.replaceWith(fresh);
        fresh.querySelector("button")?.focus();
      },
    }, t(on ? "set.aiConsentWithdraw" : "set.aiConsentGive"));
    const node = row(t("set.aiConsentLabel"), on ? t("set.aiConsentOn", { date: fmtDate(new Date(at).toISOString().slice(0, 10)) }) : t("set.aiConsentOff"), btn);
    return node;
  }

  function modelRow(job, model, when) {
    return el("tr", {}, [el("th", {}, job), el("td", {}, prettyModel(model)), el("td.note", {}, when)]);
  }

  /* ---------------- account ---------------- */
  function accountSection() {
    const body = el("div.set-acct");

    // Profile picture: one hidden file input, opened by the avatar itself or the
    // row's button; the editor frames it, the store keeps it (and syncs it).
    const fileInput = el("input", { type: "file", accept: "image/*", hidden: true });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";                       // picking the same file again still fires
      if (!file) return;
      const res = await openAvatarEditor(file);
      if (!res) return;                           // cancelled
      if (res.error) { toast(res.error); return; }
      if (store.setAvatar(res.dataUrl)) { toast(t("avatar.saved")); paint(); }
      else toast(t("avatar.readFail"));
    });
    const pick = () => fileInput.click();

    /** The round picture (or initial, or a person when there's neither) that
     *  opens the picker, with a camera on hover. */
    function face(initial) {
      const a = store.avatar;
      return el("button.set-avatar.set-avatar--photo", {
        type: "button", onclick: pick,
        "aria-label": t(a ? "avatar.change" : "avatar.add"), title: t(a ? "avatar.change" : "avatar.add"),
      }, [
        a ? el("img", { src: a, alt: "" }) : initial ? el("span", {}, initial) : icon(ICONS.user, 20),
        el("span.set-avatar__cam", { "aria-hidden": "true" }, icon(ICONS.camera, 16)),
      ]);
    }

    function photoRow() {
      const a = store.avatar;
      return row(t("avatar.rowLabel"), t(store.authed ? "avatar.rowNote" : "avatar.rowNoteLocal"), [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: pick }, [icon(ICONS.camera, 15), t(a ? "avatar.change" : "avatar.add")]),
        a ? el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: () => {
            store.setAvatar(null);
            paint();
            toast(t("avatar.removed"), { actionLabel: t("common.undo"), onAction: () => { store.setAvatar(a); paint(); } });
          },
        }, t("avatar.remove")) : null,
      ]);
    }

    function paint() {
      clear(body);
      if (!store.authed) {
        body.append(...[
          !store.proxyUp ? el("p.note.note--warn", {}, t("set.acctNoServer")) : null,
          row(t("set.acctSignedOutLabel"), t("set.acctSignedOut").split(" — ").slice(-1)[0], el("a.btn.btn--sm", { href: "#/login" }, t("set.acctSignIn")), { lead: face(null) }),
          photoRow(),
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
          toast(t(r?.kept ? "set.acctSignedOutKept" : "set.acctSignedOutToast"));
          paint();
        },
      }, t("set.acctSignOut")));

      body.append(...[
        el("div.set-profile", {}, [
          face((email[0] || "?").toUpperCase()),
          el("div.set-profile__text", {}, [
            el("strong", {}, email),
            chips.childNodes.length ? chips : null,
          ].filter(Boolean)),
          el("div.set-row__ctl", {}, actions),
        ]),
        photoRow(),
        // Adding a password re-proves the account with a fresh Google sign-in, so an Apple-only account can't yet.
        store.authPasswordless && store.authGoogleLinked
          ? row(t("setpw.add"), t("set.pwNote"), el("button.btn.btn--ghost.btn--sm", {
              type: "button",
              onclick: async () => { if (await setPasswordDialog()) { toast(t("setpw.addedToast")); paint(); } },
            }, t("setpw.add")))
          : null,
        !store.authPasswordless
          ? row(t("set.pwChangeLabel"), t("set.pwChangeNote"), el("button.btn.btn--ghost.btn--sm", {
              type: "button",
              onclick: async () => { if (await changePasswordDialog()) toast(t("pwchange.done")); },
            }, t("pwchange.title")))
          : null,
        !store.authPasswordless && store.emailConfigured
          ? row(t("set.emailLabel"), t("set.emailNote"), el("button.btn.btn--ghost.btn--sm", {
              type: "button",
              onclick: async () => { if (await changeEmailDialog()) toast(t("emailchange.sent")); },
            }, t("emailchange.title")))
          : null,
        row(t("set.signOutOthersLabel"), t("set.signOutOthersNote"), el("button.btn.btn--ghost.btn--sm", {
          type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget; btn.disabled = true;
            try { toast(t((await store.signOutOtherDevices()) > 0 ? "set.signedOutOthers" : "set.signedOutOthersNone")); }
            catch (err) { toast(err.message || t("login.somethingWrong")); }
            finally { btn.disabled = false; }
          },
        }, t("set.signOutOthers"))),
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

    // The file input lives outside the repainted body, so a repaint mid-pick can't drop it.
    return card(ICONS.user, t("set.acctTitle"), t("set.acctSub"), [body, fileInput]);
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
      } catch (err) {
        importStatus.className = "set-row__note note--warn";
        importStatus.textContent = t(err?.code === "is_set" ? "set.importIsSet" : "set.importBadFile");
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
    "claude-haiku-5-5": "Claude Haiku 5.5",
  })[id] || id;
}
