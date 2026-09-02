// Curated pointers to where genuinely public, reuse-permitted past national
// exams actually live. StudyBuddy never hosts, scrapes, or redistributes the
// exam content itself — this list only gets the student to the official
// source; they bring the material back through the normal Create flow.
//
// IMPORTANT, verified by actually downloading and inspecting them: every ZIP
// linked from Skolverket's own "Gamla nationella prov" page
// (https://www.skolverket.se/prov-och-bedomning/nationella-prov/bestall-nationella-prov/gamla-nationella-prov)
// is an SPSM accessibility-adaptation bundle (braille/punktskrift, tactile
// graphics, screen-reader "Textview" format, teacher instructions) — never
// the actual exam. Every one of those ZIPs contains this readme line:
// "Det som inte följer med är själva förlagan/originalprovet." (confirmed
// across Biologi åk9, Samhällskunskap åk9, and Matematik 1a gymnasiet).
// The same readme names where the real material lives instead:
//   - Matematik: PRIM-gruppen, Stockholms universitet
//   - NO (biologi/fysik/kemi): Umeå universitet
//   - Engelska / Svenska: contain copyrighted texts — only "exempel"
//     (sample) material is freely published; full historical exams have to
//     be requested from Skolverket as a "begäran om allmän handling".
// Geografi, Historia, Religionskunskap, Samhällskunskap point to the subject
// university groups Skolverket's own page links to alongside (and instead
// of relying on) its misleading zip.

export const NATIONAL_TESTS_OVERVIEW_URL =
  "https://www.skolverket.se/prov-och-bedomning/nationella-prov/bestall-nationella-prov/gamla-nationella-prov";

export const NATIONAL_TEST_LEVELS = [
  { id: "grundskolan-ak9", label: "Grundskolan, åk 9" },
  { id: "gymnasiet-komvux", label: "Gymnasiet / komvux" },
];

// kind: "page"    -> a university archive/listing page with real past exams, freely usable
//       "limited" -> same, but only sample/example material is freely published;
//                    full historical exams contain copyrighted texts and must be
//                    requested from Skolverket directly
export const NATIONAL_TEST_SUBJECTS = [
  { level: "grundskolan-ak9", id: "biologi", name: "Biologi", kind: "page", url: "https://www.umu.se/institutionen-for-tillampad-utbildningsvetenskap/np/no9/tidigare-givna-prov/" },
  { level: "grundskolan-ak9", id: "engelska", name: "Engelska", kind: "limited", url: "https://www.gu.se/nationella-prov-frammande-sprak/prov-och-bedomningsstod-i-engelska/exempel-pa-uppgiftstyper" },
  { level: "grundskolan-ak9", id: "fysik", name: "Fysik", kind: "page", url: "https://www.umu.se/institutionen-for-tillampad-utbildningsvetenskap/np/no9/tidigare-givna-prov/" },
  { level: "grundskolan-ak9", id: "geografi", name: "Geografi", kind: "page", url: "https://www.uu.se/nationella-prov/geografi/aldre-prov-och-bedomningsstod" },
  { level: "grundskolan-ak9", id: "historia", name: "Historia", kind: "page", url: "https://mau.se/om-oss/fakulteter-och-institutioner/larande-och-samhalle/nationellt-prov-historia/" },
  { level: "grundskolan-ak9", id: "kemi", name: "Kemi", kind: "page", url: "https://www.umu.se/institutionen-for-tillampad-utbildningsvetenskap/np/no9/tidigare-givna-prov/" },
  { level: "grundskolan-ak9", id: "matematik", name: "Matematik", kind: "page", url: "https://www.su.se/enheter/prim-gruppen/nationella-prov/arskurs-9" },
  { level: "grundskolan-ak9", id: "religion", name: "Religionskunskap", kind: "page", url: "https://www.gu.se/didaktik-pedagogisk-profession/nationella-prov-i-religionskunskap" },
  { level: "grundskolan-ak9", id: "samhalle", name: "Samhällskunskap", kind: "page", url: "https://www.gu.se/nationella-prov-i-samhallskunskap" },
  { level: "grundskolan-ak9", id: "svenska", name: "Svenska/Svenska som andraspråk", kind: "limited", url: "https://www.uu.se/nationella-prov/svenska-och-svenska-som-andrasprak/grundskolan/ak9/exempel" },

  { level: "gymnasiet-komvux", id: "engelska", name: "Engelska (nivå 1 & 2)", kind: "limited", url: "https://www.gu.se/nationella-prov-frammande-sprak/prov-och-bedomningsstod-i-engelska/exempel-pa-uppgiftstyper" },
  { level: "gymnasiet-komvux", id: "matematik-1", name: "Matematik (kurs 1 / nivå 1, inkl. 1a, 1b)", kind: "page", url: "https://www.su.se/enheter/prim-gruppen/nationella-prov/niva-1-kurs-1" },
  { level: "gymnasiet-komvux", id: "matematik-2-4", name: "Matematik (kurs 2–4, inkl. 3b, 3c)", kind: "page", url: "https://www.umu.se/institutionen-for-tillampad-utbildningsvetenskap/np/np-2-4/tidigare-givna-prov/" },
  { level: "gymnasiet-komvux", id: "svenska-niva1", name: "Svenska/Sva nivå 1", kind: "limited", url: "https://www.uu.se/nationella-prov/svenska-och-svenska-som-andrasprak/gymnasiet/gy1/exempel-pa-provmaterial-i-niva-1" },
  { level: "gymnasiet-komvux", id: "svenska-k3", name: "Svenska/Sva kurs 3", kind: "limited", url: "https://www.uu.se/nationella-prov/svenska-och-svenska-som-andrasprak/gymnasiet/gy3/exempel-pa-provmaterial-i-kurs-3" },
];

/** The canonical subject name every year's import for one entry shares — this
 *  IS the grouping key (via store.js's ensureSubject() case-insensitive
 *  reuse-by-name), so it must come out byte-identical every time. */
export function nationalSubjectName(entry) {
  const suffix = entry.level === "grundskolan-ak9" ? ", åk 9" : ", gymnasiet/komvux";
  return `Nationellt prov – ${entry.name}${suffix}`;
}
