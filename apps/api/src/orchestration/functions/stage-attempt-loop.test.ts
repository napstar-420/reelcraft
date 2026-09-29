import { describe, expect, it, vi } from 'vitest';
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
