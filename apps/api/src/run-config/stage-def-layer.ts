import type { ConfigLayer, StageDef } from '@reelcraft/shared';

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
    // §11.2 — `StageDef.budget.qcCapUsd` (author-facing) maps to
    // `ConfigLayer.qc.capUsd` (override-facing), the same shape QC's
    // `judge`/`threshold` already use. Per §5.2 ordering the stage's own
    // authored cap wins over channel/blueprint defaults but stays
    // overridable by `run.overrides[stageKey]`, exactly like `retryLimit`.
    ...(stage.budget?.stageCapUsd !== undefined && {
      budget: { stageCapUsd: stage.budget.stageCapUsd },
    }),
    ...(stage.budget?.qcCapUsd !== undefined && {
      qc: { capUsd: stage.budget.qcCapUsd },
    }),
    // §14 — mirrors `retryLimit` above: an iterating stage's own
    // `itemRetryLimit`/`maxItems` always override the engine/channel/
    // blueprint defaults, but stay overridable by `run.overrides[stageKey]`.
    ...(stage.iterate !== undefined && {
      iterate: {
        itemRetryLimit: stage.iterate.itemRetryLimit,
        ...(stage.iterate.maxItems !== undefined && { maxItems: stage.iterate.maxItems }),
      },
    }),
  };
}
