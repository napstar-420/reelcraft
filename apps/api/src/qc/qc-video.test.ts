import { describe, expect, it } from 'vitest';
import { judgeWatchesVideo } from './qc-video';

const providers = (kinds: string[] | 'throw') =>
  ({
    get: () => {
      if (kinds === 'throw') throw new Error('unknown provider');
      return { listModels: async () => [{ modelId: 'm', capabilities: { inputKinds: kinds } }] };
    },
  }) as never;

describe('judgeWatchesVideo', () => {
  it('always accepts Codex, which opens the files itself', async () => {
    expect(await judgeWatchesVideo(providers([]), { provider: 'codex', modelId: 'x' })).toBe(true);
  });
  it('accepts a model that declares video input', async () => {
    expect(
      await judgeWatchesVideo(providers(['media.video']), { provider: 'p', modelId: 'm' }),
    ).toBe(true);
    expect(await judgeWatchesVideo(providers(['media.*']), { provider: 'p', modelId: 'm' })).toBe(
      true,
    );
  });
  it('rejects a model that only reads images, an unknown model, or no provider', async () => {
    expect(
      await judgeWatchesVideo(providers(['media.image']), { provider: 'p', modelId: 'm' }),
    ).toBe(false);
    expect(
      await judgeWatchesVideo(providers(['media.video']), { provider: 'p', modelId: 'other' }),
    ).toBe(false);
    expect(await judgeWatchesVideo(providers('throw'), { provider: 'p', modelId: 'm' })).toBe(
      false,
    );
    expect(await judgeWatchesVideo(providers([]), { provider: '', modelId: '' })).toBe(false);
  });
});
