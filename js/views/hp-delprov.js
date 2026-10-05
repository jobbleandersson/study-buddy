// One Högskoleprov delprov at #/hp/<dp>: set up a practice run (training or on the clock, how many,
// extended time, marked as you go or at the end), browse and filter every question the student has
// for it, have the AI write more in the test's format, and look back at earlier runs.
//
// The delprov's sets (its övningsprov, the ORD word bank) are added to the student's library the
// first time the page is opened, like the hub's tiles always did — there's no separate "add" step.

import { store } from "../store.js";
import { el, clear, icon, ICONS, toast } from "../lib/dom.js";
import { t, fmtDate, sentenceCase } from "../lib/i18n.js";
import { localDayKey, addDays } from "../lib/activity.js";
import { renderRich } from "../lib/rich.js";
import { loadHpIndex, isHpImported, importHpSet } from "../data/hp-content.js";
import {
  isHpSetId, parseHpSetId, partOf, PASS_COUNT, SEC_PER_Q, CALIBRATION_N, minutesFor,
  questionHistory, delprovStats, delprovEstimate, NORM_TABLES,
} from "../lib/hp.js";
import { AI_DELPROV, MORE_HP, addHpQuestions, isAddingHp } from "../components/hp-more.js";
import { ClaudeError } from "../claude.js";
import { sparkline } from "../lib/spark.js";

const fmtN = (n) => (n == null ? "–" : Number(n).toFixed(2).replace(".", ","));
const LIST_STEP = 30;

// The setup the student last chose, per visit (not saved): mode, count, extended time, marking.
const setup = { mode: "train", n: null, ext: false, marked: true };

/** Every question of this delprov in the student's HP sets, with the set it lives in. */
function delprovQuestions(dp) {
  const out = [];
  for (const a of store.assignments) {
    if (!isHpSetId(a.id)) continue;
    const setDp = parseHpSetId(a.id).delprov;
    for (const q of a.questions) if ((q.variant || setDp) === dp) out.push({ q, set: a });
  }
  return out;
}

function sourceOf(set) {
  const ref = parseHpSetId(set.id);
  if (/-ai$/.test(set.id)) return { label: t("hp.srcAi"), ai: true };
  if (ref.test) return { label: NORM_TABLES[ref.test]?.label || t("hp.srcPractice") };
  return { label: set.title };
}

const plainPrompt = (q) => {
  const s = String(q.prompt || "").replace(/\s+/g, " ").trim();
  return s.length > 110 ? `${s.slice(0, 107)}…` : s;
};

