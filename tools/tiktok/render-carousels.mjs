// Renders every TikTok photo carousel in posts.mjs with carousel.html: one folder per post with its
// slides (1080×1920 JPEG) and a caption.txt (caption + hashtags, ready to paste), plus INLAGG.md listing
// them all in order.
//
//   node tools/tiktok/render-carousels.mjs              # every post
//   node tools/tiktok/render-carousels.mjs hp-7-dagar   # only the posts whose id contains this
//   node tools/tiktok/render-carousels.mjs knep,ak9     # or any of these
//
// Output: tools/tiktok/out/karuseller/ (kept out of git and out of fly deploy). It drives a headless
// browser (headless.mjs); no npm packages.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./headless.mjs";
import { POSTS } from "./posts.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "karuseller");
const only = (process.argv[2] || "").split(",");

const b = await launch();
try {
  await b.open(`${b.base}/tools/tiktok/carousel.html`, `typeof window.renderSlide === "function" && typeof katex !== "undefined"`);
  const posts = POSTS.filter((p) => only.some((o) => p.id.includes(o)));
  const index = [];
  let warnings = 0;
  for (const post of posts) {
    const no = String(POSTS.indexOf(post) + 1).padStart(2, "0");
    const dir = path.join(OUT, `${no}-${post.id}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, slide] of post.slides.entries()) {
      const spec = { series: post.series, count: `${k + 1}/${post.slides.length}`, ...slide };
      const fit = await b.evaluate(`window.renderSlide(${JSON.stringify(spec)})`);
      if (!fit.fits) { warnings++; console.warn(`  ! ${post.id} slide ${k + 1} doesn't fit the safe area, even shrunk: shorten it`); }
      else if (fit.scale < 0.85) console.warn(`  · ${post.id} slide ${k + 1} shrunk to ${Math.round(fit.scale * 100)} %`);
      fs.writeFileSync(path.join(dir, `${String(k + 1).padStart(2, "0")}.jpg`), Buffer.from(await b.shoot("jpeg", 94), "base64"));
    }
    const caption = `${post.caption}\n\n${post.tags.join(" ")}`;
    fs.writeFileSync(path.join(dir, "caption.txt"), caption + "\n");
    index.push(`## ${no}. ${post.id}\n\n${post.slides.length} bilder, mapp \`${no}-${post.id}\`\n\n${caption}\n`);
    console.log(`${no} ${post.id} (${post.slides.length})`);
  }
  if (only.length === 1 && !only[0]) fs.writeFileSync(path.join(OUT, "INLAGG.md"), `# TikTok-karuseller\n\nEn mapp per inlägg. Ladda upp bilderna i ordning som ett fotoinlägg och klistra in texten.\n\n${index.join("\n")}`);
  console.log(`\n${posts.length} posts in ${OUT}${warnings ? `, ${warnings} slide(s) to shorten` : ""}`);
} finally {
  await b.close();
}
