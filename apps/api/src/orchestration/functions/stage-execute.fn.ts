import type { Inngest } from 'inngest';
import { approvalModeOf } from '@reelcraft/shared';
import type { StageRunnerService } from '../stage-runner.service';
import { runStageAttemptLoop } from './stage-attempt-loop';
import type { buildStageExecuteItemFunction } from './stage-execute-item.fn';

export interface StageExecuteEventData {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
}

/**
 * §13.1/§13.3 — the per-stage entry point `run.orchestrate` `step.invoke`s
 * once per stage, iterating or not (Locked Decision 1 — this outcome shape
 * and this function's identity never change across phase 7).
 *
 * The non-iterating path is completely unchanged from before phase 7 chunk
 * 4: it's the same `while(true)` attempt loop, now factored out into
 * `runStageAttemptLoop` (shared with `stage.execute.item`) but called with
 * the exact same step ids, retry-limit source, and outcome shapes as
 * before — zero behavioral change, verified by
 * `stage-execute-inngest.e2e.test.ts`'s pre-existing coverage.
 *
 * When `stage.iterate` is declared, this function instead becomes a thin
 * OUTER loop: resolve the item count once, ensure `stage_item` rows exist,
 * then for each item either skip it (already `'passed'` — §14.5's partial
 * resume) or `step.invoke` a fresh `stage.execute.item` run for it. Each
 * item gets its own independent Inngest function invocation/step history
 * (see the phase 7 plan doc's "one dispatcher function, one per-item
 * function" decision) — this function's own step count therefore stays
 * O(itemCount), never O(itemCount × retries × steps/attempt).
 */
/** The outcome that ends the stage after a batch: the first of the worst kind,
 * in item order. Items QC gave up on (`approval_required` in an end-reviewed
 * stage) are held, not a reason to stop. */
export function worstOutcome<T extends { outcome: string }>(
  results: T[],
  endReview: boolean,
): T | undefined {
  const priority = ['failed', 'budget_blocked', 'deferred', 'run_not_running', 'approval_required'];
  const stopping = results.filter(
    (result) =>
      result.outcome !== 'passed' && !(endReview && result.outcome === 'approval_required'),
  );
  return stopping.sort((a, b) => priority.indexOf(a.outcome) - priority.indexOf(b.outcome))[0];
}

export function buildStageExecuteFunction(
  client: Inngest,
  runner: StageRunnerService,
  stageExecuteItemFn: ReturnType<typeof buildStageExecuteItemFunction>,
) {
  return client.createFunction(
    // A server restart can interrupt Inngest while it is invoking this
    // endpoint. Retrying replays memoized steps and reuses the persisted
    // provider handle, so it resumes poll/fetch without submitting a second
    // provider job. `0` strands a submitted attempt after a callback EOF.
    { id: 'stage.execute', retries: 3 },
    { event: 'stage/execute.requested' },
    async ({ event, step, logger }) => {
      const data = event.data as StageExecuteEventData;
      const { stage, effective, prevStageKey } = await step.run('load-stage-context', () =>
        runner.loadStageContext(data.runId, data.stageKey),
      );

      const humanInteraction = runner.interactionFor(stage.capability);
      if (humanInteraction) {
        await step.run(`await-human-input-${data.stageKey}`, () =>
          runner.awaitHumanInput(
            data.runId,
            data.stageExecutionId,
            humanInteraction === 'timeline_editor' ? 'timeline_edit' : 'input',
          ),
        );
        return { outcome: 'input_required' as const };
      }

      if (stage.iterate) {
        const resolved = await step.run('resolve-iterate-count', () =>
          runner.resolveIterateCount(
            data.runId,
            data.stageExecutionId,
            stage,
            effective,
            prevStageKey,
          ),
        );
        if (!resolved.ok) {
          await step.run('fail-stage-iterate-count', () =>
            runner.failStageExecution(data.stageExecutionId, resolved.reason),
          );
          return { outcome: 'failed' as const, reason: resolved.reason };
        }
        const { itemCount } = resolved;
        await step.run('ensure-stage-items', () =>
          runner.ensureStageItems(data.stageExecutionId, itemCount),
        );

        // 'stage' mode: the items run without pausing; one QC gave up on is
        // held, and a single review opens after the last item.
        const endReview = approvalModeOf(stage) === 'stage';

        // Items run in batches of `concurrency` (one at a time when unset). A
        // fixed batch, not a sliding window, so the step order stays the same
        // on every replay. Every item of a batch finishes before the next
        // batch starts, and before a failure ends the stage.
        const concurrency = stage.iterate.concurrency ?? 1;
        for (let start = 0; start < itemCount; start += concurrency) {
          // §12.4 manual pause — stop after the current batch rather than
          // running the whole iterating stage to completion.
          const runState = await step.run(`check-runnable-item-${start}`, () =>
            runner.getRunState(data.runId),
          );
          if (runState !== 'RUNNING') return { outcome: 'run_not_running' as const };

          const batch = Array.from(
            { length: Math.min(concurrency, itemCount - start) },
            (_, offset) => start + offset,
          );
          const items = await Promise.all(
            batch.map((i) =>
              step.run(`check-item-${i}`, () => runner.itemState(data.stageExecutionId, i)),
            ),
          );
          const todo = batch.flatMap((i, offset) => {
            const item = items[offset]!;
            if (item.state === 'passed') return [];
            if (endReview && item.state === 'awaiting_approval') return [];
            return [{ i, item }];
          });

          const settled = await Promise.allSettled(
            todo.map(({ i, item }) =>
              step.invoke(`run-item-${i}`, {
                function: stageExecuteItemFn,
                data: {
                  runId: data.runId,
                  stageExecutionId: data.stageExecutionId,
                  stageKey: data.stageKey,
                  itemIndex: i,
                  stageItemId: item.id,
                },
              }),
            ),
          );
          const crashed = settled.find((entry) => entry.status === 'rejected');
          if (crashed?.status === 'rejected') throw crashed.reason;
          const worst = worstOutcome(
            settled.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : [])),
            endReview,
          );
          if (worst) return worst;
        }

        return step.run('conclude-iterating-stage', () =>
          runner.concludeIteratingStage(stage, {
            runId: data.runId,
            stageExecutionId: data.stageExecutionId,
          }),
        );
      }

      return runStageAttemptLoop({
        step,
        logger,
        runner,
        stage,
        effective,
        prevStageKey,
        runId: data.runId,
        stageExecutionId: data.stageExecutionId,
        stageKey: data.stageKey,
        retryLimit: effective.retryLimit,
      });
    },
  );
}
