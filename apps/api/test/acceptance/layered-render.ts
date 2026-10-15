import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

const exec = promisify(execFile);

/**
 * Renders a layered timeline (a camera moving over a big canvas; lines drawn on, written text,
 * a pop, a marker highlight, a picture placed in a box, a built-in sound) through the real render worker, then checks the frames: lines appear
 * as they are drawn, the paper stays paper, and rendering the same timeline twice gives the same
 * pixels. Needs ffmpeg and Chrome. Set REMOTION_BROWSER_EXECUTABLE to a Chrome or headless-shell binary if
 * Remotion can't find one.
 */
const timeline = {
  version: 2,
  canvas: { width: 640, height: 360, fps: 30 },
  world: { width: 1280, height: 720 },
  theme: {
    paper: '#fbfaf5',
    ink: '#1f1f1f',
    highlight: '#ffd84a',
    accents: ['#3b82f6', '#22c55e', '#ef4444'],
    fontHand: 'Caveat',
    fontBody: 'Patrick Hand',
    strokeWidth: 5,
    roughness: 0.5,
    paperTexture: 'paper',
  },
  camera: {
    keys: [
      { atSec: 0, cx: 320, cy: 180, zoom: 1 },
      { atSec: 2, cx: 320, cy: 180, zoom: 1 },
      { atSec: 3.5, cx: 960, cy: 540, zoom: 1, ease: 'in_out' },
    ],
  },
  tracks: [
    {
      // Built-in sounds need no resources: they ship with the composition.
      id: 'sfx',
      type: 'audio',
      items: [
        {
          type: 'media',
          handle: 'builtin:audio/whoosh',
          startSec: 2,
          durationSec: 0.65,
          volume: 1,
        },
      ],
    },
    {
      // A picture placed in a box with an arrival, on the screen so the camera doesn't move it.
      id: 'picture',
      type: 'overlay',
      items: [
        {
          type: 'media',
          handle: 'artifact:square',
          startSec: 0.2,
          durationSec: 5,
          space: 'screen',
          x: 520,
          y: 20,
          w: 100,
          h: 100,
          anim: { type: 'pop', durationSec: 0.3 },
        },
      ],
    },
    {
      id: 'draw',
      type: 'overlay',
      items: [
        {
          type: 'graphic',
          startSec: 0,
          durationSec: 4,
          x: 40,
          y: 20,
          w: 420,
          h: 90,
          content: { kind: 'text', text: 'HABITS', size: 90 },
          anim: { type: 'handwrite', durationSec: 1.2, hand: 'marker' },
        },
        {
          type: 'graphic',
          startSec: 0.3,
          durationSec: 3.7,
          x: 60,
          y: 140,
          w: 160,
          h: 160,
          content: { kind: 'shape', shape: 'circle', color: 'accent1' },
          anim: { type: 'draw', durationSec: 1.2 },
        },
        {
          type: 'graphic',
          startSec: 1,
          durationSec: 3,
          x: 260,
          y: 190,
          w: 150,
          h: 50,
          content: { kind: 'shape', shape: 'arrow' },
          anim: { type: 'draw', durationSec: 0.8, hand: 'pencil' },
        },
        {
          type: 'graphic',
          startSec: 1.6,
          durationSec: 2.4,
          x: 430,
          y: 150,
          w: 150,
          h: 150,
          content: { kind: 'shape', shape: 'box', color: 'accent2' },
          anim: { type: 'pop' },
        },
        {
          type: 'graphic',
          startSec: 3.6,
          durationSec: 2,
          x: 900,
          y: 450,
          w: 300,
          h: 200,
          content: {
            kind: 'paths',
            viewBox: { width: 100, height: 100 },
            strokes: [
              { d: 'M20 20 L80 20 L80 80 L20 80 Z', color: 'accent3', fill: 'highlight' },
              { d: 'M35 50 L47 65 L68 35', weight: 'bold' },
            ],
          },
          anim: { type: 'draw', durationSec: 1 },
        },
      ],
    },
  ],
};

async function frame(video: string, sec: number): Promise<Buffer> {
  const { stdout } = await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(sec),
      '-i',
      video,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

/** The share of pixels that are dark (ink) and the share that are light (paper). */
function inkAndPaper(rgb: Buffer): { ink: number; paper: number } {
  let ink = 0;
  let paper = 0;
  const pixels = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    const luma = 0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!;
    if (luma < 90) ink += 1;
    else if (luma > 225) paper += 1;
  }
  return { ink: ink / pixels, paper: paper / pixels };
}

