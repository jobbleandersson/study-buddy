// Renders "HP-matte" images for TikTok from the XYZ, KVA and NOG sets: for each problem a question
// image and an answer image (1080×1920 PNG), plus captions-hp-matte.txt with a ready caption per post.
// The layout is hp-matte.html next to this file; problems, options and explanations come straight from
// data/library, so the images always match what the app teaches. The sets take turns (XYZ, KVA, NOG,
// XYZ, …) so the series doesn't run a dozen of one kind in a row.
//
//   node tools/tiktok/render-hp-matte.mjs              # the whole series
//   node tools/tiktok/render-hp-matte.mjs --from 1 --to 10
//
// Output: tools/tiktok/out/hp-matte/ (kept out of git and out of fly deploy). It drives a headless
// browser (headless.mjs); no npm packages.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, ROOT } from "./headless.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "hp-matte");
const SETS = ["hp-xyz-ovningsprov-03", "hp-kva-ovningsprov-02", "hp-nog-ovningsprov-02", "hp-xyz-ovningsprov-02"];
const docs = SETS.map((s) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "library", `${s}.json`), "utf8")));

// Round-robin over the sets.
const series = [];
for (let k = 0; series.length < docs.reduce((n, d) => n + d.questions.length, 0); k++) {
  docs.forEach((d, s) => { if (k < d.questions.length) series.push({ set: SETS[s], i: k, q: d.questions[k] }); });
}

const arg = (name, fallback) => {
  const k = process.argv.indexOf(`--${name}`);
  return k > 0 ? Number(process.argv[k + 1]) : fallback;
};
const FROM = Math.max(1, arg("from", 1));
const TO = Math.min(series.length, arg("to", series.length));

const TAGS = { xyz: "#matte #problemlösning", kva: "#matte #kvantitativajämförelser", nog: "#matte #logik" };
const HOOK = {
  xyz: "Klarar du den på 60 sekunder?",
  kva: "Vilken är störst – eller går det inte att avgöra? Du har 60 sekunder.",
  nog: "Räcker informationen? Du har 100 sekunder.",
};

const b = await launch();
try {
  fs.mkdirSync(OUT, { recursive: true });
  const captions = [];
  for (let n = FROM; n <= TO; n++) {
    const { set, i, q } = series[n - 1];
    for (const [frame, label] of [["q", "1-fraga"], ["a", "2-svar"]]) {
      await b.open(`${b.base}/tools/tiktok/hp-matte.html?set=${set}&i=${i}&frame=${frame}&n=${n}`, `document.body?.dataset.ready === "1"`);
      // TikTok draws its caption and sound line over the bottom ~470px; anything there gets covered.
      const fit = await b.evaluate(`(() => {
        const main = document.querySelector(".main"), brand = document.querySelector(".brand").getBoundingClientRect();
        return { low: main.lastElementChild.getBoundingClientRect().bottom > 1450, high: main.firstElementChild.getBoundingClientRect().top < brand.bottom, zoom: main.style.zoom || "1" };
      })()`);
      if (fit.low || fit.high) console.warn(`  ! #${n} ${q.id} (${frame}) doesn't fit the safe area — shorten its text`);
      fs.writeFileSync(path.join(OUT, `hp-matte-${String(n).padStart(2, "0")}-${q.variant}-${label}.png`), Buffer.from(await b.shoot("png"), "base64"));
    }
    captions.push(
      `#${n} ${q.variant.toUpperCase()} (${q.id})\n` +
      `HP-matte #${n} 🧮 ${HOOK[q.variant]} Svara i kommentarerna – svaret kommer i nästa bild. ` +
      `#högskoleprovet #hp ${TAGS[q.variant]} #plugga\n`,
    );
    console.log(`#${n} ${q.id}`);
  }
  fs.writeFileSync(path.join(OUT, "captions-hp-matte.txt"), captions.join("\n"));
  console.log(`\n${(TO - FROM + 1) * 2} images and captions-hp-matte.txt in ${OUT}`);
} finally {
  await b.close();
}
