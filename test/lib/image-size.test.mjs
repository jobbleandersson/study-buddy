import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { imageDimensions, MAX_PIXELS } from "../../js/lib/image-size.js";

const png = (w, h) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const jpeg = (w, h) => {
  // SOI, an APP0 segment, then SOF0 with height and width.
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
};
const gif = (w, h) => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8]);

describe("imageDimensions", () => {
  test("reads PNG, JPEG and GIF headers", () => {
    assert.deepEqual(imageDimensions(png(4032, 3024)), { width: 4032, height: 3024 });
    assert.deepEqual(imageDimensions(jpeg(1600, 1200)), { width: 1600, height: 1200 });
    assert.deepEqual(imageDimensions(gif(320, 200)), { width: 320, height: 200 });
  });
  test("a decompression bomb shows its size before anything is decoded", () => {
    const { width, height } = imageDimensions(png(30000, 30000));
    assert.ok(width * height > MAX_PIXELS);
  });
  test("a phone's 48 MP photo is within the limit", () => {
    const { width, height } = imageDimensions(jpeg(8000, 6000));
    assert.ok(width * height <= MAX_PIXELS);
  });
  test("anything else is unknown, not an error", () => {
    assert.equal(imageDimensions(new Uint8Array([1, 2, 3])), null);
    assert.equal(imageDimensions(null), null);
  });
});
