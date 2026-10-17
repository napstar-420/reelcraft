import { describe, expect, it } from 'vitest';
import { StageDef } from '@reelcraft/shared';
import { executionEligibility } from './execution-eligibility';
const graph = ['source', 'motion', 'final'].map((key, i) =>
  StageDef.parse({
    key,
    label: key,
    dependsOn: i ? [['source', 'motion'][i - 1]] : [],
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    checks: [],
    retryLimit: 0,
    output: { kind: 'text' },
  }),
);
const rows = [
  { stageKey: 'source', state: 'passed' },
  { stageKey: 'motion', state: 'cancelled', isIterating: true, itemCount: 14, completedItems: 6 },
  { stageKey: 'final', state: 'skipped' },
];
describe('authoritative execution eligibility', () => {
  it('offers continuation of six saved items and blocks dependent stages', () => {
    const actions = executionEligibility(graph, rows, {}, 'CANCELLED');
    expect(actions.stages.motion).toMatchObject({
      continue: true,
      rerun: true,
      run: false,
      completedItems: 6,
      totalItems: 14,
    });
    expect(actions.stages.final).toMatchObject({
      run: false,
      blockedReason: 'Waiting for motion.',
    });
  });
  it.each(['RUNNING', 'PAUSING', 'CANCELLING'] as const)(
    'rejects all stage actions in %s',
    (state) => {
      const actions = executionEligibility(graph, rows, {}, state);
      for (const action of Object.values(actions.stages))
        expect([action.run, action.continue, action.rerun]).toEqual([false, false, false]);
    },
  );
  it('offers a previously scope-skipped stage only once dependencies are ready', () => {
    const actions = executionEligibility(
      graph,
      rows.map((row) =>
        row.stageKey === 'motion' ? { ...row, state: 'passed', completedItems: 14 } : row,
      ),
      {},
      'IDLE',
    );
    expect(actions.stages.final).toMatchObject({ run: true, blockedReason: null });
  });
  it('keeps saved waits and queued admission from being regenerated', () => {
    expect(executionEligibility(graph, rows, {}, 'IDLE', true).run.busy).toBe(true);
    expect(
      executionEligibility(
        graph,
        [...rows.filter((r) => r.stageKey !== 'motion'), { ...rows[1]!, waiting: 'approval' }],
        {},
        'CANCELLED',
      ).stages.motion?.blockedReason,
    ).toContain('saved approval');
  });
});

describe('disabled stage policy', () => {
  it('allows manual execution of the disabled stage, blocks every descendant and preserves independent branches', () => {
    const next = [
      ...graph.map((s) => (s.key === 'source' ? { ...s, disabled: true } : s)),
      { ...graph[0]!, key: 'independent', label: 'independent', dependsOn: [] },
    ];
    const actions = executionEligibility(next, rows, {}, 'IDLE');
    expect(actions.stages.source?.rerun).toBe(true);
    expect(actions.stages.motion?.blockedReason).toContain('Disabled ancestor: source');
    expect(actions.stages.final?.blockedReason).toContain('Disabled ancestor: source');
    expect(actions.stages.independent?.run).toBe(true);
    expect(actions.run.runBlueprint).toBe(false);
    expect(actions.run.rerunBlueprint).toBe(false);
  });
  it('restores descendant eligibility when re-enabled', () => {
    const actions = executionEligibility(graph, rows, {}, 'IDLE');
    expect(actions.stages.motion?.continue).toBe(true);
  });
});
