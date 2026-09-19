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
  sv: `och det att är som på av inte har vi för med den till ett om men var sig så kan man när vad hur vilken vilka vilket eller från ska vill blir bli detta dessa denna mig dig honom henne oss dem sin sitt sina din ditt dina min mitt mina vår vårt våra ni han vara varit hade skulle skall får fick alla någon något inga inget också bara mycket mer mest mellan efter innan under över genom utan vid hos enligt mot medan eftersom därför här där nu då ju väl ännu redan alltid aldrig ofta ibland ganska jag hon välj rätt mening betyder texten läs vem varför hjälpa hjälper kände träffade tänkte saknade samma svar meddelande frågar säger säg heter finns gillar tycker äter dricker bor kommer går ligger sitter står jul natt god dag morgon kväll hej tack snälla ursäkta förlåt vänta måndag tisdag onsdag torsdag fredag lördag söndag januari februari mars april maj juni juli augusti september oktober november december vecka månad idag igår imorgon bord stol bröd mjölk ost smör kött fisk frukt grönsaker vatten kaffe mamma pappa syster bror morbror farbror moster faster kusin syskon farmor farfar mormor morfar bättre bäst större störst liten stor gammal ung snabb långsam glad ledsen röd blå grön gul svart vit`,
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
    for (const sentence of s.split(/(?<=[.!?:])\s+/)) if (sentence.trim()) add(sentence.trim(), isTarget(sentence, false), false);
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
