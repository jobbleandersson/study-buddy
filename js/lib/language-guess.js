// A rough guess at whether a short text is Swedish or English, from its common small words. Used to notice a tutor opener
// that is in another language than its question (sets made before the generation prompt asked for the same language, whose
// openers came out in English under Swedish questions). Not a language detector: it only answers when it is fairly sure,
// and null (unknown) means "leave it alone".

const SV = new Set(["och", "att", "det", "som", "är", "en", "ett", "på", "för", "med", "inte", "du", "den", "av", "till", "har", "kan", "om",
  "vad", "hur", "vilken", "vilket", "vilka", "var", "när", "varför", "ska", "bör", "måste", "vid", "från", "eller", "men", "så", "sig", "de",
  "dem", "ditt", "din", "dina", "mig", "dig", "här", "där", "också", "bara", "fram", "efter", "innan", "mellan", "genom", "under", "över", "i"]);
const EN = new Set(["the", "and", "you", "your", "how", "what", "which", "this", "that", "is", "are", "of", "to", "in", "for", "with", "not", "it",
  "as", "an", "does", "do", "can", "should", "would", "will", "from", "or", "but", "so", "about", "between", "through", "before", "after", "its",
  "these", "those", "they", "them", "when", "why", "where", "think", "picture", "try", "start"]);

/** "sv", "en", or null when it is too short or too mixed to say. */
export function guessLang(text) {
  const words = String(text ?? "").toLowerCase().match(/[a-zåäö]+/g) || [];
  let sv = 0, en = 0;
  for (const w of words) {
    if (SV.has(w) && !EN.has(w)) sv++;
    else if (EN.has(w) && !SV.has(w)) en++;
  }
  sv += (String(text ?? "").match(/[åäö]/gi) || []).length;
  if (sv + en < 2) return null;
  if (sv >= en * 2) return "sv";
  if (en >= sv * 2) return "en";
  return null;
}

/** Can this opener stand under this question? Only a clear mismatch (English opener, Swedish question, or the other way
 *  round) says no. */
export function openerFits(opener, prompt) {
  const a = guessLang(opener);
  const b = guessLang(prompt);
  return !(a && b && a !== b);
}
