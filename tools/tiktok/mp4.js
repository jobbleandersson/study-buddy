// Frames (and optionally sound) in, an .mp4 out: H.264 video and AAC audio from the browser's own
// WebCodecs encoders, written into a plain MP4 (the index first, so it starts playing before it has
// fully loaded). Used by the video pages through motion.js; nothing to install.

const FOURCC = (s) => [...s].map((c) => c.charCodeAt(0));
const u8 = (n) => [n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
const u24 = (n) => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const zeros = (n) => new Array(n).fill(0);

/** An MP4 box: 32-bit size, four-letter type, then the payload (byte arrays or nested boxes). */
function box(type, ...parts) {
  const body = parts.flatMap((p) => (p instanceof Uint8Array ? [...p] : p));
  return [...u32(8 + body.length), ...FOURCC(type), ...body];
}
const fullBox = (type, version, flags, ...parts) => box(type, u8(version), u8(flags >>> 16), u16(flags & 0xffff), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
/** An MPEG-4 descriptor (inside esds), its length in the four-byte form. */
const descriptor = (tag, body) => [tag, 0x80, 0x80, 0x80, body.length, ...body];

/** One track: id, handler ("vide"/"soun"), timescale and per-sample duration, the sample sizes, the
 *  key samples (video), the sample entry box, and where its samples start in the file. */
function trak({ id, handler, timescale, delta, sizes, keys, entry, offset, width = 0, height = 0 }) {
  const n = sizes.length;
  const ms = Math.round((n * delta * 1000) / timescale);
  const stbl = box("stbl",
    fullBox("stsd", 0, 0, u32(1), entry),
    fullBox("stts", 0, 0, u32(1), u32(n), u32(delta)),
    ...(keys ? [fullBox("stss", 0, 0, u32(keys.length), keys.flatMap((k) => u32(k + 1)))] : []),
    fullBox("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
    fullBox("stsz", 0, 0, u32(0), u32(n), sizes.flatMap(u32)),
    fullBox("stco", 0, 0, u32(1), u32(offset)));
  const video = handler === "vide";
  const minf = box("minf",
    video ? fullBox("vmhd", 0, 1, zeros(8)) : fullBox("smhd", 0, 0, u16(0), u16(0)),
    box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
    stbl);
  const mdia = box("mdia",
    fullBox("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(n * delta), u16(0x55c4), u16(0)),
    fullBox("hdlr", 0, 0, u32(0), FOURCC(handler), zeros(12), FOURCC(video ? "VideoHandler" : "SoundHandler"), u8(0)),
    minf);
  return {
    ms,
    box: box("trak",
      fullBox("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(video ? 0 : 0x0100), u16(0), MATRIX, u32(width * 65536), u32(height * 65536)),
      mdia),
  };
}

function moov(tracks) {
  const ms = Math.max(...tracks.map((t) => t.ms));
  return box("moov",
    fullBox("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1)),
    ...tracks.map((t) => t.box));
}

/** Encodes sound (one Float32Array per channel) as AAC-LC. Returns what finish() needs for the
 *  audio track. */
export async function encodeAac(channels, sampleRate = 48000, bitrate = 160_000) {
  const chunks = [];
  let description = null, failure = null;
  const encoder = new AudioEncoder({
    output(chunk, meta) {
      if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push(data);
    },
    error(e) { failure = e; },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels.length, bitrate });
  const total = channels[0].length;
  for (let at = 0; at < total; at += sampleRate) {
    const len = Math.min(sampleRate, total - at);
    const planar = new Float32Array(len * channels.length);
    channels.forEach((ch, c) => planar.set(ch.subarray(at, at + len), c * len));
    encoder.encode(new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: len, numberOfChannels: channels.length, timestamp: Math.round((at * 1e6) / sampleRate), data: planar }));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (!description) throw new Error("The audio encoder gave no AAC configuration.");
  return { chunks, description, sampleRate, channels: channels.length, bitrate };
}

/** Starts an H.264 encoder for width×height at fps. add() takes a frame (an ImageBitmap or a canvas),
 *  finish({ audio }) returns the finished .mp4 as bytes, with the sound from encodeAac() if given. */
export async function createMp4({ width, height, fps = 30, bitrate = 8_000_000 }) {
  const chunks = [];
  let description = null, failure = null;
  const encoder = new VideoEncoder({
    output(chunk, meta) {
      if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, key: chunk.type === "key", ts: chunk.timestamp });
    },
    error(e) { failure = e; },
  });
  // High profile, level 4.0 (enough for 1080×1920 at 30 fps); Baseline if this machine lacks High.
  const config = { codec: "avc1.640028", width, height, bitrate, bitrateMode: "variable", framerate: fps, avc: { format: "avc" } };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) config.codec = "avc1.42E028";
  encoder.configure(config);

  let n = 0;
  return {
    async add(image) {
      if (failure) throw failure;
      const frame = new VideoFrame(image, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 });
      frame.close();
      n++;
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
    },
    async finish({ audio = null } = {}) {
      await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      if (!description) throw new Error("The encoder gave no H.264 configuration (avcC).");
      // Frames must come back in display order: this writer has no composition offsets (B-frames).
      if (chunks.some((c, k) => k && c.ts <= chunks[k - 1].ts)) throw new Error("The encoder reordered frames (B-frames); this MP4 writer can't store that.");

      const vSizes = chunks.map((c) => c.data.length);
      const vBytes = vSizes.reduce((a, b) => a + b, 0);
      const avc1 = box("avc1",
        zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff),
        box("avcC", description));
      const aSizes = audio ? audio.chunks.map((c) => c.length) : [];
      const mp4a = audio && box("mp4a",
        zeros(6), u16(1), zeros(8), u16(audio.channels), u16(16), u16(0), u16(0), u32(audio.sampleRate * 65536),
        fullBox("esds", 0, 0, descriptor(0x03, [...u16(2), 0,
          ...descriptor(0x04, [0x40, 0x15, ...u24(0), ...u32(audio.bitrate), ...u32(audio.bitrate), ...descriptor(0x05, [...audio.description])]),
          ...descriptor(0x06, [0x02])])));

      const ftyp = box("ftyp", FOURCC("isom"), u32(512), FOURCC("isom"), FOURCC("iso2"), FOURCC("avc1"), FOURCC("mp41"));
      const tracks = (start) => [
        trak({ id: 1, handler: "vide", timescale: fps * 1000, delta: 1000, sizes: vSizes, keys: chunks.flatMap((c, k) => (c.key ? [k] : [])), entry: avc1, offset: start, width, height }),
        ...(audio ? [trak({ id: 2, handler: "soun", timescale: audio.sampleRate, delta: 1024, sizes: aSizes, entry: mp4a, offset: start + vBytes })] : []),
      ];
      const moovLength = moov(tracks(0)).length;
      const start = ftyp.length + moovLength + 8;
      const header = [...ftyp, ...moov(tracks(start))];
      const total = vBytes + aSizes.reduce((a, b) => a + b, 0);
      const out = new Uint8Array(header.length + 8 + total);
      out.set(header, 0);
      out.set([...u32(8 + total), ...FOURCC("mdat")], header.length);
      let at = header.length + 8;
      for (const c of chunks) { out.set(c.data, at); at += c.data.length; }
      for (const c of audio?.chunks || []) { out.set(c, at); at += c.length; }
      return out;
    },
  };
}
