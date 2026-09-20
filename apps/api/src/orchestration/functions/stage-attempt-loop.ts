import type { Context } from 'inngest';
import type { StageDef } from '@reefcraft/shared';
import type { StageAttemptContext, StageRunnerService } from '../stage-runner.service';
import type { EffectiveStageConfig } from '../../run-config/config-resolver.service';

/** `Context.Any['step']` — the step-tools object handed to every Inngest
 * function handler. Typed this way (rather than importing an internal
 * `GetStepTools` helper) so this module only depends on `inngest`'s public
 * `Context` export, the same one `stage-execute-inngest.e2e.test.ts` already
 * imports for its own `transformCtx` helper. */
type StepTools = Context.Any['step'];

/** §13's backoff poll sequence, capped. */
const POLL_BACKOFF_SEC = [5, 15, 30];

/** The outcome union `stage.execute` and `stage.execute.item` both return —
 * `run.orchestrate` (non-iterating) and `stage.execute`'s own outer loop
 * (iterating) bubble it through unchanged. */
export type StageAttemptOutcome =
  | { outcome: 'passed'; artifactId: string }
  | { outcome: 'approval_required'; artifactId: string }
  | { outcome: 'run_not_running' }
  | { outcome: 'budget_blocked'; reason: 'run_cap_exceeded' | 'stage_cap_exceeded' }
  | { outcome: 'failed'; reason: string };

export interface StageAttemptLoopParams {
  step: StepTools;
  runner: StageRunnerService;
  stage: StageDef;
  effective: EffectiveStageConfig;
  prevStageKey: string | undefined;
  runId: string;
  stageExecutionId: string;
  stageKey: string;
  /** `effective.retryLimit` for the non-iterating path, or
   * `effective.iterate!.itemRetryLimit` for one item's own loop. */
  retryLimit: number;
  /** phase 7 chunk 4 — set only by `stage.execute.item`'s caller. */
  itemIndex?: number;
  stageItemId?: string;
}

/**
 * §13.1/§13.3 — one stage attempt's submit/poll/fetch/check/QC/retry loop,
 * shared by `stage.execute` (non-iterating) and `stage.execute.item` (one
 * iterating item, run as its own Inngest function invocation — see the
 * phase 7 plan doc's "one dispatcher function, one per-item function"
 * decision for why). Each caller passes its OWN `step` from its own Inngest
 * function context, so step ids never need item-index disambiguation here:
 * an item's attempt loop runs inside a completely separate function
 * invocation from both the non-iterating path and every other item, each
 * with its own independent step history. This is what keeps the two
 * callers' step-id schemes byte-for-byte identical to what `stage.execute`
 * used before this chunk existed.
 *
 * Two counters are deliberately kept distinct: the local `iteration`
 * (incremented every loop pass, used only to keep this ONE function
 * invocation's step ids unique) and the DB-derived `attemptCtx.attemptNo`
 * (returned by `runner.beginAttempt`, used for every actual retry-accounting
 * decision — §13.2 Rule 2).
 */
