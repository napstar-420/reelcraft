import { describe, expect, it } from 'vitest';
import type { Probe, StageDef } from '@reelcraft/shared';
import { audioPolicyViolation } from './audio-policy';

const probe = (audio: boolean): Probe => ({
  container: 'mp4',
  durationSec: 1,
  streams: [
    { type: 'video', codec: 'h264' },
    ...(audio ? [{ type: 'audio' as const, codec: 'aac' }] : []),
  ],
});
const stage = (capability: string, audio?: 'required' | 'optional' | 'forbidden') =>
  ({
    capability,
    output: { kind: 'media.video', ...(audio && { constraints: { audio } }) },
  }) as StageDef;

describe('audioPolicyViolation', () => {
  it('requires sound from a video by default, but not from a render', () => {
    expect(audioPolicyViolation(stage('video.generate'), probe(false))).toContain('absent');
    expect(audioPolicyViolation(stage('video.generate'), probe(true))).toBeUndefined();
    expect(audioPolicyViolation(stage('motion.render'), probe(false))).toBeUndefined();
  });
  it('honours an explicit policy and ignores other outputs', () => {
    expect(audioPolicyViolation(stage('video.generate', 'forbidden'), probe(true))).toContain(
      'present',
    );
    expect(audioPolicyViolation(stage('video.generate', 'optional'), probe(false))).toBeUndefined();
    expect(
      audioPolicyViolation(
        { capability: 'x', output: { kind: 'media.image' } } as StageDef,
        probe(false),
      ),
    ).toBeUndefined();
  });
});
