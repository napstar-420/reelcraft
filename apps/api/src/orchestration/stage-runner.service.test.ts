import type { StageDef } from '@reelcraft/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EffectiveStageConfig } from '../run-config/config-resolver.service';
import { StageRunnerService, type StageAttemptContext } from './stage-runner.service';
import { ProviderContinuationUnavailableError } from '../provider/provider-adapter.interface';

describe('StageRunnerService continuation submission', () => {
  it('uses latest feedback, audits the revision turn, and falls back to the full prompt before send', async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const submit = vi.fn().mockResolvedValue({
      providerId: 'chatgpt',
      externalId: 'new',
      payload: { pageId: 8, retained: true },
    });
    const service = Object.assign(Object.create(StageRunnerService.prototype) as object, {
      db: {
        update: () => ({
          set: (value: Record<string, unknown>) => {
            persisted.push(value);
            return { where: async () => undefined };
          },
        }),
      },
      capabilities: {
        get: () => ({
          modality: 'text',
          supportsContinuation: () => true,
          estimateCost: async () => ({
            expectedUsd: 0,
            ceilingUsd: 0,
            basis: 'configured_ceiling',
          }),
          submit,
        }),
      },
      ledger: {
        reserve: async () => ({ ok: true, reservationId: 'reserve' }),
        markSubmitted: async () => undefined,
      },
      engineConfig: { preSubmitTtlSec: 60, fetchAllowanceSec: 10 },
      events: { record: async () => undefined },
      timelineResources: { resolve: vi.fn() },
    }) as unknown as StageRunnerService;
    vi.spyOn(service as never, 'resolveBindings').mockResolvedValue({
      slots: {},
      context: {},
      provenance: {},
    });
    vi.spyOn(service, 'loadCritiqueLog').mockResolvedValue('Earlier feedback.\nLatest feedback.');
    const source = {
      handle: { providerId: 'chatgpt', externalId: 'old', payload: { pageId: 7, retained: true } },
      attemptNo: 1,
      feedback: 'Latest feedback.',
    };
    vi.spyOn(service as never, 'findContinuationSource').mockResolvedValue(source);
    const stage = {
      key: 'draft',
      capability: 'text.generate',
      instructions: { template: 'Original {{ priorCritique }}' },
      output: { kind: 'text' },
      checks: [{ type: 'regex', pattern: 'x' }],
    } as never;
    const ctx = {
      runId: 'run',
      stageExecutionId: 'execution',
      stageKey: 'draft',
      attemptNo: 2,
      stageAttemptId: 'attempt',
    } as StageAttemptContext;
    const effective = {
      layer: {},
      capabilityConfig: {},
      model: { provider: 'chatgpt', modelId: 'chatgpt' },
      polling: { maxWaitSec: 60 },
    } as never;
    await service.reserveAndSubmit(stage, ctx, undefined, effective);
    expect(submit.mock.calls[0]?.[0].continuation).toMatchObject({
      previousHandle: source.handle,
      revisionPrompt: expect.stringContaining('Latest feedback.'),
    });
    expect(submit.mock.calls[0]?.[0].continuation.revisionPrompt).not.toContain(
      'Earlier feedback.',
    );
    expect(persisted.at(-1)?.renderedPrompt).toBe(
      submit.mock.calls[0]?.[0].continuation.revisionPrompt,
    );

    submit.mockRejectedValueOnce(new ProviderContinuationUnavailableError('tab gone'));
    await service.reserveAndSubmit(
      stage,
      { ...ctx, stageAttemptId: 'fallback' },
      undefined,
      effective,
    );
    expect(submit.mock.calls.at(-1)?.[0].continuation).toEqual({ retain: true });
    expect(persisted.at(-1)?.renderedPrompt).toContain('Earlier feedback.');
  });
});