export async function renderHpDelprov(dp, qs) {
  // Add this delprov's own sets the first time the page is opened.
  try {
    const index = await loadHpIndex();
    for (const s of index.sets.filter((x) => x.subject === `hp-${dp}`)) {
      if (!isHpImported(s.id)) await importHpSet(s);
    }
  } catch { /* offline or the index failed: the page works with whatever is already there */ }

  const root = el("div.hp-dp", { style: { "--c": partOf(dp) === "kvant" ? "var(--c-tangerine)" : "var(--brand)" } });
  let tab = ["historik", "analys"].includes(qs?.get?.("tab")) ? qs.get("tab") : "ova";
  let topic = "", status = "", shown = LIST_STEP;
  const body = el("div.hp-dp__body");

  const tabBtn = (key, label) => el("button.hp-dp__tab", {
    type: "button", role: "tab", "aria-selected": String(tab === key),
    onclick: () => { tab = key; paint(); },
  }, label);

  function header() {
    const stats = delprovStats(store.attempts, (id) => store.findQuestion(id)?.question.variant || null)[dp];
    const level = stats && stats.answered ? delprovEstimate({ delprov: dp, correct: stats.correct, total: stats.answered }).normed : null;
    const timedN = Math.min(stats?.timed || 0, CALIBRATION_N);
    return el("header.hp-dp__head", {}, [
      el("a.homebtn", { href: "#/hp" }, [icon(ICONS.back, 16), t("hp.pageTitle")]),
      el("p.hp-dp__code", {}, t(`hp.delprov.${dp}`)),
      el("h1", {}, t(`hp.name.${dp}`)),
      el("p.hp-dp__about", {}, t(`hp.about.${dp}`)),
      el("div.hp-dp__level", {}, [
        el("span", {}, [t("hp.levelLabel"), " ", el("strong", {}, fmtN(level))]),
        el("span.hp-calib", { title: t("hp.calibTip", { n: CALIBRATION_N }) }, [
          el("span.hp-calib__bar", { "aria-hidden": "true" }, [el("i", { style: { width: `${(timedN / CALIBRATION_N) * 100}%` } })]),
          t("hp.calibCount", { n: timedN, of: CALIBRATION_N }),
        ]),
      ]),
      el("div.hp-dp__tabs", { role: "tablist" }, [
        tabBtn("ova", t("hp.tabPractice")), tabBtn("historik", t("hp.tabHistory")), tabBtn("analys", t("hp.tabAnalysis")),
      ]),
    ]);
  }

  /* ---- Öva: the setup ---- */
  function setupCard(poolSize) {
    const full = PASS_COUNT[dp];
    const n = setup.n || full;
    const seg = (key, label) => el("button.hp-seg__opt", {
      type: "button", "aria-pressed": String(setup.mode === key), onclick: () => { setup.mode = key; paint(); },
    }, label);
    const countBtn = (v, label) => el("button.hp-count", {
      type: "button", "aria-pressed": String(n === v), onclick: () => { setup.n = v; paint(); },
    }, label);
    const timed = setup.mode === "timed";
    const toggle = (key, label, sub) => el("label.hp-toggle", {}, [
      el("input", { type: "checkbox", checked: !!setup[key], onchange: (e) => { setup[key] = e.target.checked; paint(); } }),
      el("span", {}, [el("strong", {}, label), el("small", {}, sub)]),
    ]);
    const count = Math.min(n, poolSize);
    const q = new URLSearchParams({ n: String(count) });
    if (timed) { q.set("mode", "timed"); if (!setup.marked) q.set("fb", "0"); }
    if (timed && setup.ext) q.set("ext", "1");
    const summary = timed
      ? t("hp.setupSumTimed", { n: count, m: minutesFor(dp, count, { extended: setup.ext }) })
      : t("hp.setupSumTrain", { n: count });

    return el("section.set-card.hp-setup", { "aria-labelledby": "hp-setup-title" }, [
      el("h2#hp-setup-title", {}, t("hp.setupTitle")),
      el("p.note", {}, t("hp.setupSub")),
      el("div.hp-seg", { role: "group", "aria-label": t("hp.setupMode") }, [seg("train", t("hp.modeTrain")), seg("timed", t("hp.modeTimed"))]),
      el("p.hp-setup__modehint", {}, t(timed ? "hp.modeTimedSub" : "hp.modeTrainSub", { s: SEC_PER_Q[dp] })),
      el("div.hp-counts", { role: "group", "aria-label": t("hp.setupCount") }, [
        ...[5, 10, 15].filter((v) => v < full || v === 5).map((v) => countBtn(v, String(v))),
        countBtn(full, t("hp.countFull", { n: full })),
      ]),
      timed ? el("div.hp-toggles", {}, [
        toggle("ext", t("hp.extTitle"), t("hp.extSub")),
        toggle("marked", t("hp.markTitle"), t("hp.markSub")),
      ]) : null,
      count < n ? el("p.note", {}, t("hp.setupFewer", { n: poolSize })) : null,
      el("div.hp-setup__go", {}, [
        el("a.btn", { href: `#/hp/ova/${dp}?${q}` }, [icon(ICONS.play, 16), t("hp.setupStart")]),
        el("span.note", {}, summary),
      ]),
    ].filter(Boolean));
  }

  /* ---- Öva: every question, filtered ---- */
  function listCard(all) {
    const hist = questionHistory(store.attempts);
    const topics = [...new Set(all.map(({ q }) => q.topic).filter(Boolean))].sort();
    const statusOf = (q) => {
      const h = hist[q.id];
      return !h ? "new" : h.correct ? "right" : "wrong";
    };
    const rows = all.filter(({ q }) => (!topic || q.topic === topic) && (
      !status || (status === "saved" ? store.isSaved(q.id) : statusOf(q) === status)));

    const select = (label, value, options, onchange) => el("label.hp-filter", {}, [
      el("span", {}, label),
      el("select", { onchange: (e) => onchange(e.target.value) },
        options.map(([v, text]) => el("option", { value: v, selected: v === value }, text))),
    ]);
    const statusChip = (s) => el(`span.hp-chip.is-${s}`, {}, t(`hp.status.${s}`));

    const list = el("ol.hp-qlist", {}, rows.slice(0, shown).map(({ q, set }) => {
      const src = sourceOf(set);
      const saved = store.isSaved(q.id);
      const saveBtn = el("button.iconbtn.iconbtn--sm", {
        type: "button", "aria-pressed": String(saved),
        "aria-label": t("hp.saveQuestion"), title: t("hp.saveQuestion"),
        onclick: () => { store.toggleSaved(q.id); paint(); },
      }, [icon(ICONS.bookmark, 15)]);
      return el("li.hp-qrow", {}, [
        el("div.hp-qrow__main", {}, [
          el("span.hp-qrow__prompt", { html: renderRich(plainPrompt(q)) }),
          el("span.hp-qrow__chips", {}, [
            q.topic ? el("span.hp-chip", {}, sentenceCase(q.topic)) : null,
            statusChip(statusOf(q)),
            el("span.hp-chip" + (src.ai ? ".is-ai" : ""), {}, src.label),
          ].filter(Boolean)),
        ]),
        saveBtn,
        el("a.btn.btn--sm.btn--ghost", { href: `#/hp/ova/${dp}?ids=${encodeURIComponent(q.id)}` }, t("hp.listOpen")),
      ]);
    }));

    return el("section.set-card.hp-list", { "aria-labelledby": "hp-list-title" }, [
      el("div.hp-list__head", {}, [
        el("h2#hp-list-title", {}, t("hp.listTitle", { n: all.length })),
        rows.length ? el("a.btn.btn--sm", {
          href: `#/hp/ova/${dp}?ids=${encodeURIComponent(rows.slice(0, 60).map(({ q }) => q.id).join(","))}`,
        }, [icon(ICONS.play, 14), t("hp.listPractise", { n: Math.min(rows.length, 60) })]) : null,
      ].filter(Boolean)),
      el("div.hp-filters", {}, [
        topics.length > 1 ? select(t("hp.filterTopic"), topic, [["", t("hp.filterAll")], ...topics.map((x) => [x, sentenceCase(x)])], (v) => { topic = v; shown = LIST_STEP; paint(); }) : null,
        select(t("hp.filterStatus"), status, [
          ["", t("hp.filterAll")], ["new", t("hp.status.new")], ["wrong", t("hp.status.wrong")],
          ["right", t("hp.status.right")], ["saved", t("hp.status.saved")],
        ], (v) => { status = v; shown = LIST_STEP; paint(); }),
      ].filter(Boolean)),
      rows.length ? list : el("p.note", {}, t("hp.listEmpty")),
      rows.length > shown ? el("button.linkbtn", { type: "button", onclick: () => { shown += LIST_STEP; paint(); } },
        t("hp.listMore", { n: rows.length - shown })) : null,
    ].filter(Boolean));
  }

  /* ---- Öva: more questions from the AI ---- */
  function aiCard() {
    if (!AI_DELPROV.includes(dp)) return null;
    const busy = isAddingHp(dp);
    const btn = el("button.btn.btn--ghost", {
      type: "button", disabled: busy || !store.canUseAI(),
      onclick: async () => {
        btn.disabled = true;
        btn.textContent = t("hp.aiBusy");
        try {
          const n = await addHpQuestions(dp, MORE_HP);
          toast(t("hp.aiAdded", { n }));
        } catch (e) {
          toast(e instanceof ClaudeError || e?.message ? e.message : t("hp.moreFailed"));
        }
        if (root.isConnected) paint();
      },
    }, busy ? t("hp.aiBusy") : [icon(ICONS.spark, 16), t("hp.aiMake", { n: MORE_HP })]);
    return el("section.set-card.hp-ai", {}, [
      el("h2", {}, t("hp.aiTitle")),
      el("p.note", {}, t("hp.aiSub")),
      btn,
      store.canUseAI() ? null : el("p.note", {}, t(store.aiBlockReason() === "signin" ? "hp.aiNeedSignIn" : "hp.aiUnavailable")),
    ].filter(Boolean));
  }

  /* ---- Analys: this week, over time, per topic ---- */
  function analysisCards() {
    // Every answer to this delprov, with when it was given.
    const answers = [];
    const runs = [];
    for (const a of store.attempts) {
      if (!Array.isArray(a.items)) continue;
      const mine = a.items.filter((it) => store.findQuestion(it.questionId)?.question.variant === dp);
      if (!mine.length) continue;
      const right = mine.filter((it) => it.firstTry ?? it.correct).length;
      runs.push({ at: a.finishedAt || 0, right, n: mine.length });
      for (const it of mine) answers.push({ at: a.finishedAt || 0, ok: !!(it.firstTry ?? it.correct), topic: it.topic });
    }
    if (!answers.length) {
      return [el("section.set-card", {}, [el("h2", {}, t("hp.analysisTitle")), el("p.note", {}, t("hp.analysisEmpty"))])];
    }
    runs.sort((x, y) => x.at - y.at);

    // Weeks start on Monday, in the student's own time.
    const weekStart = (ms) => {
      const d = new Date(ms);
      return addDays(localDayKey(d), -((d.getDay() + 6) % 7));
    };
    const thisWeek = weekStart(Date.now());
    const rightThisWeek = answers.filter((x) => x.ok && weekStart(x.at) === thisWeek).length;
    const rightTotal = answers.filter((x) => x.ok).length;
    const level = delprovEstimate({ delprov: dp, correct: rightTotal, total: answers.length }).normed;

    const weeks = Array.from({ length: 6 }, (_, i) => addDays(thisWeek, -7 * (5 - i)));
    const perWeek = weeks.map((w) => {
      const inWeek = answers.filter((x) => weekStart(x.at) === w);
      return { w, n: inWeek.length, ok: inWeek.filter((x) => x.ok).length };
    });
    const maxN = Math.max(1, ...perWeek.map((x) => x.n));

    const topics = {};
    for (const x of answers) {
      const k = x.topic || "–";
      const e = topics[k] || (topics[k] = { ok: 0, n: 0 });
      e.n++; if (x.ok) e.ok++;
    }
    const topicRows = Object.entries(topics).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);

    const stat = (label, value) => el("div.hp-stat", {}, [el("span", {}, label), el("strong", {}, value)]);
    const levels = runs.map((r) => delprovEstimate({ delprov: dp, correct: r.right, total: r.n }).normed).slice(-12);

    return [
      el("section.set-card", {}, [
        el("h2", {}, t("hp.analysisTitle")),
        el("div.hp-stats", {}, [
          stat(t("hp.statWeek"), String(rightThisWeek)),
          stat(t("hp.statTotal"), t("hp.statOf", { c: rightTotal, n: answers.length })),
          stat(t("hp.levelLabel"), fmtN(level)),
        ]),
      ]),
      el("section.set-card", {}, [
        el("h2", {}, t("hp.weeksTitle")),
        el("div.hp-weeks", { role: "img", "aria-label": t("hp.weeksAria", { list: perWeek.map((x) => `${x.ok}/${x.n}`).join(", ") }) },
          perWeek.map((x) => el("div.hp-weeks__col", {}, [
            el("div.hp-weeks__bar", { style: { height: `${(x.n / maxN) * 100}%` } }, [
              el("i", { style: { height: `${x.n ? (x.ok / x.n) * 100 : 0}%` } }),
            ]),
            el("span.hp-weeks__n", {}, String(x.n)),
            el("span.hp-weeks__w", {}, x.w === thisWeek ? t("hp.thisWeek") : fmtDate(x.w)),
          ]))),
        el("p.note", {}, t("hp.weeksLegend")),
      ]),
      levels.length >= 2 ? el("section.set-card", {}, [
        el("h2", {}, t("hp.levelTrend")),
        sparkline(levels, { max: 2, ariaLabel: t("hp.levelTrendAria", { list: levels.map(fmtN).join(", ") }) }),
      ]) : null,
      el("section.set-card", {}, [
        el("h2", {}, t("hp.topicsTitle")),
        el("ul.hp-topics", {}, topicRows.map(([k, e]) => el("li", {}, [
          el("span.hp-topics__name", {}, sentenceCase(k)),
          el("span.hp-calib__bar.hp-topics__bar", { "aria-hidden": "true" }, [el("i", { style: { width: `${(e.ok / e.n) * 100}%` } })]),
          el("span.hp-topics__n", {}, t("hp.statOf", { c: e.ok, n: e.n })),
        ]))),
      ]),
    ].filter(Boolean);
  }

  /* ---- Historik ---- */
  function historyCard() {
    const runs = store.attempts
      .filter((a) => a.hp && (a.items || []).some((it) => store.findQuestion(it.questionId)?.question.variant === dp))
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    if (!runs.length) {
      return el("section.set-card", {}, [el("h2", {}, t("hp.historyTitle")), el("p.note", {}, t("hp.historyEmpty"))]);
    }
    return el("section.set-card", {}, [
      el("h2", {}, t("hp.historyTitle")),
      el("ol.hp-hist", {}, runs.slice(0, 40).map((a) => {
        const mine = a.items.filter((it) => store.findQuestion(it.questionId)?.question.variant === dp);
        const right = mine.filter((it) => it.firstTry ?? it.correct).length;
        const kind = a.examMode ? t("hp.histExam") : a.timeLimitMin ? t("hp.histTimed") : t("hp.histTrain");
        return el("li", {}, [
          el("a.hp-hist__row", { href: `#/results/${a.id}` }, [
            el("span.hp-hist__date", {}, fmtDate(localDayKey(new Date(a.finishedAt || Date.now())))),
            el("span", {}, t("hp.histRight", { c: right, n: mine.length })),
            el("span.hp-chip", {}, kind),
            icon(ICONS.chevronRight, 14),
          ]),
        ]);
      })),
    ]);
  }

  function paint() {
    clear(root);
    const all = delprovQuestions(dp);
    clear(body);
    if (tab === "historik") body.append(historyCard());
    else if (tab === "analys") body.append(...analysisCards());
    else if (!all.length) body.append(el("section.set-card", {}, [el("p", {}, t("hp.practiceEmptyBody"))]));
    else body.append(...[setupCard(all.length), listCard(all), aiCard()].filter(Boolean));
    root.append(header(), body);
  }

  paint();
  const onChange = () => { if (root.isConnected) paint(); };
  store.addEventListener("change", onChange);
  return {
    title: `${t(`hp.delprov.${dp}`)} · ${t("hp.pageTitle")}`,
    node: root,
    cleanup: () => store.removeEventListener("change", onChange),
  };
}

