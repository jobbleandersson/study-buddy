// The TikTok photo carousels: every post, its slides, its caption and hashtags. render-carousels.mjs
// draws them with carousel.html. Questions come straight from the app's reviewed library (data/library),
// so a slide always matches what PluggEra teaches; facts about Högskoleprovet come from js/lib/hp.js
// (eight delprov, 55 minutes a provpass, the time per question the app's timed runs use).
//
// Slide types (see slides.js): hook, question, answer, text (title/body/list/vs), formula, curve, cta.
// Text takes **bold**, *italic*, ==highlight==, $math$ and \n; a list item is [title, detail, marker?].

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lib = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "library", file), "utf8"));
export const hpQ = (dp, i) => lib(`hp-2026v-${dp}.json`).questions[i];
const libQ = (file, match) => {
  const q = lib(file).questions.find((x) => x.prompt.includes(match));
  if (!q) throw new Error(`No question in ${file} with "${match}"`);
  return q;
};

export const HP_DATE = "söndag 18 oktober";
export const DELPROV = { xyz: "XYZ · Matematisk problemlösning", kva: "KVA · Kvantitativa jämförelser", nog: "NOG · Kvantitativa resonemang", mek: "MEK · Meningskomplettering" };

const HP_CTA = {
  type: "cta", title: "Öva på alla åtta delprov. ==Gratis.==",
  ticks: ["Riktiga provfrågor med förklaring", "Uppskattad normerad poäng", "En plan fram till provdagen"],
  url: "pluggera.se/hp",
};
const APP_CTA = (title, ticks) => ({ type: "cta", title, ticks, url: "pluggera.se" });
export const TAGS_HP = ["#högskoleprovet", "#hp", "#hp2026", "#studietips", "#plugga", "#studytok"];

/** A question from the library as a four-slide challenge: the hook, the question, the answer, where to practise. */
function challenge({ id, series = "hp", badge, q, label, hook, sub, sticker, prompt, verdict, explanation, cta, caption, tags }) {
  const shared = { label, prompt: prompt ?? q.prompt, options: q.choices, given: q.stimulus?.given, quantities: q.stimulus?.quantities, statements: q.stimulus?.statements, small: q.choices.length > 4 || q.choices.some((c) => c.length > 30) };
  return {
    id, series, caption, tags,
    slides: [
      { type: "hook", badge, title: hook, sub, sticker, swipeText: "Svep och testa" },
      { type: "question", badge, ...shared },
      { type: "answer", badge, label, options: q.choices, answer: q.answer, verdict: verdict ?? `Rätt svar: ${"ABCDE"[q.answer]}`, explanation: explanation ?? q.explanation, prompt: null },
      { ...(cta || HP_CTA), badge },
    ],
  };
}

