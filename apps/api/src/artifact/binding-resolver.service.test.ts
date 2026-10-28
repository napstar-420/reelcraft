import { describe, expect, it } from 'vitest';
import type { Ref } from '@reelcraft/shared';
import { BindingResolverService, type BindingScope } from './binding-resolver.service';
import { TimelineHandleService } from './timeline-handle.service';

/** `{from:'input'}` always does an artifact lookup first (to check whether
 * the input was a media upload) before falling back to `ctx.inputs`, so
 * even a plain-text/missing input needs a `db.select()` chain that resolves
 * to no rows. Mirrors `stage-runner.service.test.ts`'s `Object.create`
 * pattern for a dependency-light unit under test. */
function service(): BindingResolverService {
  const emptySelect = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  };
  return Object.assign(Object.create(BindingResolverService.prototype) as object, {
    db: emptySelect,
    logger: { warn: () => undefined, debug: () => undefined },
  }) as unknown as BindingResolverService;
}

const baseCtx: BindingScope = { runId: 'run-1', inputs: {} };

describe('BindingResolverService — {from: "coalesce"}', () => {
  it('resolves to the first branch whose value is not undefined', async () => {
    const ref: Ref = {
      from: 'coalesce',
      refs: [
        { from: 'input', inputKey: 'missing' },
        { from: 'const', value: 'fallback' },
      ],
    };
    const result = await service().resolve(ref, baseCtx);
    expect(result.value).toBe('fallback');
  });

  it('prefers an earlier branch over a later one when both resolve', async () => {
    const ref: Ref = {
      from: 'coalesce',
      refs: [
        { from: 'const', value: 'first' },
        { from: 'const', value: 'second' },
      ],
    };
    const result = await service().resolve(ref, baseCtx);
    expect(result.value).toBe('first');
  });

  it('resolves to undefined when every branch is undefined', async () => {
    const ref: Ref = {
      from: 'coalesce',
      refs: [
        { from: 'input', inputKey: 'missing-a' },
        { from: 'input', inputKey: 'missing-b' },
      ],
    };
    const result = await service().resolve(ref, baseCtx);
    expect(result.value).toBeUndefined();
    expect(result.provenance).toEqual({ ref });
  });

  it("reports the winning branch's own provenance, not the coalesce wrapper", async () => {
    const winner: Ref = { from: 'const', value: 'chosen' };
    const ref: Ref = {
      from: 'coalesce',
      refs: [{ from: 'input', inputKey: 'missing' }, winner],
    };
    const result = await service().resolve(ref, baseCtx);
    expect(result.provenance).toEqual({ ref: winner });
  });

  it('resolves the same way inside resolveRefEnvelopes (check refs)', async () => {
    const ref: Ref = {
      from: 'coalesce',
      refs: [
        { from: 'input', inputKey: 'missing' },
        { from: 'const', value: 42 },
      ],
    };
    const { refs } = await service().resolveRefEnvelopes({ x: ref }, baseCtx);
    expect(refs.x).toEqual({ kind: 'literal', data: 42 });
  });
});

