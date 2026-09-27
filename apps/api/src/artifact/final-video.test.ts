import { describe, expect, it } from 'vitest';
import { pickFinalVideo } from './final-video';
import { posterSeekSec } from './derived-frame.service';

describe('pickFinalVideo', () => {
  it('returns the last passed video-producing stage in graph order', () => {
    const artifactsById = new Map([
      ['art-script', { id: 'art-script', kind: 'text', blobId: null, probe: null }],
      ['art-video', { id: 'art-video', kind: 'media.video', blobId: 'blob-1', probe: null }],
    ]);
    const result = pickFinalVideo(
      ['script', 'assemble'],
      [
        { stageKey: 'script', state: 'passed', outputArtifactId: 'art-script' },
        { stageKey: 'assemble', state: 'passed', outputArtifactId: 'art-video' },
      ],
      artifactsById,
    );
    expect(result).toEqual({
      artifactId: 'art-video',
      blobId: 'blob-1',
      probe: null,
      posterBlobId: null,
    });
  });

  it('skips a video stage that is not the last one in graph order', () => {
    const artifactsById = new Map([
      ['art-v1', { id: 'art-v1', kind: 'media.video', blobId: 'blob-1', probe: null }],
      ['art-notes', { id: 'art-notes', kind: 'text', blobId: null, probe: null }],
    ]);
    const result = pickFinalVideo(
      ['assemble', 'notes'],
      [
        { stageKey: 'assemble', state: 'passed', outputArtifactId: 'art-v1' },
        { stageKey: 'notes', state: 'passed', outputArtifactId: 'art-notes' },
      ],
      artifactsById,
    );
    expect(result?.artifactId).toBe('art-v1');
  });

  it('skips a stage that has not passed', () => {
    const artifactsById = new Map([
      ['art-video', { id: 'art-video', kind: 'media.video', blobId: 'blob-1', probe: null }],
    ]);
    const result = pickFinalVideo(
      ['assemble'],
      [{ stageKey: 'assemble', state: 'failed', outputArtifactId: 'art-video' }],
      artifactsById,
    );
    expect(result).toBeNull();
  });

  it('returns null when no stage produced a video', () => {
    const artifactsById = new Map([
      ['art-script', { id: 'art-script', kind: 'text', blobId: null, probe: null }],
    ]);
    const result = pickFinalVideo(
      ['script'],
      [{ stageKey: 'script', state: 'passed', outputArtifactId: 'art-script' }],
      artifactsById,
    );
    expect(result).toBeNull();
  });

  it("reads posterBlobId from the artifact's derived column when present", () => {
    const artifactsById = new Map([
      [
        'art-video',
        {
          id: 'art-video',
          kind: 'media.video',
          blobId: 'blob-1',
          probe: null,
          derived: { poster: 'blob-poster' },
        },
      ],
    ]);
    const result = pickFinalVideo(
      ['assemble'],
      [{ stageKey: 'assemble', state: 'passed', outputArtifactId: 'art-video' }],
      artifactsById,
    );
    expect(result?.posterBlobId).toBe('blob-poster');
  });

  it('returns null for an empty graph or no executions', () => {
    expect(pickFinalVideo([], [], new Map())).toBeNull();
    expect(pickFinalVideo(['assemble'], [], new Map())).toBeNull();
  });
});

describe('posterSeekSec', () => {
  it('seeks a third into the clip', () => {
    expect(posterSeekSec(30)).toBe(10);
  });

  it('returns 0 for an undefined, zero, or negative duration', () => {
    expect(posterSeekSec(undefined)).toBe(0);
    expect(posterSeekSec(0)).toBe(0);
    expect(posterSeekSec(-5)).toBe(0);
  });

  it('never exceeds (duration - 0.1) for a very short clip', () => {
    const seek = posterSeekSec(0.2);
    expect(seek).toBeCloseTo(0.2 / 3, 5);
    expect(seek).toBeLessThanOrEqual(0.1);
  });

  it('never goes negative for a sub-0.1s clip', () => {
    expect(posterSeekSec(0.05)).toBe(0);
  });

  it('uses the (duration - 0.1) clamp when it is smaller than a third', () => {
    // d/3 = 0.04, d - 0.1 = 0.02 — the clamp wins here.
    expect(posterSeekSec(0.12)).toBeCloseTo(0.02, 5);
  });
});
