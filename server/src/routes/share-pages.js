import { Router } from "express";
import fs from "node:fs/promises";

// Addresses of their own for the screens worth sharing on their own: a TikTok bio, a message, a
// search result. The app's screens live behind "#/…", and what follows "#" never reaches a link
// preview or a search engine, so pluggera.se/#/hp previews as the front page. Each address here serves
// the app's own index.html with that screen's title, description and preview image in place of the
// front page's (the block between index.html's share-meta markers), and the app then opens the screen
// itself (SHARE_PATHS in js/main.js). Everything else on the page, the noindex tag and the inline
// scripts the CSP hashes included, stays exactly as it is.
//
// Preview images: tools/og/render-og.mjs. A new address needs its route in js/main.js too.

const SITE = "https://pluggera.se";

export const SHARE_PAGES = {
  "/hp": {
    title: "Högskoleprovet – öva gratis med PluggEra",
    description: "Öva på alla åtta delprov i provformat, med förklaring till varje fråga. Få en uppskattad normerad poäng och en dagsplan fram till provdagen. Gratis.",
    ogTitle: "Plugga till högskoleprovet med PluggEra",
    ogDescription: "Alla åtta delprov i provformat, en uppskattad poäng och en plan fram till provdagen. Gratis.",
    image: "/assets/og-hp.jpg",
    imageAlt: "PluggEra: plugga till högskoleprovet. En uppskattad normerad poäng på 1,35 och de åtta delproven.",
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The share-meta block for one page: the same tags index.html carries for the front page. */
export function shareMeta(pathname, page) {
  const url = SITE + pathname;
  const image = SITE + page.image;
  return [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="PluggEra" />`,
    `<meta property="og:locale" content="sv_SE" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${esc(page.ogTitle)}" />`,
    `<meta property="og:description" content="${esc(page.ogDescription)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(page.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(page.ogTitle)}" />`,
    `<meta name="twitter:description" content="${esc(page.ogDescription)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].map((line) => `  ${line}`).join("\n");
}

const BLOCK = /(<!-- share-meta\b[\s\S]*?-->\n)[\s\S]*?(\n\s*<!-- \/share-meta -->)/;

/** index.html with its share-meta block swapped for this page's. Throws if the markers are gone, so a
 *  careless edit to index.html fails loudly (and in the tests) instead of sharing the wrong preview. */
export function withShareMeta(html, pathname, page) {
  if (!BLOCK.test(html)) throw new Error("index.html has no share-meta block");
  return html.replace(BLOCK, (_, open, close) => `${open}${shareMeta(pathname, page)}${close}`);
}

export function sharePages(indexHtmlPath) {
  const router = Router();
  for (const [pathname, page] of Object.entries(SHARE_PAGES)) {
    // Express matches "/hp/" and "/HP" here too; the canonical address stays the one above.
    router.get(pathname, async (req, res, next) => {
      try {
        const html = await fs.readFile(indexHtmlPath, "utf8");
        res.type("html").set("Cache-Control", "no-cache").send(withShareMeta(html, pathname, page));
      } catch (e) {
        next(e);
      }
    });
  }
  return router;
}
