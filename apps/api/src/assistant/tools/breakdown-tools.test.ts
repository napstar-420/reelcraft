import { describe, expect, it, vi } from 'vitest';
import { VideoBreakdown } from '@reelcraft/shared';
import { aspectOf } from './breakdown-tools';
import { runTool } from './registry';
import { newTurnContext, type ToolDeps } from './types';

const video = {
  blobId: 'b-vid',
  objectKey: 'k',
  mime: 'video/mp4',
  kind: 'video',
  name: 'ref.mp4',
  probe: {
    container: 'mp4',
    durationSec: 10,
    streams: [{ type: 'video', codec: 'h264', width: 1080, height: 1920 }],
  },
};

function deps(over: Partial<Record<keyof ToolDeps, unknown>> = {}): ToolDeps {
  return {
    attachments: {
      file: vi.fn(async (id: string) => {
        if (id === 'att-vid') return video;
        if (id === 'att-vid2') return { ...video, blobId: 'b-vid2', name: 'run.mp4' };
        throw new Error('missing');
      }),
    },
    review: {
      transcriber: vi.fn(async () => ({ available: true, by: 'voicestudio', paid: false })),
      analyze: vi.fn(async () => ({
        durationSec: 10,
        width: 1080,
        height: 1920,
        fps: 30,
        hasAudio: true,
        shots: [
          { index: 0, startSec: 0, endSec: 4, keyframeSec: 2, words: 'did you know' },
          { index: 1, startSec: 4, endSec: 10, keyframeSec: 7, words: 'space is big' },
        ],
        sheets: [{ mime: 'image/jpeg', base64: 'SHEET', shots: [0, 1], columns: 2 }],
        loudnessPerSecond: [-20, -21, -22, -20, -19, -20, -21, -22, -20, -30],
        transcript: {
          by: 'voicestudio',
          costUsd: 0,
          text: 'did you know space is big',
          lines: [],
          wordsPerMinute: 150,
        },
        soundBetweenWords: { seconds: 2, of: 3, likelyMusic: true },
      })),
      facts: vi.fn(async (blobId: string) => ({
        durationSec: blobId === 'b-vid' ? 10 : 12,
        width: 1080,
        height: 1920,
        fps: 30,
        hasAudio: true,
        shots: blobId === 'b-vid' ? 2 : 3,
        averageShotSec: blobId === 'b-vid' ? 5 : 4,
        loudnessLufs: -20,
      })),
      contactSheet: vi.fn(async (_b: string, o: { at?: number[] }) => ({
        mime: 'image/jpeg' as const,
        base64: 'CS',
        times: o.at ?? [],
        columns: 3,
        durationSec: 10,
      })),
    },
    ...over,
  } as unknown as ToolDeps;
}

describe('analyze_video', () => {
  it('returns the format, shots with words, transcript, music guess and keyframe sheets', async () => {
    const c = newTurnContext();
    const out = await runTool('analyze_video', { source: { attachmentId: 'att-vid' } }, c, deps());
    expect(out).toMatchObject({
      ok: true,
      result: {
        format: { durationSec: 10, aspectRatio: '9:16', fps: 30 },
        pacing: { shots: 2, averageShotSec: 5 },
        shots: [{ index: 0, words: 'did you know' }, { index: 1 }],
        transcript: { wordsPerMinute: 150 },
        soundBetweenWords: { likelyMusic: true },
        sheets: [{ position: 1, shots: [0, 1] }],
      },
      images: [{ base64: 'SHEET' }],
    });
    expect(c.imagesShown).toBe(1);
  });

  it('asks before paying for Deepgram in Manual, and skips the words in Plan', async () => {
    const paid = deps();
    (paid.review.transcriber as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: true,
      by: 'deepgram',
      paid: true,
    });
    const asked: string[] = [];
    await runTool(
      'analyze_video',
      { source: { attachmentId: 'att-vid' } },
      newTurnContext({
        mode: 'manual',
        confirm: async (r) => (asked.push(r.title), { answer: 'yes' }),
      }),
      paid,
    );
    expect(asked[0]).toContain('with Deepgram');
    expect(paid.review.analyze).toHaveBeenCalledWith('b-vid', 'deepgram');
    const plan = await runTool(
      'analyze_video',
      { source: { attachmentId: 'att-vid' } },
      newTurnContext({ mode: 'plan' }),
      paid,
    );
    expect(plan).toMatchObject({
      ok: true,
      result: { transcriptNote: expect.stringContaining('Plan mode') },
    });
    expect(paid.review.analyze).toHaveBeenLastCalledWith('b-vid', null);
  });
});

