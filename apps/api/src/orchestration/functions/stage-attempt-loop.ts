import type { Context, Logger } from 'inngest';
import { DEFAULT_FEEDBACK_MAX_ATTEMPTS } from '@reelcraft/shared';
import type { JobStatus, StageDef } from '@reelcraft/shared';
import { CONSUMES_RETRY_LIMIT } from '../attempt-outcome';
import type {
  FetchAndFinalizeResult,
  StageAttemptContext,
  StageRunnerService,
} from '../stage-runner.service';
import type { EffectiveStageConfig } from '../../run-config/config-resolver.service';

/** `Context.Any['step']` — the step-tools object handed to every Inngest
 * function handler. Typed this way (rather than importing an internal
 * `GetStepTools` helper) so this module only depends on `inngest`'s public
 * `Context` export, the same one `stage-execute-inngest.e2e.test.ts` already
 * imports for its own `transformCtx` helper. */
type StepTools = Context.Any['step'];

/** §13's backoff poll sequence, capped. */
const POLL_BACKOFF_SEC = [5, 15, 30];

/** A job whose provider reports its own `deadlineMs` (e.g. Codex's own
 * job-runner watchdog) is still worth polling past this loop's generic
 * `polling.maxWaitSec` as long as that provider-declared deadline hasn't
 * passed — it's demonstrably still alive and within its own real budget,
 * not hung. Providers that never set `deadlineMs` get exactly today's
 * behavior: only `maxWaitSec` bounds them. Reads the clock, so call it only
 * inside a `step.run` (see the lint rule for this directory). */
export function withinProviderDeadline(status: JobStatus): boolean {
  // eslint-disable-next-line no-restricted-syntax -- only ever called inside a step.run
  return !status.done && status.deadlineMs !== undefined && Date.now() < status.deadlineMs;
}

/** The outcome union `stage.execute` and `stage.execute.item` both return —
 * `run.orchestrate` (non-iterating) and `stage.execute`'s own outer loop
 * (iterating) bubble it through unchanged. */
export type StageAttemptOutcome =
  | { outcome: 'passed'; artifactId: string }
  | { outcome: 'approval_required'; artifactId: string }
  | { outcome: 'run_not_running' }
  | { outcome: 'budget_blocked'; reason: 'run_cap_exceeded' | 'stage_cap_exceeded' }
  | { outcome: 'deferred'; resumeAt: string }
  | { outcome: 'failed'; reason: string };

export interface StageAttemptLoopParams {
  step: StepTools;
  logger: Logger;
  runner: StageRunnerService;
  stage: StageDef;
  effective: EffectiveStageConfig;
  prevStageKey: string | undefined;
  runId: string;
  stageExecutionId: string;
  stageKey: string;
  /** `effective.retryLimit` for the non-iterating path, or
   * `effective.iterate!.itemRetryLimit` for one item's own loop — crash
   * retries only; check/QC feedback loops have their own caps. */
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
    logger,
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

