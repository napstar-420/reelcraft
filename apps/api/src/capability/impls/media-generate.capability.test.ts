import { describe, expect, it, vi } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import type { ExecCtx } from '../capability.interface';
import { AudioSpeechCapability, ImageGenerateCapability } from './media-generate.capability';

describe('ImageGenerateCapability', () => {
  it('prepares a stable identity-augmented prompt used for estimate and submission', async () => {
    const estimate = vi
      .fn()
      .mockResolvedValue({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' });
    const submit = vi.fn().mockResolvedValue({ providerId: 'fake', externalId: 'job-1' });
    const providers = { get: () => ({ estimate, submit }) } as never;
    const capability = new ImageGenerateCapability(providers);
    const ctx: ExecCtx<{ provider: string; modelId: string; params?: Record<string, unknown> }> = {
      runId: 'run-1',
      stageKey: 'image',
      attemptNo: 1,
      config: { provider: 'fake', modelId: 'fake-image-1' },
      slots: { references: [{ characterDescription: 'A red-haired detective' }] },
      context: {},
      renderedPrompt: 'Portrait',
      idempotencyKey: 'key-1',
      logger: { log: () => {}, error: () => {} },
    };
    const prepared = capability.prepare(ctx);
    await capability.estimateCost(prepared);
    await capability.submit(prepared);
    expect(prepared.renderedPrompt).toBe('Portrait\nCharacter identity: A red-haired detective');
    expect(estimate.mock.calls[0]?.[0].renderedPrompt).toBe(prepared.renderedPrompt);
    expect(submit.mock.calls[0]?.[0].renderedPrompt).toBe(prepared.renderedPrompt);
  });
});

const IMAGE = (n: number) => ({ kind: 'media.image' as const, base64: 'AA', filename: `${n}.png` });

function imageStage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    key: 'img',
    label: 'Images',
    capability: 'image.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'media.image_list' },
    checks: [],
    ...overrides,
  };
}

function fetching(output: unknown, config: Record<string, unknown>) {
  const providers = {
    get: () => ({ fetch: async () => ({ output, costUsd: 0.12, repro: { level: 'none' } }) }),
  } as never;
  const capability = new ImageGenerateCapability(providers);
  const ctx = { config: { provider: 'fake', modelId: 'fake-image-1', ...config } } as never;
  return capability.fetch({ providerId: 'fake', externalId: 'job' }, ctx);
}

