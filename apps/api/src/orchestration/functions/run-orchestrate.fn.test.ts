import { InngestTestEngine } from '@inngest/test';
import { Inngest } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { buildRunOrchestrateFunction, orderStageExecutions } from './run-orchestrate.fn';

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

  it('ignores a stale persisted wakeup without transitioning or loading stages', async () => {
    const client = new Inngest({ id: 'run-orchestrate-wakeup-test' });
    const db = { select: vi.fn() };
    const runState = { transition: vi.fn(), setCursor: vi.fn() };
    const claim = {
      claim: vi.fn().mockResolvedValue({ claimed: false, reason: 'stale_revision' }),
    };
    const stageExecute = client.createFunction(
      { id: 'unused-stage-execute' },
      { event: 'unused/stage' },
      () => ({ outcome: 'passed' as const, artifactId: 'unused' }),
    );
    const fn = (
      buildRunOrchestrateFunction as never as (
        ...args: unknown[]
      ) => ReturnType<typeof client.createFunction>
    )(client, db, runState, stageExecute, claim);
    const eventData = {
      runId: 'run-1',
      wakeupId: 'wake-old',
      action: 'resume',
      sourceState: 'FAILED',
      expectedRevision: 2,
    };
    const engine = new InngestTestEngine({
      function: fn,
      events: [{ name: 'run/resumed', data: eventData }],
    });

    const { result, error } = await engine.execute();

    expect(error).toBeUndefined();
    expect(result).toEqual({ ignored: true, reason: 'stale_revision' });
    expect(claim.claim).toHaveBeenCalledWith(eventData);
    expect(runState.transition).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
});
