import type { Inngest } from 'inngest';
import type { StageRunnerService } from '../stage-runner.service';

export interface StageExecuteEventData {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
}

/**
 * §13.1/§13.3 — one stage attempt loop. Steps return IDs only (§13.2 Rule
 * 1): `reserveAndSubmit` returns a JobHandle (small, serializable, not a
 * workspace path), `poll` returns status, `fetchAndFinalize` returns an
 * artifact id. Transport retry (Inngest's own `retries`) is separate from
 * the semantic retry loop below (§13.2 Rule 2) — the `for` loop over
 * attempts is what increments `attempt_no`, not Inngest's step retries.
 */
export function buildStageExecuteFunction(client: Inngest, runner: StageRunnerService) {
  return client.createFunction(
    { id: 'stage.execute', retries: 0 },
    { event: 'stage/execute.requested' },
    async ({ event, step }) => {
      const data = event.data as StageExecuteEventData;
      const stage = await step.run('load-stage-def', () => runner.loadStageDef(data.runId, data.stageKey));

      const maxAttempts = stage.retryLimit + 1;
      for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
        const attemptCtx = await step.run(`begin-attempt-${attemptNo}`, () =>
          runner.beginAttempt({
            runId: data.runId,
            stageExecutionId: data.stageExecutionId,
            stageKey: data.stageKey,
            attemptNo,
          }),
        );

        try {
          const handle = await step.run(`submit-${data.stageKey}-${attemptNo}`, () =>
            runner.reserveAndSubmit(stage, attemptCtx, {}),
          );

          let status = await step.run(`poll-${data.stageKey}-${attemptNo}-0`, () =>
            runner.pollOnce(stage, handle),
          );
          let pollCount = 0;
          while (!status.done && pollCount < 30) {
            pollCount += 1;
            await step.sleep(`poll-wait-${data.stageKey}-${attemptNo}-${pollCount}`, '2s');
            status = await step.run(`poll-${data.stageKey}-${attemptNo}-${pollCount}`, () =>
              runner.pollOnce(stage, handle),
            );
          }

          if (status.done && status.outcome === 'failed') {
            throw new Error(status.reason);
          }

          const { artifactId } = await step.run(`fetch-${data.stageKey}-${attemptNo}`, () =>
            runner.fetchAndFinalize(stage, attemptCtx, handle),
          );

          return { outcome: 'passed' as const, artifactId };
        } catch (err) {
          const isLastAttempt = attemptNo === maxAttempts;
          if (isLastAttempt) {
            await step.run(`record-failure-${data.stageKey}`, () =>
              runner.recordFailure(attemptCtx, err instanceof Error ? err.message : String(err)),
            );
            return { outcome: 'failed' as const, reason: err instanceof Error ? err.message : String(err) };
          }
        }
      }

      throw new Error('stage.execute: unreachable');
    },
  );
}
