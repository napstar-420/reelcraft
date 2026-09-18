import { describe, expect, it, vi } from 'vitest';
import { RunActionService } from './run-action.service';

function setup() {
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ revision: 4 }]) }),
      }),
    }),
  };
  const invalidation = {
    preview: vi.fn().mockResolvedValue({
      closure: {
        affectedStageKeys: ['draft', 'render'],
        affectedExecutionIds: ['execution-draft', 'execution-render'],
        affectedArtifactIds: ['artifact-draft', 'artifact-render'],
      },
      costs: [
        {
          artifactId: 'artifact-draft',
          stageKey: 'draft',
          spentUsd: 1,
          estimatedRerunUsd: 2,
        },
      ],
      totals: { spentUsd: 1, estimatedRerunUsd: 2 },
      fingerprint: 'fingerprint-1',
    }),
    apply: vi.fn().mockResolvedValue(undefined),
  };
  const tokens = {
    issue: vi.fn().mockReturnValue({ token: 'signed', expiresAt: 'soon' }),
    verify: vi.fn().mockReturnValue({
      runRevision: 4,
      preview: { fingerprint: 'fingerprint-1' },
    }),
  };
  const tx = {};
  const mutation = {
    withLockedRun: vi.fn(async (_id, _action, _states, callback) => {
      await callback(tx, { revision: 4 });
      return { wakeupId: 'wakeup-1', revision: 5 };
    }),
  };
  const dispatcher = { dispatch: vi.fn().mockResolvedValue(true) };
  const service = new RunActionService(
    db as never,
    invalidation as never,
    tokens as never,
    mutation as never,
    dispatcher as never,
  );
  return { service, invalidation, tokens, mutation, dispatcher, tx };
}

describe('RunActionService stage retry', () => {
  it('binds a preview to the current run revision and exact stage payload', async () => {
    const { service, tokens } = setup();
    const result = await service.previewStageRetry('run-1', 'draft');

    expect(tokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'retry',
        runId: 'run-1',
        runRevision: 4,
        proposedPayload: { stageKey: 'draft' },
      }),
    );
    expect(result.previewToken).toBe('signed');
  });

  it('recomputes the closure under the revision precondition before applying and waking', async () => {
    const { service, invalidation, mutation, dispatcher, tx } = setup();
    await service.confirmStageRetry('run-1', 'draft', 'signed');

    expect(mutation.withLockedRun).toHaveBeenCalledWith(
      'run-1',
      'retry',
      ['PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'FAILED', 'COMPLETED'],
      expect.any(Function),
      'run/resumed',
    );
    expect(invalidation.apply).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ runId: 'run-1', targetStageKey: 'draft' }),
    );
    expect(dispatcher.dispatch).toHaveBeenCalledWith('wakeup-1');
  });
});
