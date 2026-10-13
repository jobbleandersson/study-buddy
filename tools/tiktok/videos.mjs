// The TikTok videos: every video, what's in it, its caption and hashtags. render-videos.mjs films them
// with video.html (the kinds are described in video.js). Like the carousels in posts.mjs, the questions
// come straight from the app's reviewed library, and none of these ten repeats a carousel question;
// the HP-ord videos are words 1–5 of the ORD bank, the same as the first "Dagens HP-ord" images.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hpQ, DELPROV, HP_DATE, TAGS_HP } from "./posts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORD_BANK = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "library", "hp-ord-bank-01.json"), "utf8")).questions;
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const HP_TICKS = ["Alla åtta delprov", "Förklaring till varje fråga", "Uppskattad normerad poäng"];
const HP_CTA = { title: "Fler HP-frågor. ==Gratis.==", ticks: HP_TICKS, url: "pluggera.se/hp" };

/** A real HP question against the clock: the hook, the question, the answer and why, where to practise. */
const quiz = ({ id, dp, i, hook, caption }) => ({
  id, kind: "quiz", series: "hp", badge: "Hinner du?", label: DELPROV[dp], q: hpQ(dp, i), hook, cta: HP_CTA, caption, tags: TAGS_HP,
});

/** The short cut of the showcase (see showcase.js): the same five features under a different hook.
 *  The copy is the site's own (its stats, "svarar direkt, dygnet runt", the estimate on the HP hub). */
const promo = ({ id, hook, caption }) => ({
  id, kind: "promo", page: "showcase.html", hook, caption,
  copy: {
    items: {
      library: "Färdiga övningar från ==åk 7 till gymnasiet==",
      question: "==Förklaring== till varje fråga",
      formulas: "==143 formler==, sök på sekunder",
      ai: "==AI-hjälp== dygnet runt",
      hp: "Din ==HP-poäng==, uppskattad",
    },
    cta: { title: "Allt det här ==gratis== på", url: "pluggera.se", sub: "Länken finns i vår bio." },
  },
  tags: ["#plugga", "#studietips", "#högskoleprovet", "#studytok", "#skola", "#pluggera"],
});

/** Dagens HP-ord #n as a video. */
const ord = (n) => {
  const q = ORD_BANK[n - 1];
  const word = q.prompt.match(/\*\*(.+?)\*\*/)[1];
  return {
    id: `hp-ord-${n}-${slug(word)}`, kind: "ord", series: "ord", badge: `Dagens HP-ord #${n}`,
    word, choices: q.choices, answer: q.answer, explanation: q.explanation, secs: 6,
    caption: `Dagens HP-ord #${n}: ${word}. Vad betyder det? Svara innan tiden tar slut! Fler HP-ord gratis, länk i bio.`,
    tags: ["#högskoleprovet", "#hp", "#ordförståelse", "#plugga", "#studietips", "#studytok"],
  };
};

