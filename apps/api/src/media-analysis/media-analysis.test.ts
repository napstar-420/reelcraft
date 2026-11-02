import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectShots, loudnessCurve } from './media-analysis';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('media analysis on a real file (ffmpeg)', () => {
  let dir: string;
  let video: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'media-analysis-'));
    video = join(dir, 'cuts.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x90:d=1.5',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x90:d=2',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=160x90:d=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4.5',
      '-filter_complex',
      '[0][1][2]concat=n=3:v=1:a=0[v]',
      '-map',
      '[v]',
      '-map',
      '3:a',
      '-pix_fmt',
      'yuv420p',
      '-shortest',
      video,
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the two cuts and the sound', async () => {
    const { shots } = await detectShots(video, 4.5);
    expect(shots).toHaveLength(3);
    expect(shots[1]!.startSec).toBeCloseTo(1.5, 0);
    expect(shots[2]!.startSec).toBeCloseTo(3.5, 0);
    const curve = await loudnessCurve(video, 4.5);
    expect(curve.length).toBe(5);
    expect(curve[2]).toBeGreaterThan(-40);
  });
});