const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/** The loudest sample in a stretch of the video's audio, in dB (very negative for silence). */
async function peakDb(video: string, startSec: number, lengthSec: number): Promise<number> {
  const { stderr } = await exec('ffmpeg', [
    '-v',
    'info',
    '-ss',
    String(startSec),
    '-t',
    String(lengthSec),
    '-i',
    video,
    '-vn',
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);
  const peak = /max_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  return peak === undefined || peak === '-inf' ? -120 : Number(peak);
}

async function render(dir: string, name: string): Promise<string> {
  const output = path.join(dir, name);
  await exec(
    process.execPath,
    [
      path.resolve(__dirname, '../../../render-worker/dist/cli.js'),
      path.join(dir, 'timeline.json'),
      path.join(dir, 'resources.json'),
      'draft',
      output,
      ...(process.env.REMOTION_BROWSER_EXECUTABLE ? [process.env.REMOTION_BROWSER_EXECUTABLE] : []),
    ],
    { timeout: 600_000 },
  );
  return output;
}

/** A solid red PNG as a data URL, so the placed picture needs no file. */
function redSquareDataUrl(): string {
  const size = 8;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(size * 3).fill(Buffer.from([220, 30, 30])),
  ]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** The colour of the pixel at (x, y) of a frame. */
function pixel(rgb: Buffer, width: number, x: number, y: number): [number, number, number] {
  const at = (y * width + x) * 3;
  return [rgb[at]!, rgb[at + 1]!, rgb[at + 2]!];
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'reelcraft-whiteboard-'));
  await writeFile(path.join(dir, 'timeline.json'), JSON.stringify(timeline));
  await writeFile(
    path.join(dir, 'resources.json'),
    JSON.stringify({
      media: { 'artifact:square': { src: redSquareDataUrl(), kind: 'media.image' } },
      timing: {},
    }),
  );
  const first = await render(dir, 'a.mp4');
  const second = await render(dir, 'b.mp4');

  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'default=noprint_wrappers=1',
    first,
  ]);
  assert(/width=640/.test(stdout) && /height=360/.test(stdout), `Unexpected size: ${stdout}`);
  const duration = Number(/duration=([\d.]+)/.exec(stdout)?.[1]);
  assert(Math.abs(duration - 5.6) < 0.3, `Unexpected duration: ${duration}`);

  // Lines appear as they are drawn: nothing at the start, more ink a little later.
  const start = inkAndPaper(await frame(first, 0));
  const midway = inkAndPaper(await frame(first, 1.0));
  const drawn = inkAndPaper(await frame(first, 2.0));
  assert(start.ink < 0.002, `Frame at 0s already has ink: ${start.ink}`);
  assert(midway.ink > start.ink, 'No lines were drawn by 1.0s');
  assert(drawn.ink > midway.ink, 'The drawing did not keep growing');
  // The paper stays paper.
  assert(drawn.paper > 0.7, `Paper is not paper: ${drawn.paper}`);
  // The placed picture shows where its box is (top right, on the screen), and not before it arrived.
  const early = await frame(first, 0);
  const later = await frame(first, 1.0);
  const [r, g, b] = pixel(later, 640, 570, 70);
  assert(r > 180 && g < 80 && b < 80, `The placed picture is not there at 1.0s: ${r},${g},${b}`);
  const [er] = pixel(early, 640, 570, 70);
  assert(
    er > 200 && pixel(early, 640, 570, 70)[1] > 200,
    'The picture was there before it arrived',
  );
  // The camera moved: the frame before and after the move differ.
  const before = sha(await frame(first, 1.9));
  const after = sha(await frame(first, 4.0));
  assert(before !== after, 'The camera did not move');
  // The built-in sound plays where it was put, and the rest is silent.
  const during = await peakDb(first, 2, 0.65);
  const silent = await peakDb(first, 4.2, 1);
  assert(during > -30, `The built-in sound is missing or silent (peak ${during} dB)`);
  assert(silent < -60, `Audio where there should be none (peak ${silent} dB)`);
  // The same timeline renders to the same pixels.
  for (const sec of [0.9, 1.5, 3.0, 5.0]) {
    const one = sha(await frame(first, sec));
    const two = sha(await frame(second, sec));
    assert(one === two, `Frame at ${sec}s differs between two renders`);
  }
  console.log(`layered render acceptance passed: ${first} (${duration.toFixed(2)}s)`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
