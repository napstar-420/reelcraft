import { describe, expect, it } from 'vitest';
import { FakeProviderAdapter } from './fake-provider.adapter';

describe('FakeProviderAdapter media fixtures', () => {
  it('returns deterministic image and audio source descriptors', async () => {
    const provider = new FakeProviderAdapter();
    for (const modelId of ['fake-image-1', 'fake-audio-1']) {
      const handle = await provider.submit({ modelId, params: {} }, `fixture-${modelId}`);
      expect(await provider.poll(handle)).toMatchObject({ done: true, outcome: 'succeeded' });
      const result = await provider.fetch(handle);
      expect(result.output).toMatchObject({ base64: expect.any(String) });
    }
  });
});
