import { describe, expect, it } from 'vitest';
import { buildQcEnvelope, type QcEnvelopeSource } from './qc-envelope';

/**
 * §10.2 — the exclusion list this module's doc comment names (rendered
 * prompt, model identity, cost, attempt number, prior verdicts, this
 * attempt's own check results, row ids, `qc.threshold`) is enforced at the
 * TYPE level: `QcEnvelopeSource` has no field for any of them, so a caller
 * physically cannot pass `result.rawResponse` or `effective.model` through
 * `buildQcEnvelope` by accident — there's no parameter to put it in. What
 * IS worth testing here is that `buildQcEnvelope` itself doesn't leak via
 * its own construction: conditional fields are truly absent (not
 * present-with-`undefined`) when omitted, and it defensively copies rather
 * than aliasing the caller's mutable objects.
 */
describe('buildQcEnvelope', () => {
  const baseSource: QcEnvelopeSource = {
    criteria: 'Is this a good hook?',
    artifactKind: 'text',
    artifactData: 'SENTINEL_ARTIFACT_DATA',
    includeInputs: false,
  };

  it('includes only criteria + artifact when nothing else is provided', () => {
    const envelope = buildQcEnvelope(baseSource);
    expect(envelope).toEqual({
      criteria: 'Is this a good hook?',
      artifact: { kind: 'text', data: 'SENTINEL_ARTIFACT_DATA' },
    });
    expect(Object.keys(envelope)).toEqual(['criteria', 'artifact']);
  });

  it('omits dimensions/inputs/transcript/probe entirely rather than present-with-undefined', () => {
    const envelope = buildQcEnvelope(baseSource);
    expect('dimensions' in envelope).toBe(false);
    expect('inputs' in envelope).toBe(false);
    expect('transcript' in envelope).toBe(false);
    expect('probe' in envelope.artifact).toBe(false);
    expect(JSON.stringify(envelope)).not.toContain('undefined');
  });

  it('includes inputs iff includeInputs is true, even when slots/context are provided', () => {
    const withoutFlag = buildQcEnvelope({
      ...baseSource,
      includeInputs: false,
      slots: { topic: 'SENTINEL_SLOT' },
      context: { outline: 'SENTINEL_CONTEXT' },
    });
    expect('inputs' in withoutFlag).toBe(false);

    const withFlag = buildQcEnvelope({
      ...baseSource,
      includeInputs: true,
      slots: { topic: 'SENTINEL_SLOT' },
      context: { outline: 'SENTINEL_CONTEXT' },
    });
    expect(withFlag.inputs).toEqual({
      slots: { topic: 'SENTINEL_SLOT' },
      context: { outline: 'SENTINEL_CONTEXT' },
    });
  });

  it('includeInputs with no slots/context yields empty objects, not undefined/missing', () => {
    const envelope = buildQcEnvelope({ ...baseSource, includeInputs: true });
    expect(envelope.inputs).toEqual({ slots: {}, context: {} });
  });

  it('includes dimensions/probe/transcript only when explicitly provided, copied field-by-field', () => {
    const envelope = buildQcEnvelope({
      ...baseSource,
      dimensions: [{ key: 'hook', description: 'Is it engaging?', weight: 0.6 }],
      artifactProbe: { durationSec: 5 },
      transcript: 'SENTINEL_TRANSCRIPT',
    });
    expect(envelope.dimensions).toEqual([
      { key: 'hook', description: 'Is it engaging?', weight: 0.6 },
    ]);
    expect(envelope.artifact.probe).toEqual({ durationSec: 5 });
    expect(envelope.transcript).toBe('SENTINEL_TRANSCRIPT');
  });

  it('includes media only when provided, copied field-by-field', () => {
    const withoutMedia = buildQcEnvelope(baseSource);
    expect('media' in withoutMedia).toBe(false);

    const withMedia = buildQcEnvelope({
      ...baseSource,
      media: { sourceKey: 'SENTINEL_SOURCE_KEY', mime: 'image/png' },
    });
    expect(withMedia.media).toEqual({ sourceKey: 'SENTINEL_SOURCE_KEY', mime: 'image/png' });
  });

  it("defensively copies slots/context rather than aliasing the caller's objects", () => {
    const slots = { topic: 'original' };
    const envelope = buildQcEnvelope({ ...baseSource, includeInputs: true, slots });
    slots.topic = 'mutated-after-the-fact';
    expect(envelope.inputs?.slots.topic).toBe('original');
  });

  it('includes the clips of a video list, copied field by field', () => {
    const clips = [{ sourceKey: 'k/1.mp4', mime: 'video/mp4', index: 1, label: 'Scene 1' }];
    const envelope = buildQcEnvelope({ ...baseSource, clips });
    expect(envelope.clips).toEqual(clips);
    expect(envelope.clips![0]).not.toBe(clips[0]);
    expect('clips' in buildQcEnvelope(baseSource)).toBe(false);
  });

  it('includes the images of an image list, copied field by field', () => {
    const images = [{ sourceKey: 'k/1.png', mime: 'image/png', index: 0, label: 'Image 1' }];
    const envelope = buildQcEnvelope({ ...baseSource, images });
    expect(envelope.images).toEqual(images);
    expect(envelope.images![0]).not.toBe(images[0]);
    expect('images' in buildQcEnvelope(baseSource)).toBe(false);
    expect('clips' in envelope).toBe(false);
  });
});
