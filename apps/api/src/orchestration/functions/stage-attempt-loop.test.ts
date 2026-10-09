import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobStatus } from '@reelcraft/shared';
import { runStageAttemptLoop, withinProviderDeadline } from './stage-attempt-loop';

describe('withinProviderDeadline', () => {
  it('is false once the job is done', () => {
    const status: JobStatus = { done: true, outcome: 'succeeded' };
    expect(withinProviderDeadline(status)).toBe(false);
  });

  it('is false when the provider never reported a deadline', () => {
    const status: JobStatus = { done: false, phase: 'running' };
    expect(withinProviderDeadline(status)).toBe(false);
  });

  it('is true while the provider-declared deadline is still in the future', () => {
    const status: JobStatus = {
      done: false,
      phase: 'running',
      deadlineMs: Date.now() + 60_000,
    };
    expect(withinProviderDeadline(status)).toBe(true);
  });

  it('is false once the provider-declared deadline has passed', () => {
    const status: JobStatus = {
      done: false,
      phase: 'running',
      deadlineMs: Date.now() - 1,
    };
    expect(withinProviderDeadline(status)).toBe(false);
  });
});

describe('runStageAttemptLoop user_action failures', () => {
  it('fails the stage once with the provider message, without spending retries', async () => {
    const reason = 'Sign in to ChatGPT to continue';
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValue(undefined),
      beginAttempt: vi.fn().mockResolvedValue({ attemptNo: 1 }),
      countRoundAttempts: vi.fn().mockResolvedValue(0),
      reserveAndSubmit: vi.fn().mockResolvedValue({
        outcome: 'submitted',
        handle: { providerId: 'chatgpt', externalId: 'x' },
      }),
      pollOnce: vi.fn().mockResolvedValue({
        done: true,
        outcome: 'failed',
        reason,
        retryable: false,
        failureClass: 'user_action',
      }),
      settleFailedPoll: vi.fn(),
      stopIfRunNotRunning: vi.fn().mockResolvedValue(false),
      failStageExecution: vi.fn(),
      recordAttemptError: vi.fn(),
    };
    const step = { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() };

    const result = await runStageAttemptLoop({
      step: step as never,
      logger: { warn: vi.fn() } as never,
      runner: runner as never,
      stage: {} as never,
      effective: { polling: { maxWaitSec: 60 } } as never,
      prevStageKey: undefined,
      runId: 'run',
      stageExecutionId: 'exec',
      stageKey: 'draft',
      retryLimit: 3,
    });

    expect(result).toEqual({ outcome: 'failed', reason });
    expect(runner.reserveAndSubmit).toHaveBeenCalledTimes(1);
    expect(runner.failStageExecution).toHaveBeenCalledWith('exec', reason, undefined);
    expect(runner.recordAttemptError).not.toHaveBeenCalled();
  });
});

