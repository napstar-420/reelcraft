import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Cuts a test picture out of its plain background with the real render worker and checks the
 * pixels: the background is see-through, the subject is solid, and a patch of the background's
 * colour inside the subject stays. A picture with no plain background is refused. Needs ffmpeg.
 */
const worker = path.resolve(__dirname, '../../../render-worker/dist/cli.js');
const WIDTH = 200;
const HEIGHT = 150;

async function rgba(file: string): Promise<Buffer> {
  const { stdout } = await exec(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`cutout acceptance: ${message}`);
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'reelcraft-cutout-'));
  // A white card outlined in black on green, with a green patch inside it; saved as a JPEG, so the
  // background is only nearly one colour, as a generated picture's is.
  const input = path.join(dir, 'picture.jpg');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x30a050:s=${WIDTH}x${HEIGHT},` +
      'drawbox=x=50:y=30:w=100:h=90:color=black:t=fill,' +
      'drawbox=x=55:y=35:w=90:h=80:color=white:t=fill,' +
      'drawbox=x=90:y=65:w=20:h=20:color=0x30a050:t=fill',
    '-frames:v',
    '1',
    '-q:v',
    '4',
    input,
  ]);
  const output = path.join(dir, 'cutout.png');
  await exec(process.execPath, [worker, 'cutout', input, output]);
  const { stdout: format } = await exec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=pix_fmt',
    '-of',
    'csv=p=0',
    output,
  ]);
  assert(format.trim() === 'rgba', `the cut-out has no alpha channel (${format.trim()})`);
  const pixels = await rgba(output);
  const alpha = (x: number, y: number) => pixels[(y * WIDTH + x) * 4 + 3]!;
  assert(alpha(2, 2) === 0, `the corner is not see-through (${alpha(2, 2)})`);
  assert(
    alpha(25, 75) === 0,
    `the background beside the card is not see-through (${alpha(25, 75)})`,
  );
  assert(alpha(60, 40) === 255, `the card is not solid (${alpha(60, 40)})`);
  assert(alpha(100, 75) === 255, `the green inside the card was removed (${alpha(100, 75)})`);

  // A picture with no plain background (coloured noise) is refused.
  const busy = path.join(dir, 'busy.png');
  await exec('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    "nullsrc=s=200x150,format=rgb24,geq=r='random(1)*255':g='random(2)*255':b='random(3)*255'",
    '-frames:v',
    '1',
    busy,
  ]);
  const refused = await exec(process.execPath, [
    worker,
    'cutout',
    busy,
    path.join(dir, 'busy-out.png'),
  ]).then(
    () => false,
    (error: { stderr?: string }) => /no plain background/.test(error.stderr ?? ''),
  );
  assert(refused, 'a picture with no plain background was cut out');

  console.log(`cutout acceptance passed (${dir})`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
