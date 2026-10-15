// Makes the sound effects that ship with Reelcraft. They are synthesised from noise and tones, so
// they are original: no recording, no licence to track. The output is deterministic (seeded), so
// running this again gives the same files. Run it with: node scripts/make-sfx.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sfx');

/** The same stream of numbers from 0 to 1 for a seed (mulberry32). */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const samples = (seconds) => new Float32Array(Math.round(seconds * RATE));
const noise = (rnd) => rnd() * 2 - 1;

/** A one-pole low-pass filter. */
function lowpass(input, cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  const out = new Float32Array(input.length);
  let y = 0;
  for (let i = 0; i < input.length; i += 1) {
    y += a * (input[i] - y);
    out[i] = y;
  }
  return out;
}
const highpass = (input, cutoff) => {
  const low = lowpass(input, cutoff);
  return input.map((v, i) => v - low[i]);
};
/** Fades the first and last few milliseconds, so nothing clicks. */
function edges(buffer, ms = 6) {
  const n = Math.round((ms / 1000) * RATE);
  for (let i = 0; i < n && i < buffer.length; i += 1) {
    const g = i / n;
    buffer[i] *= g;
    buffer[buffer.length - 1 - i] *= g;
  }
  return buffer;
}
const normalize = (buffer, peak = 0.8) => {
  let max = 0;
  for (const v of buffer) max = Math.max(max, Math.abs(v));
  return buffer.map((v) => (max > 0 ? (v / max) * peak : v));
};
const sine = (freq, t) => Math.sin(2 * Math.PI * freq * t);

const sounds = {
  // Short scratches of a pencil on paper.
  pencil() {
    const rnd = random(11);
    const out = samples(0.55);
    const raw = out.map(() => noise(rnd));
    const band = lowpass(highpass(raw, 2500), 7000);
    return out.map((_, i) => {
      const t = i / RATE;
      // Three strokes, each loudest in the middle.
      const stroke = Math.max(0, Math.sin(Math.PI * ((t * 3.6) % 1))) ** 1.5;
      const grain = 0.6 + 0.4 * Math.abs(Math.sin(t * 190 + Math.sin(t * 37) * 3));
      return band[i] * stroke * grain;
    });
  },
  // The squeak of a marker.
  marker() {
    const rnd = random(23);
    const out = samples(0.7);
    const raw = out.map(() => noise(rnd));
    const low = lowpass(raw, 1800);
    return out.map((_, i) => {
      const t = i / RATE;
      const env = Math.sin(Math.PI * (t / 0.7)) ** 0.8;
      const squeak = 0.25 * sine(880 + 60 * Math.sin(t * 18), t) * (0.5 + 0.5 * Math.sin(t * 9));
      return (low[i] * 1.6 + squeak) * env;
    });
  },
  // A soft pop, like a bubble.
  pop() {
    const out = samples(0.2);
    return out.map((_, i) => {
      const t = i / RATE;
      const freq = 180 + 520 * Math.exp(-t * 28);
      return sine(freq, t) * Math.exp(-t * 20);
    });
  },
  // Air moving past: noise that sweeps up and fades.
  whoosh() {
    const rnd = random(37);
    const out = samples(0.65);
    const raw = out.map(() => noise(rnd));
    const slices = [400, 800, 1600, 3000].map((fc) => lowpass(highpass(raw, fc * 0.5), fc));
    return out.map((_, i) => {
      const t = i / RATE;
      const pos = Math.min(2.999, (t / 0.65) * 3);
      const k = Math.floor(pos);
      const mix = slices[k][i] * (1 - (pos - k)) + slices[k + 1][i] * (pos - k);
      return mix * Math.sin(Math.PI * (t / 0.65)) ** 2;
    });
  },
  // Paper being moved: a few crinkles.
  paper() {
    const rnd = random(41);
    const out = samples(0.5);
    const hits = [];
    for (let h = 0; h < 14; h += 1) hits.push({ at: rnd() * 0.42, gain: 0.4 + rnd() * 0.6 });
    const grain = highpass(
      out.map(() => noise(rnd)),
      1500,
    );
    return out.map((_, i) => {
      const t = i / RATE;
      let env = 0;
      for (const hit of hits) if (t >= hit.at) env += hit.gain * Math.exp(-(t - hit.at) * 70);
      return grain[i] * Math.min(1, env);
    });
  },
  // A small click.
  click() {
    const rnd = random(53);
    const out = samples(0.06);
    const raw = lowpass(
      highpass(
        out.map(() => noise(rnd)),
        1200,
      ),
      6000,
    );
    return out.map((_, i) => raw[i] * Math.exp(-(i / RATE) * 90));
  },
  // A bell: a bright ding.
  ding() {
    const out = samples(0.9);
    return out.map((_, i) => {
      const t = i / RATE;
      return (sine(880, t) + 0.5 * sine(1760, t) + 0.25 * sine(2637, t)) * Math.exp(-t * 5.5);
    });
  },
  // A clock tick.
  tick() {
    const out = samples(0.05);
    return out.map((_, i) => {
      const t = i / RATE;
      return sine(2400, t) * Math.exp(-t * 110);
    });
  },
  // A quick swipe, high to low.
  swipe() {
    const rnd = random(67);
    const out = samples(0.35);
    const raw = out.map(() => noise(rnd));
    const bright = lowpass(highpass(raw, 1200), 6000);
    const dull = lowpass(highpass(raw, 300), 1500);
    return out.map((_, i) => {
      const t = i / RATE;
      const k = t / 0.35;
      return (bright[i] * (1 - k) + dull[i] * k) * Math.sin(Math.PI * k) ** 1.5;
    });
  },
  // A glittering run of high notes.
  sparkle() {
    const out = samples(0.75);
    const notes = [1318.5, 1568, 1975.5, 2637, 3136];
    return out.map((_, i) => {
      const t = i / RATE;
      let v = 0;
      notes.forEach((f, n) => {
        const start = n * 0.08;
        if (t >= start) v += sine(f, t) * Math.exp(-(t - start) * 9) * 0.5;
      });
      return v;
    });
  },
  // A soft thump, for something landing.
  thud() {
    const rnd = random(79);
    const out = samples(0.3);
    const dull = lowpass(
      out.map(() => noise(rnd)),
      400,
    );
    return out.map((_, i) => {
      const t = i / RATE;
      return (sine(70 + 60 * Math.exp(-t * 30), t) * 1.2 + dull[i] * 0.5) * Math.exp(-t * 14);
    });
  },
  // A gentle two-note chime, for a result.
  chime() {
    const out = samples(1.2);
    return out.map((_, i) => {
      const t = i / RATE;
      const second = t >= 0.12 ? sine(988, t - 0.12) * Math.exp(-(t - 0.12) * 3.2) : 0;
      return sine(659, t) * Math.exp(-t * 3.2) + 0.8 * second;
    });
  },
};

function wav(buffer) {
  const data = Buffer.alloc(buffer.length * 2);
  buffer.forEach((v, i) =>
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2),
  );
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(sounds)) {
  const file = join(OUT, `${name}.wav`);
  writeFileSync(file, wav(edges(normalize(make()))));
  console.log(`${name}.wav`);
}
