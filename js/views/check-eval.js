// #/dev/check-eval - a developer tool, not linked from anywhere: does "Kolla min uträkning" need Sonnet,
// or can the much cheaper Haiku do the same job? Drop in photos of handwritten working (ideally real
// ones, some with a planted mistake), say what the right answer is where you know it, and each photo is
// sent to BOTH models through the page's own checkWorking() - same prompt, same photo shrinking, same
// parsing - so what you compare is what a student would get.
//
// What it answers (lib/check-eval.js): which model points at the right line, which one flags correct work
// as wrong, which one misses a real slip - and, where they disagree, you say who was right.
// English only on purpose: it is for the people building the app, so it has no strings.js entries.
//
// Runs two real model calls per photo (~3 cents in all), so it is limited to accounts that are exempt
// from the monthly AI allowance. Results live in memory: export the CSV/JSON before leaving the page.

import { store } from "../store.js";
import { el, icon, ICONS, toast, uid, downloadText } from "../lib/dom.js";
import { checkWorking, ClaudeError } from "../claude.js";
import { shrinkImage } from "../lib/photo.js";
import { homeButton } from "../components/nav.js";
import { bindFileTargets } from "../components/file-drop.js";
import {
  EVAL_MODELS, costUsd, expectation, verdictFor, compareRuns, needsJudge, summarise, toCsv,
} from "../lib/check-eval.js";

const MAX_CASES = 40;
const CONCURRENT = 2;                         // photos in flight at once (x2 models = 4 requests)
const IDS = EVAL_MODELS.map((m) => m.id);
const PER_PHOTO_ESTIMATE = 0.03;              // dollars, both models: only used for the "about $X" line

const usd = (n) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");

const VERDICT = {
  correct: { text: "matches your key", tone: "ok" },
  false_flag: { text: "flagged correct work as wrong", tone: "bad" },
  missed: { text: "missed the mistake", tone: "bad" },
  wrong_line: { text: "pointed at the wrong line", tone: "bad" },
  abstained: { text: "declined to judge", tone: "warn" },
  error: { text: "request failed", tone: "bad" },
  no_key: { text: "", tone: "none" },
  pending: { text: "", tone: "none" },
};
const TONE = {
  ok: { background: "var(--ok-tint)", color: "var(--ok-ink)" },
  warn: { background: "var(--retry-tint)", color: "var(--retry-ink)" },
  bad: { background: "var(--retry-tint)", color: "var(--retry-ink)", fontWeight: "700" },
  none: { background: "var(--surface-sunk)", color: "var(--ink-soft)" },
};
const chip = (text, tone) => el("span", { style: { ...TONE[tone], display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "12px", lineHeight: "1.5" } }, text);

