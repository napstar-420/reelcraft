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

  it('returns a list of images when more than one is asked for', async () => {
    const provider = new FakeProviderAdapter();
    const handle = await provider.submit(
      { modelId: 'fake-image-1', params: { count: 3 } },
      'fixture-image-list',
    );
    const { output } = await provider.fetch(handle);
    expect(output).toMatchObject({
      images: [
        { kind: 'media.image', filename: 'fixture.png' },
        { filename: 'fixture-2.png' },
        { filename: 'fixture-3.png' },
      ],
    });
  });

  it('can come back short of the images asked for', async () => {
    const provider = new FakeProviderAdapter();
    const handle = await provider.submit(
      { modelId: 'fake-image-1', params: { count: 4, fakeImageCount: 2 } },
      'fixture-image-short',
    );
    const { output } = await provider.fetch(handle);
    expect((output as { images: unknown[] }).images).toHaveLength(2);
  });
});