describe('runStageAttemptLoop abandoned jobs', () => {
  const handle = (externalId: string) => ({ providerId: 'chatgpt', externalId });

  function runner(over: Record<string, unknown> = {}) {
    return {
      findHeldQcAttempt: vi.fn().mockResolvedValue(undefined),
      beginAttempt: vi.fn().mockResolvedValue({ attemptNo: 1 }),
      countRoundAttempts: vi.fn().mockResolvedValue(0),
      reserveAndSubmit: vi
        .fn()
        .mockResolvedValueOnce({ outcome: 'submitted', handle: handle('first') })
        .mockResolvedValue({ outcome: 'submitted', handle: handle('second') }),
      pollOnce: vi.fn().mockResolvedValue({ done: true, outcome: 'succeeded' }),
      fetchAndFinalize: vi.fn().mockResolvedValue({ outcome: 'success', artifactId: 'a1' }),
      cancelJob: vi.fn().mockResolvedValue(undefined),
      recordAttemptError: vi.fn(),
      recordFailure: vi.fn(),
      ...over,
    };
  }

  function loop(r: object, retryLimit: number) {
    const warn = vi.fn();
    const result = runStageAttemptLoop({
      step: { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() } as never,
      logger: { warn } as never,
      runner: r as never,
      stage: { checks: [] } as never,
      effective: { polling: { maxWaitSec: 60 } } as never,
      prevStageKey: undefined,
      runId: 'run',
      stageExecutionId: 'exec',
      stageKey: 'draft',
      retryLimit,
    });
    return { result, warn };
  }

  it('cancels the job of an attempt whose fetch threw, before recording the error, then retries', async () => {
    const r = runner({
      fetchAndFinalize: vi
        .fn()
        .mockRejectedValueOnce(new Error('run exceeded 30000ms'))
        .mockResolvedValue({ outcome: 'success', artifactId: 'a1' }),
    });
    const { result } = loop(r, 3);

    await expect(result).resolves.toEqual({ outcome: 'passed', artifactId: 'a1' });
    expect(r.cancelJob).toHaveBeenCalledTimes(1);
    expect(r.cancelJob).toHaveBeenCalledWith(expect.anything(), handle('first'));
    expect(r.cancelJob.mock.invocationCallOrder[0]).toBeLessThan(
      r.recordAttemptError.mock.invocationCallOrder[0]!,
    );
    expect(r.recordAttemptError).toHaveBeenCalledWith(expect.anything(), 'run exceeded 30000ms');
  });

  it('cancels the job, then records the failure, when the last attempt threw', async () => {
    const r = runner({ fetchAndFinalize: vi.fn().mockRejectedValue(new Error('boom')) });
    const { result } = loop(r, 0);

    await expect(result).resolves.toEqual({ outcome: 'failed', reason: 'boom' });
    expect(r.cancelJob).toHaveBeenCalledTimes(1);
    expect(r.cancelJob.mock.invocationCallOrder[0]).toBeLessThan(
      r.recordFailure.mock.invocationCallOrder[0]!,
    );
  });

  it('does not cancel when the submit itself threw', async () => {
    const r = runner({ reserveAndSubmit: vi.fn().mockRejectedValue(new Error('no tab')) });
    const { result } = loop(r, 0);

    await expect(result).resolves.toEqual({ outcome: 'failed', reason: 'no tab' });
    expect(r.cancelJob).not.toHaveBeenCalled();
  });

  it('does not cancel a job its provider already reported as failed', async () => {
    const r = runner({
      pollOnce: vi.fn().mockResolvedValue({
        done: true,
        outcome: 'failed',
        reason: 'ChatGPT reported an error',
        retryable: true,
        failureClass: 'provider',
      }),
      settleFailedPoll: vi.fn(),
      stopIfRunNotRunning: vi.fn().mockResolvedValue(false),
    });
    const { result } = loop(r, 0);

    await expect(result).resolves.toEqual({
      outcome: 'failed',
      reason: 'ChatGPT reported an error',
    });
    expect(r.cancelJob).not.toHaveBeenCalled();
  });

  it('keeps going when the cleanup itself fails', async () => {
    const r = runner({
      fetchAndFinalize: vi.fn().mockRejectedValue(new Error('boom')),
      cancelJob: vi.fn().mockRejectedValue(new Error('neo is down')),
    });
    const { result, warn } = loop(r, 0);

    await expect(result).resolves.toEqual({ outcome: 'failed', reason: 'boom' });
    expect(r.recordFailure).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'abandoned job cleanup failed',
    );
  });
});

