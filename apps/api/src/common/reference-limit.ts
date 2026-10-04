import type { ModelCapabilities } from '@reelcraft/shared';
import { FLOW_MAX_REFERENCES } from '../capability/impls/flow-video.prompt';

/** Most reference images a role-consuming stage may use. A Flow stage uploads
 * them as browser ingredients, so its limit is the browser job's input cap,
 * not the pinned model's image-generation one; every other stage uses the
 * model's own advertised limit (undefined when it declares none). */
export function stageReferenceLimit(
  capability: string,
  capabilities: Pick<ModelCapabilities, 'maxRefs' | 'image'> | undefined,
): number | undefined {
  if (capability === 'browser.flow_video') return FLOW_MAX_REFERENCES;
  return capabilities?.maxRefs ?? capabilities?.image?.maxReferences;
}
