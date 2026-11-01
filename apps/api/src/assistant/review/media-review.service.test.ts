import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MediaReviewService } from './media-review.service';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('MediaReviewService (real ffmpeg)', () => {
  let dir: string;
  let video: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'review-test-'));
    video = join(dir, 'clip.mp4');
    // 4 s of test pattern with a tone for 2 s, then silence
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=10:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-filter_complex',
      '[1:a]apad=whole_dur=4[a]',
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      video,
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function service(transcribeBuffer = vi.fn()) {
    const row = {
      id: 'b1',
      objectKey: 'k',
      mime: 'video/mp4',
      bytes: statSync(video).size,
      deletedAt: null,
    };
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    };
    const storage = { getStream: async () => createReadStream(video) };
    const audio = { transcriber: vi.fn(), transcribeBuffer };
    return new MediaReviewService(db as never, storage as never, audio as never);
  }

  it('makes one contact sheet of frames spread over the video, or at chosen times', async () => {
    const sheet = await service().contactSheet('b1', { count: 4 });
    expect(sheet).toMatchObject({ mime: 'image/jpeg', columns: 2, times: [0.8, 1.6, 2.4, 3.2] });
    expect(sheet!.durationSec).toBeCloseTo(4, 0);
    expect(Buffer.from(sheet!.base64, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const at = await service().contactSheet('b1', { at: [3, 1, 99] });
    expect(at!.times).toEqual([1, 3, 3.95]);
  });

  it("listens to a video's soundtrack: transcript lines, loudness and the silence at the end", async () => {
    const transcribe = vi.fn(async () => ({
      transcript: 'beep',
      durationSec: 4,
      words: [{ text: 'beep', startSec: 0.1, endSec: 1.9 }],
      costUsd: 0,
      by: 'voicestudio' as const,
    }));
    const heard = await service(transcribe).listen('b1', 'voicestudio');
    expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'audio/mp4', 'voicestudio');
    expect(heard).toMatchObject({ by: 'voicestudio', lines: [{ atSec: 0.1, text: 'beep' }] });
    expect(heard!.stats.maxVolumeDb).not.toBeNull();
    expect(heard!.stats.silences.at(-1)!.startSec).toBeGreaterThan(1.5);
  });
});
