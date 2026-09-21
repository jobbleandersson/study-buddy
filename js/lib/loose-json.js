// Models sometimes wrap JSON in a code fence or add a sentence around it.
// Pull the object or array out and parse it; throws (like JSON.parse) if there
// is nothing parseable.

export function parseLooseJSON(text) {
  let t = String(text ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.search(/[[{]/);
  const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}
