import type { Inngest } from 'inngest';
import { eq } from 'drizzle-orm';
import { StageDef } from '@reefcraft/shared';
import type { Db } from '../../db/drizzle.provider';
import { blueprintVersion, run, stageExecution } from '../../db/schema/index';
import type { RunStateService } from '../run-state.service';
import { buildStageExecuteFunction } from './stage-execute.fn';

export interface RunStartedEventData {
  runId: string;
}

/**
 * §13.4/§13.5 — one Run at a time (`concurrency` keyed by runId), cancels on
 * `run/cancelled` for the same runId. Walks stage_execution rows created at
 * run start, in blueprint graph array order — REQ-2.8.3 ("Run's Stages
 * execute strictly sequentially"), §16.1. `stage_execution` carries no
 * ordinal column, so the graph is loaded and the rows sorted in memory
 * rather than adding a migration for a run-start-time property.
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

      const executions = await step.run('load-stage-executions', async () => {
        const [runRow] = await db
          .select({ blueprintVersionId: run.blueprintVersionId })
          .from(run)
          .where(eq(run.id, runId))
          .limit(1);
        if (!runRow) throw new Error(`run.orchestrate: run ${runId} not found`);

        const [versionRow] = await db
          .select({ graph: blueprintVersion.graph })
          .from(blueprintVersion)
          .where(eq(blueprintVersion.id, runRow.blueprintVersionId))
          .limit(1);
        if (!versionRow) {
          throw new Error(
            `run.orchestrate: blueprint version ${runRow.blueprintVersionId} not found`,
          );
        }

        const graph = StageDef.array().parse(versionRow.graph);
        const order = new Map(graph.map((stage, index) => [stage.key, index]));

        const rows = await db.select().from(stageExecution).where(eq(stageExecution.runId, runId));
        return [...rows].sort(
          (a, b) => (order.get(a.stageKey) ?? 0) - (order.get(b.stageKey) ?? 0),
        );
      });

      for (const execution of executions) {
        if (execution.state === 'passed') continue;

        await step.run(`set-cursor-${execution.stageKey}`, () =>
          runState.setCursor(runId, execution.stageKey),
        );

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
