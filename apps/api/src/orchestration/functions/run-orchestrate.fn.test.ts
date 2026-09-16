import { describe, expect, it } from 'vitest';
import { orderStageExecutions } from './run-orchestrate.fn';

describe('orderStageExecutions', () => {
  it('sorts by blueprint graph array order, not by stage_key alphabetically', () => {
    // Deliberately non-alphabetical graph order: if this were sorted by
    // `stageKey` instead (the bug this fix replaces), "outline" would run
    // last instead of first.
    const graph = [{ key: 'outline' }, { key: 'script' }, { key: 'zzz-title' }];
    const executions = [{ stageKey: 'zzz-title' }, { stageKey: 'outline' }, { stageKey: 'script' }];

    expect(orderStageExecutions(graph, executions).map((e) => e.stageKey)).toEqual([
      'outline',
      'script',
      'zzz-title',
    ]);
  });

  it('does not mutate the input array', () => {
    const graph = [{ key: 'b' }, { key: 'a' }];
    const executions = [{ stageKey: 'a' }, { stageKey: 'b' }];
    const original = [...executions];

    orderStageExecutions(graph, executions);

    expect(executions).toEqual(original);
  });
});
