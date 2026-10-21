import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MotionSource } from '@reelcraft/shared';
import { checkMotionCode } from '../../src/capability/motion/motion-code-check';
import { SAMPLE_MOTION_CODE } from '../../src/capability/motion/sample-motion';

const exec = promisify(execFile);

/**
 * Renders a motion graphic through the real render worker, transparent and opaque, then lays the
 * transparent clip over a red timeline and checks the frames: the red shows through where the
 * graphic draws nothing, the graphic shows where it draws, two renders give the same pixels, and
 * code with a forbidden import does not build. Needs ffmpeg and Chrome. Set
 * REMOTION_BROWSER_EXECUTABLE to a Chrome or headless-shell binary if Remotion can't find one.
 */
const WIDTH = 640;
const HEIGHT = 360;
const GREEN = '#00ff00';

const worker = path.resolve(__dirname, '../../../render-worker/dist/cli.js');
const browser = process.env.REMOTION_BROWSER_EXECUTABLE
  ? [process.env.REMOTION_BROWSER_EXECUTABLE]
  : [];

const source = (
  background: MotionSource['background'],
  code = SAMPLE_MOTION_CODE,
): MotionSource => ({
  version: 1,
  code,
  width: WIDTH,
  height: HEIGHT,
  fps: 30,
  durationSec: 2,
  background,
  props: { title: 'Accept', values: [2, 4, 3], color: GREEN },
});

async function renderMotion(dir: string, name: string, motion: MotionSource): Promise<string> {
  const sourcePath = path.join(dir, `${name}.json`);
  await writeFile(sourcePath, JSON.stringify(motion));
  const output = path.join(dir, name);
  await exec(process.execPath, [worker, 'motion', sourcePath, output, ...browser], {
    timeout: 600_000,
  });
  return output;
}

/** One frame as raw pixels; `rgba` decodes a VP9 clip with its alpha channel. */
async function frame(video: string, sec: number, format: 'rgb24' | 'rgba'): Promise<Buffer> {
  const decoder = format === 'rgba' ? ['-c:v', 'libvpx-vp9'] : [];
  const { stdout } = await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      ...decoder,
      '-ss',
      String(sec),
      '-i',
      video,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      format,
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

async function probe(
  video: string,
): Promise<{ codec: string; width: number; height: number; duration: number; alpha: boolean }> {
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    video,
  ]);
  const data = JSON.parse(stdout) as {
    streams: Array<{
      codec_type: string;
      codec_name: string;
      width: number;
      height: number;
      tags?: Record<string, string>;
    }>;
    format: { duration: string };
  };
  const stream = data.streams.find((s) => s.codec_type === 'video')!;
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    duration: Number(data.format.duration),
    alpha: stream.tags?.alpha_mode === '1' || stream.tags?.ALPHA_MODE === '1',
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`motion render acceptance: ${message}`);
}

const isGreen = (r: number, g: number, b: number) => g > 200 && r < 80 && b < 80;
const isRed = (r: number, g: number, b: number) => r > 200 && g < 60 && b < 60;

async function main() {
  assert(checkMotionCode(SAMPLE_MOTION_CODE).length === 0, 'the sample graphic breaks the rules');
  const dir = await mkdtemp(path.join(tmpdir(), 'reelcraft-motion-'));

  // Transparent: VP9 WebM with alpha, drawing nothing in the corners.
  const clip = await renderMotion(dir, 'motion.webm', source('transparent'));
  const info = await probe(clip);
  assert(
    info.codec === 'vp9' && info.alpha,
    `transparent clip is ${info.codec}, alpha ${info.alpha}`,
  );
  assert(info.width === WIDTH && info.height === HEIGHT, 'transparent clip has the wrong size');
  assert(Math.abs(info.duration - 2) < 0.1, `transparent clip lasts ${info.duration}s`);
  const rgba = await frame(clip, 1, 'rgba');
  assert(rgba[3] === 0, `the corner is not see-through (alpha ${rgba[3]})`);
  let opaqueGreen = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! > 200 && isGreen(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)) opaqueGreen += 1;
  }
  assert(opaqueGreen > 1000, `the graphic draws too little (${opaqueGreen} green pixels)`);

  // Determinism: the same source renders the same pixels.
  const again = await renderMotion(dir, 'again.webm', source('transparent'));
  const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  assert(hash(await frame(again, 1, 'rgba')) === hash(rgba), 'two renders differ');

  // Opaque: an ordinary MP4.
  const opaque = await probe(await renderMotion(dir, 'motion.mp4', source('opaque')));
  assert(opaque.codec === 'h264' && !opaque.alpha, `opaque clip is ${opaque.codec}`);

  // Over a red timeline: red where the graphic draws nothing, green where it draws.
  await copyFile(clip, path.join(dir, 'resource-0.webm'));
  await writeFile(
    path.join(dir, 'timeline.json'),
    JSON.stringify({
      version: 1,
      canvas: { width: WIDTH, height: HEIGHT, fps: 30, background: '#ff0000' },
      tracks: [
        {
          id: 'v',
          type: 'video',
          items: [{ id: 'm', type: 'media', handle: 'clip', startSec: 0, durationSec: 2 }],
        },
      ],
    }),
  );
  await writeFile(
    path.join(dir, 'resources.json'),
    JSON.stringify({
      media: { clip: { src: 'resource-0.webm', kind: 'media.video' } },
      timing: {},
    }),
  );
  const composed = path.join(dir, 'composed.mp4');
  await exec(
    process.execPath,
    [
      worker,
      path.join(dir, 'timeline.json'),
      path.join(dir, 'resources.json'),
      'draft',
      composed,
      ...browser,
    ],
    { timeout: 600_000 },
  );
  const rgb = await frame(composed, 1, 'rgb24');
  assert(
    isRed(rgb[0]!, rgb[1]!, rgb[2]!),
    `the corner of the composed video is not red: ${rgb.subarray(0, 3).join(',')}`,
  );
  let green = 0;
  for (let i = 0; i < rgb.length; i += 3)
    if (isGreen(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)) green += 1;
  assert(green > 1000, `the graphic does not show over the red (${green} green pixels)`);

  // A forbidden import does not build, even if it got past the check.
  const blocked = await renderMotion(
    dir,
    'blocked.webm',
    source(
      'transparent',
      "import fs from 'node:fs';\nexport default () => <div>{String(fs)}</div>;",
    ),
  ).then(
    () => false,
    (error: { stderr?: string }) => /not allowed/.test(error.stderr ?? ''),
  );
  assert(blocked, 'a forbidden import was bundled');

  console.log(`motion render acceptance passed (${dir})`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