describe('runStageAttemptLoop feedback retries', () => {
  /** A runner whose every fetch ends in `outcome`; `countRoundAttempts`
   * counts from the attempts recorded so far, like the real DB query. */
  function feedbackRunner(outcome: 'qc_failed' | 'check_failed') {
    const recorded: string[] = [];
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValue(undefined),
      beginAttempt: vi.fn(async () => ({ attemptNo: recorded.length + 1 })),
      countRoundAttempts: vi.fn(
        async (_exec: string, outcomes: string[]) =>
          recorded.filter((o) => outcomes.includes(o)).length,
      ),
      reserveAndSubmit: vi.fn().mockResolvedValue({
        outcome: 'submitted',
        handle: { providerId: 'fake', externalId: 'x' },
      }),
      pollOnce: vi.fn().mockResolvedValue({ done: true, outcome: 'succeeded' }),
      fetchAndFinalize: vi.fn(async () => {
        recorded.push(outcome);
        return outcome === 'qc_failed'
          ? {
              outcome,
              checkResults: [],
              qcVerdict: { score: 10, critique: 'Too generic.' },
            }
          : {
              outcome,
              checkResults: [{ name: 'word_count', kind: 'builtin', pass: false }],
            };
      }),
      handOffForReview: vi.fn().mockResolvedValue({
        outcome: 'approval_required',
        artifactId: 'artifact-last',
      }),
      failStageExecution: vi.fn(),
    };
    return runner;
  }

  function loop(runner: object, stage: object) {
    return runStageAttemptLoop({
      step: { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      runner: runner as never,
      stage: { checks: [], ...stage } as never,
      effective: { polling: { maxWaitSec: 60 } } as never,
      prevStageKey: undefined,
      runId: 'run',
      stageExecutionId: 'exec',
      stageKey: 'draft',
      retryLimit: 0, // crashes only — must not cap the QC/check loop
    });
  }

  it('regenerates on QC failure without spending retryLimit, failing once qc.maxAttempts is spent', async () => {
    const runner = feedbackRunner('qc_failed');
    const result = await loop(runner, { qc: { maxAttempts: 2 } });

    expect(runner.reserveAndSubmit).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      outcome: 'failed',
      reason: 'qc_failed after 2 attempts: Too generic.',
    });
    expect(runner.handOffForReview).not.toHaveBeenCalled();
  });

  it("hands the last output to a human when qc.onExhausted is 'human_review'", async () => {
    const runner = feedbackRunner('qc_failed');
    const result = await loop(runner, { qc: { maxAttempts: 2, onExhausted: 'human_review' } });

    expect(runner.reserveAndSubmit).toHaveBeenCalledTimes(2);
    expect(runner.handOffForReview).toHaveBeenCalledTimes(1);
    expect(runner.failStageExecution).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'approval_required', artifactId: 'artifact-last' });
  });

  it('caps failed checks by checkMaxAttempts, defaulting to 3', async () => {
    const defaulted = feedbackRunner('check_failed');
    const result = await loop(defaulted, {});
    expect(defaulted.reserveAndSubmit).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      outcome: 'failed',
      reason: 'check_failed after 3 attempts: word_count',
    });

    const capped = feedbackRunner('check_failed');
    await loop(capped, { checkMaxAttempts: 1 });
    expect(capped.reserveAndSubmit).toHaveBeenCalledTimes(1);
  });
});

/**
 * Runs `body` the way Inngest does: the whole function is re-run from the top
 * every time a new step completes, finished steps answer from their saved
 * result, and a step seen for the first time ends the pass. `onNewStep` can
 * move the clock between passes, as real time passes between replays.
 */
async function replay<T>(
  body: (step: unknown) => Promise<T>,
  onNewStep: (id: string) => void,
): Promise<T> {
  const memo = new Map<string, unknown>();
  for (;;) {
    let interrupt!: () => void;
    const interrupted = new Promise<'interrupted'>(
      (resolve) => (interrupt = () => resolve('interrupted')),
    );
    const record = (id: string, value: unknown) => {
      memo.set(id, JSON.parse(JSON.stringify(value ?? null)));
      onNewStep(id);
      interrupt();
      return new Promise<never>(() => undefined); // like Inngest: the pass just stops
    };
    const step = {
      run: async (id: string, fn: () => Promise<unknown>) =>
        memo.has(id) ? memo.get(id) : record(id, await fn()),
      sleep: async (id: string) => (memo.has(id) ? undefined : record(id, true)),
    };
    const result = await Promise.race([body(step), interrupted]);
    if (result !== 'interrupted') return result;
  }
}

