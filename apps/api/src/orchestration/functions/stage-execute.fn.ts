import type { Inngest } from 'inngest';
import type { StageAttemptContext, StageRunnerService } from '../stage-runner.service';

export interface StageExecuteEventData {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
}

/** §13's backoff poll sequence, capped. */
const POLL_BACKOFF_SEC = [5, 15, 30];

/**
 * §13.1/§13.3 — one stage attempt loop. Steps return IDs only (§13.2 Rule
 * 1): `reserveAndSubmit` returns a small discriminated `SubmitOutcome`
 * (a JobHandle on success, or a `budget_blocked` reason — never a
 * workspace path), `poll` returns status, `fetchAndFinalize` returns a
 * discriminated outcome carrying only ids/results, never the artifact
 * payload itself.
 *
 * Two counters are deliberately kept distinct: the local `iteration`
 * (incremented every loop pass, used only to keep Inngest step ids unique)
 * and the DB-derived `attemptCtx.attemptNo` (returned by
 * `runner.beginAttempt`, used for every actual retry-accounting/
 * continuation decision — §13.2 Rule 2, transport retry must never
 * double-count a semantic attempt). Conflating the two would reintroduce
 * exactly the "loop-local variable drives retry accounting" bug this chunk
 * exists to fix.
 */
export function buildStageExecuteFunction(client: Inngest, runner: StageRunnerService) {
  return client.createFunction(
    { id: 'stage.execute', retries: 0 },
    { event: 'stage/execute.requested' },
    async ({ event, step }) => {
      const data = event.data as StageExecuteEventData;
      const { stage, effective, prevStageKey } = await step.run('load-stage-context', () =>
        runner.loadStageContext(data.runId, data.stageKey),
      );

      if (stage.capability === 'human.input') {
        await step.run(`await-human-input-${data.stageKey}`, () =>
          runner.awaitHumanInput(data.runId, data.stageExecutionId),
        );
        return { outcome: 'input_required' as const };
      }

      let iteration = 0;
      while (true) {
        iteration += 1;
        const attemptCtx: StageAttemptContext = await step.run(`begin-attempt-${iteration}`, () =>
          runner.beginAttempt({
            runId: data.runId,
            stageExecutionId: data.stageExecutionId,
            stageKey: data.stageKey,
          }),
        );
        // §11 — DB-derived, not `attemptCtx.attemptNo` itself: a
        // `budget_blocked` attempt loops (after a resume) without
        // consuming a semantic retry, which breaks the old invariant that
        // `attemptNo` equalled "semantic attempts used". `countSemanticAttemptsUsed`
        // counts only attempts STRICTLY BEFORE this one (this attempt's own
        // just-inserted row is still at its provisional `'success'`
        // placeholder, so it never counts itself) — the `+1` below accounts
        // for the current attempt itself becoming a semantic use if it
        // fails, matching the old `attemptNo >= retryLimit + 1` semantics
        // for every case where `attemptNo` and semantic-attempts-used
        // coincide (i.e. no `budget_blocked` attempt has occurred yet).
        const semanticAttemptsUsed = await step.run(`count-semantic-attempts-${iteration}`, () =>
          runner.countSemanticAttemptsUsed(data.stageExecutionId),
        );
        const isLastAttempt = semanticAttemptsUsed + 1 >= effective.retryLimit + 1;

        try {
          const submission = await step.run(`submit-${data.stageKey}-${iteration}`, () =>
            runner.reserveAndSubmit(stage, attemptCtx, prevStageKey, effective),
          );

          if (submission.outcome === 'budget_blocked') {
            return { outcome: 'budget_blocked' as const, reason: submission.reason };
          }
          if (submission.outcome === 'run_not_running') {
            return { outcome: 'run_not_running' as const };
          }
          const handle = submission.handle;

          let status = await step.run(`poll-${data.stageKey}-${iteration}-0`, () =>
            runner.pollOnce(stage, handle),
          );
          let pollCount = 0;
          let elapsedSec = 0;
          while (!status.done && elapsedSec < effective.polling.maxWaitSec) {
            const waitSec = POLL_BACKOFF_SEC[Math.min(pollCount, POLL_BACKOFF_SEC.length - 1)]!;
            pollCount += 1;
            elapsedSec += waitSec;
            await step.sleep(`poll-wait-${data.stageKey}-${iteration}-${pollCount}`, `${waitSec}s`);
            status = await step.run(`poll-${data.stageKey}-${iteration}-${pollCount}`, () =>
              runner.pollOnce(stage, handle),
            );
          }

          if (!status.done) {
            await step.run(`provider-timeout-${data.stageKey}-${iteration}`, () =>
              runner.recordProviderTimeout(stage, attemptCtx, handle),
            );
            if (isLastAttempt) {
              await step.run(`fail-stage-${data.stageKey}`, () =>
                runner.failStageExecution(data.stageExecutionId, 'provider_timeout'),
              );
              return { outcome: 'failed' as const, reason: 'provider_timeout' };
            }
            continue;
          }

          if (status.outcome === 'failed') {
            // §11.3 — a confirmed non-billing failure: release, not spend.
            await step.run(`settle-failed-poll-${data.stageKey}-${iteration}`, () =>
              runner.settleFailedPoll(attemptCtx),
            );
            throw new Error(status.reason);
          }

          const fetched = await step.run(`fetch-${data.stageKey}-${iteration}`, () =>
            runner.fetchAndFinalize(stage, attemptCtx, handle, prevStageKey, effective),
          );

          if (fetched.outcome === 'success') {
            return { outcome: 'passed' as const, artifactId: fetched.artifactId };
          }

          if (fetched.outcome === 'approval_required') {
            return {
              outcome: 'approval_required' as const,
              artifactId: fetched.artifactId,
            };
          }

          if (fetched.outcome === 'run_not_running') {
            return { outcome: 'run_not_running' as const };
          }

          if (fetched.outcome === 'qc_error') {
            await step.run(`fail-stage-${data.stageKey}`, () =>
              runner.failStageExecution(data.stageExecutionId, fetched.reason),
            );
            return { outcome: 'failed' as const, reason: fetched.reason };
          }

          if (fetched.outcome === 'qc_budget_exhausted') {
            await step.run(`fail-stage-${data.stageKey}`, () =>
              runner.failStageExecution(data.stageExecutionId, 'qc_budget_exhausted'),
            );
            return { outcome: 'failed' as const, reason: 'qc_budget_exhausted' };
          }

          // check_failed | qc_failed — semantic, consumes a retry.
          if (isLastAttempt) {
            const reason =
              fetched.outcome === 'check_failed'
                ? 'check_failed'
                : `qc_failed: ${fetched.qcVerdict.critique}`;
            await step.run(`fail-stage-${data.stageKey}`, () =>
              runner.failStageExecution(data.stageExecutionId, reason),
            );
            return { outcome: 'failed' as const, reason };
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (isLastAttempt) {
            await step.run(`record-failure-${data.stageKey}`, () =>
              runner.recordFailure(attemptCtx, reason),
            );
            return { outcome: 'failed' as const, reason };
          }
          // Not the last attempt: mark THIS attempt's row so it doesn't sit
          // at its provisional outcome forever, then loop to a fresh
          // attempt — the stage_execution itself isn't failed yet.
          await step.run(`record-attempt-error-${data.stageKey}-${iteration}`, () =>
            runner.recordAttemptError(attemptCtx, reason),
          );
        }
      }
    },
  );
}
