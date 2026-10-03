import { describe, expect, it } from 'vitest';
import type { ConfigLayer, StageDef } from '@reelcraft/shared';
import type { Db } from '../db/drizzle.provider';
import type { EngineConfig } from '../config/engine-config';
import { ConfigResolverService } from './config-resolver.service';

function stage(overrides: Partial<StageDef> & Pick<StageDef, 'key'>): StageDef {
  return {
    label: overrides.key,
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

/** `resolveRunConfig` never touches `this.db`/`this.engineConfig` — stubs are enough. */
const resolver = new ConfigResolverService({} as Db, {} as EngineConfig);

describe('ConfigResolverService.resolveRunConfig (pure)', () => {
  it('layers engine -> channel -> blueprint -> stage per stage key', () => {
    const engine: ConfigLayer = { retryLimit: 0, polling: { intervalSec: 5, maxWaitSec: 120 } };
    const channelDefaults: ConfigLayer = { model: { params: { max_tokens: 512 } } };
    const blueprintDefaults: ConfigLayer = { model: { provider: 'fake', modelId: 'fake-text-1' } };

    const graph = [
      stage({ key: 'outline', retryLimit: 1 }),
      stage({ key: 'script', retryLimit: 2 }),
    ];

    const result = resolver.resolveRunConfig({ graph, engine, channelDefaults, blueprintDefaults });

    expect(result.outline).toEqual({
      retryLimit: 1,
      polling: { intervalSec: 5, maxWaitSec: 120 },
      model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 512 } },
    });
    expect(result.script?.retryLimit).toBe(2);
  });

  it('a stage with its own model overrides the blueprint-layer model entirely (modelId switch)', () => {
    const graph = [
      stage({
        key: 'title',
        retryLimit: 0,
        model: { provider: 'fake', modelId: 'fake-judge-1', params: { seed: 1 } },
      }),
    ];
    const result = resolver.resolveRunConfig({
      graph,
      engine: {},
      channelDefaults: {},
      blueprintDefaults: {
        model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 512 } },
      },
    });
    expect(result.title?.model).toEqual({
      provider: 'fake',
      modelId: 'fake-judge-1',
      params: { seed: 1 },
    });
  });

  it('returns one entry per stage key, empty for an empty graph', () => {
    const result = resolver.resolveRunConfig({
      graph: [],
      engine: {},
      channelDefaults: {},
      blueprintDefaults: {},
    });
    expect(result).toEqual({});
  });

  it('a stage-authored budget cap survives the full engine -> channel -> blueprint -> stage fold', () => {
    const graph = [stage({ key: 'outline', budget: { stageCapUsd: 5, qcCapUsd: 1 } })];
    const result = resolver.resolveRunConfig({
      graph,
      engine: {},
      channelDefaults: {},
      blueprintDefaults: {},
    });
    expect(result.outline?.budget).toEqual({ stageCapUsd: 5 });
    expect(result.outline?.qc).toEqual({ capUsd: 1 });
  });

  it('a blueprint-layer stageCapUsd is overridden by the stage-authored one, same precedence as retryLimit', () => {
    const graph = [stage({ key: 'outline', budget: { stageCapUsd: 2 } })];
    const result = resolver.resolveRunConfig({
      graph,
      engine: {},
      channelDefaults: {},
      blueprintDefaults: { budget: { stageCapUsd: 100 } },
    });
    expect(result.outline?.budget).toEqual({ stageCapUsd: 2 });
  });

  it('a stage without a retry limit gets the blueprint default, over the channel and engine', () => {
    const unset = stage({ key: 'a' });
    delete unset.retryLimit;
    const result = resolver.resolveRunConfig({
      graph: [unset, stage({ key: 'b', retryLimit: 0 })],
      engine: { retryLimit: 0 },
      channelDefaults: { retryLimit: 1 },
      blueprintDefaults: { retryLimit: 2 },
    });
    expect(result.a?.retryLimit).toBe(2);
    // An explicit 0 on the stage still wins.
    expect(result.b?.retryLimit).toBe(0);
  });

  it('a stage without a model uses the default for its kind of work', () => {
    const imagePin = { provider: 'fake', modelId: 'fake-image-1' };
    const result = resolver.resolveRunConfig({
      graph: [
        stage({ key: 'script' }),
        stage({ key: 'art', capability: 'image.generate', output: { kind: 'media.image' } }),
        stage({
          key: 'pinned',
          capability: 'image.generate',
          output: { kind: 'media.image' },
          model: { provider: 'fal', modelId: 'flux' },
        }),
      ],
      engine: {},
      channelDefaults: {
        models: { text: { provider: 'fake', modelId: 'fake-text-1' }, image: imagePin },
      },
      blueprintDefaults: { models: { text: { provider: 'openrouter', modelId: 'm' } } },
    });
    // The blueprint's text default wins over the channel's.
    expect(result.script?.model).toEqual({ provider: 'openrouter', modelId: 'm' });
    expect(result.art?.model).toEqual(imagePin);
    // The stage's own model wins over both.
    expect(result.pinned?.model).toEqual({ provider: 'fal', modelId: 'flux' });
  });
});
