// Which language is this text in? Read-aloud needs to know, because the
// library's language sets mix Swedish (or English) instructions with quoted
// Spanish / German / French / English — and a Swedish voice reading Spanish
// sounds wrong. Small word lists plus a few spelling cues: enough to tell the
// student's language from the language being learned, without a model.
//
// Every call is "target language vs. everything else", so a word that's shared
// between the target and the student's language ("en", "de", "man") is dropped
// for that comparison — it says nothing either way.

const LISTS = {
  sv: `och det att är som på av inte har vi för med den till ett om men var sig så kan man när vad hur vilken vilka vilket eller från ska vill blir bli detta dessa denna mig dig honom henne oss dem sin sitt sina din ditt dina min mitt mina vår vårt våra ni han vara varit hade skulle skall får fick alla någon något inga inget också bara mycket mer mest mellan efter innan under över genom utan vid hos enligt mot medan eftersom därför här där nu då ju väl ännu redan alltid aldrig ofta ibland ganska jag hon välj rätt mening betyder texten läs vem varför hjälpa hjälper kände träffade tänkte saknade samma svar meddelande frågar säger säg heter finns gillar tycker äter dricker bor kommer går ligger sitter står jul natt god dag morgon kväll hej tack snälla ursäkta förlåt vänta måndag tisdag onsdag torsdag fredag lördag söndag januari februari mars april maj juni juli augusti september oktober november december vecka månad idag igår imorgon bord stol bröd mjölk ost smör kött fisk frukt grönsaker vatten kaffe mamma pappa syster bror morbror farbror moster faster kusin syskon farmor farfar mormor morfar bättre bäst större störst liten stor gammal ung snabb långsam glad ledsen röd blå grön gul svart vit du sa se ta ha ser ont dit par plus in text verb form just hat dans`,
  es: `el la los las un una unos unas y o pero que del al por para con sin sobre entre desde hasta es son está están era eran fue fueron ser estar tiene tienen tengo tenía hay ha han he hemos muy más menos también cuando donde dónde cómo qué quién quiénes cuál cuáles mi mis tu tus su sus nuestro yo tú él ella nosotros ellos ellas usted ustedes sí ya aquí allí ahora siempre nunca todo todos toda todas otro otra este esta estos estas ese esa eso lo le les se me te nos hacer hace hizo hacía voy va vamos van fui iba estaba estaban quiero puedo quiso quería casa amiga amigo madre padre niños parque cielo entiendo entiende hablo hablas habla hablan soy eres somos vivo vive vivimos llamo llama gusta gustan como come comen comer bebe bebo beber tiene tienes vengo viene vienen pretérito imperfecto llegué llegaba cocinaba cocinó jugaban jugaron estuvo hizo ayer hoy mañana anoche siempre normalmente días lunes martes miércoles jueves viernes sábado domingo enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre hola gracias favor perdón adiós buenos buenas noches tardes semana mes año escuela clase profesor profesora libro perro gato pájaro caballo mesa ensalada fiesta película verduras carne pescado leche pan agua`,
  de: `der die das den dem des ein eine einen einem einer und oder aber dass nicht ist sind war waren wird werden wurde wurden hat haben hatte hatten kann können konnte muss müssen soll sollen will wollen ich er sie es wir ihr mein dein sein unser auch noch schon nur sehr mit von zu auf aus bei nach über unter vor durch für gegen ohne um wenn als wie was wer wo wann warum weil hier dort jetzt immer nie oft manchmal zum zur im am wäre hätte würde könnte bitte helfen mehr zeit gemacht machte macht machen mag magst möge mögt gemüse eltern wohnen wohnt hamburg berlin montag dienstag mittwoch donnerstag freitag samstag sonntag januar februar märz mai juni juli august dezember oktober guten morgen abend nacht danke bitte entschuldigung tschüss hallo woche monat jahr schule unterricht lehrer lehrerin buch hund katze vogel pferd tisch brot milch käse fleisch fisch obst wasser kaffee mutter vater schwester bruder onkel tante cousin geschwister oma opa`,
  fr: `le la les un une des du et ou mais que qui ne pas est sont était étaient été être avoir ont avait avaient je tu il elle nous vous ils elles mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs ce cet cette ces dans sur sous avec sans pour par chez vers entre très plus moins aussi quand où comment pourquoi parce si au aux suis es sommes êtes fait faire dit voir peut veux veut allé maison ami amie bonjour bonsoir merci pardon salut lundi mardi mercredi jeudi vendredi samedi dimanche janvier février mars avril mai juin juillet août septembre octobre novembre décembre semaine mois année école classe professeur livre chien chat oiseau cheval table pain lait fromage viande poisson légumes fruits eau café mère père soeur frère oncle tante cousin`,
  en: `the a an and or but that this these those is are was were be been being have has had do does did will would can could should may might not no yes you he she it we they me him her us them my your his its our their of in on at to for from with by about as into over under after before than then when where why how what which who whom there here very more most also just only choose correct form sentence since ago yesterday last mean means meaning word noun verb adjective opposite synonym passage text answer`,
};

