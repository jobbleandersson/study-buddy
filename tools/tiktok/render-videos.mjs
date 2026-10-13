// Films every TikTok video in videos.mjs with video.html: an .mp4 per video (1080×1920, 30 fps, H.264,
// no sound: pick one in TikTok), a cover image and the caption (+ hashtags) to paste, plus VIDEOR.md
// listing them all in order.
//
//   node tools/tiktok/render-videos.mjs                  # every video
//   node tools/tiktok/render-videos.mjs hinner-du,ord    # only those whose id contains one of these
//
// Output: tools/tiktok/out/videor/ (kept out of git and out of fly deploy). It steps through each video
// frame by frame in a headless browser (headless.mjs), so a 20-second video takes a minute or two.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./headless.mjs";
import { VIDEOS } from "./videos.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "videor");
const FPS = 30;
const only = (process.argv[2] || "").split(",");
const everything = only.length === 1 && !only[0];
const videos = VIDEOS.filter((v) => only.some((o) => v.id.includes(o)));

const b = await launch();
try {
  fs.mkdirSync(OUT, { recursive: true });
  let warnings = 0;
  for (const v of videos) {
    const name = `${String(VIDEOS.indexOf(v) + 1).padStart(2, "0")}-${v.id}`;
    const started = Date.now();
    await b.open(`${b.base}/tools/tiktok/${v.page || "video.html"}`, `typeof window.setupVideo === "function" && typeof katex !== "undefined"`);
    const info = await b.evaluate(`window.setupVideo(${JSON.stringify(v)})`);
    info.fits.forEach((f, k) => {
      if (!f.fits) { warnings++; console.warn(`  ! ${v.id}, scene ${k + 1} doesn't fit the safe area: shorten it`); }
      else if (f.scale < 0.85) console.warn(`  · ${v.id}, scene ${k + 1} shrunk to ${Math.round(f.scale * 100)} %`);
    });

    await b.evaluate("window.startEncoding()");
    for (let f = 0; f < info.frames; f++) {
      await b.evaluate(`window.seekVideo(${f / FPS})`);
      await b.evaluate(`window.addFrame("${await b.shoot("jpeg", 95)}")`);
    }
    const size = await b.evaluate("window.finishEncoding()");
    const parts = [];
    for (let at = 0; at < size; at += 4 << 20) parts.push(Buffer.from(await b.evaluate(`window.readVideo(${at}, ${at + (4 << 20)})`), "base64"));
    fs.writeFileSync(path.join(OUT, `${name}.mp4`), Buffer.concat(parts));

    await b.evaluate(`window.seekVideo(${info.cover})`);
    fs.writeFileSync(path.join(OUT, `${name}-omslag.jpg`), Buffer.from(await b.shoot("jpeg", 92), "base64"));
    fs.writeFileSync(path.join(OUT, `${name}.txt`), `${v.caption}\n\n${v.tags.join(" ")}\n`);
    console.log(`${name}: ${info.length.toFixed(1)} s, ${(size / 1e6).toFixed(1)} MB (${Math.round((Date.now() - started) / 1000)} s to film)`);
  }
  if (everything) {
    const list = VIDEOS.map((v, k) => {
      const name = `${String(k + 1).padStart(2, "0")}-${v.id}`;
      return `## ${name}\n\nVideo \`${name}.mp4\`, omslag \`${name}-omslag.jpg\`\n\n${v.caption}\n\n${v.tags.join(" ")}\n`;
    });
    fs.writeFileSync(path.join(OUT, "VIDEOR.md"), `# TikTok-videor\n\nLadda upp videon, välj omslaget (eller en bild ur videon), lägg på ett ljud i TikTok och klistra in texten.\n\n${list.join("\n")}`);
  }
  console.log(`\n${videos.length} videos in ${OUT}${warnings ? `, ${warnings} scene(s) to shorten` : ""}`);
} finally {
  await b.close();
}
