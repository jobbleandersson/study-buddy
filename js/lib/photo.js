// Getting a photo ready to send. A phone camera shot is 3–8 MB, but a model
// reads handwriting just as well from a 1600-pixel image — and the upload is a
// fraction of the size (and of the cost: images are billed by their dimensions).

import { readImageFile } from "../material.js";
import { t } from "./i18n.js";

const OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;   // sanity cap on what we'll even try to decode

/**
 * Resolves { mediaType, data (base64), preview (data URL) } — the same shape
 * as material.js readImageFile(). Anything the canvas route can't do (no
 * createImageBitmap, an odd format) falls back to sending the file as it is.
 */
export async function shrinkImage(file, { maxEdge = 1600, quality = 0.85 } = {}) {
  if (!OK_TYPES.includes(file.type)) throw new Error(t("err.imageType"));
  if (file.size > MAX_SOURCE_BYTES) throw new Error(t("err.imageSize"));
  try {
    const bmp = await createImageBitmap(file);          // honours the photo's EXIF rotation
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";                             // a transparent PNG becomes white paper, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1), preview: dataUrl };
  } catch {
    if (file.size > 5 * 1024 * 1024) throw new Error(t("err.imageSize"));
    return readImageFile(file);
  }
}
