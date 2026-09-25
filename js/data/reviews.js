// Reviews added by hand to the front page (#/welcome), for ones that came in
// some other way than the app (an email, a message) — most reviews are written
// in #/rate, approved in #/admin/reviews and fetched from the server instead.
// Only real ones: each entry is a person's own words, added once they've agreed
// to be quoted. The section stays hidden while there are none at all, so there
// is never a placeholder or a made-up quote on the page.
//
// Shape of one entry:
//   {
//     name: "Elin",              // first name or initials only, never a full name
//     context: "Elev, åk 9",     // optional: who they are, in their own language
//     text: "…",                 // their words, verbatim; not translated
//     lang: "sv",                // language the text is written in ("sv" | "en")
//     rating: 5,                 // optional, whole stars 1–5
//     date: "2026-10-01",        // when they gave it (YYYY-MM-DD)
//     consent: true,             // they said yes to being shown publicly
//   }
//
// To take a review down, delete its entry (and bump the sw.js cache version).

export const REVIEWS = [];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The entries that are complete enough to show. Anything without explicit
 *  consent, a name, text, a known language or a valid date is left out rather
 *  than shown half-filled; an out-of-range rating just drops the stars. */
export function publishableReviews(list = REVIEWS) {
  return list
    .filter((r) => r && r.consent === true
      && typeof r.name === "string" && r.name.trim()
      && typeof r.text === "string" && r.text.trim()
      && (r.lang === "sv" || r.lang === "en")
      && typeof r.date === "string" && DATE_RE.test(r.date))
    .map((r) => ({
      ...r,
      rating: Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 ? r.rating : null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