export function renderCheckEval() {
  // minWidth 0: inside the app shell's flex/grid, a wide table would otherwise force the whole page wider than the screen.
  const root = el("div.check-eval", { style: { maxWidth: "1000px", width: "100%", minWidth: "0", margin: "0 auto" } });
  const st = { cases: [], running: false, stop: false, gate: "checking" };   // gate: checking | open | <reason text>

  const summaryEl = el("div");
  const listEl = el("div", { style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "12px", marginTop: "12px" } });
  const topEl = el("div");

  function decideGate() {
    if (!store.canUseAI()) return "Sign in on a server that has the AI connected to use this tool.";
    // A metered account has an allowance; this tool would eat it (about 4,000 tokens x 2 models per photo).
    if (store.aiUsage) return "This tool runs two models on every photo, so it is only open to accounts that are exempt from the monthly AI allowance (AI_BUDGET_EXEMPT_EMAILS on the server).";
    return "open";
  }

  /* ---------- running ---------- */

  async function runCase(c) {
    c.status = "running";
    paintCase(c);
    const todo = EVAL_MODELS.filter((m) => !c.runs[m.id] || c.runs[m.id].error);
    await Promise.all(todo.map(async (m) => {
      const t0 = performance.now();
      try {
        const res = await checkWorking({ image: { mediaType: c.image.mediaType, data: c.image.data }, model: m.id });
        c.runs[m.id] = { result: res, ms: Math.round(performance.now() - t0), usage: res.usage, cost: costUsd(m.id, res.usage) };
      } catch (e) {
        c.runs[m.id] = { error: e instanceof ClaudeError ? e.message : String(e?.message || e), ms: Math.round(performance.now() - t0) };
      }
    }));
    c.status = "done";
    paintCase(c);
    paintSummary();
    // The allowance or the server's daily cap ran out mid-run: stop spending, say why.
    if (!store.canUseAI()) st.stop = true;
  }

  async function runAll() {
    if (st.running) return;
    const queue = st.cases.filter((c) => EVAL_MODELS.some((m) => !c.runs[m.id] || c.runs[m.id].error));
    if (!queue.length) { toast("Nothing left to run."); return; }
    st.running = true; st.stop = false; paintTop();
    let next = 0;
    const worker = async () => { while (!st.stop) { const c = queue[next++]; if (!c) return; await runCase(c); } };
    await Promise.all(Array.from({ length: CONCURRENT }, worker));
    const stopped = st.stop;
    st.running = false; st.stop = false; paintTop(); paintSummary();
    toast(stopped ? "Stopped." : "Done.");
  }

  /* ---------- adding photos ---------- */

  async function addFiles(files) {
    const room = MAX_CASES - st.cases.length;
    if (room <= 0) { toast(`At most ${MAX_CASES} photos at a time.`); return; }
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
    for (const f of list) {
      try {
        const image = await shrinkImage(f);
        const c = { id: uid(), name: f.name || "pasted photo", image, kind: "", line: "", expected: null, runs: {}, judge: null, status: "idle" };
        st.cases.push(c);
        listEl.appendChild(cardEl(c));
      } catch (e) { toast(e?.message || "Couldn't read that image."); }
    }
    paintTop(); paintSummary();
  }

  /* ---------- painting ---------- */

  function paintTop() {
    const gateOpen = st.gate === "open";
    const pending = st.cases.filter((c) => EVAL_MODELS.some((m) => !c.runs[m.id] || c.runs[m.id].error)).length;
    const fileInput = el("input", {
      type: "file", accept: "image/*", multiple: true, style: { display: "none" },
      onchange: (e) => { const f = [...e.target.files]; e.target.value = ""; addFiles(f); },
    });
    topEl.replaceChildren(
      el("div.panel", {}, [
        el("h2", { style: { marginBottom: "6px" } }, "Kolla min uträkning: which model?"),
        el("p.note", {}, [
          "Developer tool. Each photo goes to ", el("b", {}, EVAL_MODELS.map((m) => m.label).join(" and ")),
          " through the real check, side by side. Add photos of handwritten working (best: real ones, some with a planted mistake), ",
          "say what the right answer is where you know it, run, and look at the summary. Where the models disagree, say who was right.",
        ]),
        st.gate === "checking" ? el("p.note", {}, "Checking your account…")
          : !gateOpen ? el("p.note.note--warn", { role: "alert" }, st.gate)
          : el("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "10px" } }, [
              fileInput,
              el("button.btn.btn--ghost.btn--sm", { type: "button", disabled: st.running, onclick: () => fileInput.click() }, [icon(ICONS.camera, 14), "Add photos"]),
              st.running
                ? el("button.btn.btn--sm", { type: "button", onclick: () => { st.stop = true; toast("Stopping after the photos in flight…"); } }, "Stop")
                : el("button.btn.btn--sm", { type: "button", disabled: !pending, onclick: runAll }, [icon(ICONS.spark, 14), pending ? `Run ${pending} photo${pending === 1 ? "" : "s"}` : "Run"]),
              el("button.btn.btn--ghost.btn--sm", { type: "button", disabled: st.running || !st.cases.length, onclick: clearAll }, "Clear"),
              el("button.btn.btn--ghost.btn--sm", { type: "button", disabled: !st.cases.length, onclick: () => downloadText("check-eval.csv", toCsv(st.cases), "text/csv") }, "Export CSV"),
              el("button.btn.btn--ghost.btn--sm", { type: "button", disabled: !st.cases.length, onclick: exportJson }, "Export JSON"),
              pending ? el("span.note", {}, `${st.cases.length} photo${st.cases.length === 1 ? "" : "s"} · about ${usd(pending * PER_PHOTO_ESTIMATE)} to run`) : null,
            ]),
      ]),
    );
  }

  function clearAll() {
    st.cases = [];
    listEl.replaceChildren();
    paintTop(); paintSummary();
  }

  function exportJson() {
    const rows = st.cases.map((c) => ({
      photo: c.name, answerKey: c.expected, whoWasRight: c.judge,
      runs: Object.fromEntries(IDS.map((id) => [id, c.runs[id] ? {
        error: c.runs[id].error || null, ms: c.runs[id].ms, usage: c.runs[id].usage || null, usd: c.runs[id].cost ?? null,
        verdict: verdictFor(c.expected, c.runs[id]), result: c.runs[id].result || null,
      } : null])),
    }));
    downloadText("check-eval.json", JSON.stringify({ summary: summarise(st.cases), cases: rows }, null, 2));
  }

  function paintSummary() {
    if (!st.cases.length) { summaryEl.replaceChildren(); return; }
    const s = summarise(st.cases);
    const td = (v, extra = {}) => el("td", { style: { padding: "6px 10px", textAlign: "right", ...extra } }, v);
    const th = (v, extra = {}) => el("th", { style: { padding: "6px 10px", textAlign: "right", fontWeight: "600", fontSize: "12px", color: "var(--ink-soft)", ...extra } }, v);
    const rows = EVAL_MODELS.map((m) => {
      const x = s.models[m.id];
      return el("tr", { style: { borderTop: "1px solid var(--line)" } }, [
        td(m.label, { textAlign: "left", fontWeight: "600" }),
        td(x.scored ? `${x.correct}/${x.scored} (${pct(x.correct, x.scored)})` : "no keys yet"),
        td(x.falseFlags), td(x.missed), td(x.wrongLine), td(x.abstained), td(x.errors),
        td(x.ran ? `${(x.msTotal / x.ran / 1000).toFixed(1)} s` : "–"),
        td(x.ran ? `${usd(x.cost / x.ran)} · ${usd(x.cost)} total` : "–"),
      ]);
    });
    const a = s.agreement;
    const j = s.judged;
    const lines = [];
    if (a.comparable) lines.push(`The models told the student the same thing on ${a.same} of ${a.comparable} photos (${pct(a.same, a.comparable)}).`);
    if (s.disagreements) {
      lines.push(`${s.disagreements} disagreement${s.disagreements === 1 ? "" : "s"}: you judged ${EVAL_MODELS[0].label} right ${j[IDS[0]]}, ${EVAL_MODELS[1].label} right ${j[IDS[1]]}, both ${j.both}, neither ${j.neither}; ${j.unjudged} still to judge.`);
    }
    summaryEl.replaceChildren(el("div.panel", { style: { marginTop: "12px", overflowX: "auto" } }, [
      el("h3", { style: { marginBottom: "6px" } }, `Summary · ${s.finished} of ${s.cases} photos run on both`),
      el("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: "13px" } }, [
        el("thead", {}, el("tr", {}, [
          th("Model", { textAlign: "left" }), th("Right line (of keyed)"), th("Flagged correct work"), th("Missed a slip"),
          th("Wrong line"), th("Declined"), th("Errors"), th("Avg time"), th("Cost per photo"),
        ])),
        el("tbody", {}, rows),
      ]),
      ...lines.map((l) => el("p.note", { style: { marginTop: "8px" } }, l)),
      el("p.note", { style: { marginTop: "8px" } }, "Costs are what Anthropic reports for each request, priced with the server's own rate table. Flagging correct work and missing a real slip are the two mistakes a student would feel."),
    ]));
  }

  function runView(c, m) {
    const run = c.runs[m.id];
    const verdict = verdictFor(c.expected, run);
    const v = VERDICT[verdict];
    const r = run?.result;
    const body = [];
    if (c.status === "running" && !run) {
      body.push(el("p.note", {}, [el("span.typing", {}, [el("span"), el("span"), el("span")]), " running…"]));
    } else if (!run) {
      body.push(el("p.note", {}, "not run yet"));
    } else if (run.error) {
      body.push(el("p.note.note--warn", {}, run.error));
    } else if (r.status !== "checked") {
      body.push(el("p", { style: { margin: 0 } }, r.status === "unreadable" ? "Said the photo is unreadable." : "Said there is no working to check."));
      if (r.reason) body.push(el("p.note", {}, r.reason));
    } else {
      body.push(el("p", { style: { margin: 0, fontWeight: "600" } }, r.firstError == null ? "Every line follows" : `First error: line ${r.firstError}`));
      body.push(el("p.note", { style: { margin: 0 } }, `Final answer: ${r.answerCorrect === true ? "correct" : r.answerCorrect === false ? "wrong" : "unclear"}`));
    }
    if (run && !run.error) {
      body.push(el("p.note", { style: { margin: 0 } }, `${(run.ms / 1000).toFixed(1)} s · ${(run.usage?.input_tokens || 0) + (run.usage?.output_tokens || 0)} tokens · ${usd(run.cost || 0)}`));
    }
    if (r && r.status === "checked" && r.lines.length) {
      body.push(el("details", {}, [
        el("summary", { style: { cursor: "pointer", fontSize: "13px" } }, `How it read the page (${r.lines.length} lines)`),
        el("ol", { style: { margin: "6px 0 0", paddingLeft: "22px", fontSize: "13px" } }, r.lines.map((l) => el("li", {}, [
          el("span", { style: { color: l.ok === false ? "var(--retry-ink)" : "var(--ink-soft)", fontWeight: l.ok === false ? "700" : "400" } }, `${l.ok === true ? "✓" : l.ok === false ? "✗" : "·"} `),
          l.text,
          l.note ? el("span", { style: { color: "var(--ink-faint)" } }, ` (${l.note})`) : null,
        ]))),
      ]));
    }
    return el("div", { style: { flex: "1 1 240px", minWidth: "0", display: "grid", gap: "4px", alignContent: "start" } }, [
      el("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, [
        el("b", {}, m.label), v.text ? chip(v.text, v.tone) : null,
      ]),
      ...body,
    ]);
  }

  function judgeRow(c) {
    const btn = (label, value) => el("button.btn.btn--sm" + (c.judge === value ? "" : ".btn--ghost"), {
      type: "button", "aria-pressed": String(c.judge === value),
      onclick: () => { c.judge = c.judge === value ? null : value; paintCase(c); paintSummary(); },
    }, label);
    return el("div", { style: { gridColumn: "1 / -1", padding: "8px 10px", borderRadius: "8px", background: "var(--retry-tint)", color: "var(--retry-ink)" } }, [
      el("div", { style: { fontSize: "13px", marginBottom: "6px" } }, "The models disagree on this one. Who was right?"),
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, [
        btn(`${EVAL_MODELS[0].label} was right`, IDS[0]), btn(`${EVAL_MODELS[1].label} was right`, IDS[1]), btn("Both fine", "both"), btn("Both wrong", "neither"),
      ]),
    ]);
  }

  function cardEl(c) {
    const kindSel = el("select", { "aria-label": "Right answer for this photo", disabled: st.running, onchange: (e) => { c.kind = e.target.value; c.expected = expectation(c.kind, c.line); paintCase(c); paintSummary(); } }, [
      el("option", { value: "" }, "Answer key: don't know"),
      el("option", { value: "ok" }, "Every line is correct"),
      el("option", { value: "line" }, "First wrong line is…"),
    ]);
    kindSel.value = c.kind;
    const lineIn = c.kind === "line" ? el("input", {
      type: "number", min: "1", max: "20", value: c.line, placeholder: "line", "aria-label": "Line number of the first mistake", style: { width: "70px" },
      onchange: (e) => { c.line = e.target.value; c.expected = expectation(c.kind, c.line); paintCase(c); paintSummary(); },
    }) : null;
    const node = el("div.panel", { style: { display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "flex-start", padding: "var(--s-4)" } }, [
      el("div", { style: { flex: "0 0 150px", display: "grid", gap: "6px", justifyItems: "start" } }, [
        el("img", { src: c.image.preview, alt: `Photo: ${c.name}`, style: { width: "150px", maxHeight: "190px", objectFit: "contain", borderRadius: "8px", border: "1px solid var(--line)", background: "var(--surface-sunk)" } }),
        el("span", { style: { fontSize: "12px", color: "var(--ink-faint)", overflowWrap: "anywhere" } }, c.name),
        el("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, [kindSel, lineIn]),
        el("button.linkbtn", { type: "button", disabled: st.running, onclick: () => removeCase(c) }, "Remove"),
      ]),
      el("div", { style: { flex: "1 1 520px", minWidth: "0", display: "flex", flexWrap: "wrap", gap: "14px" } }, [
        ...EVAL_MODELS.map((m) => runView(c, m)),
        needsJudge(c) ? judgeRow(c) : null,
        (() => {
          const cmp = compareRuns(c.runs[IDS[0]], c.runs[IDS[1]]);
          return cmp ? el("p.note", { style: { gridColumn: "1 / -1", flex: "1 1 100%", margin: 0 } }, `Transcriptions ${Math.round(cmp.transcription * 100)}% alike${cmp.lineDelta ? `; ${EVAL_MODELS[1].label} read ${Math.abs(cmp.lineDelta)} ${cmp.lineDelta > 0 ? "more" : "fewer"} line${Math.abs(cmp.lineDelta) === 1 ? "" : "s"}` : ""}.`) : null;
        })(),
      ]),
    ]);
    c.el = node;
    return node;
  }

  function paintCase(c) { if (c.el && c.el.isConnected) { const old = c.el; old.replaceWith(cardEl(c)); } }

  function removeCase(c) {
    st.cases = st.cases.filter((x) => x !== c);
    c.el?.remove();
    paintTop(); paintSummary();
  }

  /* ---------- mount ---------- */

  root.append(homeButton({ grid: true }), topEl, summaryEl, listEl);
  paintTop();
  bindFileTargets(root, {
    accept: "image/*", paste: true,
    onFiles: (files) => { if (st.gate === "open" && !st.running) addFiles(files); },
    onReject: () => toast("That isn't an image."),
  });
  // The usage fetch decides whether this account is metered; wait for it rather than guess from a stale null.
  Promise.resolve(store.refreshUsage?.()).catch(() => {}).then(() => { st.gate = decideGate(); paintTop(); });
  return { title: "Check model comparison", node: root, cleanup: () => { st.stop = true; } };
}
