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

describe('runStageAttemptLoop feedback retries', () => {
  /** A runner whose every fetch ends in `outcome`; `countRoundAttempts`
   * counts from the attempts recorded so far, like the real DB query. */
  function feedbackRunner(outcome: 'qc_failed' | 'check_failed') {
    const recorded: string[] = [];
    const runner = {
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
    let polls: Record<string, number> = {};
    const runner = {
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
