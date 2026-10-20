// A join link's token is the secret that makes the link work, so it must not be stored anywhere that records where
// someone was. The app strips it before it sends the entry pageview or an error report (js/lib/join-link.js); this does
// the same to whatever arrives, so an older app, or anything else posting to those endpoints, cannot put one in the tables.
export const hideJoinToken = (path) => String(path ?? "").replace(/^(\/join\/(?:class|parent|friend)\/).*$/, "$1:id");
