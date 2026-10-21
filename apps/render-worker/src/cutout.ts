/**
 * Cuts a picture out of a plain background: reads it with ffmpeg, removes the background
 * (`cutout-pixels.ts`) and writes a PNG with an alpha channel.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { cutOut } from '@reelcraft/shared';

const exec = promisify(execFile);

export interface CutoutJob {
  input: string;
  output: string;
  tolerance: number;
  feather: number;
}

/** A picture with too little or too much background to cut out is refused, with this message. */
export const NO_PLAIN_BACKGROUND =
  'the picture has no plain background to cut out: ask for one subject on a single flat colour';

async function size(input: string): Promise<{ width: number; height: number }> {
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0:s=x',
    input,
  ]);
  const [width, height] = stdout.trim().split('x').map(Number);
  if (!width || !height) throw new Error(`can't read the picture's size: ${stdout.trim()}`);
  return { width, height };
}

/** Writes raw RGBA pixels as a PNG through ffmpeg's stdin. */
function writePng(output: string, rgba: Uint8Array, width: number, height: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${width}x${height}`,
      '-i',
      '-',
      '-frames:v',
      '1',
      output,
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg could not write the PNG: ${stderr}`)),
    );
    ffmpeg.stdin.end(Buffer.from(rgba));
  });
}

/** Runs the job; returns the share of the picture that was removed. */
export async function cutoutPicture(job: CutoutJob): Promise<number> {
  const { width, height } = await size(job.input);
  const { stdout } = await exec(
    'ffmpeg',
    ['-v', 'error', '-i', job.input, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { encoding: 'buffer', maxBuffer: width * height * 4 + 1024 * 1024 },
  );
  if (stdout.length < width * height * 4) throw new Error("can't read the picture's pixels");
  const result = cutOut(new Uint8Array(stdout.subarray(0, width * height * 4)), width, height, {
    tolerance: job.tolerance,
    feather: job.feather,
  });
  if (result.removed < 0.02 || result.removed > 0.98) throw new Error(NO_PLAIN_BACKGROUND);
  await writePng(job.output, result.rgba, width, height);
  return result.removed;
}
