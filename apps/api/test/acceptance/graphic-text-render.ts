import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Renders words drawn by graphic items through the real render worker and checks the pixels:
 * a line of words in coloured parts shows each part in its own colour, and typed words appear letter
 * by letter, and an arrow between two items is drawn between where they are. Needs ffmpeg and Chrome. Set
 * REMOTION_BROWSER_EXECUTABLE to a Chrome or headless-shell binary if Remotion can't find one.
 */
const WIDTH = 640;
const HEIGHT = 360;
const worker = path.resolve(__dirname, '../../../render-worker/dist/cli.js');
const browser = process.env.REMOTION_BROWSER_EXECUTABLE
  ? [process.env.REMOTION_BROWSER_EXECUTABLE]
  : [];

const graphic = (extra: Record<string, unknown>) => ({
  type: 'graphic',
  startSec: 0,
  durationSec: 2,
  anim: { type: 'none' },
  ...extra,
});

const timeline = {
  version: 2,
  canvas: { width: WIDTH, height: HEIGHT, fps: 30, background: '#ffffff' },
  theme: {
    paper: '#ffffff',
    ink: '#000000',
    highlight: '#ffd84a',
    accents: ['#0000ff', '#ff0000'],
    fontHand: 'Caveat',
    fontBody: 'Patrick Hand',
    strokeWidth: 4,
    roughness: 0,
    paperTexture: 'none',
  },
  tracks: [
    {
      id: 'overlay',
      type: 'overlay',
      items: [
        // Coloured parts: blue on the left half of the box, red on the right.
        graphic({
          id: 'runs',
          x: 20,
          y: 20,
          w: 600,
          h: 120,
          content: {
            kind: 'text',
            text: 'WWWW MMMM',
            size: 100,
            font: 'body',
            runs: [
              { text: 'WWWW ', color: 'accent1' },
              { text: 'MMMM', color: 'accent2' },
            ],
          },
        }),
        // Typed words: 'IIIIIIIIII' over 2s, so about half are typed at 1s.
        graphic({
          id: 'typed',
          x: 20,
          y: 200,
          w: 600,
          h: 120,
          content: { kind: 'text', text: 'IIIIIIIIII', size: 100, font: 'body', color: '#00aa00' },
          anim: { type: 'type', durationSec: 2, caret: false },
          durationSec: 4,
        }),
        // An arrow between two boxes (in the bottom-right corner area), drawn from where they are.
        graphic({
          id: 'left-end',
          x: 380,
          y: 300,
          w: 40,
          h: 40,
          content: { kind: 'shape', shape: 'box', color: '#ff00ff' },
        }),
        graphic({
          id: 'right-end',
          x: 580,
          y: 300,
          w: 40,
          h: 40,
          content: { kind: 'shape', shape: 'box', color: '#ff00ff' },
        }),
        graphic({
          id: 'joining',
          // A stale box on purpose: the arrow follows its ends, not this.
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          content: { kind: 'connector', from: 'left-end', to: 'right-end', color: '#ff8800' },
        }),
        graphic({
          id: 'dangling',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          content: { kind: 'connector', from: 'left-end', to: 'nowhere', color: '#ff8800' },
        }),
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

type Rgb = [number, number, number];
/** How many pixels in a box match a test. */
function count(
  rgb: Buffer,
  box: { x: number; y: number; w: number; h: number },
  test: (p: Rgb) => boolean,
): number {
  let n = 0;
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const i = (y * WIDTH + x) * 3;
      if (test([rgb[i]!, rgb[i + 1]!, rgb[i + 2]!])) n += 1;
    }
  }
  return n;
}
const isBlue = ([r, g, b]: Rgb) => b > 150 && r < 100 && g < 100;
const isRed = ([r, g, b]: Rgb) => r > 150 && g < 100 && b < 100;
const isOrange = ([r, g, b]: Rgb) => r > 200 && g > 90 && g < 180 && b < 80;
const isGreen = ([r, g, b]: Rgb) => g > 120 && r < 90 && b < 90;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`graphic text render acceptance: ${message}`);
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'reelcraft-graphic-text-'));
  await writeFile(path.join(dir, 'timeline.json'), JSON.stringify(timeline));
  await writeFile(path.join(dir, 'resources.json'), JSON.stringify({ media: {}, timing: {} }));
  const video = path.join(dir, 'out.mp4');
  await exec(
    process.execPath,
    [
      worker,
      path.join(dir, 'timeline.json'),
      path.join(dir, 'resources.json'),
      'draft',
      video,
      ...browser,
    ],
    { timeout: 600_000 },
  );
  const rgb = await frame(video, 1);

  // Coloured parts.
  const left = { x: 20, y: 20, w: 250, h: 120 };
  const right = { x: 330, y: 20, w: 290, h: 120 };
  const blueLeft = count(rgb, left, isBlue);
  const redRight = count(rgb, right, isRed);
  assert(blueLeft > 500, `the first part is not blue (${blueLeft} blue pixels)`);
  assert(redRight > 500, `the second part is not red (${redRight} red pixels)`);
  assert(count(rgb, left, isRed) < 20, 'red shows in the first part');
  assert(count(rgb, right, isBlue) < 20, 'blue shows in the second part');

  // Typing: by 1s the first letters are in and the rest not yet; by 3s all of them.
  const typedRow = { x: 20, y: 200, w: 600, h: 120 };
  const greenAt = (frameRgb: Buffer) => count(frameRgb, typedRow, isGreen);
  const columns = (frameRgb: Buffer) => {
    let last = 0;
    for (let x = typedRow.x; x < typedRow.x + typedRow.w; x += 1) {
      if (count(frameRgb, { ...typedRow, x, w: 1 }, isGreen) > 0) last = x;
    }
    return last;
  };
  const start = await frame(video, 0);
  const done = await frame(video, 3);
  assert(greenAt(start) === 0, `typed words show before typing starts (${greenAt(start)})`);
  assert(greenAt(rgb) > 100, 'nothing is typed half way');
  assert(greenAt(done) > greenAt(rgb) * 1.5, 'typing did not go on after half way');
  assert(
    columns(rgb) < columns(done) - 50,
    `half way, the typed letters reach as far as at the end (${columns(rgb)} vs ${columns(done)})`,
  );

  // The arrow: orange between the two boxes, and nowhere else (the dangling one draws nothing).
  const between = count(rgb, { x: 425, y: 300, w: 150, h: 40 }, isOrange);
  const elsewhere = count(rgb, { x: 0, y: 0, w: WIDTH, h: 290 }, isOrange);
  assert(between > 100, `no arrow between the two boxes (${between} orange pixels)`);
  assert(elsewhere === 0, `orange where no arrow should be (${elsewhere} pixels)`);

  console.log(`graphic text render acceptance passed (${dir})`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
