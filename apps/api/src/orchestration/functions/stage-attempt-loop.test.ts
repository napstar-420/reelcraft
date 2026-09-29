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
      countSemanticAttemptsUsed: vi.fn().mockResolvedValue(0),
      countInfraAttemptsUsed: vi.fn().mockResolvedValue(0),
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
