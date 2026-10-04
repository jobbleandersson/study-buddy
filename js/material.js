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

// pdf.js (~320 KB) and JSZip (~95 KB) are only needed when someone imports a file, so they load
// then — not on every visit. One shared promise per script, cleared on failure so a later import
// can retry (a flaky connection, say) instead of being stuck with the first failure.
const vendorLoads = {};
function loadVendor(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  vendorLoads[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    const fail = () => { delete vendorLoads[src]; s.remove(); reject(new Error(globalName)); };
    s.onload = () => (window[globalName] ? resolve(window[globalName]) : fail());
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return vendorLoads[src];
}

async function extractPdfTextFromBuffer(buf) {
  let lib;
  try { lib = await loadVendor("vendor/pdf.min.js", "pdfjsLib"); } catch { throw new Error(t("err.pdfNoLib")); }
  lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

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

// The whole file is read into memory (and a ZIP's PDFs unpacked into it), so there is a ceiling.
const MAX_PDF_BYTES = 60 * 1024 * 1024;
const MAX_ZIP_BYTES = 150 * 1024 * 1024;

export async function extractPdfText(file) {
  if (file.size > MAX_PDF_BYTES) throw new Error(t("err.fileTooBig", { mb: MAX_PDF_BYTES / 1048576 }));
  return extractPdfTextFromBuffer(await file.arrayBuffer());
}

/** Pulls text out of every PDF inside a ZIP (e.g. Skolverket's national-exam
 *  downloads) and concatenates it — audio files (listening comprehension)
 *  are counted but skipped; there's no transcription here. */
export async function extractZipText(file) {
  let JSZip;
  try { JSZip = await loadVendor("vendor/jszip.min.js", "JSZip"); } catch { throw new Error(t("err.zipNoLib")); }
  if (file.size > MAX_ZIP_BYTES) throw new Error(t("err.fileTooBig", { mb: MAX_ZIP_BYTES / 1048576 }));
  const zip = await JSZip.loadAsync(file);
  // A PDF that unpacks to more than a PDF may be is skipped, not inflated: a few KB of zip can
  // expand to gigabytes.
  const entries = Object.values(zip.files).filter((f) => !f.dir && !((f._data?.uncompressedSize || 0) > MAX_PDF_BYTES));
  const pdfEntries = entries.filter((f) => /\.pdf$/i.test(f.name)).slice(0, 20); // cap runaway zips
  if (!pdfEntries.length) throw new Error(t("err.zipNoPdf"));

  const parts = [];
  for (const entry of pdfEntries) {
    try {
      const text = await extractPdfTextFromBuffer(await entry.async("arraybuffer"));
      parts.push(`--- ${entry.name} ---\n${text}`);
    } catch {
      // Skip an unreadable/scanned PDF inside the zip; keep going with the rest.
    }
    if (parts.join("\n\n").length > MAX_CHARS) break;
  }
  if (!parts.length) throw new Error(t("err.zipNoText"));

  const skippedAudio = entries.filter((f) => /\.mp3$/i.test(f.name)).length;
  return {
    text: fitText(parts.join("\n\n")),
    pdfCount: parts.length,
    totalPdfCount: pdfEntries.length,
    skippedAudio,
  };
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