export async function runStageAttemptLoop(
  params: StageAttemptLoopParams,
): Promise<StageAttemptOutcome> {
  const {
    step,
    runner,
    stage,
    effective,
    prevStageKey,
    runId,
    stageExecutionId,
    stageKey,
    retryLimit,
    itemIndex,
    stageItemId,
  } = params;

  let iteration = 0;
  while (true) {
    iteration += 1;
    const attemptCtx: StageAttemptContext = await step.run(`begin-attempt-${iteration}`, () =>
      runner.beginAttempt({ runId, stageExecutionId, stageKey, itemIndex, stageItemId }),
    );
    // §11 — DB-derived, not `attemptCtx.attemptNo` itself: a
    // `budget_blocked` attempt loops (after a resume) without consuming a
    // semantic retry. `countSemanticAttemptsUsed` counts only attempts
    // STRICTLY BEFORE this one; the `+1` below accounts for the current
    // attempt itself becoming a semantic use if it fails.
    const semanticAttemptsUsed = await step.run(`count-semantic-attempts-${iteration}`, () =>
      runner.countSemanticAttemptsUsed(stageExecutionId, stageItemId),
    );
    const isLastAttempt = semanticAttemptsUsed + 1 >= retryLimit + 1;
    const infraAttemptsUsed = await step.run(`count-infra-attempts-${iteration}`, () =>
      runner.countInfraAttemptsUsed(stageExecutionId, stageItemId),
    );

    try {
      const submission = await step.run(`submit-${stageKey}-${iteration}`, () =>
        runner.reserveAndSubmit(stage, attemptCtx, prevStageKey, effective),
      );

      if (submission.outcome === 'budget_blocked') {
        return { outcome: 'budget_blocked' as const, reason: submission.reason };
      }
      if (submission.outcome === 'run_not_running') {
        return { outcome: 'run_not_running' as const };
      }
      const handle = submission.handle;

      let status = await step.run(`poll-${stageKey}-${iteration}-0`, () =>
        runner.pollOnce(stage, handle),
      );
      let pollCount = 0;
      let elapsedSec = 0;
      while (!status.done && elapsedSec < effective.polling.maxWaitSec) {
        const waitSec = POLL_BACKOFF_SEC[Math.min(pollCount, POLL_BACKOFF_SEC.length - 1)]!;
        pollCount += 1;
        elapsedSec += waitSec;
        await step.sleep(`poll-wait-${stageKey}-${iteration}-${pollCount}`, `${waitSec}s`);
        status = await step.run(`poll-${stageKey}-${iteration}-${pollCount}`, () =>
          runner.pollOnce(stage, handle),
        );
      }

      if (!status.done) {
        await step.run(`provider-timeout-${stageKey}-${iteration}`, () =>
          runner.recordProviderTimeout(stage, attemptCtx, handle),
        );
        if (isLastAttempt) {
          await step.run(`fail-stage-${stageKey}`, () =>
            runner.failStageExecution(stageExecutionId, 'provider_timeout', stageItemId),
          );
          return { outcome: 'failed' as const, reason: 'provider_timeout' };
        }
        continue;
      }

      if (status.outcome === 'failed') {
        // §11.3 — a confirmed non-billing failure: release, not spend.
        await step.run(`settle-failed-poll-${stageKey}-${iteration}`, () =>
          runner.settleFailedPoll(attemptCtx),
        );
        if (status.failureClass === 'infrastructure') {
          await step.run(`record-infra-error-${stageKey}-${iteration}`, () =>
            runner.recordInfraError(attemptCtx, status.reason),
          );
          if (infraAttemptsUsed + 1 >= runner.infraAttemptLimit()) {
            await step.run(`fail-stage-infra-${stageKey}`, () =>
              runner.failStageExecution(stageExecutionId, status.reason, stageItemId),
            );
            return { outcome: 'failed' as const, reason: status.reason };
          }
          continue;
        }
        throw new Error(status.reason);
      }

      const fetched = await step.run(`fetch-${stageKey}-${iteration}`, () =>
        runner.fetchAndFinalize(stage, attemptCtx, handle, prevStageKey, effective),
      );

      if (fetched.outcome === 'success') {
        return { outcome: 'passed' as const, artifactId: fetched.artifactId };
      }

      if (fetched.outcome === 'approval_required') {
        return { outcome: 'approval_required' as const, artifactId: fetched.artifactId };
      }

      if (fetched.outcome === 'run_not_running') {
        return { outcome: 'run_not_running' as const };
      }

      if (fetched.outcome === 'qc_error') {
        await step.run(`fail-stage-${stageKey}`, () =>
          runner.failStageExecution(stageExecutionId, fetched.reason, stageItemId),
        );
        return { outcome: 'failed' as const, reason: fetched.reason };
      }

      if (fetched.outcome === 'qc_budget_exhausted') {
        await step.run(`fail-stage-${stageKey}`, () =>
          runner.failStageExecution(stageExecutionId, 'qc_budget_exhausted', stageItemId),
        );
        return { outcome: 'failed' as const, reason: 'qc_budget_exhausted' };
      }

      // check_failed | qc_failed — semantic, consumes a retry.
      if (isLastAttempt) {
        const reason =
          fetched.outcome === 'check_failed'
            ? 'check_failed'
            : `qc_failed: ${fetched.qcVerdict.critique}`;
        await step.run(`fail-stage-${stageKey}`, () =>
          runner.failStageExecution(stageExecutionId, reason, stageItemId),
        );
        return { outcome: 'failed' as const, reason };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (isLastAttempt) {
        await step.run(`record-failure-${stageKey}`, () =>
          runner.recordFailure(attemptCtx, reason),
        );
        return { outcome: 'failed' as const, reason };
      }
      // Not the last attempt: mark THIS attempt's row so it doesn't sit at
      // its provisional outcome forever, then loop to a fresh attempt.
      await step.run(`record-attempt-error-${stageKey}-${iteration}`, () =>
        runner.recordAttemptError(attemptCtx, reason),
      );
    }
  }
}
