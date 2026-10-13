// Renders "Dagens HP-ord" images for TikTok from the ORD word bank: for each word a question image
// and an answer image (1080×1920 PNG), plus captions.txt with a ready caption per word. The layout is
// hp-ord.html next to this file; the words, options and explanations come straight from
// data/library/hp-ord-bank-01.json, so the images always match what the app teaches.
//
//   node tools/tiktok/render-hp-ord.mjs              # every word
//   node tools/tiktok/render-hp-ord.mjs --from 1 --to 10
//
// Output: tools/tiktok/out/ (kept out of git and out of fly deploy). It drives a headless browser
// (headless.mjs); no npm packages.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, ROOT } from "./headless.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "library", "hp-ord-bank-01.json"), "utf8"));

const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? Number(process.argv[k + 1]) : fallback;
};
const FROM = Math.max(1, arg("from", 1));
const TO = Math.min(BANK.questions.length, arg("to", BANK.questions.length));

const wordOf = (q) => q.prompt.match(/\*\*(.+?)\*\*/)[1];
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const b = await launch();
try {
  fs.mkdirSync(OUT, { recursive: true });
  const captions = [];
  for (let n = FROM; n <= TO; n++) {
    const q = BANK.questions[n - 1];
    const word = wordOf(q);
    for (const [frame, label] of [["q", "1-fraga"], ["a", "2-svar"]]) {
      await b.open(`${b.base}/tools/tiktok/hp-ord.html?i=${n - 1}&frame=${frame}&n=${n}`, `document.body?.dataset.ready === "1"`);
      // TikTok draws its caption and sound line over the bottom ~470px; anything there gets covered.
      const fit = await b.evaluate(`(() => {
        const main = document.querySelector(".main"), brand = document.querySelector(".brand").getBoundingClientRect();
        return { low: main.lastElementChild.getBoundingClientRect().bottom > 1450, high: main.firstElementChild.getBoundingClientRect().top < brand.bottom };
      })()`);
      if (fit.low || fit.high) console.warn(`  ! "${word}" (${frame}) doesn't fit the safe area — shorten its explanation or options`);
      fs.writeFileSync(path.join(OUT, `hp-ord-${String(n).padStart(2, "0")}-${slug(word)}-${label}.png`), Buffer.from(await b.shoot("png"), "base64"));
    }
    captions.push(
      `#${n} ${word}\n` +
      `Dagens HP-ord #${n}: ${word} 🤔 Vad betyder det? Svara i kommentarerna, svaret kommer i nästa bild. ` +
      `#högskoleprovet #hp #ordförståelse #plugga #studietips\n`,
    );
    console.log(`#${n} ${word}`);
  }
  fs.writeFileSync(path.join(OUT, "captions.txt"), captions.join("\n"));
  console.log(`\n${(TO - FROM + 1) * 2} images and captions.txt in ${OUT}`);
} finally {
  await b.close();
}
