import { describe, expect, it } from 'vitest';
import type { ConfigLayer } from '@reefcraft/shared';
import { mergeLayer, mergeLayers } from './layer-merge';

describe('mergeLayer', () => {
  it('deep-merges nested objects', () => {
    const base: ConfigLayer = { qc: { threshold: 50, capUsd: 1 } };
    const patch: ConfigLayer = { qc: { threshold: 70 } };
    expect(mergeLayer(base, patch)).toEqual({ qc: { threshold: 70, capUsd: 1 } });
  });

  it('replaces arrays and scalars outright rather than merging them', () => {
    const base: ConfigLayer = { retryLimit: 1 };
    const patch: ConfigLayer = { retryLimit: 3 };
    expect(mergeLayer(base, patch)).toEqual({ retryLimit: 3 });
  });

  it('skips an absent (undefined) patch key — base value survives', () => {
    const base: ConfigLayer = { retryLimit: 2, budget: { runCapUsd: 10 } };
    const patch: ConfigLayer = { retryLimit: undefined };
    expect(mergeLayer(base, patch)).toEqual({ retryLimit: 2, budget: { runCapUsd: 10 } });
  });

  it('deletes the key on an explicit null patch value — it does not resurface', () => {
    const base: ConfigLayer = { retryLimit: 2 };
    const patch: ConfigLayer = { retryLimit: null };
    const merged = mergeLayer(base, patch);
    expect('retryLimit' in merged).toBe(false);
  });

  it('merges model.params when modelId matches', () => {
    const base: ConfigLayer = { model: { modelId: 'gpt', params: { temperature: 0.5 } } };
    const patch: ConfigLayer = { model: { modelId: 'gpt', params: { max_tokens: 512 } } };
    expect(mergeLayer(base, patch)).toEqual({
      model: { modelId: 'gpt', params: { temperature: 0.5, max_tokens: 512 } },
    });
  });

  it('discards old params outright when modelId switches', () => {
    const base: ConfigLayer = { model: { modelId: 'gpt', params: { temperature: 0.5 } } };
    const patch: ConfigLayer = { model: { modelId: 'claude', params: { max_tokens: 512 } } };
    expect(mergeLayer(base, patch)).toEqual({
      model: { modelId: 'claude', params: { max_tokens: 512 } },
    });
  });

  it('applies the same modelId-aware rule to qc.model', () => {
    const base: ConfigLayer = { qc: { model: { modelId: 'judge-a', params: { seed: 1 } } } };
    const patch: ConfigLayer = { qc: { model: { modelId: 'judge-b', params: { seed: 2 } } } };
    expect(mergeLayer(base, patch)).toEqual({
      qc: { model: { modelId: 'judge-b', params: { seed: 2 } } },
    });
  });
});

describe('mergeLayers', () => {
  it('folds left to right — later layers win', () => {
    const engine: ConfigLayer = { retryLimit: 0, polling: { intervalSec: 5, maxWaitSec: 120 } };
    const channelDefaults: ConfigLayer = { retryLimit: 1, model: { params: { max_tokens: 512 } } };
    const blueprintDefaults: ConfigLayer = { model: { provider: 'fake', modelId: 'fake-text-1' } };
    const stage: ConfigLayer = { retryLimit: 2 };

    expect(mergeLayers(engine, channelDefaults, blueprintDefaults, stage)).toEqual({
      retryLimit: 2,
      polling: { intervalSec: 5, maxWaitSec: 120 },
      model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 512 } },
    });
  });

  it('returns an empty layer when folding zero layers', () => {
    expect(mergeLayers()).toEqual({});
  });
});
