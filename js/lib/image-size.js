// An image's pixel size read from its header, without decoding it. Decoding is what costs memory —
// width × height × 4 bytes — and a small, highly compressed file (a 30000 × 30000 PNG of one colour
// is a few MB) would need gigabytes and take a phone's or Chromebook's tab down with it. So a picture
// is measured first and refused if it is absurdly large. Pure, so it can be unit-tested.

/** Most pixels we'll decode: room for any phone camera (48–64 MP sensors, full resolution). */
export const MAX_PIXELS = 70_000_000;

/** { width, height } from the first bytes of a PNG, JPEG, GIF or WebP, or null if it can't tell. */
export function imageDimensions(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const u16be = (i) => (b[i] << 8) | b[i + 1];
  const u16le = (i) => b[i] | (b[i + 1] << 8);
  const u24le = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));

  // PNG: signature, then the IHDR chunk with width and height.
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") return { width: u32be(16), height: u32be(20) };

  // GIF: logical screen size.
  if (b.length >= 10 && ascii(0, 3) === "GIF") return { width: u16le(6), height: u16le(8) };

  // WebP: RIFF....WEBP, then one of three chunk kinds.
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (kind === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // JPEG: walk the segments to the frame header (SOF0–SOF15, except the DHT/JPG/DAC markers).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }   // fill byte
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }   // no length
      const len = u16be(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5) };
      }
      if (marker === 0xda || len < 2) return null;   // start of scan before any frame header: give up
      i += 2 + len;
    }
  }
  return null;
}

/** Throws (with `message`) when the file's header says it is too big to decode. Unknown → let it be
 *  tried: the browser's own decoder is the fallback, as before. */
export async function assertDecodable(file, message) {
  // Exif blocks before a JPEG's frame header can run to 64 KB each; 512 KB covers every real camera.
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const dims = imageDimensions(head);
  if (dims && dims.width * dims.height > MAX_PIXELS) throw new Error(message);
}