const SETS = Object.fromEntries(Object.entries(LISTS).map(([k, v]) => [k, new Set(v.split(/\s+/).filter(Boolean))]));

// Spelling cues: characters that give a language away. Swedish has å (and
// ä/ö, which it shares with German), but almost never é, ü, ñ, ç or the
// other accents — so those count for whichever target language uses them.
const CUES = {
  es: /[¿¡ñáíóúü]/g,
  fr: /[çœéèêëàâîïôùû]/g,
  de: /[ßü]/g,
  sv: /å/g,
};

/** For `text`, is it the language being learned ("target"), the student's own
 *  ("ui"), or too short / too neutral to say ("unknown")? */
export function classify(text, targetCode) {
  const s = String(text || "").toLowerCase();
  const target = SETS[targetCode];
  if (!target) return "unknown";
  // The student's languages: Swedish, plus English unless English is the
  // language being learned. Other target languages don't compete.
  const ui = targetCode === "en" ? [SETS.sv] : [SETS.sv, SETS.en];
  let t = 0, u = 0;
  for (const w of s.match(/[\p{L}]+/gu) || []) {
    const inTarget = target.has(w);
    const inUi = ui.some((set) => set.has(w));
    if (inTarget && inUi) continue;                 // shared word: no evidence
    if (inTarget) t++;
    else if (inUi) u++;
  }
  for (const [lang, re] of Object.entries(CUES)) {
    const n = (s.match(re) || []).length;
    if (!n) continue;
    if (lang === targetCode) t += 2 * n;
    else if (lang === "sv") u += 2 * n;
  }
  // "ü" is a cue for both es and de; whichever isn't the target simply doesn't count.
  if (t === u) return "unknown";
  return t > u ? "target" : "ui";
}

/** "Spanska 3" / "Spanish" → { code: "es", bcp: "es-ES" }; null for anything
 *  that isn't a language subject. */
export function targetLangFor(subjectName) {
  const n = String(subjectName || "").toLowerCase();
  if (/spanska|spanish|español/.test(n)) return { code: "es", bcp: "es-ES" };
  if (/tyska|german|deutsch/.test(n)) return { code: "de", bcp: "de-DE" };
  if (/franska|french|français/.test(n)) return { code: "fr", bcp: "fr-FR" };
  if (/engelska|english/.test(n)) return { code: "en", bcp: "en-GB" };
  return null;
}