describe('BindingResolverService — media manifests carry blobId', () => {
  /** Each `select()` resolves to the next queued result, whether the query
   * ends at `.limit()` or `.where()`. */
  function serviceWith(...results: unknown[][]): BindingResolverService {
    const queue = [...results];
    const next = () => Promise.resolve(queue.shift() ?? []);
    const query: object = {
      limit: next,
      orderBy: () => query,
      then: (resolve: (rows: unknown[]) => unknown) => next().then(resolve),
    };
    const select = () => ({
      from: () => ({
        where: () => query,
        innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([{ graph: [] }]) }) }),
      }),
    });
    return Object.assign(Object.create(BindingResolverService.prototype) as object, {
      db: { select },
      logger: { warn: () => undefined, debug: () => undefined },
    }) as unknown as BindingResolverService;
  }
  const ctx: BindingScope = { runId: 'run-1', inputs: {}, prevStageKey: 'narration_audio' };

  it('{from:"prev"} on a media.audio artifact includes its blobId (Deepgram needs it)', async () => {
    const row = { id: 'art-1', kind: 'media.audio', blobId: 'blob-1', probe: null, data: null };
    const { value } = await serviceWith([row], [{ objectKey: 'k/audio.wav' }]).resolve(
      { from: 'prev' },
      ctx,
    );
    expect(value).toMatchObject({
      artifactId: 'art-1',
      blobId: 'blob-1',
      sourceKey: 'k/audio.wav',
    });
  });

  it('{from:"prev"} on a media artifact carries its stored probe, so a probe stage can report it', async () => {
    const probe = { container: 'wav', durationSec: 1.656, streams: [{ type: 'audio' }] };
    const row = { id: 'art-1', kind: 'media.audio', blobId: 'blob-1', probe, data: null };
    const { value } = await serviceWith([row], [{ objectKey: 'k/audio.wav' }]).resolve(
      { from: 'prev' },
      ctx,
    );
    expect(value).toMatchObject({ probe, durationSec: 1.656, hasAudio: true });
  });

  it('{from:"stage"} reads the named stage, not the previous one, and labels its manifest', async () => {
    const row = { id: 'art-9', kind: 'media.audio', blobId: 'blob-9', probe: null, data: null };
    const { value, provenance } = await serviceWith([row], [{ objectKey: 'k/music.wav' }]).resolve(
      { from: 'stage', stageKey: 'music' },
      ctx,
    );
    expect(value).toMatchObject({
      artifactId: 'art-9',
      handle: 'stage:music',
      sourceKey: 'k/music.wav',
    });
    expect(provenance).toMatchObject({ artifactId: 'art-9' });
  });

  it('{from:"stage"} names the stage it could not find an artifact for', async () => {
    await expect(
      serviceWith([]).resolve({ from: 'stage', stageKey: 'music' }, ctx),
    ).rejects.toThrow('no active artifact for stage "music"');
  });

  it('matches only requested items in consumer order and records precise provenance', async () => {
    const rows = ['alice', 'bob', 'castle'].map((key, itemIndex) => ({
      id: key,
      itemIndex,
      iterationValue: { key },
      kind: 'media.image',
      blobId: key,
      probe: null,
      data: null,
    }));
    const ctx: BindingScope = {
      runId: 'run-1',
      inputs: {},
      itemIndex: 0,
      iterateOverValue: [{ referenceKeys: ['castle', 'bob', 'bob'] }],
    };
    const ref: Ref = {
      from: 'stage',
      stageKey: 'sheets',
      match: { sourcePath: 'key', itemPath: 'referenceKeys' },
    };
    const result = await serviceWith(
      rows,
      [{ objectKey: 'castle.png' }],
      [{ objectKey: 'bob.png' }],
    ).resolve(ref, ctx);
    expect(result.value).toMatchObject([{ artifactId: 'castle' }, { artifactId: 'bob' }]);
    expect(result.provenance).toEqual({ ref, artifactIds: ['castle', 'bob'] });
  });

  it('rejects missing, ambiguous and historical producer identities', async () => {
    const ref: Ref = {
      from: 'stage',
      stageKey: 'sheets',
      match: { sourcePath: 'key', itemPath: 'wanted' },
    };
    const ctx: BindingScope = {
      runId: 'run-1',
      inputs: {},
      itemIndex: 0,
      iterateOverValue: [{ wanted: 'bob' }],
    };
    const row = { id: 'a', itemIndex: 0, iterationValue: { key: 'alice' }, kind: 'media.image' };
    await expect(serviceWith([row]).resolve(ref, ctx)).rejects.toThrow('no active item');
    await expect(
      serviceWith([row, { ...row, id: 'b', iterationValue: { key: 'alice' } }]).resolve(ref, {
        ...ctx,
        iterateOverValue: [{ wanted: 'alice' }],
      }),
    ).rejects.toThrow('multiple active items');
    await expect(serviceWith([{ ...row, iterationValue: null }]).resolve(ref, ctx)).rejects.toThrow(
      'Rerun that stage',
    );
  });

  it('accepts a scalar or empty selection and rejects invalid runtime fields', async () => {
    const ref: Ref = {
      from: 'stage',
      stageKey: 'sheets',
      match: { sourcePath: 'key', itemPath: 'wanted' },
    };
    const ctx: BindingScope = {
      runId: 'run-1',
      inputs: {},
      itemIndex: 0,
      iterateOverValue: [{ wanted: 'bob' }],
    };
    const row = {
      id: 'bob',
      itemIndex: 0,
      iterationValue: { key: 'bob' },
      kind: 'media.image',
      blobId: 'b',
    };
    expect(
      (await serviceWith([row], [{ objectKey: 'bob.png' }]).resolve(ref, ctx)).provenance
        .artifactIds,
    ).toEqual(['bob']);
    expect(
      (await serviceWith([row]).resolve(ref, { ...ctx, iterateOverValue: [{ wanted: [] }] })).value,
    ).toEqual([]);
    for (const wanted of [undefined, 1, {}, [['bob']]]) {
      await expect(
        serviceWith([row]).resolve(ref, { ...ctx, iterateOverValue: [{ wanted }] }),
      ).rejects.toThrow('must be a string or string array');
    }
    await expect(
      serviceWith([{ ...row, iterationValue: { key: 1 } }]).resolve(ref, ctx),
    ).rejects.toThrow('must be a string');
  });

  it('{from:"prev"} on a media.image_list gives each item its own blobId', async () => {
    const row = {
      id: 'art-2',
      kind: 'media.image_list',
      blobId: null,
      probe: null,
      data: {
        images: [
          { index: 0, label: null, blobId: 'blob-a', probe: null },
          { index: 1, label: null, blobId: 'blob-b', probe: null },
        ],
      },
    };
    const { value } = await serviceWith(
      [row],
      [
        { id: 'blob-a', objectKey: 'k/a.png' },
        { id: 'blob-b', objectKey: 'k/b.png' },
      ],
    ).resolve({ from: 'prev' }, ctx);
    expect(value).toMatchObject([
      { blobId: 'blob-a', sourceKey: 'k/a.png' },
      { blobId: 'blob-b', sourceKey: 'k/b.png' },
    ]);
  });

  it('{from:"memory"} on a media row with no artifact throws instead of resolving null', async () => {
    const row = {
      memKey: 'narration_audio',
      version: 1,
      kind: 'media.audio',
      artifactId: null,
      data: null,
      tombstone: false,
    };
    await expect(
      serviceWith([row]).resolve({ from: 'memory', key: 'narration_audio' }, ctx),
    ).rejects.toThrow('memory media "narration_audio" has no file');
  });

  it('{from:"memory"} on word timings gives them a handle that canonicalizes to their artifact', async () => {
    const timing = {
      transcript: 'hi there',
      durationSec: 1,
      sentences: [],
      words: [{ text: 'hi', startSec: 0, endSec: 0.5 }],
    };
    const row = {
      runId: 'run-1',
      memKey: 'narration_words',
      version: 1,
      writtenBy: 'narration_words',
      writtenItem: null,
      kind: 'data',
      artifactId: null,
      data: timing,
      tombstone: false,
    };
    const ref = { from: 'memory', key: 'narration_words' } as const;
    const { value, provenance } = await serviceWith([row], [{ id: 'art-words' }]).resolve(ref, ctx);
    expect(value).toEqual({ handle: 'memory:narration_words', ...timing });

    const timeline = {
      version: 1,
      canvas: { width: 1080, height: 1920, fps: 30 },
      tracks: [
        {
          id: 'captions',
          type: 'captions',
          items: [
            {
              type: 'captions',
              styleId: 'caption.clean',
              startSec: 0,
              timingHandle: 'memory:narration_words',
            },
          ],
        },
      ],
    };
    const canonical = new TimelineHandleService().canonicalize(timeline, { words: provenance }) as {
      tracks: Array<{ items: Array<{ timingHandle?: string }> }>;
    };
    expect(canonical.tracks[0]!.items[0]!.timingHandle).toBe('artifact:art-words');
  });
});
