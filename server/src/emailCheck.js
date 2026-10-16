// Is this string shaped like an email address? Not a proof that the mailbox exists (only a mail can prove
// that, see verify-email), just enough to turn away typos and junk before an account is made for them:
// signup used to accept anything that contained an '@', and an address that cannot receive mail can
// never be verified or reset.

const BAD = /[\s\u0000-\u001f\u007f<>()[\]\\,;:"]/;

/** `address` is expected trimmed and lower-cased. */
export function isPlausibleEmail(address) {
  if (typeof address !== "string" || address.length > 254) return false;
  const at = address.indexOf("@");
  if (at < 1 || at !== address.lastIndexOf("@")) return false;
  const local = address.slice(0, at), domain = address.slice(at + 1);
  if (local.length > 64 || BAD.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (BAD.test(domain) || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.some((l) => !l || l.startsWith("-") || l.endsWith("-"))) return false;
  return labels[labels.length - 1].length >= 2;
}
