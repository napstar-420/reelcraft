import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Renders a hand-drawn timeline (a camera moving over a big canvas; lines drawn on, written text,
 * a pop, a marker highlight) through the real render worker, then checks the frames: lines appear
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
      id: 'draw',
      type: 'overlay',
      items: [
        {
          type: 'sketch',
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
          type: 'sketch',
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
          type: 'sketch',
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
          type: 'sketch',
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
          type: 'sketch',
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

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'reelcraft-whiteboard-'));
  await writeFile(path.join(dir, 'timeline.json'), JSON.stringify(timeline));
  await writeFile(path.join(dir, 'resources.json'), JSON.stringify({ media: {}, timing: {} }));
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
  // The camera moved: the frame before and after the move differ.
  const before = sha(await frame(first, 1.9));
  const after = sha(await frame(first, 4.0));
  assert(before !== after, 'The camera did not move');
  // The same timeline renders to the same pixels.
  for (const sec of [0.9, 1.5, 3.0, 5.0]) {
    const one = sha(await frame(first, sec));
    const two = sha(await frame(second, sec));
    assert(one === two, `Frame at ${sec}s differs between two renders`);
  }
  console.log(`whiteboard render acceptance passed: ${first} (${duration.toFixed(2)}s)`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
