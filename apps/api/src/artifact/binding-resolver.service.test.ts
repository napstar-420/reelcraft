import { describe, expect, it } from 'vitest';
import type { Ref } from '@reelcraft/shared';
import { BindingResolverService, type BindingScope } from './binding-resolver.service';

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
    const select = () => ({
      from: () => ({
        where: () => ({
          limit: next,
          orderBy: next,
          then: (resolve: (rows: unknown[]) => unknown) => next().then(resolve),
        }),
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
});