describe('ImageGenerateCapability images', () => {
  const capability = new ImageGenerateCapability({} as never);

  it('allows a single image or an image list', () => {
    expect(capability.allowedOutputs({} as never)).toEqual(['media.image', 'media.image_list']);
  });

  it('describes count and onShortfall in its config schema', () => {
    expect(capability.configSchema.properties?.count).toMatchObject({
      type: 'integer',
      minimum: 2,
      maximum: 8,
    });
    expect(capability.configSchema.properties?.onShortfall?.enum).toEqual(['warn', 'fail']);
  });

  it('asks the provider for count images only when it is above 1', async () => {
    const estimate = vi
      .fn()
      .mockResolvedValue({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' });
    const providers = { get: () => ({ estimate }) } as never;
    const withProviders = new ImageGenerateCapability(providers);
    const base = { slots: {}, context: {}, runId: 'r', stageKey: 'k', attemptNo: 1 };
    await withProviders.estimateCost({
      ...base,
      idempotencyKey: 'a',
      config: { provider: 'fake', modelId: 'm', count: 3, onShortfall: 'fail' },
    } as never);
    expect(estimate.mock.calls[0]?.[0].params.count).toBe(3);
    expect(estimate.mock.calls[0]?.[0].params).not.toHaveProperty('onShortfall');
    await withProviders.estimateCost({
      ...base,
      idempotencyKey: 'b',
      config: { provider: 'fake', modelId: 'm' },
    } as never);
    expect(estimate.mock.calls[1]?.[0].params).not.toHaveProperty('count');
  });

  describe('validate', () => {
    const messages = (config: Record<string, unknown>, stage: StageDef) =>
      capability.validate(config as never, stage).map((issue) => issue.path);

    it('accepts an image list with a count in range', () => {
      expect(messages({ count: 4 }, imageStage({ config: { count: 4 } }))).toEqual([]);
      expect(
        messages({ count: 4, onShortfall: 'fail' }, imageStage({ config: { count: 4 } })),
      ).toEqual([]);
    });

    it('requires a count of 2 to 8 for an image list', () => {
      expect(messages({}, imageStage())).toEqual(['config.count']);
      expect(messages({ count: 1 }, imageStage())).toEqual(['config.count']);
      expect(messages({ count: 9 }, imageStage())).toEqual(['config.count']);
      expect(messages({ count: 2.5 }, imageStage())).toEqual(['config.count']);
    });

    it('refuses iterate and writes on an image list', () => {
      const stage = imageStage({
        iterate: {
          over: { from: 'const', value: [] },
          itemAlias: 'x',
          itemRetryLimit: 0,
        },
        writes: { images: '$' },
      });
      expect(messages({ count: 3 }, stage)).toEqual(['iterate', 'writes']);
    });

    it('keeps count and onShortfall off a single image', () => {
      const single = imageStage({ output: { kind: 'media.image' } });
      expect(messages({}, single)).toEqual([]);
      expect(messages({ count: 1 }, single)).toEqual([]);
      expect(messages({ onShortfall: 'warn' }, single)).toEqual(['config.onShortfall']);
    });

    describe('picking the best of several candidates', () => {
      const qc = {
        criteria: 'Sharp',
        threshold: 70,
        model: { provider: 'codex', modelId: 'gpt-example', params: {} },
        includeInputs: false,
      } as const;
      const picking = (overrides: Partial<StageDef> = {}) =>
        imageStage({ output: { kind: 'media.image' }, qc, ...overrides });

      it('accepts 2 to 4 candidates with quality control', () => {
        for (const count of [2, 3, 4]) expect(messages({ count }, picking())).toEqual([]);
        expect(messages({ count: 3, onShortfall: 'fail' }, picking())).toEqual([]);
      });

      it('may iterate and write to memory', () => {
        const stage = picking({
          iterate: { over: { from: 'const', value: [] }, itemAlias: 'x', itemRetryLimit: 0 },
          writes: { image: '$' },
        });
        expect(messages({ count: 3 }, stage)).toEqual([]);
      });

      it('allows at most 4 candidates', () => {
        expect(messages({ count: 5 }, picking())).toEqual(['config.count']);
        expect(messages({ count: 2.5 }, picking())).toEqual(['config.count']);
      });

      it('needs quality control to pick', () => {
        const issues = capability.validate({ count: 3 } as never, picking({ qc: undefined }));
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
          path: 'config.count',
          message: expect.stringContaining('needs quality control'),
        });
      });
    });
  });

  describe('fetch', () => {
    it('leaves a single image alone', async () => {
      const result = await fetching(IMAGE(1), {});
      expect(result.output).toEqual(IMAGE(1));
      expect(result.rejection).toBeUndefined();
    });

    it('returns every image of a full list', async () => {
      const result = await fetching({ images: [IMAGE(1), IMAGE(2), IMAGE(3)] }, { count: 3 });
      expect(result.output).toEqual({ images: [IMAGE(1), IMAGE(2), IMAGE(3)] });
      expect(result.rejection).toBeUndefined();
      expect(result.providerMeta).toBeUndefined();
    });

    it('drops images past the count', async () => {
      const result = await fetching({ images: [IMAGE(1), IMAGE(2), IMAGE(3)] }, { count: 2 });
      expect(result.output).toEqual({ images: [IMAGE(1), IMAGE(2)] });
    });

    it('wraps the one image of a provider that cannot make several', async () => {
      const result = await fetching(IMAGE(1), { count: 3 });
      expect(result.output).toEqual({ images: [IMAGE(1)] });
      expect(result.providerMeta).toMatchObject({ shortfall: { requested: 3, returned: 1 } });
    });

    it('warns by default when fewer images come back, and keeps them', async () => {
      const result = await fetching({ images: [IMAGE(1), IMAGE(2)] }, { count: 4 });
      expect(result.output).toEqual({ images: [IMAGE(1), IMAGE(2)] });
      expect(result.rejection).toBeUndefined();
      expect(result.providerMeta).toMatchObject({
        shortfall: { requested: 4, returned: 2 },
        warning: 'The provider returned 2 of 4 images',
      });
      expect(result.costUsd).toBe(0.12);
    });

    it('rejects the attempt, keeping its cost, when onShortfall is fail', async () => {
      const result = await fetching(
        { images: [IMAGE(1), IMAGE(2)] },
        { count: 4, onShortfall: 'fail' },
      );
      expect(result.rejection).toBe('The provider returned 2 of 4 images');
      expect(result.costUsd).toBe(0.12);
    });

    it('fails when no image comes back, whatever onShortfall says', async () => {
      await expect(fetching({ images: [] }, { count: 3 })).rejects.toThrow('no images');
      await expect(fetching({ images: [] }, { count: 3, onShortfall: 'warn' })).rejects.toThrow(
        'no images',
      );
    });
  });
});

describe('AudioSpeechCapability', () => {
  it('speaks the text of a memory ref, not its { text } wrapper', () => {
    const capability = new AudioSpeechCapability({} as never);
    const ctx = {
      config: { provider: 'x', modelId: 'y' },
      slots: { text: { text: 'Hello there.' } },
    };
    expect(capability.prepare(ctx as never).slots.text).toBe('Hello there.');
    expect(capability.prepare({ ...ctx, slots: { text: 'plain' } } as never).slots.text).toBe(
      'plain',
    );
  });
});