const breakdown = {
  title: 'Space facts',
  summary: 'Two shots.',
  format: { aspectRatio: '9:16', durationSec: 10 },
  shots: [
    { index: 0, startSec: 0, endSec: 4, visual: 'Earth', make: 'generate_image' },
    { index: 1, startSec: 4, endSec: 10, visual: 'Title', make: 'text_only' },
  ],
  narration: { present: true },
  captions: { present: false },
  music: { present: true },
  pacing: { shots: 2, averageShotSec: 5 },
};

describe('save_breakdown', () => {
  it('saves a breakdown card with the video to play', async () => {
    const out = await runTool(
      'save_breakdown',
      { source: { attachmentId: 'att-vid' }, breakdown },
      newTurnContext({ mode: 'plan' }),
      deps(),
    );
    expect(out).toMatchObject({
      ok: true,
      item: {
        type: 'breakdown',
        payload: {
          source: {
            blobId: 'b-vid',
            attachmentId: 'att-vid',
            label: 'the attached file "ref.mp4"',
          },
          breakdown: { title: 'Space facts', sections: [], soundEffects: [] },
        },
      },
    });
  });

  it('refuses shots out of order, overlapping or past the end', () => {
    const bad = VideoBreakdown.safeParse({
      ...breakdown,
      shots: [
        { index: 0, startSec: 0, endSec: 6, visual: 'a', make: 'other' },
        { index: 1, startSec: 4, endSec: 3, visual: 'b', make: 'other' },
        { index: 2, startSec: 5, endSec: 30, visual: 'c', make: 'other' },
      ],
    });
    expect(bad.success).toBe(false);
    const messages = bad.error!.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'A shot must end after it starts.',
        'Shots must be in order and not overlap.',
        'A shot ends after the video (10s).',
      ]),
    );
  });
});

describe('compare_media', () => {
  it('compares two videos with frames at the same relative moments', async () => {
    const d = deps();
    const c = newTurnContext();
    const out = await runTool(
      'compare_media',
      { a: { attachmentId: 'att-vid' }, b: { attachmentId: 'att-vid2' }, frames: 2 },
      c,
      d,
    );
    expect(out).toMatchObject({
      ok: true,
      result: {
        a: { durationSec: 10, shots: 2, aspectRatio: '9:16' },
        b: { durationSec: 12, shots: 3, averageShotSec: 4 },
      },
      images: [{ base64: 'CS' }, { base64: 'CS' }],
    });
    expect(d.review.contactSheet).toHaveBeenCalledWith('b-vid', { at: [2.5, 7.5] });
    expect(d.review.contactSheet).toHaveBeenCalledWith('b-vid2', { at: [3, 9] });
    expect(c.imagesShown).toBe(2);
  });

  it('names common aspect ratios', () => {
    expect(aspectOf(1080, 1920)).toBe('9:16');
    expect(aspectOf(1920, 1080)).toBe('16:9');
    expect(aspectOf(1080, 1350)).toBe('4:5');
    expect(aspectOf(1000, 1000)).toBe('1:1');
    expect(aspectOf(1000, 700)).toBe('1000:700');
    expect(aspectOf(null, 10)).toBeNull();
  });
});
