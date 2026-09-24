import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { stageDefLayer } from './stage-def-layer';
import { mergeLayer } from './layer-merge';

function stage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    key: 'outline',
    label: 'Outline',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...overrides,
  };
}

describe('stageDefLayer', () => {
  it('projects retryLimit and model unconditionally', () => {
    const layer = stageDefLayer(stage({ retryLimit: 2 }));
    expect(layer).toEqual({ retryLimit: 2 });
  });

  it('projects StageDef.budget.stageCapUsd into ConfigLayer.budget.stageCapUsd', () => {
    const layer = stageDefLayer(stage({ budget: { stageCapUsd: 5 } }));
    expect(layer.budget).toEqual({ stageCapUsd: 5 });
  });

  it('projects StageDef.budget.qcCapUsd into ConfigLayer.qc.capUsd — the author-facing/override-facing name mismatch is deliberate', () => {
    const layer = stageDefLayer(stage({ budget: { qcCapUsd: 2 } }));
    expect(layer.qc).toEqual({ capUsd: 2 });
  });

  it('projects both budget fields together', () => {
    const layer = stageDefLayer(stage({ budget: { stageCapUsd: 5, qcCapUsd: 2 } }));
    expect(layer.budget).toEqual({ stageCapUsd: 5 });
    expect(layer.qc).toEqual({ capUsd: 2 });
  });

  it('omits budget/qc entirely when StageDef.budget is absent', () => {
    const layer = stageDefLayer(stage());
    expect(layer.budget).toBeUndefined();
    expect(layer.qc).toBeUndefined();
  });

  it('a run.overrides patch still wins over the stage-authored cap, same as retryLimit', () => {
    const base = stageDefLayer(stage({ budget: { stageCapUsd: 5 } }));
    const override = { budget: { stageCapUsd: 1 } };
    expect(mergeLayer(base, override).budget).toEqual({ stageCapUsd: 1 });
  });
});
