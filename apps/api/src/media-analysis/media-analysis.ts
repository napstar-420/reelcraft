import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseEbur128,
  parseSceneScores,
  perSecond,
  shotsFrom,
  type Shot,
} from './media-analysis.logic';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 5 * 60_000;

/** Where a video's shots change. Frames are scaled down first, so a long video stays fast. */
export async function detectShots(
  file: string,
  durationSec: number,
): Promise<{ shots: Shot[]; threshold: number }> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-an',
      '-sn',
      '-vf',
      "scale=160:-2,select='gte(scene,0)',metadata=print:file=-",
      '-f',
      'null',
      '-',
    ],
    { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  return shotsFrom(parseSceneScores(stdout), durationSec);
}

/** Loudness each second (LUFS), from the soundtrack. Empty when the file has no sound. */
export async function loudnessCurve(file: string, durationSec: number): Promise<number[]> {
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-i',
        file,
        '-vn',
        '-af',
        'ebur128=peak=none',
        '-f',
        'null',
        '-',
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
    );
    const points = parseEbur128(stderr);
    return points.length ? perSecond(points, durationSec) : [];
  } catch {
    return [];
  }
}