describe('runStageAttemptLoop replays', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not time out an earlier attempt when the clock passes its provider deadline', async () => {
    let now = Date.UTC(2026, 9, 5, 6, 17, 0);
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const DEADLINE = 15 * 60_000;

    let attempts = 0;
    const polls: Record<string, number> = {};
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValue(undefined),
      beginAttempt: vi.fn(async () => ({ attemptNo: ++attempts })),
      countRoundAttempts: vi.fn().mockResolvedValue(0),
      infraAttemptLimit: () => 3,
      reserveAndSubmit: vi.fn(async () => ({
        outcome: 'submitted',
        handle: { providerId: 'chatgpt', externalId: `job-${attempts}`, submittedAt: now },
      })),
      // Each job reads as running (with its own 15 minute deadline) for a few
      // polls, then done.
      pollOnce: vi.fn(
        async (_stage: unknown, handle: { externalId: string; submittedAt: number }) => {
          polls[handle.externalId] = (polls[handle.externalId] ?? 0) + 1;
          return polls[handle.externalId]! <= 4
            ? { done: false, phase: 'running', deadlineMs: handle.submittedAt + DEADLINE }
            : { done: true, outcome: 'succeeded' };
        },
      ),
      fetchAndFinalize: vi.fn(async () =>
        attempts === 1
          ? { outcome: 'qc_failed', checkResults: [], qcVerdict: { score: 10, critique: 'No.' } }
          : { outcome: 'success', artifactId: 'artifact-2' },
      ),
      recordProviderTimeout: vi.fn(),
      recordProviderStall: vi.fn(),
      failStageExecution: vi.fn(),
      recordAttemptError: vi.fn(),
    };

    const result = await replay(
      (step) =>
        runStageAttemptLoop({
          step: step as never,
          logger: { warn: vi.fn() } as never,
          runner: runner as never,
          stage: { qc: { maxAttempts: 3 } } as never,
          effective: { polling: { maxWaitSec: 10 } } as never,
          prevStageKey: undefined,
          runId: 'run',
          stageExecutionId: 'exec',
          stageKey: 'draft',
          retryLimit: 0,
        }),
      (id) => {
        now += 1_000;
        // Attempt 1 ran for 9 minutes; attempt 2 is polling when attempt 1's
        // 15 minutes run out, still well inside its own.
        if (id === 'begin-attempt-2') now += 9 * 60_000;
        if (id === 'poll-draft-2-1') now += 7 * 60_000;
      },
    );

    expect(result).toEqual({ outcome: 'passed', artifactId: 'artifact-2' });
    expect(runner.recordProviderTimeout).not.toHaveBeenCalled();
    expect(runner.recordProviderStall).not.toHaveBeenCalled();
    expect(runner.failStageExecution).not.toHaveBeenCalled();
  });

  it('retries a stalled self-timed job as an infrastructure error, not a failed stage', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let attempts = 0;
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValue(undefined),
      beginAttempt: vi.fn(async () => ({ attemptNo: ++attempts })),
      countRoundAttempts: vi.fn().mockResolvedValue(0),
      infraAttemptLimit: () => 3,
      reserveAndSubmit: vi.fn(async () => ({
        outcome: 'submitted',
        handle: { providerId: 'chatgpt', externalId: `job-${attempts}` },
      })),
      // Attempt 1 never finishes (its deadline passes); attempt 2 is done at once.
      pollOnce: vi.fn(async () =>
        attempts === 1
          ? { done: false, phase: 'running', deadlineMs: 1_000_000 + 60_000 }
          : { done: true, outcome: 'succeeded' },
      ),
      fetchAndFinalize: vi.fn(async () => ({ outcome: 'success', artifactId: 'a' })),
      recordProviderTimeout: vi.fn(),
      recordProviderStall: vi.fn(),
      failStageExecution: vi.fn(),
    };
    const result = await replay(
      (step) =>
        runStageAttemptLoop({
          step: step as never,
          logger: { warn: vi.fn() } as never,
          runner: runner as never,
          stage: {} as never,
          effective: { polling: { maxWaitSec: 10 } } as never,
          prevStageKey: undefined,
          runId: 'run',
          stageExecutionId: 'exec',
          stageKey: 'draft',
          retryLimit: 0,
        }),
      () => {
        now += 30_000;
      },
    );
    expect(result).toEqual({ outcome: 'passed', artifactId: 'a' });
    expect(runner.recordProviderStall).toHaveBeenCalledTimes(1);
    expect(runner.recordProviderTimeout).not.toHaveBeenCalled();
    expect(runner.failStageExecution).not.toHaveBeenCalled();
  });

  it('still times a provider without its own deadline out, spending a retry', async () => {
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValue(undefined),
      beginAttempt: vi.fn().mockResolvedValue({ attemptNo: 1 }),
      countRoundAttempts: vi.fn().mockResolvedValue(0),
      infraAttemptLimit: () => 3,
      reserveAndSubmit: vi.fn().mockResolvedValue({
        outcome: 'submitted',
        handle: { providerId: 'fal', externalId: 'x' },
      }),
      pollOnce: vi.fn().mockResolvedValue({ done: false, phase: 'running' }),
      recordProviderTimeout: vi.fn(),
      recordProviderStall: vi.fn(),
      failStageExecution: vi.fn(),
    };
    const result = await runStageAttemptLoop({
      step: { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      runner: runner as never,
      stage: {} as never,
      effective: { polling: { maxWaitSec: 10 } } as never,
      prevStageKey: undefined,
      runId: 'run',
      stageExecutionId: 'exec',
      stageKey: 'draft',
      retryLimit: 0,
    });
    expect(result).toEqual({ outcome: 'failed', reason: 'provider_timeout' });
    expect(runner.recordProviderTimeout).toHaveBeenCalledTimes(1);
    expect(runner.recordProviderStall).not.toHaveBeenCalled();
  });
});

