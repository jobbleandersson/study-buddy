// A second pass over freshly written questions, before they're saved: the same fast model checks the
// set it just wrote, and questions it can't stand behind are dropped. Tested 2026-10-07/10 on 80 new
// questions plus 5 known-wrong ones: it caught every real error in the new sets with no false alarms,
// and 4 of the 5 planted ones (it missed a NOG logic slip it shared with the writer - which is why the
// Högskoleprov questions stay on the stronger model, see js/claude.js MODELS).
//
// Pure helpers only (no network, store or DOM), so they can be unit-tested; claude.js makes the call.

/** What the reviewer is told. A multiple-choice question is shown WITHOUT its answer, so the reviewer
 *  has to solve it rather than agree with it; a cloze is judged answer by answer. */
export const REVIEW_SYSTEM = `Du granskar övningsfrågor för elever innan de sparas och används. Var noggrann och skeptisk: en fråga med fel facit är värre än ingen fråga alls.
För varje fråga:
- kind "mc": lös frågan själv från grunden. Ange index (0-baserat) för det alternativ som är rätt. Om fler än ett alternativ kan försvaras, eller inget är rätt, sätt verdict "unclear".
- kind "cloze": luckorna skrivs {{svar1|svar2}} och varje alternativ inom en lucka godtas som rätt svar. Pröva varje godtaget alternativ i meningen var för sig. Ger något godtaget alternativ en felaktig eller ogrammatisk mening i sammanhanget, sätt verdict "wrong" och nämn vilket.
- övriga (text, worked, flashcard): kontrollera att "answer" är sakligt korrekt och faktiskt besvarar frågan. Sätt verdict "wrong" om det innehåller ett fel.
Kontrollera också att frågan går att förstå och har ett entydigt svar.
Svara ENDAST med en JSON-array, en post per fråga: [{"i":0,"answer":2,"verdict":"ok","problem":""}]. "answer" bara för mc.`;

/** The questions as the reviewer sees them: numbered, multiple choice without its key. */
export function reviewItems(questions) {
  return questions.map((q, i) => {
    const it = { i, kind: q.kind, prompt: q.prompt };
    if (q.stimulus) it.stimulus = q.stimulus;
    if (q.kind === "mc") it.choices = q.choices;
    else if (q.kind !== "cloze") it.answer = q.answer;   // a cloze carries its answers in the prompt
    return it;
  });
}

/** The reviewer's reply -> its verdict array, or null when there isn't a usable one. */
export function parseVerdicts(text) {
  const s = String(text || "");
  const from = s.indexOf("["), to = s.lastIndexOf("]");
  if (from < 0 || to <= from) return null;
  try {
    const arr = JSON.parse(s.slice(from, to + 1));
    return Array.isArray(arr) ? arr.filter((v) => v && Number.isInteger(v.i)) : null;
  } catch {
    return null;
  }
}

/** Which questions to drop. A multiple-choice question whose blind answer differs from its key is
 *  flagged; so is anything not judged "ok". A question the reviewer skipped is kept (not judged is not
 *  judged wrong), but a reply that skips more than half of them is no review at all: null. */
export function flaggedIndexes(questions, verdicts) {
  if (!Array.isArray(verdicts)) return null;
  const byIndex = new Map(verdicts.map((v) => [v.i, v]));
  if (byIndex.size < questions.length / 2) return null;
  const out = [];
  questions.forEach((q, i) => {
    const v = byIndex.get(i);
    if (!v) return;
    if (v.verdict !== "ok" || (q.kind === "mc" && v.answer !== q.answer)) out.push(i);
  });
  return out;
}