const QUOTED = /["“«„]([^"”»“]+?)["”»“]/g;

/**
 * Split a prompt into runs and say which are target-language. Quoted spans
 * are usually the target-language examples, unless they read as the student's
 * own language (a "translate this" sentence); the text around them is the
 * instruction, which is the student's language unless it clearly isn't.
 * → [{ text, target: boolean, quoted: boolean }]
 */
export function segmentPrompt(text, targetCode) {
  const src = String(text || "");
  const isTarget = (s, quoted) => {
    const c = classify(s, targetCode);
    return c === "target" || (c === "unknown" && (quoted || targetCode === "en"));
  };
  const out = [];
  const add = (s, target, quoted) => {
    const prev = out[out.length - 1];
    if (prev && !quoted && !prev.quoted && prev.target === target) prev.text += " " + s;
    else out.push({ text: s, target, quoted });
  };
  // Text between quotes is judged a sentence at a time, so "Samma text. ¿Qué
  // hace Ana?" comes out as Swedish + Spanish rather than one muddle.
  const pushFrame = (s) => {
    // Sentences by lookahead only (a lookbehind here is a SyntaxError on Safari before 16.4).
    for (const sentence of s.match(/[\s\S]+?(?:[.!?:]+(?=\s|$)|$)/g) || []) if (sentence.trim()) add(sentence.trim(), isTarget(sentence, false), false);
  };
  let last = 0, m;
  const re = new RegExp(QUOTED.source, "g");
  while ((m = re.exec(src))) {
    pushFrame(src.slice(last, m.index));
    if (m[1].trim()) add(m[1], isTarget(m[1], true), true);
    last = m.index + m[0].length;
  }
  pushFrame(src.slice(last));
  return out;
}

/** The target-language phrases quoted in a prompt, in order. */
export function targetPhrases(prompt, targetCode) {
  return segmentPrompt(prompt, targetCode).filter((s) => s.quoted && s.target).map((s) => s.text.trim());
}

/** The prompt with its quoted target-language text hidden — for "listen
 *  first" practice. Unquoted text and translations stay readable. */
export function maskTargetSpans(prompt, targetCode, mask = "···") {
  return String(prompt || "").replace(new RegExp(QUOTED.source, "g"), (whole, inner) =>
    (classify(inner, targetCode) === "ui" ? whole : whole.replace(inner, mask)));
}

/**
 * Are a question's answer choices in the target language? Options within one
 * question are all one language in these sets, so read them together; when
 * they're too short to tell ("llegué / cocinaba"), lean on the prompt: a gap
 * means the choices fill it (target), a quoted target phrase with no gap means
 * they translate it (the student's language). English sets are English
 * throughout, so there only a clearly Swedish list counts as "not target".
 */
export function choicesAreTarget(choices, prompt, targetCode) {
  const joined = (choices || []).join(" . ");
  if (!/[\p{L}]/u.test(joined)) return false;       // numbers and the like
  const c = classify(joined, targetCode);
  if (c === "target") return true;
  if (c === "ui") return false;
  if (targetCode === "en") return true;
  const p = prompt || "";
  if (/_{2,}/.test(p)) return true;
  // A quoted target word followed by its gloss — "sehen" (se) — asks for a
  // form of that word (participle, feminine…), so the options are target too.
  const glossed = new RegExp(QUOTED.source + "\\s*\\(", "g");
  let g;
  while ((g = glossed.exec(p))) if (classify(g[1], targetCode) !== "ui") return true;
  return !segmentPrompt(p, targetCode).some((s) => s.quoted && s.target);
}

/* ---------------------------------------------------------------------------
 * Which language is each PART of a text in? (no target language needed)
 *
 * Read-aloud must never voice Spanish in a Swedish voice or the reverse, and a sentence that mixes
 * two languages has to change voice where the language changes. classify()/segmentPrompt() above
 * answer that for a language set (the subject says what the target is); this answers it for any
 * text - a tutor reply, a conversation line, a reading passage - across the five languages the
 * word lists cover.
 *
 * Every word is labelled with the ONE language whose list holds it (a word in several lists, or
 * one letter, says nothing), or with a language its spelling gives away (ñ, ß, å, ç ...). The path
 * through the words that costs least is then the answer. So one stray word never flips the voice
 * (the lists aren't perfect: Swedish "hund" is only in the German one); a foreign phrase inside a
 * sentence needs about three words of evidence, a whole foreign sentence two (or one with a clear
 * spelling), and a foreign word or phrase in quotes just one.
 * ------------------------------------------------------------------------- */

const CODES = ["sv", "en", "es", "de", "fr"];
/** The locale to ask the device for, per language. */
export const LANG_BCP = { sv: "sv-SE", en: "en-GB", es: "es-ES", de: "de-DE", fr: "fr-FR" };

const WORD_LANG = new Map();
{
  const owners = new Map();
  for (const c of CODES) for (const w of SETS[c]) owners.set(w, (owners.get(w) || []).concat(c));
  for (const [w, cs] of owners) if (cs.length === 1 && w.length > 1) WORD_LANG.set(w, cs[0]);
}
// Characters only one of the five uses. Not é (French and Spanish), ä / ö (Swedish and German) or ü
// (German and Spanish): those say nothing.
const WORD_CUES = [["es", /[ñáíóú]/], ["fr", /[çœèêëàâîïôùû]/], ["de", /ß/], ["sv", /å/]];

/** { lang, weight } for a word that points at one language, else null. Weight 1 is a word from that
 *  language's list; 2 is a spelling only that language uses (ñ, ß, å ...), or both together - a word
 *  like "dónde" is Spanish beyond doubt, while "hund" alone (it is Swedish too) is only a hint. */
function wordLang(word) {
  const w = word.toLowerCase();
  if (w.length < 2) return null;
  const listed = WORD_LANG.get(w) || null;
  let cued = null;
  for (const [lang, re] of WORD_CUES) if (re.test(w)) { cued = lang; break; }
  if (listed && cued && listed !== cued) return { lang: listed, weight: 1 };
  if (listed || cued) return { lang: listed || cued, weight: cued ? 2 : 1 };
  return null;
}

const QUOTE_BETWEEN = /["“”«»„]/;                // a quoted word or phrase: set off, so cheap to switch
const BREAK_BETWEEN = /[.!?…:;()\n\r—–]/;        // a sentence or clause break
const OPENERS = /["“«„(¿¡]/;

/**
 * Split `text` into runs by language: [{ text, code }] with code one of sv / en / es / de / fr, in
 * order, adjacent runs always different. `home` is the language assumed where there is no evidence
 * (numbers, names, a run of unknown words). The runs joined together are exactly `text`.
 */
export function segmentByLanguage(text, home = "sv") {
  const src = String(text ?? "");
  const words = [];
  for (const m of src.matchAll(/\p{L}+/gu)) {
    const l = wordLang(m[0]);
    words.push({ start: m.index, end: m.index + m[0].length, lang: l ? l.lang : null, weight: l ? l.weight : 0 });
  }
  const homeIx = Math.max(0, CODES.indexOf(home));
  const homeCode = CODES[homeIx];
  if (!words.length) return src.trim() ? [{ text: src, code: homeCode }] : [];

  // Costs, in "words that disagree": a word of another language costs 2 x its weight. Changing language costs
  // 0.1 at a quote. Mid-sentence, going INTO another language costs 3 and coming back to `home` costs 1, so a
  // phrase inside a sentence needs three words (two would be a tie, which stays put) and one home-language word
  // after it pulls the voice back. Across a sentence break, going into another language costs 2.2 - just more
  // than one listed word is worth, so a foreign sentence needs two (or one with a clear spelling), and less
  // than a mid-sentence switch, so the change lands at the break rather than at the first word we can
  // identify - and coming back to `home` is free, so unmarked text after a foreign sentence isn't dragged
  // along with it. Starting a text in a language other than `home` costs 2.5: two listed words, or one clear
  // spelling.
  const S = CODES.length, MISS = 2, INTO = 3, BACK_HOME = 1, BREAK_ENTER = 2.2, QUOTE_SWITCH = 0.1, START_OFF_HOME = 2.5;
  const emit = (w, s) => (w.lang === null ? (s === homeIx ? 0 : 0.02) : (w.lang === CODES[s] ? 0 : MISS * w.weight));
  const cost = words.map(() => new Array(S).fill(Infinity));
  const back = words.map(() => new Array(S).fill(0));
  for (let s = 0; s < S; s++) cost[0][s] = (s === homeIx ? 0 : START_OFF_HOME) + emit(words[0], s);
  for (let i = 1; i < words.length; i++) {
    const gap = src.slice(words[i - 1].end, words[i].start);
    const kind = QUOTE_BETWEEN.test(gap) ? "quote" : BREAK_BETWEEN.test(gap) ? "break" : "word";
    for (let s = 0; s < S; s++) {
      let best = cost[i - 1][s] + emit(words[i], s), from = s;     // staying put wins a tie
      const toHome = s === homeIx;
      const change = kind === "quote" ? QUOTE_SWITCH : kind === "break" ? (toHome ? 0 : BREAK_ENTER) : (toHome ? BACK_HOME : INTO);
      for (let p = 0; p < S; p++) {
        if (p === s) continue;
        const c = cost[i - 1][p] + change + emit(words[i], s);
        if (c < best) { best = c; from = p; }
      }
      cost[i][s] = best; back[i][s] = from;
    }
  }
  let s = 0;
  for (let k = 1; k < S; k++) if (cost[words.length - 1][k] < cost[words.length - 1][s]) s = k;
  const path = new Array(words.length);
  for (let i = words.length - 1; i >= 0; i--) { path[i] = s; s = back[i][s]; }

  const runs = [];
  let cut = 0, cur = path[0];
  for (let i = 1; i < words.length; i++) {
    if (path[i] === cur) continue;
    let at = words[i].start;
    while (at > words[i - 1].end && OPENERS.test(src[at - 1])) at--;   // an opening quote goes with the run it opens
    runs.push({ text: src.slice(cut, at), code: CODES[cur] });
    cut = at; cur = path[i];
  }
  runs.push({ text: src.slice(cut), code: CODES[cur] });
  return runs;
}
