import type { ModelPin } from '@reelcraft/shared';
import { modelAcceptsKind } from '../common/file-inputs';
import { SELF_INSPECTING_PROVIDERS, type ProviderRegistry } from '../provider/provider.registry';

export const QC_IMAGES_UNAVAILABLE =
  "This judge model can't look at images. Pick Codex or Claude, or a model that accepts image input, to judge an image list.";

export function qcImagesLimit(limit: number): string {
  return `This judge model can look at ${limit} images at a time, fewer than this stage makes. Lower the number of images, or pick Codex, Claude or another judge model.`;
}

/** Why a judge can't look at `count` images together, or `undefined` when it
 * can: Codex and Claude open the files themselves with its local tools, and any other model
 * must declare image input and (when it declares one) room for that many
 * attachments. */
export async function judgeImagesProblem(
  providers: Pick<ProviderRegistry, 'get'>,
  judge: Pick<ModelPin, 'provider' | 'modelId'>,
  count: number,
): Promise<string | undefined> {
  if (!judge.provider) return QC_IMAGES_UNAVAILABLE;
  if (SELF_INSPECTING_PROVIDERS.has(judge.provider)) return undefined;
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
