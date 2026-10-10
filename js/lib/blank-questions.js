// Starter questions for a "build it myself" set — one of each kind, cycling.
// Prompts are filled so the set saves and runs straight away; answers are
// placeholders the student can edit (or leave blank while testing). Its own
// module so the quick-add dialog (on the menu screen) doesn't pull in all of
// Create to make three of them.

import { uid } from "./dom.js";
import { t } from "./i18n.js";

const BLANK_KINDS = ["mc", "text", "cloze", "flashcard", "worked"];

export function blankQuestions(n) {
  return Array.from({ length: Math.max(1, n || 5) }, (_, i) => {
    const kind = BLANK_KINDS[i % BLANK_KINDS.length];
    const q = { id: uid(), topic: "demo", kind, prompt: t("create.blankQ", { n: i + 1 }) };
    if (kind === "mc") { q.choices = ["A", "B", "C"]; q.answer = 0; }
    else if (kind === "cloze") { q.prompt = t("create.blankCloze", { n: i + 1 }); }
    else if (kind === "worked") { q.answer = ""; q.steps = []; }
    else { q.answer = ""; }
    return q;
  });
}
