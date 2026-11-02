import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_LIMITS,
  attachmentKind,
  attachmentMime,
  attachmentProblem,
  describeAttachment,
  extOf,
  mediaFacts,
} from './attachment.logic';

describe('attachment rules', () => {
  it('tells pictures, videos, sounds and other files apart', () => {
    expect(attachmentKind('image/png', 'png')).toBe('image');
    expect(attachmentKind('image/svg+xml', 'svg')).toBe('file');
    expect(attachmentKind('video/quicktime', 'mov')).toBe('video');
    expect(attachmentKind('audio/mpeg', 'mp3')).toBe('audio');
    expect(attachmentKind('application/octet-stream', 'mp4')).toBe('video');
    expect(attachmentKind('application/pdf', 'pdf')).toBe('file');
  });

  it('fills in a mime the browser did not send', () => {
    expect(attachmentMime('', 'jpg')).toBe('image/jpeg');
    expect(attachmentMime('application/octet-stream', 'mov')).toBe('video/quicktime');
    expect(attachmentMime('application/octet-stream', 'mp3')).toBe('audio/mpeg');
    expect(attachmentMime('image/webp', 'webp')).toBe('image/webp');
    expect(attachmentMime('', 'pdf')).toBe('application/octet-stream');
    expect(extOf('local/assistant/attachments/01ABC.MP4')).toBe('mp4');
  });

  it('reads size and length from the probe', () => {
    const probe = {
      container: 'mov',
      durationSec: 12.3456,
      streams: [{ type: 'video' as const, codec: 'h264', width: 1080, height: 1920 }],
    };
    expect(mediaFacts(probe, 'video')).toEqual({ width: 1080, height: 1920, durationSec: 12.35 });
    expect(mediaFacts(probe, 'image')).toEqual({ width: 1080, height: 1920, durationSec: null });
    expect(mediaFacts(null, 'file')).toEqual({ width: null, height: null, durationSec: null });
  });

  it('refuses files too big, empty, unreadable or too long', () => {
    const ok = { kind: 'video' as const, bytes: 1000, durationSec: 30, probed: true };
    expect(attachmentProblem(ok)).toBeNull();
    expect(attachmentProblem({ ...ok, bytes: ATTACHMENT_LIMITS.video + 1 })).toMatch(/most a chat/);
    expect(attachmentProblem({ ...ok, bytes: 0 })).toMatch(/empty/);
    expect(attachmentProblem({ ...ok, probed: false })).toMatch(/couldn't be read/);
    expect(attachmentProblem({ ...ok, durationSec: 20 * 60 })).toMatch(/Trim it/);
    expect(
      attachmentProblem({ kind: 'file', bytes: 10, durationSec: null, probed: false }),
    ).toBeNull();
  });

  it('describes a file for the model with its id', () => {
    expect(
      describeAttachment({
        id: 'att1',
        name: 'ref.mp4',
        kind: 'video',
        mime: 'video/mp4',
        width: 1080,
        height: 1920,
        durationSec: 31.5,
        sourceUrl: null,
      }),
    ).toBe('- attachmentId att1: "ref.mp4" (video, video/mp4, 1080x1920, 31.5s)');
  });
});
