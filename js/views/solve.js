// Instant problem help, as a chat from the moment the page loads — no
// upload-then-chat gate. Attach a photo (button or paste), paste or type
// plain text, or both, and send; the tutor answers, then it's a normal
// back-and-forth about that same problem, reusing the exact streaming call
// the practice-session tutor already runs on. Needs the tutor server
// (store.hasKey()); until then the composer is disabled and the reason is
// spelled out, exactly like Create.
//
// Also where the seven one-tap "ways to study" live (quiz me, explain, summarise, compare,
// word list, debate, feedback on text — lib/study-modes.js): tapping one starts a fresh thread under that
// mode's own ground rules instead of the default "help with one problem" persona; tapping
// the active one again returns to the default. This used to be its own page (#/chat) —
// folded in here because it was the exact same chat, just with a different system prompt,
// and having "the AI page" and "the AI chat page" as two separate things confused more than
// it helped. #/chat?mode=X still gets read as ?mode=X here (main.js no longer routes #/chat
// at all — an old link to it lands on the home page, same as any other unknown hash).
//
//   #/solve            the default "help with a problem" persona
//   #/solve?mode=quiz  starts in that way of studying (also linked from the home page's
//                      AI study help strip, and from the mode chips below)
//   #/solve?mode=check is intercepted by main.js before this module ever loads — that's
//                      the separate "Kolla min uträkning" tab (check.js), not a mode here.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast, uid } from "../lib/dom.js";
import { markdown } from "../lib/markdown.js";
import { announce } from "../lib/a11y.js";
import { shrinkImage } from "../lib/photo.js";
import { tutorStream, generateAssignment, ClaudeError } from "../claude.js";
import { extractSetBrief, withSetId, withoutSetId, pickMaterial, generationParams } from "../lib/set-brief.js";
import { setProposalCard } from "../components/set-proposal-card.js";
import { solveChatSystem, studyChatSystem } from "../prompts.js";
import { STUDY_MODES, isStudyMode, trimHistory, MAX_INPUT_CHARS } from "../lib/study-modes.js";
import { t, plural } from "../lib/i18n.js";
import { homeButton } from "../components/nav.js";
import { bindFileTargets } from "../components/file-drop.js";
import { aiQuotaNote } from "../components/ai-gate.js";
import { aiHead } from "../components/ai-head.js";
import { aiTile } from "../components/ai-mark.js";
import { openPopover, closePopover } from "../lib/popover.js";
import { setMood } from "../components/mascot.js";
import { openMaterialPicker } from "../components/material-picker.js";
import { chatHistoryPanel } from "../components/chat-history-panel.js";
import { materialSystemBlock, extractSourceRefs } from "../lib/chat-material.js";
import { newChatId, saveChat, chatTitle, addSaved, removeSaved, findSaved } from "../lib/chat-history.js";
import { setSessionActive } from "../lib/session-active.js";
import { localDayKey } from "../lib/activity.js";
import { fmtDate } from "../lib/i18n.js";
import { aiReportButton } from "../components/ai-report.js";

/** How much of a long pasted text is echoed back in the student's own bubble — the message
 *  sent to the model is never truncated, only what's shown (a page of notes shouldn't make
 *  the transcript unscrollable). */
const ECHO_CHARS = 600;

/** Signed out, every way in leads here: the sign-in page, then back to the chat. */
const SIGN_IN_HREF = `#/login?next=${encodeURIComponent("/solve")}`;