export const VIDEOS = [
  /* ---------------- Hinner du? Riktiga HP-frågor mot klockan ---------------- */
  quiz({ id: "hinner-du-potenser", dp: "xyz", i: 10, hook: "Vad är $2^{10} - 2^{9}$? ==Utan miniräknare.==",
    caption: "Vad är 2^10 − 2^9? Utan miniräknare! Svara innan tiden tar slut. Fler HP-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-brak", dp: "xyz", i: 2, hook: "Två tredjedelar plus en fjärdedel. ==Vad blir det?==",
    caption: "Bråk utan miniräknare. Hinner du? Skriv ditt svar i kommentarerna! Fler HP-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-produkten", dp: "xyz", i: 5, hook: "$a + b = 10$ och $a - b = 4$. ==Vad är produkten?==",
    caption: "a + b = 10 och a − b = 4. Vad är a · b? Svara innan tiden tar slut! Fler HP-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-medelvardet", dp: "xyz", i: 8, hook: "Fem tal har medelvärdet 12. ==Vilket tal saknas?==",
    caption: "Vilket tal saknas? Svara innan tiden tar slut! Fler HP-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-potenser-kva", dp: "kva", i: 6, hook: "$2^5$ eller $5^2$: ==vilket är störst?==",
    caption: "2⁵ eller 5²? Svara innan tiden tar slut! Fler KVA-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-medel-median", dp: "kva", i: 2, hook: "Medelvärdet eller medianen av 3, 5 och 10: ==vilket är störst?==",
    caption: "Medelvärde eller median? Svara innan tiden tar slut! Fler KVA-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-primtal", dp: "kva", i: 11, hook: "Hur många ==primtal== finns det mellan 1 och 20?",
    caption: "Hur många primtal finns det mellan 1 och 20? Svara innan tiden tar slut! Fler HP-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-svavande", dp: "mek", i: 3, hook: "Ingen visste om han var för eller emot. ==Hur var talet?==",
    caption: "Vilket ord passar? Svara innan tiden tar slut! Fler MEK-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-ovilja", dp: "mek", i: 8, hook: "Ett tyst medgivande. ==Vilket ord saknas?==",
    caption: "Vilket ord saknas? Svara innan tiden tar slut! Fler MEK-frågor gratis, länk i bio." }),
  quiz({ id: "hinner-du-nog", dp: "nog", i: 5, hook: "Är $x > 5$? ==Räcker informationen?==",
    caption: "Räcker informationen? En klassisk NOG-fråga. Svara innan tiden tar slut! Fler NOG-frågor gratis, länk i bio." }),

  /* ---------------- HP-nedräkningen ---------------- */
  {
    id: "nedrakning-7-dagar", kind: "countdown", series: "countdown", badge: "HP-nedräkningen",
    label: `Högskoleprovet, ${HP_DATE}`, big: "7", from: 30, title: "dagar kvar till HP. ==Gör så här.==",
    listTitle: "Veckan i ==tre steg==",
    list: [["Gör ett provpass på tid", "se var du tappar poäng"], ["Öva på dina svagaste delprov", "där finns mest att hämta"], ["Lämna aldrig en fråga tom", "fel svar ger inga minuspoäng"]],
    cta: { title: "Öva på alla åtta delprov. ==Gratis.==", ticks: HP_TICKS, url: "pluggera.se/hp" },
    caption: `7 dagar kvar till högskoleprovet (${HP_DATE}). Spara och tagga någon som också skriver! Öva gratis, länk i bio.`, tags: TAGS_HP,
  },
  {
    id: "nedrakning-3-dagar", kind: "countdown", series: "countdown", badge: "HP-nedräkningen",
    label: `Högskoleprovet, ${HP_DATE}`, big: "3", from: 7, title: "dagar kvar till ==HP==",
    listTitle: "Nu ==finslipar== du",
    list: [["Gå igenom dina fel", "varför blev det fel?"], ["Träna tempot", "gissa, markera och gå vidare"], ["Inga nya maraton", "kort repetition räcker nu"]],
    cta: { title: "Öva på alla åtta delprov. ==Gratis.==", ticks: HP_TICKS, url: "pluggera.se/hp" },
    caption: "3 dagar kvar till HP. Så finslipar du sista dagarna. Spara! Öva gratis, länk i bio.", tags: TAGS_HP,
  },
  {
    id: "nedrakning-imorgon", kind: "countdown", series: "countdown", badge: "HP-nedräkningen",
    label: `Högskoleprovet, ${HP_DATE}`, big: "1", from: 7, title: "dag kvar. ==Imorgon är det HP!==",
    listTitle: "Packa ==ikväll==",
    list: [["Giltig legitimation", "utan den får du inte skriva", "✓"], ["Kallelsen", "kolla tid och plats igen", "✓"], ["Mat och vatten", "provet pågår hela dagen", "✓"]],
    cta: { title: "En sista runda? ==Gratis.==", ticks: ["Alla åtta delprov", "Förklaring till varje fråga"], url: "pluggera.se/hp" },
    caption: "Imorgon är det högskoleprovet! Packa det här ikväll. Skicka till din HP-kompis!", tags: TAGS_HP,
  },
  {
    id: "lycka-till", kind: "countdown", series: "countdown", badge: "HP-nedräkningen",
    sticker: "HP imorgon", title: "==Lycka till== på högskoleprovet!", sub: `${HP_DATE[0].toUpperCase()}${HP_DATE.slice(1)}. Du fixar det.`, burst: true,
    listTitle: "Tre saker att ==komma ihåg==",
    list: [["Ät frukost", "provet pågår hela dagen"], ["Fastnar du? Gå vidare", "markera frågan och kom tillbaka"], ["Gissa hellre än tomt", "fel svar ger inga minuspoäng"]],
    cta: { title: "Hur gick det? ==Berätta!==", url: "pluggera.se/hp", sub: "Skriv i kommentarerna efter provet." },
    caption: "Lycka till på högskoleprovet imorgon! Berätta hur det gick i kommentarerna efteråt.", tags: TAGS_HP,
  },

  /* ---------------- Dagens HP-ord ---------------- */
  ord(1), ord(2), ord(3), ord(4), ord(5),

  /* ---------------- Showcase: the app itself, feature by feature ---------------- */
  // Real screens from capture-showcase.mjs (run it first). Every number in the copy is the site's own:
  // the front page's stats, the formula collection's count, PluggEra AI's "svarar direkt, dygnet runt".
  {
    id: "showcase", kind: "showcase", page: "showcase.html",
    copy: {
      hero: "Plugga ==smartare==, inte längre.",
      scenes: {
        landing: { chip: "Gratis att använda", title: "==4 700+ övningsfrågor.== Alla med förklaring." },
        library: { chip: "Övningsbibliotek", title: "Färdiga set från ==åk 7 till gymnasiet==" },
        question: { chip: "Öva", title: "Svara – och få ==förklaringen direkt==" },
        hp: { chip: "Högskoleprovet", title: "Alla 8 delprov och din ==uppskattade poäng==" },
        formulas: { chip: "Formelsamling", title: "==143 formler.== Sök på sekunder." },
        ai: { chip: "PluggEra AI", title: "Fastnar du? ==Fråga AI:n==, dygnet runt." },
        profile: { chip: "Din profil", title: "Håll koll på ==din pluggsvit==" },
      },
      cta: { title: "Plugga smartare. ==Gratis.==", ticks: ["Åk 7 till gymnasiet", "Alla 8 delprov på högskoleprovet", "Förklaring till varje fråga"], url: "pluggera.se", sub: "Länken finns i vår bio." },
    },
    caption: "Så funkar PluggEra: färdiga övningar från åk 7 till gymnasiet, högskoleprovet, formelsamling och AI-hjälp. Gratis, länk i bio!",
    tags: ["#plugga", "#studietips", "#högskoleprovet", "#studytok", "#skola", "#pluggera"],
  },

  /* ---------------- Promo: the short cut, three hooks on the same 17 seconds ---------------- */
  // Post them on different days and keep the hook that holds viewers longest (TikTok's analytics).
  promo({ id: "promo-5-saker", hook: "5 saker du kan göra ==gratis== på PluggEra",
    caption: "5 saker du kan göra gratis på PluggEra. Vilken visste du inte om? Länk i bio!" }),
  promo({ id: "promo-hp-sondag", hook: "Högskoleprovet på söndag? ==Testa det här.==",
    caption: "Skriver du högskoleprovet på söndag? Testa det här, gratis. Länk i bio!" }),
  promo({ id: "promo-pov", hook: "POV: du hittar en pluggsajt som ==faktiskt förklarar==",
    caption: "POV: du hittar en pluggsajt som faktiskt förklarar. Gratis, länk i bio!" }),

  /* ---------------- The ad: problem → solution, for paid TikTok (see ad.js) ---------------- */
  {
    id: "annons-glomska", kind: "ad", page: "showcase.html",
    copy: {
      hook: "Pluggar i timmar men ==glömmer allt==?",
      stamp: "Glömt",
      notes: ["Fotosyntes → socker + syre", "Pythagoras: a² + b² = c²", "+20 % = gånga med 1,20", "Franska revolutionen 1789", "Median = mittersta värdet", "they = de, them = dem"],
      fix: "Testa dig själv ==i stället.==",
      fixSticker: "Förklaring direkt",
      curve: "Frågan kommer tillbaka ==precis innan du glömmer==",
      curveWith: "Med repetition", curveWithout: "Utan",
      curveSticker: "PluggEra håller koll åt dig",
      fan: "Allt från ==åk 7 till högskoleprovet==",
      stats: [["4 700+", "övningsfrågor"], ["13", "ämnen"], ["8 av 8", "HP-delprov"]],
      ai: "Fastnar du? ==Fråga AI:n.==",
      aiSticker: "Svarar dygnet runt",
      cta: { title: "Testa ==gratis== idag", ticks: ["Ingen reklam", "Byggt på läroplanen", "Förklaring till varje fråga"], url: "pluggera.se", sub: "Börja direkt – inget konto behövs." },
    },
    caption: "Pluggar du i timmar men glömmer allt till provet? Testa dig själv i stället. Gratis på pluggera.se",
    tags: ["#plugga", "#studietips", "#studytok", "#skola", "#prov", "#pluggera"],
  },
];