  /** What to do with a finished fetch (or a "Retry QC" judging): the stage's
   * outcome when it is decided, or `undefined` to loop to a fresh attempt. */
  const settleFetched = async (
    fetched: FetchAndFinalizeResult,
    attemptCtx: StageAttemptContext,
    iteration: number,
    isLastAttempt = false,
  ): Promise<StageAttemptOutcome | undefined> => {
    if (fetched.outcome === 'success') {
      return { outcome: 'passed' as const, artifactId: fetched.artifactId };
    }

    if (fetched.outcome === 'approval_required') {
      return { outcome: 'approval_required' as const, artifactId: fetched.artifactId };
    }

    if (fetched.outcome === 'run_not_running') {
      return { outcome: 'run_not_running' as const };
    }

    if (fetched.outcome === 'deferred') {
      return { outcome: 'deferred' as const, resumeAt: fetched.resumeAt };
    }

    if (fetched.outcome === 'output_rejected') {
      // Recorded as a provider error (the call was billed and settled), so it
      // spends the crash retry budget exactly as a thrown error would.
      if (!isLastAttempt) return undefined;
      await step.run(`fail-stage-${stageKey}`, () =>
        runner.failStageExecution(stageExecutionId, fetched.reason, stageItemId),
      );
      return { outcome: 'failed' as const, reason: fetched.reason };
    }

    if (fetched.outcome === 'qc_error' || fetched.outcome === 'model_error') {
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

    // check_failed | qc_failed — not a stage failure: loop to a fresh
    // attempt (the critique is spliced into its prompt) until this
    // feedback kind's own cap is spent. This attempt's outcome is already
    // recorded, so the count includes it.
    const failedOutcome = fetched.outcome;
    const failuresUsed = await step.run(`count-${failedOutcome}-${iteration}`, () =>
      runner.countRoundAttempts(stageExecutionId, [failedOutcome], stageItemId),
    );
    const maxAttempts =
      (failedOutcome === 'qc_failed' ? stage.qc?.maxAttempts : stage.checkMaxAttempts) ??
      DEFAULT_FEEDBACK_MAX_ATTEMPTS;
    if (failuresUsed >= maxAttempts) {
      if (failedOutcome === 'qc_failed' && stage.qc?.onExhausted === 'human_review') {
        const handedOff = await step.run(`qc-handoff-${stageKey}-${iteration}`, () =>
          runner.handOffForReview(stage, attemptCtx),
        );
        return handedOff.outcome === 'approval_required'
          ? { outcome: 'approval_required' as const, artifactId: handedOff.artifactId }
          : { outcome: 'run_not_running' as const };
      }
      const reason =
        fetched.outcome === 'check_failed'
          ? `check_failed after ${failuresUsed} attempts: ${fetched.checkResults
              .filter((r) => !r.pass)
              .map((r) => r.name)
              .join(', ')}`
          : `qc_failed after ${failuresUsed} attempts: ${fetched.qcVerdict.critique}`;
      await step.run(`fail-stage-${stageKey}`, () =>
        runner.failStageExecution(stageExecutionId, reason, stageItemId),
      );
      return { outcome: 'failed' as const, reason };
    }
    return undefined;
  };

  let iteration = 0;
  while (true) {
    iteration += 1;

    // "Retry QC": quality control could not run, the output was parked for
    // review and a person released it to be judged again. Judge the stored
    // output; nothing is generated and no attempt is spent.
    const held = await step.run(
      `find-held-qc-${iteration}`,
      async () => (await runner.findHeldQcAttempt(stageExecutionId, stageItemId)) ?? null,
    );
    if (held) {
      const retried = await step.run(`retry-qc-${iteration}`, () =>
        runner.retryHeldQc(stage, held, prevStageKey, effective),
      );
      const settled = await settleFetched(retried, held, iteration);
      if (settled) return settled;
      continue;
    }

    const attemptCtx: StageAttemptContext = await step.run(`begin-attempt-${iteration}`, () =>
      runner.beginAttempt({ runId, stageExecutionId, stageKey, itemIndex, stageItemId }),
    );
    // DB-derived, not `attemptCtx.attemptNo` itself: only crashes spend
    // `retryLimit` — check/QC failures, human rejections and
    // `budget_blocked` all loop without consuming it. Counts attempts
    // STRICTLY BEFORE this one; `isLastAttempt` means this attempt crashing
    // would exhaust the limit.
    const crashAttemptsUsed = await step.run(`count-crash-attempts-${iteration}`, () =>
      runner.countRoundAttempts(stageExecutionId, [...CONSUMES_RETRY_LIMIT], stageItemId),
    );
    const isLastAttempt = crashAttemptsUsed >= retryLimit;
    const infraAttemptsUsed = await step.run(`count-infra-attempts-${iteration}`, () =>
      runner.countRoundAttempts(stageExecutionId, ['infra_error'], stageItemId),
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

      // The "still inside the provider's own deadline" check reads the clock,
      // so it runs inside the poll step and its answer is saved with the
      // status. Inngest re-runs this whole function on every step and replays
      // saved results: a clock read out here would be re-decided against the
      // current time on every replay, so an earlier attempt's loop could
      // suddenly "time out" long after it finished and take the stage down.
      const poll = (id: string) =>
        step.run(id, async () => {
          const polled = await runner.pollOnce(stage, handle, attemptCtx);
          return { status: polled, live: withinProviderDeadline(polled) };
        });
      let { status, live } = await poll(`poll-${stageKey}-${iteration}-0`);
      let pollCount = 0;
      let elapsedSec = 0;
      while (!status.done && (elapsedSec < effective.polling.maxWaitSec || live)) {
        const waitSec = POLL_BACKOFF_SEC[Math.min(pollCount, POLL_BACKOFF_SEC.length - 1)]!;
        pollCount += 1;
        elapsedSec += waitSec;
        await step.sleep(`poll-wait-${stageKey}-${iteration}-${pollCount}`, `${waitSec}s`);
        ({ status, live } = await poll(`poll-${stageKey}-${iteration}-${pollCount}`));
      }

      if (!status.done && status.deadlineMs !== undefined) {
        // A browser provider (ChatGPT, Codex) that kept its own clock and
        // ran past it: its page or process is stuck, which is ours to clean
        // up, not the stage's to fail on. Cancel it and go again as an
        // infrastructure retry; only repeated stalls fail the stage.
        const reason = 'The provider job stalled and was cancelled';
        await step.run(`provider-stalled-${stageKey}-${iteration}`, () =>
          runner.recordProviderStall(stage, attemptCtx, handle, reason),
        );
        if (infraAttemptsUsed + 1 >= runner.infraAttemptLimit()) {
          await step.run(`fail-stage-infra-${stageKey}`, () =>
            runner.failStageExecution(stageExecutionId, reason, stageItemId),
          );
          return { outcome: 'failed' as const, reason };
        }
        continue;
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
        // A run cancellation settles the provider job directly, racing this
        // same poll — that race must exit quietly as `run_not_running`,
        // not fail the stage over what is really just a cancel.
        const stoppedByCancel = await step.run(`check-cancelled-${stageKey}-${iteration}`, () =>
          runner.stopIfRunNotRunning(attemptCtx),
        );
        if (stoppedByCancel) return { outcome: 'run_not_running' as const };
        if (status.failureClass === 'user_action') {
          // Retrying can't help until the user acts (e.g. signs in) — fail
          // now with the provider's message so it's the one they see.
          await step.run(`fail-stage-user-action-${stageKey}`, () =>
            runner.failStageExecution(stageExecutionId, status.reason, stageItemId),
          );
          return { outcome: 'failed' as const, reason: status.reason };
        }
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

      const settled = await settleFetched(fetched, attemptCtx, iteration, isLastAttempt);
      if (settled) return settled;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        { runId, stageKey, attemptNo: attemptCtx.attemptNo, itemIndex, isLastAttempt, err },
        'stage attempt threw',
      );
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
