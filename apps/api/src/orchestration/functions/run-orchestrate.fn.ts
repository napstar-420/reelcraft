import type { Inngest } from 'inngest';
import { eq } from 'drizzle-orm';
import { StageDef } from '@reefcraft/shared';
import type { Db } from '../../db/drizzle.provider';
import { blueprintVersion, run, stageExecution } from '../../db/schema/index';
import type { RunStateService } from '../run-state.service';
import { buildStageExecuteFunction } from './stage-execute.fn';
import type { RunWakeupClaimService, RunWakeupEventData } from '../../run/run-wakeup-claim.service';

/** Shared shape for both triggers below — `run/resumed` (§12.4, sent by
 * `RunService.resume()`) carries the identical `{runId}` payload. */
export interface RunStartedEventData {
  runId: string;
  wakeupId?: string;
  action?: RunWakeupEventData['action'];
  sourceState?: RunWakeupEventData['sourceState'];
  expectedRevision?: number;
}

/** §16.1 — sorts `stage_execution` rows into blueprint graph array order.
 * Pure and exported so the ordering fix is directly unit-testable without
 * needing an Inngest test driver: `stage_execution` carries no ordinal
 * column of its own, so this is the one place that decides execution order. */
export function orderStageExecutions<T extends { stageKey: string }>(
  graph: Pick<StageDef, 'key'>[],
  executions: T[],
): T[] {
  const order = new Map(graph.map((stage, index) => [stage.key, index]));
  return [...executions].sort(
    (a, b) => (order.get(a.stageKey) ?? 0) - (order.get(b.stageKey) ?? 0),
  );
}

/**
 * §13.4/§13.5 — one Run at a time (`concurrency` keyed by runId), cancels on
 * `run/cancelled` for the same runId. Walks stage_execution rows created at
 * run start, in blueprint graph array order — REQ-2.8.3 ("Run's Stages
 * execute strictly sequentially"), §16.1. `stage_execution` carries no
 * ordinal column, so the graph is loaded and the rows sorted in memory
 * rather than adding a migration for a run-start-time property.
 *
 * §12.4 — triggers on `run/resumed` as well as `run/started`: the existing
 * unconditional `mark-running` step below is what actually flips a
 * `PAUSED_BUDGET` run back to `RUNNING` on a resumed invocation, so no
 * separate "un-pause" step is needed. The loop's existing
 * `state === 'passed'` skip re-enters at whichever stage_execution isn't
 * done yet — including the one that was `budget_blocked`, via a fresh
 * `beginAttempt` inside `stage.execute` (a new attempt row, not a
 * resumption of the old one).
 */
export function buildRunOrchestrateFunction(
  client: Inngest,
  db: Db,
  runState: RunStateService,
  stageExecuteFn: ReturnType<typeof buildStageExecuteFunction>,
  wakeupClaim?: RunWakeupClaimService,
) {
  return client.createFunction(
    {
      id: 'run.orchestrate',
      concurrency: { limit: 1, key: 'event.data.runId' },
      cancelOn: [{ event: 'run/cancelled', match: 'data.runId' }],
    },
    [{ event: 'run/started' }, { event: 'run/resumed' }],
    async ({ event, step }) => {
      const data = event.data as RunStartedEventData;
      const { runId } = data;

      if (
        data.wakeupId &&
        data.action &&
        data.sourceState &&
        data.expectedRevision !== undefined &&
        wakeupClaim
      ) {
        const claim = await step.run('claim-wakeup', () =>
          wakeupClaim.claim(data as RunWakeupEventData),
        );
        if (!claim.claimed) return { ignored: true as const, reason: claim.reason };
      } else {
        // Backward compatibility for already-enqueued events from before the
        // durable wakeup envelope was introduced.
        await step.run('mark-running', () => runState.transition(runId, 'RUNNING'));
      }

      const executions = await step.run('load-stage-executions', async () => {
        const [row] = await db
          .select({ graph: blueprintVersion.graph })
          .from(run)
          .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
          .where(eq(run.id, runId))
          .limit(1);
        if (!row) throw new Error(`run.orchestrate: run ${runId} not found`);

        const graph = StageDef.array().parse(row.graph);
        const rows = await db.select().from(stageExecution).where(eq(stageExecution.runId, runId));
        return orderStageExecutions(graph, rows);
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

        if (result.outcome === 'budget_blocked') {
          // §11.5 — never silently resumes, never silently dies. Cursor is
          // deliberately left pointing at this stage (set just above) so a
          // resumed invocation naturally re-enters here.
          await step.run('mark-paused-budget', () => runState.transition(runId, 'PAUSED_BUDGET'));
          return { state: 'PAUSED_BUDGET' as const };
        }

        if (result.outcome === 'run_not_running') {
          return { state: 'CANCELLED' as const };
        }

        if (result.outcome === 'approval_required') {
          await step.run('mark-paused-approval', () =>
            runState.transition(runId, 'PAUSED_APPROVAL'),
          );
          return { state: 'PAUSED_APPROVAL' as const };
        }

        if (result.outcome === 'input_required') {
          await step.run('mark-paused-input', () => runState.transition(runId, 'PAUSED_INPUT'));
          return { state: 'PAUSED_INPUT' as const };
        }

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
