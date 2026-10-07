import { describe, expect, it, vi } from 'vitest';
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
