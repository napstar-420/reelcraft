import type { Inngest } from 'inngest';
import type { StageRunnerService } from '../stage-runner.service';
import { runStageAttemptLoop } from './stage-attempt-loop';

export interface StageExecuteItemEventData {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
  itemIndex: number;
  stageItemId: string;
}

/**
 * phase 7 chunk 4 — one iterating item's full submit/poll/fetch/check/
 * QC/retry loop, run as its OWN Inngest function invocation with its own
 * independent step history (see the plan doc's "one dispatcher function,
 * one per-item function" decision — this is what keeps `stage.execute`'s
 * own step count at O(itemCount) instead of O(itemCount × retries ×
 * steps/attempt)).
 *
 * This function has no event a real caller ever sends — `stage/execute.item
 * .requested` exists only because the installed Inngest SDK's
 * `createFunction` requires a trigger argument; every actual invocation
 * comes from `stage.execute`'s outer loop via `step.invoke({function:
 * stageExecuteItemFn, ...})`, which dispatches directly to this function by
 * id rather than through the named event.
 */
export function buildStageExecuteItemFunction(client: Inngest, runner: StageRunnerService) {
  return client.createFunction(
    { id: 'stage.execute.item', retries: 3 },
    { event: 'stage/execute.item.requested' },
    async ({ event, step }) => {
      const data = event.data as StageExecuteItemEventData;
      const { stage, effective, prevStageKey } = await step.run('load-stage-context', () =>
        runner.loadStageContext(data.runId, data.stageKey),
      );
      if (!stage.iterate) {
        throw new Error(`stage.execute.item: stage "${data.stageKey}" does not declare iterate`);
      }

      return runStageAttemptLoop({
        step,
        runner,
        stage,
        effective,
        prevStageKey,
        runId: data.runId,
        stageExecutionId: data.stageExecutionId,
        stageKey: data.stageKey,
        retryLimit: effective.iterate!.itemRetryLimit,
        itemIndex: data.itemIndex,
        stageItemId: data.stageItemId,
      });
    },
  );
}