describe('runStageAttemptLoop Retry QC', () => {
  const held = { attemptNo: 1, stageAttemptId: 'attempt-1' };
  const run = (runner: object) =>
    runStageAttemptLoop({
      step: { run: (_id: string, fn: () => unknown) => fn(), sleep: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      runner: runner as never,
      stage: { qc: { maxAttempts: 3 } } as never,
      effective: { polling: { maxWaitSec: 10 } } as never,
      prevStageKey: undefined,
      runId: 'run',
      stageExecutionId: 'exec',
      stageKey: 'draft',
      retryLimit: 0,
    });

  it('judges the held output again without generating or spending an attempt', async () => {
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValue(held),
      retryHeldQc: vi.fn().mockResolvedValue({ outcome: 'success', artifactId: 'a1' }),
      beginAttempt: vi.fn(),
      reserveAndSubmit: vi.fn(),
    };
    await expect(run(runner)).resolves.toEqual({ outcome: 'passed', artifactId: 'a1' });
    expect(runner.retryHeldQc).toHaveBeenCalledWith(
      expect.anything(),
      held,
      undefined,
      expect.anything(),
    );
    expect(runner.beginAttempt).not.toHaveBeenCalled();
    expect(runner.reserveAndSubmit).not.toHaveBeenCalled();
  });

  it('pauses again when QC still cannot run', async () => {
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValue(held),
      retryHeldQc: vi.fn().mockResolvedValue({ outcome: 'approval_required', artifactId: 'a1' }),
      beginAttempt: vi.fn(),
    };
    await expect(run(runner)).resolves.toEqual({ outcome: 'approval_required', artifactId: 'a1' });
  });

  it('regenerates when the retried QC rejects the output', async () => {
    let regenerated = 0;
    const runner = {
      findHeldQcAttempt: vi.fn().mockResolvedValueOnce(held).mockResolvedValue(undefined),
      retryHeldQc: vi.fn().mockResolvedValue({
        outcome: 'qc_failed',
        checkResults: [],
        qcVerdict: { score: 10, critique: 'Too generic.' },
      }),
      countRoundAttempts: vi.fn().mockResolvedValueOnce(1).mockResolvedValue(0),
      infraAttemptLimit: () => 3,
      beginAttempt: vi.fn(async () => ({ attemptNo: 2, stageAttemptId: 'attempt-2' })),
      reserveAndSubmit: vi.fn(async () => {
        regenerated += 1;
        return { outcome: 'submitted', handle: { providerId: 'fake', externalId: 'x' } };
      }),
      pollOnce: vi.fn().mockResolvedValue({ done: true, outcome: 'succeeded' }),
      fetchAndFinalize: vi.fn().mockResolvedValue({ outcome: 'success', artifactId: 'a2' }),
      failStageExecution: vi.fn(),
    };
    await expect(run(runner)).resolves.toEqual({ outcome: 'passed', artifactId: 'a2' });
    expect(regenerated).toBe(1);
  });
});