export const POSTS = [
  /* ---------------- HP-nedräkningen: veckan fram till provet ---------------- */
  {
    id: "hp-7-dagar", series: "countdown",
    caption: `7 dagar kvar till högskoleprovet (${HP_DATE}). Spara planen och tagga någon som också skriver! Öva gratis på alla åtta delprov, länk i bio.`,
    tags: TAGS_HP,
    slides: [
      { type: "hook", badge: "HP-nedräkningen", label: `Högskoleprovet, ${HP_DATE}`, big: "7", title: "dagar kvar till HP. ==Gör så här.==", sub: "En plan för sista veckan. Spara den." },
      { type: "text", badge: "HP-nedräkningen", title: "Veckan, dag för dag", list: [
        ["Dag 1", "Gör ett provpass på tid. Se var du tappar poäng."],
        ["Dag 2–3", "Öva på de två delprov där du tappar mest."],
        ["Dag 4", "Ett provpass till, på tid. Träna tempot."],
        ["Dag 5", "Gå igenom dina fel. Varför blev det fel?"],
        ["Dag 6", "Lätt repetition. Inga nya maraton."],
        ["Dag 7", "Vila, sov ordentligt och packa legitimation."],
      ] },
      { type: "text", badge: "HP-nedräkningen", title: "Tempot är ==halva provet==", vs: { bad: ["Så här tappar du poäng", "Fastna på en svår fråga i fem minuter."], good: ["Gör så här", "Gissa, markera frågan och gå vidare. Kom tillbaka om tiden räcker."] } },
      { type: "text", badge: "HP-nedräkningen", title: "Lämna ==aldrig== en fråga tom", body: "Fel svar ger inga minuspoäng på HP. En gissning kan bara ge poäng, aldrig ta bort några." },
      { ...HP_CTA, badge: "HP-nedräkningen" },
    ],
  },
  {
    id: "hp-gissa-alltid", series: "countdown",
    caption: "Lämnar du frågor tomma på HP? Sluta med det. Spara och skicka till någon som skriver nu på söndag.",
    tags: TAGS_HP,
    slides: [
      { type: "hook", badge: "HP-nedräkningen", title: "Lämnar du frågor ==tomma== på HP?", sub: "Då ger du bort poäng.", sticker: "HP-tips" },
      { type: "text", badge: "HP-nedräkningen", title: "==Inga== minuspoäng", body: "Ett fel svar ger noll poäng, precis som ett tomt. En gissning kan alltså bara hjälpa." },
      { type: "text", badge: "HP-nedräkningen", title: "Oddsen om du gissar helt blint", list: [["ORD och NOG", "fem svarsalternativ: 20 % chans"], ["LÄS, MEK, ELF, XYZ, KVA, DTK", "fyra svarsalternativ: 25 % chans"]] },
      { type: "text", badge: "HP-nedräkningen", title: "Gissa ==smart==", body: "Stryk först de alternativ som är helt fel. Är två kvar har du 50 % chans." },
      { type: "text", badge: "HP-nedräkningen", title: "==Sista== minuten?", body: "Fyll i ett svar på varje fråga du inte hunnit med. Samma bokstav rakt igenom går snabbast." },
      { ...HP_CTA, badge: "HP-nedräkningen" },
    ],
  },
  {
    id: "hp-tid-per-fraga", series: "countdown",
    caption: "Så mycket tid har du per fråga på högskoleprovet. Spara inför söndag! Öva på tid gratis, länk i bio.",
    tags: TAGS_HP,
    slides: [
      { type: "hook", badge: "HP-nedräkningen", title: "==Hur länge== får du lägga på en HP-fråga?", sub: "55 minuter per provpass. Så räcker de." },
      { type: "text", badge: "HP-nedräkningen", label: "Verbal del, 40 frågor", title: "Ungefär per fråga", list: [["ORD", "cirka 18 sekunder"], ["MEK", "cirka 48 sekunder"], ["LÄS och ELF", "cirka 2 minuter"]].map(([a, b]) => [a, b, "·"]) },
      { type: "text", badge: "HP-nedräkningen", label: "Kvantitativ del, 40 frågor", title: "Ungefär per fråga", list: [["XYZ och KVA", "cirka 1 minut"], ["NOG", "cirka 1 minut 40 sekunder"], ["DTK", "cirka 2 minuter"]].map(([a, b]) => [a, b, "·"]) },
      { type: "text", badge: "HP-nedräkningen", title: "Spara tid ==där det går==", body: "Gå snabbt på ORD. Tiden du sparar där behöver du på läsförståelsen." },
      { ...HP_CTA, badge: "HP-nedräkningen" },
    ],
  },
  {
    id: "hp-kvallen-innan", series: "countdown",
    caption: "Kvällen innan HP: gör det här. Spara och skicka till din HP-kompis!",
    tags: TAGS_HP,
    slides: [
      { type: "hook", badge: "HP-nedräkningen", title: "Kvällen ==innan HP==", sub: "Checklistan inför provdagen.", sticker: "Spara den!" },
      { type: "text", badge: "HP-nedräkningen", title: "Packa", list: [["Giltig legitimation", "utan den får du inte skriva"], ["Kallelsen", "kolla tid och plats igen"], ["Mat och vatten", "provet pågår hela dagen"]].map(([a, b]) => [a, b, "✓"]) },
      { type: "text", badge: "HP-nedräkningen", title: "Gör inte", vs: { bad: ["Kvällen innan", "Plugga till midnatt och sova fem timmar."], good: ["Gör i stället", "Lätt repetition en stund, sedan vila och sömn."] } },
      { type: "text", badge: "HP-nedräkningen", title: "På morgonen", list: [["Ät frukost", ""], ["Var på plats i god tid", ""], ["Tänk: varje fråga är en ny chans", ""]] },
      { ...HP_CTA, badge: "HP-nedräkningen", title: "Lycka till på ==söndag!==", ticks: ["Öva en sista gång gratis", "Alla åtta delprov, med förklaring"] },
    ],
  },
  {
    id: "hp-hur-gick-det", series: "countdown",
    caption: "Hur gick högskoleprovet? Vilket delprov var svårast? Skriv i kommentarerna!",
    tags: TAGS_HP,
    slides: [
      { type: "hook", badge: "Efter HP", title: "Hur gick ==HP?==", sub: "Rösta i kommentarerna.", sticker: "Rösta!", swipe: false },
      { type: "text", badge: "Efter HP", title: "Vilket delprov var ==svårast?==", list: [["ORD", ""], ["LÄS", ""], ["MEK", ""], ["ELF", ""], ["XYZ", ""], ["KVA", ""], ["NOG", ""], ["DTK", ""]], note: "Skriv siffran i kommentarerna." },
      { type: "text", badge: "Efter HP", title: "Skriver du ==igen?==", body: "Börja i tid. 15 minuter om dagen räcker långt, särskilt på det delprov som drar ner mest." },
      { ...HP_CTA, badge: "Efter HP" },
    ],
  },

  /* ---------------- HP-utmaningen: en riktig HP-fråga, testa dig ---------------- */
  challenge({
    id: "hp-procentfallan", badge: "HP-utmaningen", q: hpQ("kva", 9), label: DELPROV.kva,
    hook: "Sänk priset 10 %. Höj det sedan 10 %. ==Samma pris igen?==", sub: "En klassisk HP-fälla.", sticker: "HP-fälla",
    caption: "Sänk 10 %, höj 10 %. Samma pris? Svara innan du sveper! Fler HP-frågor gratis, länk i bio.", tags: TAGS_HP,
    explanation: "$0{,}9 \\cdot 1{,}1 = 0{,}99$. Priset hamnar 1 % under det ursprungliga, vilket startpris det än är.",
  }),
  challenge({
    id: "hp-procenttricket", badge: "HP-utmaningen", q: hpQ("kva", 0), label: DELPROV.kva,
    hook: "Det här ==procenttricket== sparar tid på HP", sub: "25 % av 80 eller 80 % av 25: vilket är störst?",
    caption: "Procenttricket som sparar tid på HP. Visste du det här? Öva gratis, länk i bio.", tags: TAGS_HP,
    explanation: "$25\\% \\cdot 80 = 20$ och $80\\% \\cdot 25 = 20$. *a % av b* är alltid lika med *b % av a*.",
  }),
  challenge({
    id: "hp-prishojningen", badge: "HP-utmaningen", q: hpQ("xyz", 1), label: DELPROV.xyz,
    hook: "240 kr efter 20 % höjning. ==Vad kostade den innan?==", sub: "Lätt att svara 192 kr. Men det är fel.",
    caption: "Vad kostade varan innan höjningen? Skriv ditt svar innan du sveper! Fler HP-frågor gratis, länk i bio.", tags: TAGS_HP,
    explanation: "Nytt pris $= 1{,}20 \\cdot$ gamla priset, så gamla priset $= 240 / 1{,}20 = 200$ kr. 192 kr får man om man drar 20 % av 240, men höjningen räknades på det gamla priset.",
  }),
  challenge({
    id: "hp-a-plus-b", badge: "HP-utmaningen", q: hpQ("kva", 3), label: DELPROV.kva,
    hook: "$a + b$ eller $a \\cdot b$: ==vilket är störst?==", sub: "Svaret är inte det du tror.",
    caption: "a + b eller a · b? Svara i kommentarerna innan du sveper! Öva KVA gratis, länk i bio.", tags: TAGS_HP,
  }),
  challenge({
    id: "hp-nog-fallan", badge: "HP-utmaningen", q: hpQ("nog", 3), label: DELPROV.nog,
    hook: "Den klassiska ==NOG-fällan==", sub: "Två påståenden. Räcker de för att lösa uppgiften?", sticker: "HP-fälla",
    caption: "Den klassiska NOG-fällan. Gick du på den? Öva NOG gratis, länk i bio.", tags: TAGS_HP,
  }),
  challenge({
    id: "hp-medelhastighet", badge: "HP-utmaningen", q: hpQ("nog", 8), label: DELPROV.nog,
    hook: "60 km/h halva vägen. 90 km/h resten. ==Hur lång tid tar resan?==", sub: "En NOG-fråga från HP-övningarna.",
    caption: "Hur lång tid tar resan? Svara innan du sveper! Fler NOG-frågor gratis, länk i bio.", tags: TAGS_HP,
  }),
  challenge({
    id: "hp-delare-24", badge: "HP-utmaningen", q: hpQ("xyz", 4), label: DELPROV.xyz,
    hook: "Hur många heltal går jämnt upp i ==24?==", sub: "XYZ-fråga. Hinner du på en minut?", sticker: "1 minut",
    caption: "Hur många heltal delar 24? Svara innan du sveper! Öva XYZ gratis, länk i bio.", tags: TAGS_HP,
  }),
  challenge({
    id: "hp-cirkel-kvadrat", badge: "HP-utmaningen", q: hpQ("kva", 8), label: DELPROV.kva,
    hook: "Cirkel eller kvadrat: ==vem har störst area?==", sub: "Samma $r$ i båda.",
    caption: "Cirkel eller kvadrat? Svara i kommentarerna! Fler KVA-frågor gratis, länk i bio.", tags: TAGS_HP,
  }),
  challenge({
    id: "hp-korrelation", badge: "HP-utmaningen", q: hpQ("mek", 4), label: DELPROV.mek,
    hook: "Samband ==eller orsak?==", sub: "En MEK-fråga som är bra att kunna även utanför provet.",
    caption: "Korrelation är inte kausalitet. Klarar du MEK-frågan? Öva gratis, länk i bio.", tags: TAGS_HP,
  }),
  challenge({
    id: "hp-saltet", badge: "HP-utmaningen", q: hpQ("xyz", 11), label: DELPROV.xyz,
    hook: "Salt och vatten i förhållandet 1 : 24. ==Hur mycket salt finns i 500 g?==", sub: "Tänk på hur många delar det finns.",
    caption: "Hur många gram salt? Svara innan du sveper! Fler XYZ-frågor gratis, länk i bio.", tags: TAGS_HP,
  }),

  /* ---------------- Pluggknep som funkar ---------------- */
  {
    id: "knep-testa-dig", series: "tips",
    caption: "Sluta läsa om inför provet. Gör det här i stället. Spara till nästa prov!",
    tags: ["#studietips", "#pluggtips", "#plugga", "#studytok", "#skola", "#prov"],
    slides: [
      { type: "hook", badge: "Pluggknep", title: "==Sluta läsa om.== Gör det här i stället.", sub: "Det mest underskattade pluggknepet.", sticker: "Spara!" },
      { type: "text", badge: "Pluggknep", title: "Att läsa om känns som att lära sig", body: "Men mycket av det är igenkänning: texten känns bekant. Det betyder inte att du kan plocka fram den på provet." },
      { type: "text", badge: "Pluggknep", title: "Testa ==dig själv==", vs: { bad: ["Läsa om", "Stryka under och läsa samma kapitel igen."], good: ["Testa dig", "Stäng boken och svara på frågor ur minnet."] } },
      { type: "text", badge: "Pluggknep", title: "Varför det ==funkar==", body: "Varje gång du hämtar något ur minnet blir det lättare att hitta nästa gång. Forskare kallar det *retrieval practice*, och det är en av de bäst belagda studieteknikerna." },
      { type: "text", badge: "Pluggknep", title: "Så gör du", list: [["Gör frågor av dina anteckningar", "eller låt PluggEra göra dem"], ["Svara utan att titta", ""], ["Kolla svaren", "och öva mest på det du missade"]] },
      { ...APP_CTA("Gör frågor av dina anteckningar", ["Klistra in text, en PDF eller ett foto", "Förklaring till varje fråga", "Gratis och utan reklam"]), badge: "Pluggknep" },
    ],
  },
  {
    id: "knep-glomskekurvan", series: "tips",
    caption: "Därför glömmer du det du pluggade igår, och hur du slutar göra det. Spara!",
    tags: ["#studietips", "#pluggtips", "#plugga", "#studytok", "#minne", "#skola"],
    slides: [
      { type: "hook", badge: "Pluggknep", title: "Därför ==glömmer du== det du pluggade igår", sub: "Och vad du gör åt det." },
      { type: "curve", badge: "Pluggknep", title: "Glömskekurvan", body: "Utan repetition faller det du minns snabbt, mest de första dagarna. *Schematisk bild.*" },
      { type: "curve", badge: "Pluggknep", title: "Repetera ==precis innan== du glömmer", repeats: true, body: "Varje repetition lyfter kurvan, och efter varje gång faller den långsammare." },
      { type: "text", badge: "Pluggknep", title: "Ett enkelt schema", list: [["Idag", "plugga och testa dig"], ["Imorgon", "repetera kort"], ["Om 3 dagar", "repetera igen"], ["Om en vecka", "och igen, med allt längre mellanrum"]] },
      { type: "text", badge: "Pluggknep", title: "Låt appen hålla koll", body: "I PluggEra kommer frågorna du missar tillbaka med lagom mellanrum, tills du kan dem." },
      { ...APP_CTA("Repetition som sköter sig själv", ["Frågorna kommer tillbaka innan du glömmer", "Färdiga set för åk 7 till gymnasiet", "Gratis och utan reklam"]), badge: "Pluggknep" },
    ],
  },
  {
    id: "knep-forklara", series: "tips",
    caption: "Kan du förklara det för en 12-åring? Testa inför nästa prov. Spara!",
    tags: ["#studietips", "#pluggtips", "#feynman", "#plugga", "#studytok"],
    slides: [
      { type: "hook", badge: "Pluggknep", title: "Kan du förklara det för ==en 12-åring?==", sub: "Annars kan du det inte än." },
      { type: "text", badge: "Pluggknep", title: "Fyra steg", list: [["Välj ett begrepp", "till exempel fotosyntes"], ["Förklara det enkelt", "högt eller på papper, utan att titta"], ["Hitta luckorna", "där du fastnar är det du inte förstår"], ["Fyll i och förklara igen", "ännu enklare"]] },
      { type: "text", badge: "Pluggknep", title: "Egna ord ==slår== definitioner", vs: { bad: ["Rabbla", "”Fotosyntes är en process där …”"], good: ["Förklara", "”Växten gör socker av ljus, vatten och koldioxid, och släpper ut syre.”"] } },
      { type: "text", badge: "Pluggknep", title: "Prova i PluggEra", body: "När du kan ett ämne får du förklara det med egna ord för PluggEras handledare, och se vad som saknas." },
      { ...APP_CTA("Plugga smartare, inte längre", ["Övningar för åk 7 till högskoleprovet", "En handledare som förklarar", "Gratis och utan reklam"]), badge: "Pluggknep" },
    ],
  },
  {
    id: "knep-blanda", series: "tips",
    caption: "Kör du 20 likadana mattetal i rad? Blanda i stället. Spara inför matteprovet!",
    tags: ["#studietips", "#matte", "#pluggtips", "#plugga", "#studytok"],
    slides: [
      { type: "hook", badge: "Pluggknep", title: "Kör du ==20 likadana== mattetal i rad?", sub: "Blanda i stället." },
      { type: "text", badge: "Pluggknep", title: "Två sätt att öva", vs: { bad: ["I block", "20 procenttal, sedan 20 ekvationer."], good: ["Blandat", "Procent, ekvation, geometri, procent …"] } },
      { type: "text", badge: "Pluggknep", title: "Varför?", body: "På provet står det inte vilken metod som gäller. När du blandar tränar du på att *välja* metod, inte bara på att köra den." },
      { type: "text", badge: "Pluggknep", title: "Det känns svårare. ==Det är poängen.==", body: "Blandad övning känns segare, men den hjälper ofta mer när det är dags för prov." },
      { ...APP_CTA("Repetitionen blandar åt dig", ["Frågor från alla dina set, blandat", "Förklaring till varje fråga", "Gratis och utan reklam"]), badge: "Pluggknep" },
    ],
  },
  {
    id: "knep-25-minuter", series: "tips",
    caption: "Kommer du inte igång med pluggandet? Testa 25 minuter. Spara!",
    tags: ["#studietips", "#pomodoro", "#plugga", "#studytok", "#motivation"],
    slides: [
      { type: "hook", badge: "Pluggknep", big: "25", title: "minuter plugg. 5 minuter paus. ==Upprepa.==", sub: "Så kommer du igång när du inte orkar." },
      { type: "text", badge: "Pluggknep", title: "Så gör du", list: [["Lägg mobilen i ett annat rum", ""], ["Ställ en timer på 25 minuter", ""], ["Jobba med en enda sak", ""], ["Paus i 5 minuter", "res dig upp och rör på dig"], ["Efter fyra varv", "ta en längre paus"]] },
      { type: "text", badge: "Pluggknep", title: "Varför det ==funkar==", body: "Det är lättare att börja när det bara gäller 25 minuter. Och pauserna gör att du orkar längre." },
      { ...APP_CTA("Fokustimern finns i PluggEra", ["Slå på den under Inställningar", "Plugga i 25 eller 50 minuter", "Gratis och utan reklam"]), badge: "Pluggknep" },
    ],
  },
  {
    id: "knep-egna-regler", series: "tips",
    caption: "Gör du samma fel om och om igen? Skriv en egen regel. Spara!",
    tags: ["#studietips", "#pluggtips", "#plugga", "#studytok", "#skola"],
    slides: [
      { type: "hook", badge: "Pluggknep", title: "Gör du ==samma fel== om och om igen?", sub: "Testa det här." },
      { type: "text", badge: "Pluggknep", title: "Skriv en regel när du gör fel", body: "En mening, med egna ord, om vad du ska tänka på nästa gång." },
      { type: "text", badge: "Pluggknep", title: "Till exempel", list: [["Procent", "Sänk 15 %: gånga med 0,85, dra inte bara av 15."], ["Engelska", "Past simple för avslutad tid: yesterday, last week."], ["Svenska", "Efter preposition blir det *dem*: med dem, till dem."]].map(([a, b]) => [a, b, "”"]) },
      { type: "text", badge: "Pluggknep", title: "Varför egna ord?", body: "När du formulerar regeln själv bearbetar du felet. I PluggEra dyker regeln upp igen nästa gång frågan kommer tillbaka." },
      { ...APP_CTA("Mina regler, i PluggEra", ["Skriv en regel när du svarar fel", "Den visas när frågan kommer tillbaka", "Skriv ut alla inför provet"]), badge: "Pluggknep" },
    ],
  },

  /* ---------------- Formler du måste kunna ---------------- */
  {
    id: "formler-matteprovet", series: "formula",
    caption: "5 formler du måste kunna till matteprovet. Spara den och skicka till din klass!",
    tags: ["#matte", "#formler", "#matteprov", "#nationellaprov", "#gymnasiet", "#studytok"],
    slides: [
      { type: "hook", badge: "Formler", big: "5", title: "formler du ==måste kunna== till matteprovet", sub: "Spara inför provet." },
      { type: "formula", badge: "Formler", label: "1 av 5", title: "Pythagoras sats", tex: "a^2 + b^2 = c^2", legend: [["$a, b$", "kateterna"], ["$c$", "hypotenusan, mitt emot den räta vinkeln"]], example: "Kateterna 3 och 4 ger $c = \\sqrt{9 + 16} = 5$." },
      { type: "formula", badge: "Formler", label: "2 av 5", title: "Förändringsfaktor", tex: "\\text{nytt} = f \\cdot \\text{gammalt}", legend: [["$f$", "1 + ökningen, eller 1 − minskningen"]], example: "+20 % ger $f = 1{,}20$. −15 % ger $f = 0{,}85$." },
      { type: "formula", badge: "Formler", label: "3 av 5", title: "Räta linjens ekvation", tex: "y = kx + m", legend: [["$k$", "lutningen"], ["$m$", "där linjen skär $y$-axeln"]], example: "$y = 2x + 3$ skär $y$-axeln i 3 och stiger 2 för varje steg åt höger." },
      { type: "formula", badge: "Formler", label: "4 av 5", title: "Cirkelns area", tex: "A = \\pi r^2", legend: [["$r$", "radien"]], example: "$r = 3$ ger $A = 9\\pi \\approx 28{,}3$." },
      { type: "formula", badge: "Formler", label: "5 av 5", title: "Sannolikhet", tex: "P = \\dfrac{\\text{gynnsamma utfall}}{\\text{möjliga utfall}}", long: true, example: "En sexa på en tärning: $P = \\dfrac{1}{6}$." },
      { ...APP_CTA("Alla formler på ett ställe", ["143 formler i matte, fysik och kemi", "Sök på till exempel hypotenusa eller pH", "Fungerar offline"]), badge: "Formler" },
    ],
  },
  {
    id: "formler-procent-10-sek", series: "formula",
    caption: "Procent på 10 sekunder med förändringsfaktor. Spara till nästa matteprov!",
    tags: ["#matte", "#procent", "#mattetips", "#högstadiet", "#gymnasiet", "#studytok"],
    slides: [
      { type: "hook", badge: "Formler", title: "Procent på ==10 sekunder==", sub: "Knepet heter förändringsfaktor.", sticker: "Spara!" },
      { type: "text", badge: "Formler", title: "240 kr höjs med 20 %", vs: { bad: ["Långa vägen", "Räkna ut 20 % av 240, lägg sedan till det."], good: ["Snabba vägen", "$240 \\cdot 1{,}20 = 288$ kr"] } },
      { type: "text", badge: "Formler", title: "Gånga med", list: [["+25 %", "gånga med 1,25"], ["−30 %", "gånga med 0,70"], ["+5 %", "gånga med 1,05"], ["−2 %", "gånga med 0,98"]].map(([a, b]) => [a, b, "×"]) },
      { type: "text", badge: "Formler", title: "Två förändringar? ==Multiplicera.==", body: "−10 % och sedan +10 %: $0{,}9 \\cdot 1{,}1 = 0{,}99$. Priset hamnar 1 % lägre, inte på samma." },
      { type: "text", badge: "Formler", title: "Baklänges", body: "Efter en höjning på 20 % kostar den 240 kr. Innan dess: $240 / 1{,}20 = 200$ kr." },
      { ...APP_CTA("Öva procent tills det sitter", ["Färdiga set för åk 7 till gymnasiet", "Förklaring till varje fråga", "Gratis och utan reklam"]), badge: "Formler" },
    ],
  },

  /* ---------------- Klarar du åk 9? ---------------- */
  {
    id: "ak9-de-dem", series: "ak9",
    caption: "De eller dem? Hur många fick du rätt? Skriv i kommentarerna!",
    tags: ["#svenska", "#dedem", "#högstadiet", "#åk9", "#studytok", "#språk"],
    slides: (() => {
      const qs = ["sprang hela vägen", "pratade med ___ på rasten", "har redan ätit lunch"].map((m) => libQ("ak9-sv-sprakriktighet.json", m));
      const fill = (q) => q.prompt.replace(/^Välj rätt ord: /, "").replace(/^"|"$/g, "");
      const done = (q) => fill(q).replace("___", `**${q.choices[q.answer]}**`);
      return [
        { type: "hook", badge: "Klarar du åk 9?", title: "==De== eller ==dem?==", sub: "Tre meningar. Hur många får du rätt?", sticker: "3 frågor" },
        { type: "text", badge: "Klarar du åk 9?", title: "Fyll i: de eller dem?", list: qs.map((q) => [fill(q), ""]), note: "Skriv dina svar i kommentarerna." },
        { type: "text", badge: "Klarar du åk 9?", title: "==Facit==", list: qs.map((q, k) => [done(q), ["subjekt", "efter en preposition", "subjekt"][k]]) },
        { type: "text", badge: "Klarar du åk 9?", title: "Knepet", body: "Byt mot engelska: *they* blir de, *them* blir dem.\n*They ran* = de sprang. *With them* = med dem." },
        { ...APP_CTA("Svenska, engelska, matte och mer", ["Färdiga övningar för åk 7 till gymnasiet", "Förklaring till varje fråga", "Gratis och utan reklam"]), badge: "Klarar du åk 9?" },
      ];
    })(),
  },
  challenge({
    id: "ak9-liknelse", series: "ak9", badge: "Klarar du åk 9?", q: libQ("ak9-sv-litteratur.json", "Hennes ögon var som stjärnor"), label: "Svenska, åk 9",
    hook: "==Liknelse== eller ==metafor?==", sub: "”Hennes ögon var som stjärnor.”",
    caption: "Liknelse eller metafor? Svara innan du sveper! Fler övningar gratis, länk i bio.", tags: ["#svenska", "#åk9", "#högstadiet", "#studytok", "#litteratur"],
    cta: APP_CTA("Öva svenska inför provet", ["Bildspråk, ordklasser och språkriktighet", "Förklaring till varje fråga", "Gratis och utan reklam"]),
  }),
  challenge({
    id: "ak9-its", series: "ak9", badge: "Klarar du åk 9?", q: libQ("ak9-en-wordconfusion.json", "wagged"), label: "Engelska, åk 9",
    hook: "==its== eller ==it's?==", sub: "Ett av de vanligaste felen på engelskan.",
    caption: "its eller it's? Svara i kommentarerna! Fler engelskaövningar gratis, länk i bio.", tags: ["#engelska", "#åk9", "#högstadiet", "#studytok", "#english"],
    cta: APP_CTA("Öva engelska inför provet", ["Grammatik, ord och läsförståelse", "Förklaring till varje fråga", "Gratis och utan reklam"]),
  }),
  challenge({
    id: "ak9-medianen", series: "ak9", badge: "Klarar du åk 9?", q: libQ("ak9-matematik-statistik.json", "2, 4, 6, 10"), label: "Matematik, åk 9",
    hook: "Medianen av ==2, 4, 6 och 10?==", sub: "Kluring från åk 9-matten.",
    caption: "Vad blir medianen? Svara innan du sveper! Fler matteövningar gratis, länk i bio.", tags: ["#matte", "#åk9", "#högstadiet", "#studytok", "#statistik"],
    cta: APP_CTA("Öva matte inför provet", ["Färdiga set för åk 7 till gymnasiet", "Förklaring till varje fråga", "Gratis och utan reklam"]),
  }),
];
