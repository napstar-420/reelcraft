import { describe, expect, it } from 'vitest';
import { QC_IMAGES_UNAVAILABLE, judgeImagesProblem, qcImagesLimit } from './qc-images';

const providers = (inputKinds: string[] | 'throw', maxRefs?: number) =>
  ({
    get: () => {
      if (inputKinds === 'throw') throw new Error('unknown provider');
      return {
        listModels: async () => [
          { modelId: 'm', capabilities: { inputKinds, ...(maxRefs !== undefined && { maxRefs }) } },
        ],
      };
    },
  }) as never;

const judge = { provider: 'p', modelId: 'm' };

describe('judgeImagesProblem', () => {
  it('always accepts Codex, which opens the files itself', async () => {
    expect(await judgeImagesProblem(providers([]), { provider: 'codex', modelId: 'x' }, 8)).toBe(
      undefined,
    );
  });
  it('accepts a model that declares image input', async () => {
    expect(await judgeImagesProblem(providers(['media.image']), judge, 4)).toBe(undefined);
    expect(await judgeImagesProblem(providers(['media.*']), judge, 4)).toBe(undefined);
  });
  it('rejects a model with no image input, an unknown model, or no provider', async () => {
    expect(await judgeImagesProblem(providers(['media.video']), judge, 2)).toBe(
      QC_IMAGES_UNAVAILABLE,
    );
    expect(
      await judgeImagesProblem(providers(['media.image']), { provider: 'p', modelId: 'other' }, 2),
    ).toBe(QC_IMAGES_UNAVAILABLE);
    expect(await judgeImagesProblem(providers('throw'), judge, 2)).toBe(QC_IMAGES_UNAVAILABLE);
    expect(await judgeImagesProblem(providers([]), { provider: '', modelId: '' }, 2)).toBe(
      QC_IMAGES_UNAVAILABLE,
    );
  });
  it('rejects more images than the model can take at once', async () => {
    expect(await judgeImagesProblem(providers(['media.image'], 5), judge, 5)).toBe(undefined);
    expect(await judgeImagesProblem(providers(['media.image'], 5), judge, 6)).toBe(
      qcImagesLimit(5),
    );
  });
});
