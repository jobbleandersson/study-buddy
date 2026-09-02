// Turn the student's raw material into inputs for generateAssignment():
//   - paste text  -> { material }
//   - PDF file     -> { material }  (text extracted locally with pdf.js)
//   - image file   -> { image: { mediaType, data } }  (sent to Claude vision)
//   - topic string -> { topic }

const MAX_CHARS = 24000;

export function fitText(s) {
  const collapsed = String(s || "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return collapsed.length > MAX_CHARS ? collapsed.slice(0, MAX_CHARS) + "\n\n[...truncated]" : collapsed;
}

async function extractPdfTextFromBuffer(buf) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("PDF reader failed to load. Refresh and try again.");
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
    throw new Error("Couldn't find selectable text in that PDF. If it's a scan, upload it as a photo instead.");
  }
  return text;
}

export async function extractPdfText(file) {
  return extractPdfTextFromBuffer(await file.arrayBuffer());
}

/** Pulls text out of every PDF inside a ZIP (e.g. Skolverket's national-exam
 *  downloads) and concatenates it — audio files (listening comprehension)
 *  are counted but skipped; there's no transcription here. */
export async function extractZipText(file) {
  if (!window.JSZip) throw new Error("ZIP reader failed to load. Refresh and try again.");
  const zip = await window.JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const pdfEntries = entries.filter((f) => /\.pdf$/i.test(f.name)).slice(0, 20); // cap runaway zips
  if (!pdfEntries.length) throw new Error("Hittade ingen PDF i zip-filen.");

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
  if (!parts.length) throw new Error("Kunde inte läsa text ur PDF-filerna i zip-filen (kan vara skannade sidor).");

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
      reject(new Error("Please use a PNG, JPG, WEBP, or GIF image."));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("That image is over 5 MB — try a smaller photo."));
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = String(fr.result);
      const comma = dataUrl.indexOf(",");
      resolve({ mediaType: file.type, data: dataUrl.slice(comma + 1), preview: dataUrl });
    };
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });
}
