import type { ConfigLayer, StageDef } from '@reefcraft/shared';

/**
 * §5.2 — the top-most ConfigLayer, projected from the StageDef itself.
 * `retryLimit` is a required field on StageDef, so this layer always
 * overrides any channel/blueprint-layer `retryLimit` — that value is
 * unreachable until the phase-9 editor starts populating StageDef.retryLimit
 * from the resolved lower layers. Do not "fix" this by reordering the merge.
 */
export function stageDefLayer(stage: StageDef): ConfigLayer {
  return {
    ...(stage.model !== undefined && { model: stage.model }),
    retryLimit: stage.retryLimit,
  };
}
