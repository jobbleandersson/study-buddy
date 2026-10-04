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
import { solveTabs } from "../components/solve-tabs.js";
import { aiQuotaNote } from "../components/ai-gate.js";
import { aiHead } from "../components/ai-head.js";
import { setMood } from "../components/mascot.js";
import { openMaterialPicker } from "../components/material-picker.js";
import { chatHistoryPanel } from "../components/chat-history-panel.js";
import { materialSystemBlock, extractSourceRefs } from "../lib/chat-material.js";
import { newChatId, saveChat, chatTitle, addSaved, removeSaved, findSaved } from "../lib/chat-history.js";
import { setSessionActive } from "../lib/session-active.js";
import { localDayKey } from "../lib/activity.js";
import { fmtDate } from "../lib/i18n.js";

/** How much of a long pasted text is echoed back in the student's own bubble — the message
 *  sent to the model is never truncated, only what's shown (a page of notes shouldn't make
 *  the transcript unscrollable). */
const ECHO_CHARS = 600;

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
    refs.logEl.appendChild(who === "ai"
      ? el("div.msgrow", {}, [el("span.msgrow__av", { "aria-hidden": "true" }, icon(ICONS.spark, 15)), node])
      : node);
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

  /** The empty conversation: a centred greeting — the mark, a heading, the mode's own intro —
   *  and, for the default persona, four ways to start. Gone as soon as the first message lands. */
  function appendWelcome() {
    refs.hero?.remove();
    const mode = state.mode ? STUDY_MODES.find((m) => m.id === state.mode) : null;
    // A mode's intro opens with its name in bold; the heading already says it.
    const sub = mode ? introText().replace(/^\*\*[^*]+\*\*\s*/, "") : t("solve.heroSub");
    const start = (iconPath, key, onclick) => el("button.solve-start", { type: "button", onclick, disabled: !canChat }, [
      el("span.solve-start__ic", { "aria-hidden": "true" }, icon(iconPath, 18)),
      el("span.solve-start__txt", {}, [el("strong", {}, t(`solve.start.${key}`)), el("small", {}, t(`solve.start.${key}Sub`))]),
    ]);
    refs.hero = el("div.solve-hero", {}, [
      el("div.solve-hero__mark", { "aria-hidden": "true" }, icon(mode ? ICONS[mode.icon] || ICONS.spark : ICONS.spark, 30)),
      el("h2.solve-hero__title", {}, mode ? t(`chat.mode.${mode.id}`) : t("solve.heroTitle")),
      el("div.solve-hero__sub", { html: markdown(sub) }),
      mode ? null : el("div.solve-starts", {}, [
        start(ICONS.camera, "photo", () => refs.fileInput.click()),
        start(ICONS.target, "quiz", () => pickMode("quiz")),
        start(ICONS.spark, "explain", () => pickMode("explain")),
        start(ICONS.layers, "set", () => {
          refs.inputEl.value = t("solve.start.setPrefill");
          autosize();
          refs.inputEl.focus();
          refs.inputEl.setSelectionRange(refs.inputEl.value.length, refs.inputEl.value.length);
        }),
      ]),
    ].filter(Boolean));
    refs.logEl.appendChild(refs.hero);
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
    refs.materialBtn.disabled = !canChat;
    refs.sendBtn.disabled = !canChat;
    for (const btn of refs.modeBtns) btn.disabled = !canChat;
    refs.hero?.querySelectorAll(".solve-start").forEach((b) => { b.disabled = !canChat; });
    paintGate();
  }

  /** The note above the log explaining why the AI is off (sign in / quota / no server) — a persistent
   *  container so it can be swapped in and out live, not just decided once at build time. */
  function paintGate() {
    clear(refs.gateEl);
    refs.gateEl.hidden = canChat;
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
    refs.formEl.hidden = true;
    refs.historyBtn.setAttribute("aria-pressed", "true");
  }

  function showChat() {
    refs.history?.node.remove();
    refs.history = null;
    refs.logEl.hidden = false;
    refs.formEl.hidden = false;
    refs.historyBtn.setAttribute("aria-pressed", "false");
  }

  function paintModes() {
    for (const btn of refs.modeBtns) {
      const on = btn.dataset.mode === state.mode;
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("is-on", on);
    }
    refs.inputEl.placeholder = placeholderText();
    refs.inputEl.setAttribute("aria-label", placeholderText());
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
    refs.materialBtn.disabled = true;
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
    if (store.aiBlockReason() === "quota") return aiQuotaNote({ style: { marginBottom: "16px" } });
    return store.aiNeedsSignIn()
      ? el("p.note", { style: { marginBottom: "16px" } }, [
          t("solve.needSignIn"),
          el("a", { href: "#/login" }, t("solve.needSignInLink")),
          t("solve.needSignInTail"),
        ])
      : el("p.note.note--warn", { style: { marginBottom: "16px" } }, [
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

    const attachBtn = el("button.iconbtn", {
      type: "button", "aria-label": t("solve.attachLabel"), title: t("solve.uploadHint"),
      onclick: () => fileInput.click(),
    }, [icon(ICONS.camera, 18)]);

    const materialBtn = el("button.iconbtn", {
      type: "button", "aria-label": t("solve.attachMaterial"), title: t("solve.attachMaterial"),
      onclick: () => openMaterialPicker({
        onPick: (m) => { state.material = m; paintMaterial(); persist(); refs.inputEl.focus(); },
      }),
    }, [icon(ICONS.paperclip, 18)]);
    const materialEl = el("div.matchip", { hidden: true });

    const sendBtn = el("button.iconbtn.solve-dock__send", { type: "submit", "aria-label": t("tutor.send") }, [icon(ICONS.arrow, 18)]);

    // "Ny konversation" — a plus and the words; on a phone just the plus (the words stay for screen readers).
    const resetBtn = el("button.linkbtn.solve-chat__reset", { type: "button", hidden: true, title: t("solve.newChat"), onclick: () => resetChat() },
      [icon(ICONS.plus, 16), el("span.solve-chat__resetlabel", {}, t("solve.newChat"))]);
    const historyBtn = el("button.iconbtn.solvehead__hist", {
      type: "button", "aria-label": t("solve.historyOpen"), title: t("solve.historyOpen"), "aria-pressed": "false",
      onclick: () => (refs.history ? showChat() : showHistory()),
    }, [icon(ICONS.clock, 18)]);

    const modeBtns = STUDY_MODES.map((m) => el("button.chatmode", {
      type: "button", "data-mode": m.id, "aria-pressed": "false", title: t(`chat.mode.${m.id}`), onclick: () => pickMode(m.id),
    // The label is a span so a phone in mid-conversation can show the seven tiles as icons only (css) and
    // still keep the name for screen readers and as a tooltip.
    }, [icon(ICONS[m.icon] || ICONS.spark, 18), el("span.chatmode__label", {}, t(`chat.mode.${m.id}`))]));

    const hintEl = el("span.solve-dock__hint", {}, t("solve.enterHint"));

    // One docked card: the box, attach + send under it, and the seven ways to study as a row of chips.
    const formEl = el("form.solve-dock", { onsubmit: (e) => { e.preventDefault(); send(); } }, [
      fileInput,
      materialEl,
      pendingEl,
      inputEl,
      el("div.solve-dock__row", {}, [attachBtn, materialBtn, hintEl, sendBtn]),
      el("div.chatmodes", { role: "group", "aria-label": t("chat.modesLabel") }, modeBtns),
    ]);

    const gateEl = el("div.solve-gate", { hidden: true });
    const tabsEl = solveTabs("help");

    refs = {
      logEl, pendingEl, inputEl, attachBtn, materialBtn, materialEl, sendBtn, hintEl, fileInput,
      resetBtn, historyBtn, modeBtns, gateEl, tabsEl, formEl, panel: null, history: null, hero: null,
    };

    head = aiHead([resetBtn, historyBtn]);
    root.appendChild(homeButton({ grid: true }));
    root.appendChild(head.node);
    root.appendChild(tabsEl);
    const panel = el("div.solve-chat.solve-chat__panel", {}, [
      gateEl,
      logEl,
      formEl,
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
    for (const btn of refs.modeBtns) {
      const label = t(`chat.mode.${btn.dataset.mode}`);
      btn.title = label;
      btn.querySelector(".chatmode__label").textContent = label;
    }
    refs.hintEl.textContent = t("solve.enterHint");
    refs.resetBtn.querySelector(".solve-chat__resetlabel").textContent = t("solve.newChat");
    refs.resetBtn.title = t("solve.newChat");
    refs.historyBtn.title = t("solve.historyOpen");
    refs.historyBtn.setAttribute("aria-label", t("solve.historyOpen"));
    refs.attachBtn.title = t("solve.uploadHint");
    refs.attachBtn.setAttribute("aria-label", t("solve.attachLabel"));
    refs.materialBtn.title = t("solve.attachMaterial");
    refs.materialBtn.setAttribute("aria-label", t("solve.attachMaterial"));
    refs.sendBtn.setAttribute("aria-label", t("tutor.send"));
    const newTabs = solveTabs("help");
    refs.tabsEl.replaceWith(newTabs);
    refs.tabsEl = newTabs;
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
