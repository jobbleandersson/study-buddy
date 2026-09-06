// A shareable square image (PNG), canvas-drawn — celebrating a badge, a
// result, or a leaderboard rank. Zero backend, zero image libraries: draw
// straight onto an offscreen canvas, then open a small preview modal with a
// native share sheet where supported and a plain download everywhere else.
// The card's own look is fixed regardless of the viewer's light/dark theme —
// it's a poster going out to Snapchat or a class group chat, not a UI
// surface, so it gets its own deliberate palette instead of following the app's.

import { el, icon, ICONS } from "./dom.js";
import { t } from "./i18n.js";

const SIZE = 1080;

const GRADIENTS = {
  brand: ["#1F2C7A", "#3A57C9"],
  ok: ["#1B7A50", "#2FA36B"],
  bronze: ["#8A4A15", "#B5651D"],
  silver: ["#5F6779", "#8A93A6"],
  gold: ["#8F6B15", "#C9971F"],
  platinum: ["#3A57C9", "#6456C4", "#C14A75"],
};

export function tierEmoji(tier) {
  return { bronze: "🥉", silver: "🥈", gold: "🥇", platinum: "💎" }[tier] || "🏅";
}

// Split `text` into lines that fit `maxWidth` at ctx's CURRENT font.
function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawLines(ctx, lines, cx, y, lineHeight) {
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineHeight));
  return y + (lines.length - 1) * lineHeight + lineHeight / 2;
}

function draw(ctx, { emoji, headline, caption, tag, tone = "brand" }) {
  const colors = GRADIENTS[tone] || GRADIENTS.brand;
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  colors.forEach((c, i) => grad.addColorStop(i / Math.max(1, colors.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const glow = ctx.createRadialGradient(SIZE / 2, SIZE * 0.45, 0, SIZE / 2, SIZE * 0.45, SIZE * 0.7);
  glow.addColorStop(0, "rgba(255,255,255,.16)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";

  const cx = SIZE / 2;
  const maxWidth = SIZE - 140;
  const wordmarkY = 100;

  ctx.font = "700 42px Inter, Arial, sans-serif";
  ctx.globalAlpha = 0.85;
  ctx.fillText("StudyBuddy", cx, wordmarkY);
  ctx.globalAlpha = 1;

  // Measure every block first, then centre the whole group in the space
  // below the wordmark — flowing top-down from a fixed offset left dead
  // space whenever the text was short.
  const blocks = [];
  if (tag) {
    ctx.font = "700 36px Inter, Arial, sans-serif";
    blocks.push({ lines: wrapLines(ctx, tag.toUpperCase(), maxWidth), font: ctx.font, lineHeight: 46, alpha: 0.75 });
  }
  if (emoji) blocks.push({ emoji, font: "180px Arial, sans-serif", height: 210 });
  ctx.font = "800 130px Inter, Arial, sans-serif";
  blocks.push({ lines: wrapLines(ctx, headline, maxWidth), font: ctx.font, lineHeight: 138, alpha: 1 });
  if (caption) {
    ctx.font = "48px Inter, Arial, sans-serif";
    blocks.push({ lines: wrapLines(ctx, caption, maxWidth - 60), font: ctx.font, lineHeight: 62, alpha: 0.9 });
  }

  const gap = 44;
  const heights = blocks.map((b) => b.emoji ? b.height : b.lines.length * b.lineHeight);
  const totalHeight = heights.reduce((a, b) => a + b, 0) + gap * (blocks.length - 1);

  const top = wordmarkY + 90;
  const bottom = SIZE - 90;
  let cursor = top + Math.max(0, (bottom - top - totalHeight) / 2);

  blocks.forEach((b, i) => {
    ctx.font = b.font;
    ctx.globalAlpha = b.emoji ? 1 : b.alpha;
    if (b.emoji) ctx.fillText(b.emoji, cx, cursor + heights[i] / 2);
    else drawLines(ctx, b.lines, cx, cursor + b.lineHeight / 2, b.lineHeight);
    ctx.globalAlpha = 1;
    cursor += heights[i] + gap;
  });
}

function clamp(s, max) {
  if (!s || s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Builds the card and opens the share/download modal. `filename` should be a
 *  plain .png name — nothing user-supplied goes into it. */
export function shareCard({ emoji, headline, caption, tag, tone, filename = "studybuddy.png" }) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  draw(canvas.getContext("2d"), { emoji, headline: clamp(headline, 40), caption: clamp(caption, 70), tag, tone });
  canvas.toBlob((blob) => { if (blob) openModal(blob, filename); }, "image/png");
}

function openModal(blob, filename) {
  const url = URL.createObjectURL(blob);
  const file = new File([blob], filename, { type: "image/png" });
  const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));

  function onKeydown(e) { if (e.key === "Escape") closeAll(); }
  document.addEventListener("keydown", onKeydown);

  function closeAll() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const shareBtn = canShareFile ? el("button.btn", {
    type: "button",
    onclick: async () => { try { await navigator.share({ files: [file], title: "StudyBuddy" }); } catch {} },
  }, [icon(ICONS.share, 16), t("share.shareButton")]) : null;

  const downloadLink = el("a.btn.btn--ghost", { href: url, download: filename, onclick: closeAll }, t("share.download"));

  const overlay = el("div.modal.sharecard-backdrop", {
    role: "dialog", "aria-modal": "true", "aria-label": t("share.title"),
    onclick: (e) => { if (e.target === overlay) closeAll(); },
  }, [
    el("div.modal__card.sharecard", {}, [
      el("button.iconbtn.sharecard__close", { type: "button", "aria-label": t("common.close"), onclick: closeAll }, [icon(ICONS.close, 16)]),
      el("h3", {}, t("share.title")),
      el("img.sharecard__preview", { src: url, alt: "" }),
      el("div.sharecard__actions", {}, [shareBtn, downloadLink].filter(Boolean)),
    ]),
  ]);

  document.body.appendChild(overlay);
}