describe('StageRunnerService output-instruction prompt delivery', () => {
  it('estimates, submits, and persists the same composed prompt', async () => {
    const estimateCost = vi.fn().mockResolvedValue({
      expectedUsd: 0.01,
      ceilingUsd: 0.02,
      basis: 'token_estimate',
    });
    const submit = vi.fn().mockResolvedValue({ providerId: 'fake', externalId: 'job-1' });
    const record = vi.fn().mockResolvedValue(undefined);
    const persisted: Array<Record<string, unknown>> = [];
    const db = {
      update: vi.fn().mockReturnValue({
        set: vi.fn((value: Record<string, unknown>) => {
          persisted.push(value);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
    };
    const service = Object.assign(Object.create(StageRunnerService.prototype) as object, {
      db,
      capabilities: { get: vi.fn().mockReturnValue({ estimateCost, submit }) },
      ledger: {
        reserve: vi.fn().mockResolvedValue({ ok: true, reservationId: 'reservation-1' }),
        markSubmitted: vi.fn().mockResolvedValue(undefined),
      },
      engineConfig: { preSubmitTtlSec: 60, fetchAllowanceSec: 10 },
      timelineResources: { resolve: vi.fn() },
      events: { record },
    }) as unknown as StageRunnerService;
    vi.spyOn(service as never, 'resolveBindings').mockResolvedValue({
      slots: { topic: 'reefs' },
      context: {},
      provenance: {},
    });
    vi.spyOn(service as never, 'loadCritiqueLog').mockResolvedValue('Use a stronger ending.');

    const stage: StageDef = {
      key: 'draft',
      label: 'Draft',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      instructions: { template: 'Write about {{ topic }}.' },
      output: { kind: 'text', instructions: '{{ priorCritique }}' },
      checks: [],
      retryLimit: 0,
    };
    const ctx: StageAttemptContext = {
      runId: 'run-1',
      stageExecutionId: 'execution-1',
      stageKey: 'draft',
      attemptNo: 1,
      stageAttemptId: 'attempt-1',
    };
    const effective: EffectiveStageConfig = {
      layer: {},
      retryLimit: 0,
      polling: { intervalSec: 1, maxWaitSec: 30 },
      capabilityConfig: {},
    };

    await service.reserveAndSubmit(stage, ctx, undefined, effective);

    const estimatedContext = estimateCost.mock.calls[0]?.[0] as { renderedPrompt: string };
    const submittedContext = submit.mock.calls[0]?.[0] as { renderedPrompt: string };
    const persistedPrompt = persisted.find((value) => 'renderedPrompt' in value)?.renderedPrompt;
    expect(estimatedContext.renderedPrompt).toContain('Write about reefs.');
    expect(estimatedContext.renderedPrompt).toContain('Use a stronger ending.');
    expect(submittedContext.renderedPrompt).toBe(estimatedContext.renderedPrompt);
    expect(persistedPrompt).toBe(estimatedContext.renderedPrompt);
    expect(record).toHaveBeenCalledWith(
      ctx,
      'info',
      'prompt.rendered',
      expect.any(String),
      expect.objectContaining({ prompt: estimatedContext.renderedPrompt }),
    );
  });
});

describe('StageRunnerService.beginAttempt', () => {
  it('flips stage_execution to running, clearing a leftover failure, on an attempt', async () => {
    const setCalls: Array<{ values: Record<string, unknown> }> = [];
    const db = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          setCalls.push({ values });
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ maxAttempt: 0 }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    };
    const service = Object.assign(Object.create(StageRunnerService.prototype) as object, {
      db,
      events: { record: vi.fn().mockResolvedValue(undefined) },
    }) as unknown as StageRunnerService;

    await service.beginAttempt({
      runId: 'run-1',
      stageExecutionId: 'execution-1',
      stageKey: 'draft',
    });

    expect(setCalls).toContainEqual({ values: { state: 'running', failure: null, endedAt: null } });
  });
});

describe('StageRunnerService.stopIfRunNotRunning', () => {
  function makeService(runState: string) {
    const persisted: Array<Record<string, unknown>> = [];
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ state: runState }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn((value: Record<string, unknown>) => {
          persisted.push(value);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
    };
    const service = Object.assign(Object.create(StageRunnerService.prototype) as object, {
      db,
    }) as unknown as StageRunnerService;
    return { service, persisted };
  }

  const ctx: StageAttemptContext = {
    runId: 'run-1',
    stageExecutionId: 'execution-1',
    stageKey: 'draft',
    attemptNo: 2,
    stageAttemptId: 'attempt-2',
  };

  it('leaves a still-running attempt alone', async () => {
    const { service, persisted } = makeService('RUNNING');
    await expect(service.stopIfRunNotRunning(ctx)).resolves.toBe(false);
    expect(persisted).toHaveLength(0);
  });

  it('marks the attempt cancelled once a cancel raced its own poll', async () => {
    const { service, persisted } = makeService('CANCELLED');
    await expect(service.stopIfRunNotRunning(ctx)).resolves.toBe(true);
    expect(persisted).toEqual([{ outcome: 'cancelled', phase: 'settled' }]);
  });
});

describe('StageRunnerService phase timings', () => {
  const ctx: StageAttemptContext = {
    runId: 'run-1',
    stageExecutionId: 'execution-1',
    stageKey: 'images',
    attemptNo: 1,
    stageAttemptId: 'attempt-1',
    itemIndex: 3,
  };
  const stage = { key: 'images', capability: 'image.generate' } as StageDef;
  const handle = { providerId: 'chatgpt', externalId: 'job-1' };

  function pollingService(status: object, createdAt: string | undefined) {
    const record = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(createdAt ? [{ createdAt }] : []),
          }),
        }),
      }),
    };
    const service = Object.assign(Object.create(StageRunnerService.prototype) as object, {
      db,
      capabilities: { get: vi.fn().mockReturnValue({ poll: vi.fn().mockResolvedValue(status) }) },
      events: { record },
      ledger: {},
      engineConfig: { fetchAllowanceSec: 10 },
    }) as unknown as StageRunnerService;
    return { service, record };
  }

  it('records when the provider first reported the job done, relative to the attempt starting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T12:02:30Z'));
    try {
      const { service, record } = pollingService(
        { done: true, outcome: 'succeeded' },
        '2026-10-12T12:00:00Z',
      );
      await service.pollOnce(stage, handle, ctx);
      expect(record).toHaveBeenCalledWith(
        ctx,
        'debug',
        'job.ready',
        'Provider reported done after 150s',
        { sinceAttemptStartMs: 150_000, outcome: 'succeeded' },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('records nothing for a poll that is still running, or without an attempt context', async () => {
    const running = pollingService({ done: false, phase: 'running' }, '2026-10-12T12:00:00Z');
    await running.service.pollOnce(stage, handle, ctx);
    expect(running.record).not.toHaveBeenCalled();

    const done = pollingService({ done: true, outcome: 'succeeded' }, '2026-10-12T12:00:00Z');
    await done.service.pollOnce(stage, handle);
    expect(done.record).not.toHaveBeenCalled();
  });

  it('records nothing when the attempt row is gone', async () => {
    const { service, record } = pollingService({ done: true, outcome: 'succeeded' }, undefined);
    await service.pollOnce(stage, handle, ctx);
    expect(record).not.toHaveBeenCalled();
  });

  it('records how long each QC call took', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const passed = { status: 'passed', verdict: { score: 90, critique: 'ok' }, costUsd: 0 };
    const service = Object.assign(Object.create(StageRunnerService.prototype) as object, {
      qc: { run: vi.fn().mockResolvedValue(passed) },
      events: { record },
      engineConfig: { qcErrorRetries: 0 },
    }) as unknown as StageRunnerService;

    await (
      service as unknown as { runQcWithRetries: (...args: unknown[]) => Promise<unknown> }
    ).runQcWithRetries(
      { criteria: 'good', includeInputs: false },
      { judge: { provider: 'fake', modelId: 'j', params: {} }, threshold: 70 },
      ctx,
      { kind: 'text', data: 'x' },
      { slots: {}, context: {} },
      undefined,
    );

    expect(record).toHaveBeenCalledWith(
      ctx,
      'info',
      'qc.result',
      'QC passed',
      expect.objectContaining({ status: 'passed', durationMs: expect.any(Number) }),
    );
  });
});
