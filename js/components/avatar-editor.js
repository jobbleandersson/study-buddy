// The profile-picture editor: pick an image, frame it in a circle (drag to move,
// slider / wheel / keys to zoom), save it as a small square. Resolves with a
// data: URL (WebP where the browser can make one, JPEG otherwise) or null.

import { el, icon, ICONS } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { assertDecodable } from "../lib/image-size.js";

const VIEW = 260;          // the on-screen framing square, in CSS px
const OUT = 256;           // the saved picture, in px
const MAX_FILE = 15 * 1024 * 1024;
const MAX_ZOOM = 4;

/** Decode a picked file to something drawImage takes. Rejects anything that
 *  isn't a readable image (HEIC on most desktop browsers, a renamed PDF…). */
async function loadImage(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The framed picture as a data: URL, WebP if the browser encodes it. */
function exportSquare(img, view) {
  const c = document.createElement("canvas");
  c.width = c.height = OUT;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const f = OUT / VIEW;
  ctx.drawImage(img, view.x * f, view.y * f, view.w * f, view.h * f);
  const webp = c.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", 0.88);
}

/**
 * @param file  a File from an <input type=file>
 * @returns Promise<{ dataUrl } | { error } | null>  null when cancelled
 */
export async function openAvatarEditor(file) {
  if (!file || !/^image\//.test(file.type || "")) return { error: t("avatar.readFail") };
  if (file.size > MAX_FILE) return { error: t("avatar.tooBig") };
  try { await assertDecodable(file, t("err.imagePixels")); } catch (e) { return { error: e.message }; }
  let img;
  try { img = await loadImage(file); } catch { return { error: t("avatar.readFail") }; }
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
  if (!iw || !ih) return { error: t("avatar.readFail") };

  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const base = Math.max(VIEW / iw, VIEW / ih);   // "cover": the image always fills the circle
    let zoom = 1, ox = 0, oy = 0;                  // image centre's offset from the view centre

    const canvas = el("canvas.avatared__canvas", {
      width: VIEW * (window.devicePixelRatio || 1), height: VIEW * (window.devicePixelRatio || 1),
      tabindex: "0", role: "img", "aria-label": t("avatar.frameAria"),
    });
    const ctx = canvas.getContext("2d");
    const slider = el("input.avatared__zoom", {
      type: "range", min: "1", max: String(MAX_ZOOM), step: "0.01", value: "1", "aria-label": t("avatar.zoom"),
    });

    function view() {
      const s = base * zoom, w = iw * s, h = ih * s;
      // Keep the image covering the whole square — no empty corners to pan into.
      const mx = (w - VIEW) / 2, my = (h - VIEW) / 2;
      ox = Math.max(-mx, Math.min(mx, ox));
      oy = Math.max(-my, Math.min(my, oy));
      return { x: VIEW / 2 - w / 2 + ox, y: VIEW / 2 - h / 2 + oy, w, h };
    }

    function paint() {
      const dpr = window.devicePixelRatio || 1;
      const v = view();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, VIEW, VIEW);
      ctx.drawImage(img, v.x, v.y, v.w, v.h);
      // Dim what falls outside the circle, so the framing reads at a glance.
      ctx.fillStyle = "rgba(0, 0, 0, .55)";
      ctx.beginPath();
      ctx.rect(0, 0, VIEW, VIEW);
      ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(255, 255, 255, .9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    const setZoom = (z) => {
      zoom = Math.max(1, Math.min(MAX_ZOOM, z));
      slider.value = String(zoom);
      paint();
    };
    slider.addEventListener("input", () => setZoom(Number(slider.value)));
    // − / + step the zoom; the slider sweeps it.
    const zoomBtn = (key, path, k) => el("button.iconbtn.iconbtn--sm.avatared__zbtn", {
      type: "button", "aria-label": t(key), title: t(key), onclick: () => setZoom(zoom * k),
    }, [icon(path, 16)]);

    // Drag to move (mouse, pen or finger).
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, ox, oy };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      const k = VIEW / r.width;               // CSS px on screen → framing px
      ox = drag.ox + (e.clientX - drag.x) * k;
      oy = drag.oy + (e.clientY - drag.y) * k;
      paint();
    });
    const endDrag = () => { drag = null; };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
    canvas.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 30 : 10;
      if (e.key === "ArrowLeft") ox -= step;
      else if (e.key === "ArrowRight") ox += step;
      else if (e.key === "ArrowUp") oy -= step;
      else if (e.key === "ArrowDown") oy += step;
      else if (e.key === "+" || e.key === "=") { setZoom(zoom * 1.1); e.preventDefault(); return; }
      else if (e.key === "-") { setZoom(zoom / 1.1); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      paint();
    });

    function close(result) {
      document.removeEventListener("keydown", onEsc);
      modal.remove();
      if (prevFocus?.isConnected) prevFocus.focus();
      resolve(result);
    }
    function onEsc(e) { if (e.key === "Escape") close(null); }

    const modal = el("div.modal", {
      role: "dialog", "aria-modal": "true", "aria-labelledby": "avatared-title",
      onclick: (e) => { if (e.target === modal) close(null); },
    }, [
      el("div.modal__card.avatared", {}, [
        el("h3", { id: "avatared-title" }, t("avatar.title")),
        el("p.note", {}, t("avatar.lede")),
        el("div.avatared__stage", {}, [canvas]),
        el("div.avatared__zoomrow", {}, [
          zoomBtn("avatar.zoomOut", ICONS.minus, 1 / 1.2),
          slider,
          zoomBtn("avatar.zoomIn", ICONS.plus, 1.2),
        ]),
        el("div.avatared__actions", {}, [
          el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => close(null) }, t("common.cancel")),
          el("button.btn.btn--sm", { type: "button", onclick: () => close({ dataUrl: exportSquare(img, view()) }) },
            [icon(ICONS.check, 15), t("avatar.save")]),
        ]),
      ]),
    ]);
    document.body.appendChild(modal);
    document.addEventListener("keydown", onEsc);
    paint();
    canvas.focus();
  });
}
