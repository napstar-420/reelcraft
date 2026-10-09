import type { ModelPin } from '@reelcraft/shared';
import { modelAcceptsKind } from '../common/file-inputs';
import type { ProviderRegistry } from '../provider/provider.registry';

export const QC_IMAGES_UNAVAILABLE =
  "This judge model can't look at images. Pick Codex, or a model that accepts image input, to judge an image list.";

export function qcImagesLimit(limit: number): string {
  return `This judge model can look at ${limit} images at a time, fewer than this stage makes. Lower the number of images, or pick Codex or another judge model.`;
}

/** Why a judge can't look at `count` images together, or `undefined` when it
 * can: Codex opens the files itself with its local tools, and any other model
 * must declare image input and (when it declares one) room for that many
 * attachments. */
export async function judgeImagesProblem(
  providers: Pick<ProviderRegistry, 'get'>,
  judge: Pick<ModelPin, 'provider' | 'modelId'>,
  count: number,
): Promise<string | undefined> {
  if (!judge.provider) return QC_IMAGES_UNAVAILABLE;
  if (judge.provider === 'codex') return undefined;
  try {
    const models = await providers.get(judge.provider).listModels();
    const model = models.find((candidate) => candidate.modelId === judge.modelId);
    if (!modelAcceptsKind(model?.capabilities.inputKinds ?? [], 'media.image')) {
      return QC_IMAGES_UNAVAILABLE;
    }
    const limit = model?.capabilities.maxRefs;
    return limit !== undefined && count > limit ? qcImagesLimit(limit) : undefined;
  } catch {
    return QC_IMAGES_UNAVAILABLE;
  }
}