export function renderSolve(qs) {
  const root = el("div.solve");
  // Re-derived on every store "change" (a quota hit, a sign-in) by paintAvailability() — never a
  // one-time snapshot, or the composer and mode tiles go stale until the student leaves and returns.
  let canChat = store.hasKey();
  const state = {
    mode: isStudyMode(qs?.get?.("mode")) ? qs.get("mode") : null,   // null = the default "help with a problem" persona
    messages: [],       // Anthropic-format history for this conversation
    pendingImage: null, // { mediaType, data, preview } attached, not yet sent
    busy: false,
    abort: null,        // lets switching mode mid-stream cut the old reply off cleanly
    chatId: newChatId(), // the key this conversation is saved under (lib/chat-history.js)
    material: null,     // a set / file the answers are based on (lib/chat-material.js)
    cards: [],          // the "create this set" cards in this conversation, oldest first
  };
  let mounted = true;   // false once the page is left: a set that finishes after that is announced by a toast

  // Built once; mutated directly from here on (streaming and attach
  // previews need to update in place without losing focus or typed text).
  let refs = null;
  // The shared identity strip (avatar + live/off status) — its mood follows the same busy/idle
  // rhythm as the help-chat bubble's (site-chat.js), so the assistant visibly "thinks" while streaming.
  let head = null;

  /** The default persona has its own strings (solve.*, unchanged from before the modes existed);
   *  each study mode has its own (chat.intro.<id> / chat.placeholder.<id>). */
  const introText = () => (state.mode ? t(`chat.intro.${state.mode}`) : t("solve.intro"));
  const placeholderText = () => (state.mode ? t(`chat.placeholder.${state.mode}`) : state.material ? t("solve.materialPlaceholder") : t("solve.chatPlaceholder"));

  /** Save the conversation so it shows up under "Tidigare chattar". Cheap, and safe to call often. */
  function persist() {
    saveChat({ id: state.chatId, mode: state.mode, material: state.material, messages: state.messages });
  }

  /** What the student had written just before the reply `raw` (its text only), for a report of that reply. */
  function promptBefore(raw) {
    const i = state.messages.findIndex((m) => m.role === "assistant" && m.content === raw);
    const m = i > 0 ? state.messages[i - 1] : null;
    if (!m) return "";
    return typeof m.content === "string" ? m.content
      : (Array.isArray(m.content) ? m.content : []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  }

  /** An assistant reply, drawn from its raw text: the [F4] source markers become "fråga 4" tags, and a
   *  finished reply gets a bookmark. Runs on every streamed chunk, with `final` only at the end. */
  function renderReply(bubble, raw, final) {
    const set = state.material?.kind === "set";
    // The assistant's proposal to make a set ends in a machine-readable marker: never shown as text,
    // and the card for it appears only once the reply is complete (a half-streamed marker is hidden too).
    const { text: readable, brief } = extractSetBrief(raw);
    const { text, refs: sources } = extractSourceRefs(readable, set ? state.material.used : 0);
    // Its own suggested answers ("… [Kemi 1]") read as chips instead of raw brackets.
    let suggested = 0;
    bubble.innerHTML = markdown(text).replace(/\[([^\[\]<>\n]{1,40})\](?=\s*(?:<\/li>|<\/p>|<br\s*\/?>|$))/g, (_, s) => {
      suggested++;
      return `<span class="chatdef">${s}</span>`;
    });
    if (!final) return;
    if (brief) bubble.appendChild(proposalCard(brief, raw));
    else if (suggested && state.messages[state.messages.length - 1]?.content === raw) {
      // The newest reply asks questions with suggestions: one tap answers "go with them".
      const row = el("div.chatquick", {}, [
        el("button.btn.btn--sm", {
          type: "button",
          onclick: () => { row.remove(); refs.inputEl.value = t("solve.useDefaultsMsg"); send(); },
        }, [icon(ICONS.check, 14), t("solve.useDefaults")]),
      ]);
      bubble.appendChild(row);
    }
    const foot = el("div.msg__foot", {}, [
      sources.length
        ? el("span.msg__sources", {}, [
            el("span.tag", {}, [icon(ICONS.book, 12), t("solve.sourceFrom")]),
            ...sources.map((n) => el("span.tag", {}, t("solve.sourceQuestion", { n }))),
          ])
        : el("span"),
      saveButton(text),
      aiReportButton({ where: "solve", content: text, prompt: () => promptBefore(raw) }),
    ]);
    bubble.appendChild(foot);
  }

  /** The card under a reply that proposes a set. A newer proposal retires the older cards. */
  function proposalCard(brief, raw) {
    const card = setProposalCard({
      brief,
      isDone: (id) => store.getAssignment(id) || null,
      // Same reasons as the composer, but "no server" says generating, not solving.
      blocked: () => (store.canUseAI() ? "" : store.aiBlockReason() === "unavailable" ? t("create.noServerHere") : blockedToast()),
      create: (b) => createSet(b, () => state.cards.includes(card)),
      // The student said when the test is: offer to put it in Inför provet with this set on it.
      testFor: (made) => store.exams.find((e) => e.setIds.includes(made.id)) || null,
      addTest: (made, b) => {
        if (!b.testDate || b.testDate < localDayKey()) return null;
        const same = store.exams.find((e) => e.subjectId === made.subjectId && e.date === b.testDate);
        const exam = same
          ? store.updateExam(same.id, { setIds: [...same.setIds, made.id] })
          : store.addExam({ subjectId: made.subjectId, date: b.testDate, title: "", setIds: [made.id] });
        if (exam) toast(t("setgen.testAdded", { date: fmtDate(b.testDate) }), { actionLabel: t("setgen.openTest"), onAction: () => { location.hash = `#/exam-prep/${exam.id}`; } });
        return exam;
      },
      // Write the new set's id into the saved reply, so reopening this chat later shows "created"
      // instead of offering to make the same set again.
      onCreated: (a) => {
        const i = state.messages.findIndex((m) => m.role === "assistant" && m.content === raw);
        if (i >= 0) { state.messages[i] = { ...state.messages[i], content: withSetId(raw, a.id) }; persist(); }
      },
    });
    for (const old of state.cards) old.supersede();
    state.cards.push(card);
    return card.node;
  }

  /** Generates the set from a proposal and saves it. The same call "Create" makes, spent only when the
   *  student taps the card's button. Finishes and saves even if they have left the page meanwhile. */
  async function createSet(brief, cardStillShown = () => true) {
    let doc;
    try {
      doc = await generateAssignment(generationParams(brief, pickMaterial({ brief, material: state.material, messages: state.messages })));
    } catch (e) {
      throw new Error(e instanceof ClaudeError ? e.message : t("setgen.failed"));
    }
    if (!doc?.questions?.length) throw new Error(t("setgen.empty"));
    doc.title = brief.title || doc.title;
    doc.subject = brief.subject || doc.subject || t("common.general");
    doc.questions = doc.questions.map((q) => ({ ...q, id: uid() }));
    doc.ai = true;
    const a = store.addAssignmentDoc(doc);
    store.refreshUsage?.();
    // Nobody is looking at the card any more (page left, or a new chat started): say where the set went.
    if (!mounted || !cardStillShown()) {
      toast(t("setgen.doneToast", { title: a.title }), { actionLabel: t("setgen.practise"), onAction: () => { location.hash = `#/session/${a.id}`; } });
    }
    return a;
  }

  function saveButton(text) {
    const btn = el("button.msg__save", { type: "button" }, icon(ICONS.bookmark, 15));
    const paint = () => {
      const on = !!findSaved(state.chatId, text);
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? t("solve.unsaveAnswer") : t("solve.saveAnswer"));
      btn.title = on ? t("solve.unsaveAnswer") : t("solve.saveAnswer");
    };
    btn.addEventListener("click", () => {
      const existing = findSaved(state.chatId, text);
      if (existing) { removeSaved(existing.id); toast(t("solve.unsavedToast")); }
      else { addSaved({ chatId: state.chatId, chatTitle: chatTitle(state.messages), text }); toast(t("solve.savedToast")); }
      paint();
    });
    paint();
    return btn;
  }

  /** A message in the log. The assistant's replies sit on the page beside a small sparkles avatar
   *  (not in a bubble), so long answers read like a document; returns the message node itself. */
  function appendBubble(who, html) {
    const node = el(`div.msg.${who}`, {});
    if (html != null) node.innerHTML = html;
    refs.hero?.remove();
    refs.hero = null;
    refs.logEl.appendChild(who === "ai" ? el("div.msgrow", {}, [aiTile(26), node]) : node);
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
    return node;
  }

  /** Brings a new reply's top edge into view once, then lets it grow downward without chasing every
   *  streamed chunk to the bottom — a long answer used to always end up scrolled past its own start
   *  by the time it finished, so the heading/first item was the one thing you had to scroll back for. */
  function followReply(bubble) {
    const log = refs.logEl;
    const bubbleTop = bubble.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop;
    const maxScroll = Math.max(0, log.scrollHeight - log.clientHeight);
    log.scrollTop = Math.min(maxScroll, bubbleTop);
  }

  /** The empty conversation: a centred greeting — a heading and the mode's own intro — and, for the
   *  default persona, four ways to start and a row of the other ways to study. Every way in appears once;
   *  the composer below holds nothing but the box. Gone as soon as the first message lands. */
  function appendWelcome() {
    refs.hero?.remove();
    const mode = state.mode ? STUDY_MODES.find((m) => m.id === state.mode) : null;
    // A mode's intro opens with its name in bold; the heading already says it.
    const sub = mode ? introText().replace(/^\*\*[^*]+\*\*\s*/, "") : t("solve.heroSub");
    const start = (iconPath, key, onclick) => el("button.solve-start", { type: "button", onclick: () => whenAvailable(onclick) }, [
      el("span.solve-start__ic", { "aria-hidden": "true" }, icon(iconPath, 18)),
      el("span.solve-start__txt", {}, [el("strong", {}, t(`solve.start.${key}`)), el("small", {}, t(`solve.start.${key}Sub`))]),
    ]);
    const setChip = el("button.chatmode", { type: "button", onclick: () => whenAvailable(() => {
      refs.inputEl.value = t("solve.start.setPrefill");
      autosize();
      refs.inputEl.focus();
      refs.inputEl.setSelectionRange(refs.inputEl.value.length, refs.inputEl.value.length);
    }) }, [icon(ICONS.layers, 16), el("span.chatmode__label", {}, t("solve.start.set"))]);
    const mark = mode
      ? el("span.ai-tile", { style: { "--s": "60px" }, "aria-hidden": "true" }, icon(ICONS[mode.icon] || ICONS.spark, 30))
      : aiTile(60);
    mark.classList.add("solve-hero__mark");
    // Phones (css/app.css, "PluggEra AI on a phone"): two ways in sit by the composer, and "Fler" opens the
    // rest in a panel above them. On wider screens .solve-ways lays out as before and .solve-quick is hidden.
    const ways = mode ? null : el("div.solve-ways", { id: "solve-ways" }, [
      el("div.solve-starts", {}, [
        start(ICONS.camera, "photo", () => refs.fileInput.click()),
        start(ICONS.check, "check", () => { location.hash = "#/solve?mode=check"; }),
        start(ICONS.target, "quiz", () => pickMode("quiz")),
        start(ICONS.spark, "explain", () => pickMode("explain")),
      ]),
      el("div.solve-more", {}, [
        el("p.solve-more__label", {}, t("solve.moreWays")),
        el("div.chatmodes", { role: "group", "aria-label": t("chat.modesLabel") }, [...refs.modeBtns, setChip]),
      ]),
    ]);
    const quickChip = (iconPath, id) => el("button.chatmode", { type: "button", onclick: () => whenAvailable(() => pickMode(id)) },
      [icon(iconPath, 16), el("span.chatmode__label", {}, t(`chat.mode.${id}`))]);
    const moreBtn = mode ? null : el("button.chatmode.solve-quick__more", {
      type: "button", "aria-expanded": "false", "aria-controls": "solve-ways", onclick: () => setWaysOpen(!refs.hero.classList.contains("is-open")),
    }, [icon(ICONS.chevronDown, 16), el("span.chatmode__label", {}, t("solve.moreBtn"))]);
    // While the panel is open: Escape anywhere, or a tap outside it and its button, closes it.
    const onKey = (e) => { if (e.key === "Escape") { setWaysOpen(false); moreBtn.focus(); } };
    const onTapOutside = (e) => { if (!ways.contains(e.target) && !moreBtn.contains(e.target)) setWaysOpen(false); };
    function setWaysOpen(open) {
      refs.hero.classList.toggle("is-open", open);
      moreBtn.setAttribute("aria-expanded", String(open));
      moreBtn.replaceChildren(icon(open ? ICONS.close : ICONS.chevronDown, 16), el("span.chatmode__label", {}, t(open ? "common.close" : "solve.moreBtn")));
      document[open ? "addEventListener" : "removeEventListener"]("keydown", onKey);
      document[open ? "addEventListener" : "removeEventListener"]("pointerdown", onTapOutside, true);
      if (open) ways.querySelector("button:not([hidden])")?.focus({ preventScroll: true });
    }
    // Picking a way in closes the panel (a mode redraws the greeting anyway; a photo or a prefill doesn't).
    ways?.addEventListener("click", (e) => { if (e.target.closest("button")) setWaysOpen(false); });
    refs.hero = el("div.solve-hero" + (mode ? "" : ".solve-hero--home"), {}, [
      // The side menu's halo behind the tile on a phone; a computer's greeting has its own (.solve-hero::before).
      mode ? mark : el("span.solve-hero__glow.ai-halo", {}, mark),
      el("h2.solve-hero__title", {}, mode ? t(`chat.mode.${mode.id}`) : t("solve.heroTitle")),
      el("div.solve-hero__sub", { html: markdown(sub) }),
      ways,
      mode ? null : el("div.solve-quick", {}, [quickChip(ICONS.target, "quiz"), quickChip(ICONS.spark, "explain"), moreBtn]),
    ].filter(Boolean));
    refs.logEl.appendChild(refs.hero);
  }

  /** A way in that needs the AI: runs it, or says why not — signed out, it goes to the sign-in page and
   *  back here, so the ways in stay readable instead of greyed out. */
  function whenAvailable(fn) {
    if (canChat) return fn();
    if (store.aiNeedsSignIn()) { location.hash = SIGN_IN_HREF; return; }
    toast(blockedToast());
  }

  function appendUserBubble(text, imgSrc) {
    refs.hero?.remove();
    refs.hero = null;
    const node = el("div.msg.me", {});
    if (imgSrc) node.appendChild(el("img.msg__img", { src: imgSrc, alt: "" }));
    if (text) node.appendChild(el("span", { html: escapeHtml(text.length > ECHO_CHARS ? `${text.slice(0, ECHO_CHARS)}…` : text) }));
    refs.logEl.appendChild(node);
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
  }

  async function attachImage(file) {
    try {
      state.pendingImage = await shrinkImage(file);
    } catch (err) {
      toast(err.message || t("err.readFile"));
      return;
    }
    renderPending();
  }

  function renderPending() {
    clear(refs.pendingEl);
    refs.pendingEl.hidden = !state.pendingImage;
    if (!state.pendingImage) return;
    refs.pendingEl.appendChild(el("img", { src: state.pendingImage.preview, alt: "" }));
    refs.pendingEl.appendChild(el("button.iconbtn.iconbtn--sm", {
      type: "button", "aria-label": t("solve.removeImage"),
      onclick: () => { state.pendingImage = null; renderPending(); },
    }, [icon(ICONS.close, 14)]));
  }

  /** A fresh conversation, opened with whatever the current mode (or the default persona)
   *  leads with. Cuts an in-flight reply off first — switching mode mid-stream must not let
   *  the old answer land in the new, just-cleared thread. */
  function resetChat({ keepMaterial = false } = {}) {
    state.abort?.abort();
    state.messages = [];
    state.cards = [];
    state.pendingImage = null;
    state.busy = false;
    state.chatId = newChatId();
    if (!keepMaterial) state.material = null;
    paintChatting();
    showChat();
    clear(refs.logEl);
    refs.hero = null;
    appendWelcome();
    renderPending();
    refs.inputEl.value = "";
    autosize();
    refs.resetBtn.hidden = true;
    paintAvailability();
    paintModes();
    paintMaterial();
    if (canChat) refs.inputEl.focus();
  }

  function pickMode(id) {
    // Every finished exchange is already in "Tidigare chattar" (persist(), above) — so switching mode
    // mid-conversation doesn't lose it, just leaves it. Say so, since starting a blank thread with no
    // warning reads as if a running quiz just vanished.
    const hadChat = state.messages.length > 0;
    state.mode = state.mode === id ? null : id;   // tap the active one again to go back to the default persona
    resetChat({ keepMaterial: true });            // a new thread, but "quiz me" on the set you attached is the point
    if (hadChat) toast(t("solve.chatSavedToast"));
  }

  /** Open a saved chat: its mode, its material and every message, ready to carry on. */
  function restoreChat(chat) {
    state.abort?.abort();
    state.chatId = chat.id;
    state.mode = isStudyMode(chat.mode) ? chat.mode : null;
    state.material = chat.material || null;
    state.cards = [];
    state.pendingImage = null;
    state.busy = false;
    state.messages = chat.messages.map((m) => ({
      role: m.role,
      content: m.img ? `${m.content}\n${t("solve.imageSent")}`.trim() : m.content,
    }));
    showChat();
    paintChatting();
    clear(refs.logEl);
    refs.hero = null;
    if (!state.messages.length) appendWelcome();
    for (const m of state.messages) {
      if (m.role === "user") appendUserBubble(m.content);
      else renderReply(appendBubble("ai", ""), m.content, true);
    }
    renderPending();
    refs.inputEl.value = "";
    autosize();
    refs.resetBtn.hidden = false;
    paintAvailability();
    paintModes();
    paintMaterial();
    refs.logEl.scrollTop = refs.logEl.scrollHeight;
  }

  /** Once there is a conversation the page trades its chrome for room to read: see .solve.is-chatting. */
  function paintChatting() {
    root.classList.toggle("is-chatting", state.messages.length > 0);
  }

  /** Re-reads store.canUseAI() live — called at mount and again on every store "change" (a quota hit,
   *  a sign-in), so the composer and mode tiles never go stale until the student leaves and returns. */
  function paintAvailability() {
    canChat = head.paint();
    refs.inputEl.disabled = !canChat;
    refs.attachBtn.disabled = !canChat;
    refs.sendBtn.disabled = !canChat;
    paintGate();
  }

  /** Where the composer is, when the AI is off: signed out, a sign-in card in its place; otherwise
   *  (quota, no server) a short note above the disabled box. A persistent container, so it can be swapped
   *  in and out live, not just decided once at build time. While the history list is open, none of it. */
  function paintGate() {
    clear(refs.gateEl);
    const away = !!refs.history;
    const signIn = !canChat && store.aiNeedsSignIn();
    refs.gateEl.hidden = canChat || away;
    refs.formEl.hidden = signIn || away;
    refs.hintEl.hidden = signIn || away;
    if (!canChat) refs.gateEl.appendChild(gateNote());
  }

  /** The chip above the input: which set or file the answers come from, and how much of it fits. */
  function paintMaterial() {
    const m = state.material;
    clear(refs.materialEl);
    refs.materialEl.hidden = !m;
    if (m) {
      const cut = m.kind === "set"
        ? (m.used < m.count ? t("solve.materialCutSet", { used: m.used, count: m.count }) : "")
        : (m.cut ? t("solve.materialCut", { n: m.text.length }) : "");
      refs.materialEl.appendChild(icon(m.kind === "set" ? ICONS.book : ICONS.fileText, 16));
      refs.materialEl.appendChild(el("span.matchip__txt", {}, [
        el("b", {}, m.title),
        el("small", {}, [m.kind === "set" ? t("solve.materialKindSet") : t("solve.materialKindFile"), m.kind === "set" ? plural(m.count, "solve.materialQuestionsOne", "solve.materialQuestionsMany", { n: m.count }) : "", cut].filter(Boolean).join(" · ")),
      ]));
      refs.materialEl.appendChild(el("button.iconbtn.iconbtn--sm", {
        type: "button", "aria-label": t("solve.materialRemove"), title: t("solve.materialRemove"),
        onclick: () => { state.material = null; paintMaterial(); persist(); refs.inputEl.focus(); },
      }, icon(ICONS.close, 14)));
    }
    paintModes();   // the placeholder depends on whether material is attached
  }

  function showHistory() {
    refs.history?.node.remove();
    refs.history = chatHistoryPanel({
      activeId: state.chatId,
      onOpen: restoreChat,
      onNew: () => resetChat(),
      onBack: showChat,
    });
    refs.panel.appendChild(refs.history.node);
    refs.logEl.hidden = true;
    paintGate();
    refs.historyBtn.setAttribute("aria-pressed", "true");
  }

  function showChat() {
    refs.history?.node.remove();
    refs.history = null;
    refs.logEl.hidden = false;
    paintGate();
    refs.historyBtn.setAttribute("aria-pressed", "false");
  }

  /** The box's placeholder, and — while a way of studying is on — its name as a pill above the box, with
   *  a cross back to the default help. */
  function paintModes() {
    refs.inputEl.placeholder = placeholderText();
    refs.inputEl.setAttribute("aria-label", placeholderText());
    const mode = state.mode ? STUDY_MODES.find((m) => m.id === state.mode) : null;
    clear(refs.modePill);
    refs.modePill.hidden = !mode;
    if (mode) {
      refs.modePill.append(
        icon(ICONS[mode.icon] || ICONS.spark, 14),
        el("span", {}, t(`chat.mode.${mode.id}`)),
        el("button.solve-modepill__x", {
          type: "button", "aria-label": t("solve.modeExit"), title: t("solve.modeExit"), onclick: () => pickMode(mode.id),
        }, icon(ICONS.close, 14)),
      );
    }
  }

  function autosize() {
    const ta = refs.inputEl;
    ta.style.height = "auto";
    // A long paste scrolls inside the box instead of pushing the conversation off the screen.
    ta.style.height = `${Math.min(ta.scrollHeight, Math.round(Math.min(180, window.innerHeight * 0.28)))}px`;
  }

  async function send() {
    if (state.busy) return;
    document.querySelectorAll(".chatquick").forEach((n) => n.remove());   // answered now, one way or another
    const text = refs.inputEl.value.trim();
    if (!text && !state.pendingImage) return;
    if (text.length > MAX_INPUT_CHARS) { toast(t("chat.tooLong", { n: MAX_INPUT_CHARS })); return; }

    const img = state.pendingImage;
    state.messages.push({
      role: "user",
      content: img
        ? [
            { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
            { type: "text", text: text || t("solve.chatSeedText") },
          ]
        : text,
    });
    appendUserBubble(text, img?.preview);
    state.pendingImage = null;
    renderPending();
    refs.inputEl.value = "";
    autosize();
    refs.resetBtn.hidden = false;
    paintChatting();

    await streamReply();
  }

  async function streamReply() {
    state.busy = true;
    refs.inputEl.disabled = true;
    refs.attachBtn.disabled = true;
    refs.sendBtn.disabled = true;
    setMood(head.mascotEl, "thinking");
    const bubble = appendBubble("ai", `<span class="typing"><span></span><span></span><span></span></span>`);
    state.abort = new AbortController();
    const mine = state.abort;
    let acc = "";
    let stopReason = null;
    try {
      for await (const chunk of tutorStream({
        system: (state.mode ? studyChatSystem(state.mode) : solveChatSystem()) + materialSystemBlock(state.material),
        messages: trimHistory(state.messages.map((m) => (m.role === "assistant" && typeof m.content === "string"
          ? { ...m, content: withoutSetId(m.content) } : m))),
        signal: mine.signal,
        onStop: (r) => { stopReason = r; },
      })) {
        acc += chunk;
        renderReply(bubble, acc, false);
        followReply(bubble);
      }
      if (!acc.trim()) {
        // A real (if unhelpful) reply, not an error — don't leave the typing dots spinning forever,
        // and don't store an assistant turn that only ever said "…".
        bubble.textContent = t("tutor.emptyReply");
        bubble.classList.add("msg--error");
      } else {
        state.messages.push({ role: "assistant", content: acc });
        renderReply(bubble, acc, true);
        if (stopReason === "max_tokens") bubble.appendChild(el("p.msg__errnote", {}, t("tutor.truncated")));
        announce(t("tutor.prefix", { text: extractSetBrief(acc).text }));
      }
      persist();
    } catch (e) {
      if (mine.signal.aborted) return;   // resetChat() already cleared this thread — nothing left to update
      const msg = e instanceof ClaudeError ? e.message : t("tutor.snag");
      if (acc.trim()) {
        // Something real was under way when it broke — keep it on screen and note the error
        // underneath, rather than wiping a partial answer the student could already read.
        renderReply(bubble, acc, false);
        bubble.appendChild(el("p.msg__errnote", {}, msg));
      } else {
        bubble.textContent = msg;
        bubble.classList.add("msg--error");
      }
      state.messages.pop();   // the failed question isn't part of the history; they can send it again
      paintChatting();
      persist();
      toast(msg);
    } finally {
      if (state.abort === mine) {
        state.busy = false;
        paintAvailability();
        setMood(head.mascotEl, "idle");
        if (canChat) refs.inputEl.focus();
      }
    }
  }

  function gateNote() {
    if (store.aiBlockReason() === "quota") return aiQuotaNote();
    return store.aiNeedsSignIn()
      ? el("div.solve-signin", {}, [
          el("p", {}, t("solve.signInCta")),
          el("a.btn", { href: SIGN_IN_HREF }, t("login.signIn")),
        ])
      : el("p.note.note--warn", {}, [
          t("solve.noServerHere"),
          el("a", { href: "#/library" }, t("solve.noServerAlt")),
        ]);
  }

  function build() {
    const logEl = el("div.solve-chat__log", { "aria-live": "off", tabindex: "0", "aria-label": t("tutor.convAria") });
    const pendingEl = el("div.solve-chat__pending", { hidden: true });

    const fileInput = el("input", {
      type: "file", accept: "image/*", capture: "environment", style: { display: "none" },
      onchange: async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (file) await attachImage(file);
      },
    });

    const inputEl = el("textarea.solve-dock__input", {
      rows: 1,
      placeholder: placeholderText(), "aria-label": placeholderText(),
      oninput: autosize,
      // Enter sends; Shift+Enter is a new line — pasted notes need multiple lines.
      onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } },
    });

    // One "+" for both things you can add — a picture, or a set / file to base the answers on.
    const attachItem = (iconPath, label, onclick) => el("button.cardmenu__item", {
      type: "button", role: "menuitem", onclick: () => { closePopover(); onclick(); },
    }, [icon(iconPath, 18), label]);
    const attachBtn = el("button.iconbtn.solve-dock__add", {
      type: "button", "aria-label": t("solve.attachMenu"), title: t("solve.attachMenu"), "aria-haspopup": "menu",
      onclick: (e) => {
        e.stopPropagation();
        if (document.querySelector(".popover.solve-addmenu")) { closePopover(); return; }
        openPopover(attachBtn, [
          attachItem(ICONS.camera, t("solve.attachLabel"), () => fileInput.click()),
          attachItem(ICONS.paperclip, t("solve.attachMaterial"), () => openMaterialPicker({
            onPick: (m) => { state.material = m; paintMaterial(); persist(); refs.inputEl.focus(); },
          })),
        ], { placement: "above", width: 240, label: t("solve.attachMenu") }).classList.add("solve-addmenu");
      },
    }, [icon(ICONS.plus, 20)]);
    const materialEl = el("div.matchip", { hidden: true });
    const modePill = el("div.solve-modepill", { hidden: true });

    const sendBtn = el("button.iconbtn.solve-dock__send", { type: "submit", "aria-label": t("tutor.send") }, [icon(ICONS.arrow, 18)]);

    // "Ny konversation": a pencil beside history, once there is something to start over from.
    const resetBtn = el("button.iconbtn.solve-chat__reset", {
      type: "button", hidden: true, "aria-label": t("solve.newChat"), title: t("solve.newChat"), onclick: () => resetChat(),
    }, [icon(ICONS.pencil, 18)]);
    const historyBtn = el("button.iconbtn.solvehead__hist", {
      type: "button", "aria-label": t("solve.historyOpen"), title: t("solve.historyOpen"), "aria-pressed": "false",
      onclick: () => (refs.history ? showChat() : showHistory()),
    }, [icon(ICONS.clock, 18)]);

    // The ways to study besides the two starters (quiz me, explain), as chips in the empty conversation.
    // Picking one starts a thread in that mode; the composer then names it in a pill (paintModes).
    const modeBtns = STUDY_MODES.filter((m) => m.id !== "quiz" && m.id !== "explain").map((m) => el("button.chatmode", {
      type: "button", "data-mode": m.id, onclick: () => whenAvailable(() => pickMode(m.id)),
    }, [icon(ICONS[m.icon] || ICONS.spark, 16), el("span.chatmode__label", {}, t(`chat.mode.${m.id}`))]));

    // Computers only (css): a phone has no Shift key to remember.
    const hintEl = el("p.solve-dock__hint", {}, t("solve.enterHint"));

    // The composer: what is attached (a set, a picture, the way of studying) above one bar — "+", the box, send.
    const formEl = el("form.solve-dock", { onsubmit: (e) => { e.preventDefault(); send(); } }, [
      fileInput,
      materialEl,
      pendingEl,
      modePill,
      el("div.solve-dock__bar", {}, [attachBtn, inputEl, sendBtn]),
    ]);

    const gateEl = el("div.solve-gate", { hidden: true });

    refs = {
      logEl, pendingEl, inputEl, attachBtn, materialEl, modePill, sendBtn, hintEl, fileInput,
      resetBtn, historyBtn, modeBtns, gateEl, formEl, panel: null, history: null, hero: null,
    };

    head = aiHead([resetBtn, historyBtn]);
    root.appendChild(homeButton({ grid: true }));
    root.appendChild(head.node);
    const panel = el("div.solve-chat.solve-chat__panel", {}, [
      logEl,
      gateEl,
      formEl,
      hintEl,
      el("div.solve-chat__drop", { "aria-hidden": "true" }, t("solve.dropHere")),
    ]);
    refs.panel = panel;
    root.appendChild(panel);

    paintAvailability();
    paintModes();
    paintMaterial();
    appendWelcome();
    // Drag a picture onto the page, or paste one anywhere — focused or not.
    // Signed out, a drop is still caught (otherwise the browser opens the image
    // and the visitor loses the page) and answered with the reason instead.
    bindFileTargets(panel, {
      accept: "image/*", paste: canChat,
      // Drop is always caught (see the comment above), so it must check live availability, not the
      // moment this listener was bound — otherwise signing in mid-page leaves it stuck on the toast.
      onFiles: ([file]) => (canChat ? attachImage(file) : toast(blockedToast())),
      onReject: () => toast(t("err.imageType")),
    });
  }

  /** A language switch (see main.js's "sb:langchange"): re-labels every piece of chrome in place —
   *  mode tiles, tabs, hints, the gate note, the identity strip — without touching the conversation
   *  itself. The welcome bubble is chrome too (it's the mode's own instructional opener, not something
   *  the student wrote or the AI answered), so it's redrawn along with everything else, but only while
   *  no real exchange has happened yet. */
  function onLangSession() {
    document.title = `${t("solve.pageTitle")} · PluggEra`;
    for (const btn of refs.modeBtns) btn.querySelector(".chatmode__label").textContent = t(`chat.mode.${btn.dataset.mode}`);
    refs.hintEl.textContent = t("solve.enterHint");
    refs.resetBtn.title = t("solve.newChat");
    refs.resetBtn.setAttribute("aria-label", t("solve.newChat"));
    refs.historyBtn.title = t("solve.historyOpen");
    refs.historyBtn.setAttribute("aria-label", t("solve.historyOpen"));
    refs.attachBtn.title = t("solve.attachMenu");
    refs.attachBtn.setAttribute("aria-label", t("solve.attachMenu"));
    refs.sendBtn.setAttribute("aria-label", t("tutor.send"));
    head.paint();
    paintModes();
    paintMaterial();
    paintGate();
    if (state.messages.length === 0 && !refs.history) {
      clear(refs.logEl);
      appendWelcome();
    }
    refs.history?.refresh();
  }

  build();
  window.addEventListener("sb:langsession", onLangSession);
  store.addEventListener("change", paintAvailability);
  setSessionActive(true);   // so a language switch relabels this page in place (see onLangSession) instead of rebuilding it
  return {
    title: t("solve.pageTitle"),
    node: root,
    cleanup: () => {
      mounted = false;
      state.abort?.abort();
      window.removeEventListener("sb:langsession", onLangSession);
      store.removeEventListener("change", paintAvailability);
      setSessionActive(false);
    },
  };
}

/** The toast for a picture dropped on the page while the AI is off, worded for the actual reason. */
function blockedToast() {
  const why = store.aiBlockReason();
  return why === "signin" ? t("err.notSignedIn") : why === "quota" ? t("err.quotaExceeded") : t("solve.noServerHere").trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
