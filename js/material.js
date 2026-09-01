// Turn the student's raw material into inputs for generateAssignment():
//   - paste text  -> { material }
//   - PDF file     -> { material }  (text extracted locally with pdf.js)
//   - image file   -> { image: { mediaType, data } }  (sent to Claude vision)
//   - topic string -> { topic }

import { t } from "./lib/i18n.js";

const MAX_CHARS = 24000;

export function fitText(s) {
  const collapsed = String(s || "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return collapsed.length > MAX_CHARS ? collapsed.slice(0, MAX_CHARS) + "\n\n[...truncated]" : collapsed;
}

export async function extractPdfText(file) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error(t("err.pdfNoLib"));
  lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const pages = [];
  const limit = Math.min(pdf.numPages, 40);
  for (let p = 1; p <= limit; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items.map((i) => i.str).join(" "));
    if (pages.join(" ").length > MAX_CHARS) break;
  }
  const text = fitText(pages.join("\n\n"));
  if (text.replace(/\s/g, "").length < 20) {
    throw new Error(t("err.pdfNoText"));
  }
  return text;
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const okTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!okTypes.includes(file.type)) {
      reject(new Error(t("err.imageType")));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error(t("err.imageSize")));
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = String(fr.result);
      const comma = dataUrl.indexOf(",");
      resolve({ mediaType: file.type, data: dataUrl.slice(comma + 1), preview: dataUrl });
    };
    fr.onerror = () => reject(new Error(t("err.readFile")));
    fr.readAsDataURL(file);
  });
}
