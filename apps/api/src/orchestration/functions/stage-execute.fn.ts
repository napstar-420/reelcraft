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
 * 1): `reserveAndSubmit` returns a JobHandle (small, serializable, not a
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
        const isLastAttempt = attemptCtx.attemptNo >= stage.retryLimit + 1;

        try {
          const handle = await step.run(`submit-${data.stageKey}-${iteration}`, () =>
            runner.reserveAndSubmit(stage, attemptCtx, prevStageKey, effective),
          );

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
            throw new Error(status.reason);
          }

          const fetched = await step.run(`fetch-${data.stageKey}-${iteration}`, () =>
            runner.fetchAndFinalize(stage, attemptCtx, handle, prevStageKey, effective),
          );

          if (fetched.outcome === 'success') {
            return { outcome: 'passed' as const, artifactId: fetched.artifactId };
          }

          if (fetched.outcome === 'qc_error') {
            await step.run(`fail-stage-${data.stageKey}`, () =>
              runner.failStageExecution(data.stageExecutionId, fetched.reason),
            );
            return { outcome: 'failed' as const, reason: fetched.reason };
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
          if (isLastAttempt) {
            await step.run(`record-failure-${data.stageKey}`, () =>
              runner.recordFailure(attemptCtx, err instanceof Error ? err.message : String(err)),
            );
            return {
              outcome: 'failed' as const,
              reason: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }
    },
  );
}
