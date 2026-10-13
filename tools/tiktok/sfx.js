// Sound effects for the videos, synthesised here (no recordings, so nothing to license): a whoosh
// for each transition, a pop when text lands, a tick for a tap or the counter, key clicks for typing,
// a chime for a right answer and a low thump for a big reveal. They sit quietly under whatever sound
// is picked in TikTok. renderSfx() mixes a list of { t, kind } into one stereo track.

export const SAMPLE_RATE = 48000;

/** The same "random" noise every render, so a video always sounds the same. */
function noiseBuffer(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2f6b1d;
  for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
  return buf;
}

/** An envelope on a gain: silent, up to `peak` in `attack`, down to silent by `end` (seconds after t). */
function env(ctx, t, peak, attack, end, out) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0008, t + end);
  g.connect(out);
  return g;
}

const SOUNDS = {
  whoosh(ctx, t, out, noise) {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(3800, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.17); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    src.connect(bp).connect(g).connect(out);
    src.start(t, 0.3, 0.42);
  },
  pop(ctx, t, out) {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(820, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.09);
    o.connect(env(ctx, t, 0.22, 0.006, 0.13, out));
    o.start(t); o.stop(t + 0.15);
  },
  tick(ctx, t, out, noise) {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2400;
    src.connect(hp).connect(env(ctx, t, 0.3, 0.002, 0.035, out));
    src.start(t, 1.1, 0.05);
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 1900;
    o.connect(env(ctx, t, 0.09, 0.002, 0.05, out));
    o.start(t); o.stop(t + 0.06);
  },
  type(ctx, t, out, noise) {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.8;
    src.connect(bp).connect(env(ctx, t, 0.22, 0.001, 0.028, out));
    src.start(t, (t * 7.3) % 1.5, 0.04);
  },
  chime(ctx, t, out) {
    [[1046.5, 0], [1568, 0.085]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      o.connect(env(ctx, t + dt, 0.13, 0.008, 0.42, out));
      o.start(t + dt); o.stop(t + dt + 0.45);
    });
  },
  thump(ctx, t, out) {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.2);
    o.connect(env(ctx, t, 0.55, 0.004, 0.3, out));
    o.start(t); o.stop(t + 0.32);
  },
};

/** Mixes the events ({ t: seconds, kind }) into a stereo track `length` seconds long. Returns one
 *  Float32Array per channel. */
export async function renderSfx(events, length) {
  const ctx = new OfflineAudioContext(2, Math.ceil(length * SAMPLE_RATE), SAMPLE_RATE);
  const noise = noiseBuffer(ctx, 2);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.12;
  const master = ctx.createGain(); master.gain.value = 0.85;
  comp.connect(master).connect(ctx.destination);
  for (const e of events) if (SOUNDS[e.kind] && e.t >= 0 && e.t < length) SOUNDS[e.kind](ctx, e.t, comp, noise);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}
