import { describe, expect, it } from 'vitest';
import { stageFreshness } from './stage-freshness';
import { StageDef } from './stage-def';
import type { CreateBlueprintVersionDto } from './dto/blueprint.dto';
const stage = (key: string, dependsOn: string[]) =>
  StageDef.parse({
    key,
    label: key,
    dependsOn,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
  });
const source: CreateBlueprintVersionDto = {
  graph: [
    stage('script', []),
    stage('images', ['script']),
    stage('voice', ['script']),
    stage('join', ['images', 'voice']),
  ],
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 10 },
};
describe('workspace output freshness', () => {
  it('marks execution edits and descendants, keeps independent branches, and restores freshness on revert', () => {
    const edited = {
      ...source,
      graph: source.graph.map((s) =>
        s.key === 'voice' ? { ...s, instructions: { template: 'New narration' } } : s,
      ),
    };
    expect(stageFreshness(source, edited)).toEqual({
      changedStageKeys: ['voice'],
      validationStageKeys: [],
      staleStageKeys: ['voice', 'join'],
    });
    expect(stageFreshness(source, source).staleStageKeys).toEqual([]);
  });
  it('ignores labels and object key order, and identifies validation-only changes separately', () => {
    const draft = {
      ...source,
      graph: source.graph.map((s) => ({
        ...s,
        label: 'Renamed',
        checks: [{ type: 'script' as const, name: 'Revalidation', code: 'return true;' }],
      })),
    };
    expect(
      stageFreshness(source, {
        ...source,
        graph: source.graph.map((s) => ({ ...s, label: 'Renamed' })),
      }).staleStageKeys,
    ).toEqual([]);
    expect(stageFreshness(source, draft).validationStageKeys).toEqual([
      'script',
      'images',
      'voice',
      'join',
    ]);
    expect(stageFreshness(source, draft).staleStageKeys).toEqual([]);
  });
  it('invalidates shared-input changes and removed dependencies without erasing history', () => {
    expect(
      stageFreshness(source, { ...source, defaults: { format: { fps: 24 } } }).staleStageKeys,
    ).toEqual(['script', 'images', 'voice', 'join']);
    expect(
      stageFreshness(source, { ...source, graph: source.graph.filter((s) => s.key !== 'images') })
        .staleStageKeys,
    ).toEqual(['images', 'join']);
    expect(source.graph).toHaveLength(4);
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
