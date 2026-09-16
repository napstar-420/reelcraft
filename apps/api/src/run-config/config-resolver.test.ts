import { describe, expect, it } from 'vitest';
import type { ConfigLayer, StageDef } from '@reefcraft/shared';
import type { Db } from '../db/drizzle.provider';
import { ConfigResolverService } from './config-resolver.service';

function stage(overrides: Partial<StageDef> & Pick<StageDef, 'key'>): StageDef {
  return {
    label: overrides.key,
    capability: 'llm.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    ...overrides,
  };
}

/** `resolveRunConfig` never touches `this.db` — a stub is enough. */
const resolver = new ConfigResolverService({} as Db);

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
});
