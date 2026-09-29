import type { StageDef } from '@reelcraft/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EffectiveStageConfig } from '../run-config/config-resolver.service';
import { StageRunnerService, type StageAttemptContext } from './stage-runner.service';

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
  it('flips stage_execution to running, guarded to pending, on the first attempt', async () => {
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

    expect(setCalls).toContainEqual({ values: { state: 'running' } });
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
