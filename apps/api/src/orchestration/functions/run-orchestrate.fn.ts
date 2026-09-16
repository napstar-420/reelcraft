import type { Inngest } from 'inngest';
import { eq, asc } from 'drizzle-orm';
import type { Db } from '../../db/drizzle.provider';
import { stageExecution } from '../../db/schema/index';
import type { RunStateService } from '../run-state.service';
import { buildStageExecuteFunction } from './stage-execute.fn';

export interface RunStartedEventData {
  runId: string;
}

/**
 * §13.4/§13.5 — one Run at a time (`concurrency` keyed by runId), cancels on
 * `run/cancelled` for the same runId. Walks stage_execution rows created at
 * run start, in `stageKey` order — array order in the blueprint graph, per
 * REQ-2.8.3 ("Run's Stages execute strictly sequentially").
 */
export function buildRunOrchestrateFunction(
  client: Inngest,
  db: Db,
  runState: RunStateService,
  stageExecuteFn: ReturnType<typeof buildStageExecuteFunction>,
) {
  return client.createFunction(
    {
      id: 'run.orchestrate',
      concurrency: { limit: 1, key: 'event.data.runId' },
      cancelOn: [{ event: 'run/cancelled', match: 'data.runId' }],
    },
    { event: 'run/started' },
    async ({ event, step }) => {
      const { runId } = event.data as RunStartedEventData;

      await step.run('mark-running', () => runState.transition(runId, 'RUNNING'));

      const executions = await step.run('load-stage-executions', async () =>
        db
          .select()
          .from(stageExecution)
          .where(eq(stageExecution.runId, runId))
          .orderBy(asc(stageExecution.stageKey)),
      );

      for (const execution of executions) {
        if (execution.state === 'passed') continue;

        await step.run(`set-cursor-${execution.stageKey}`, () => runState.setCursor(runId, execution.stageKey));

        const result = await step.invoke(`invoke-stage-${execution.stageKey}`, {
          function: stageExecuteFn,
          data: { runId, stageExecutionId: execution.id, stageKey: execution.stageKey },
        });

        if (result.outcome === 'failed') {
          await step.run('mark-failed', () => runState.transition(runId, 'FAILED'));
          return { state: 'FAILED' as const };
        }
      }

      await step.run('mark-completed', () => runState.transition(runId, 'COMPLETED'));
      await step.run('clear-cursor', () => runState.setCursor(runId, null));
      return { state: 'COMPLETED' as const };
    },
  );
}
