import { vi } from 'vitest';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import type { QcOutcome } from '../../src/qc/qc-runner.service';

export function mockQcOutcomes(runner: StageRunnerService, ...outcomes: QcOutcome[]) {
  let fallback = outcomes.at(-1)!;
  const queued = [...outcomes];
  const fetchResults: QcOutcome[] = [];
  const submit = vi.spyOn(runner, 'submitQc').mockImplementation(async () => {
    const outcome = queued.shift() ?? fallback;
    if (outcome.status === 'error') return outcome;
    fetchResults.push(outcome);
    return { handle: { providerId: 'fake', externalId: `qc-test-${fetchResults.length}` } };
  });
  vi.spyOn(runner, 'pollQc').mockResolvedValue({ done: true, outcome: 'succeeded' });
  vi.spyOn(runner, 'fetchQc').mockImplementation(async () => {
    const outcome = fetchResults.shift();
    if (!outcome) throw new Error('No mocked QC verdict is queued');
    return outcome;
  });

  return {
    submit,
    setFallback(outcome: QcOutcome) {
      fallback = outcome;
    },
    queue(...next: QcOutcome[]) {
      queued.push(...next);
    },
  };
}
