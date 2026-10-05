import type { ModelPin } from '@reelcraft/shared';
import { modelAcceptsKind } from '../common/file-inputs';
import type { ProviderRegistry } from '../provider/provider.registry';

export const QC_VIDEO_UNAVAILABLE =
  "This judge model can't watch video. Pick Codex, or a model that accepts video input, to judge a video list.";

/** Whether a judge can watch video clips: Codex opens the files itself with
 * its local tools, and any other model must declare video input. */
export async function judgeWatchesVideo(
  providers: Pick<ProviderRegistry, 'get'>,
  judge: Pick<ModelPin, 'provider' | 'modelId'>,
): Promise<boolean> {
  if (!judge.provider) return false;
  if (judge.provider === 'codex') return true;
  try {
    const models = await providers.get(judge.provider).listModels();
    const model = models.find((candidate) => candidate.modelId === judge.modelId);
    return modelAcceptsKind(model?.capabilities.inputKinds ?? [], 'media.video');
  } catch {
    return false;
  }
}
