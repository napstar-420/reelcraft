import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { definitionKey, stageFreshness } from './stage-freshness';
import type { CreateBlueprintVersionDto } from '@reelcraft/shared';

// The browser uses the same dependency primitives and implementation as the shared package.
it('keeps workspace freshness comparison in sync with the API', () => {
  const shared = readFileSync(
    new URL('../../../../packages/shared/src/stage-freshness.ts', import.meta.url),
    'utf8',
  );
  const web = readFileSync(new URL('./stage-freshness.ts', import.meta.url), 'utf8');
  const implementation = (text: string) => text.slice(text.indexOf('/** Stable comparison'));
  expect(implementation(web)).toBe(implementation(shared));
});
describe('workspace freshness', () => {
  it('compares keys stably and propagates edits to joins without touching independent work', () => {
    expect(definitionKey({ a: 1, b: 2 })).toBe(definitionKey({ b: 2, a: 1 }));
    const stage = {
      label: 'Stage',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' as const },
      checks: [],
    };
    const source: CreateBlueprintVersionDto = {
      graph: [
        { ...stage, key: 'image', dependsOn: [] },
        { ...stage, key: 'voice', dependsOn: [] },
        { ...stage, key: 'join', dependsOn: ['image', 'voice'] },
      ],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 1 },
    };
    const draft = {
      ...source,
      graph: source.graph.map((s) =>
        s.key === 'voice' ? { ...s, instructions: { template: 'New' } } : s,
      ),
    };
    expect(stageFreshness(source, draft).staleStageKeys).toEqual(['voice', 'join']);
  });

  it('does not mark a stage stale when only its phase name changes', () => {
    const stage = {
      key: 'a',
      label: 'A',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' as const },
      checks: [],
    };
    const source: CreateBlueprintVersionDto = {
      graph: [stage],
      inputs: [],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 1 },
    };
    const draft = { ...source, graph: [{ ...stage, group: 'Voice' }] };
    expect(stageFreshness(source, draft).staleStageKeys).toEqual([]);
  });
});

// Keep this table identical in packages/shared and apps/web stage-freshness tests.
describe('which edits make an output stale', () => {
  const base = {
    key: 'a',
    label: 'A',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' as const },
    checks: [],
    iterate: {
      over: { from: 'input' as const, inputKey: 'list' },
      itemAlias: 'x',
      itemRetryLimit: 1,
    },
    qc: {
      criteria: 'good',
      threshold: 0.7,
      model: { provider: 'p', modelId: 'm', params: {} },
      includeInputs: false,
    },
  };
  const blueprint: CreateBlueprintVersionDto = {
    graph: [base],
    inputs: [{ key: 'list', label: 'List', required: true, accepts: { kind: 'text' } }],
    roles: [{ key: 'host', label: 'Host', required: false }],
    defaults: {},
    budget: { runCapUsd: 1 },
  };
  type Draft = CreateBlueprintVersionDto;
  const withStage = (patch: Record<string, unknown>): Draft => ({
    ...blueprint,
    graph: [{ ...base, ...patch } as Draft['graph'][number]],
  });
  const cases: Array<[string, Draft, 'kept' | 'stale' | 'validation']> = [
    ['label', withStage({ label: 'B' }), 'kept'],
    ['group', withStage({ group: 'G' }), 'kept'],
    ['model', withStage({ model: { provider: 'p', modelId: 'other' } }), 'kept'],
    ['model params', withStage({ model: { params: { voice: 'x' } } }), 'kept'],
    ['retryLimit', withStage({ retryLimit: 3 }), 'kept'],
    ['approval', withStage({ approval: { mode: 'stage' } }), 'kept'],
    ['budget', withStage({ budget: { stageCapUsd: 2 } }), 'kept'],
    ['disabled', withStage({ disabled: true }), 'kept'],
    ['enabledWhen', withStage({ enabledWhen: { input: 'list', equals: 'x' } }), 'kept'],
    ['iterate.concurrency', withStage({ iterate: { ...base.iterate, concurrency: 2 } }), 'kept'],
    [
      'iterate.itemRetryLimit',
      withStage({ iterate: { ...base.iterate, itemRetryLimit: 4 } }),
      'kept',
    ],
    ['checkMaxAttempts', withStage({ checkMaxAttempts: 5 }), 'kept'],
    ['qc.maxAttempts', withStage({ qc: { ...base.qc, maxAttempts: 5 } }), 'kept'],
    ['qc.onExhausted', withStage({ qc: { ...base.qc, onExhausted: 'human_review' } }), 'kept'],
    ['input label', { ...blueprint, inputs: [{ ...blueprint.inputs[0]!, label: 'L' }] }, 'kept'],
    [
      'input required',
      { ...blueprint, inputs: [{ ...blueprint.inputs[0]!, required: false }] },
      'kept',
    ],
    ['role label', { ...blueprint, roles: [{ ...blueprint.roles[0]!, label: 'R' }] }, 'kept'],
    ['default model', { ...blueprint, defaults: { model: { modelId: 'x' } } }, 'kept'],
    ['default models', { ...blueprint, defaults: { models: { text: { modelId: 'x' } } } }, 'kept'],
    [
      'preferred provider',
      { ...blueprint, defaults: { provider: { preferred: { text: 'p' } } } },
      'kept',
    ],
    ['default retries', { ...blueprint, defaults: { retryLimit: 2 } }, 'kept'],
    ['default budget', { ...blueprint, defaults: { budget: { runCapUsd: 3 } } }, 'kept'],
    ['default QC cap', { ...blueprint, defaults: { qc: { capUsd: 3 } } }, 'kept'],
    ['polling', { ...blueprint, defaults: { polling: { intervalSec: 3 } } }, 'kept'],
    ['instructions', withStage({ instructions: { template: 'new' } }), 'stale'],
    ['config', withStage({ config: { allowGaps: true } }), 'stale'],
    ['writes', withStage({ writes: { a: 'b' } }), 'stale'],
    ['output', withStage({ output: { kind: 'data', schema: {} } }), 'stale'],
    ['iterate.maxItems', withStage({ iterate: { ...base.iterate, maxItems: 2 } }), 'stale'],
    ['input key', { ...blueprint, inputs: [{ ...blueprint.inputs[0]!, key: 'other' }] }, 'stale'],
    [
      'role character',
      { ...blueprint, roles: [{ ...blueprint.roles[0]!, characterId: 'c' }] },
      'stale',
    ],
    ['format', { ...blueprint, defaults: { format: { aspectRatio: '9:16' } } }, 'stale'],
    ['default maxItems', { ...blueprint, defaults: { iterate: { maxItems: 3 } } }, 'stale'],
    [
      'checks',
      withStage({ checks: [{ type: 'script', name: 'c', code: 'return true;' }] }),
      'validation',
    ],
    ['qc criteria', withStage({ qc: { ...base.qc, criteria: 'better' } }), 'validation'],
    ['default QC threshold', { ...blueprint, defaults: { qc: { threshold: 0.9 } } }, 'validation'],
  ];
  it.each(cases)('%s', (_name, draft, expected) => {
    const result = stageFreshness(blueprint, draft);
    const actual = result.staleStageKeys.length
      ? 'stale'
      : result.validationStageKeys.length
        ? 'validation'
        : 'kept';
    expect(actual).toBe(expected);
  });
});
