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
        affectedItems: [
          { stageKey: 'draft', stageExecutionId: 'execution-draft', artifactId: 'artifact-draft' },
          {
            stageKey: 'render',
            stageExecutionId: 'execution-render',
            artifactId: 'artifact-render',
          },
        ],
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

// phase 7 MEDIUM finding #3 (PR #17 review) — `resolveRetrySeed`'s own
// resolution/validation logic, exercised directly (it's private, so we cast
// to reach it — the same "construct a real instance, poke at its methods"
// approach `previewStageRetry`'s own coverage above already uses through the
// public surface). A DB-backed `select().from()...limit()`/`.innerJoin()`/
// `.orderBy()` chain mock feeds each call in sequence.
const nonIteratingStage = {
  key: 'draft',
  label: 'Draft',
  capability: 'llm.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
  retryLimit: 0,
};

const iteratingStage = {
  key: 'broll',
  label: 'B-roll',
  capability: 'llm.generate',
  config: {},
  slots: {},
  context: {},
  iterate: { over: { from: 'prev' }, itemAlias: 'shot', itemRetryLimit: 0 },
  output: { kind: 'text' },
  checks: [],
  retryLimit: 0,
};

function sequencedDb(resultsByCall: unknown[][]) {
  let call = 0;
  const select = vi.fn(() => {
    const result = resultsByCall[call] ?? [];
    call += 1;
    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn().mockResolvedValue(result),
    };
    return chain;
  });
  return { select };
}

function serviceWithDb(resultsByCall: unknown[][]) {
  const db = sequencedDb(resultsByCall);
  const invalidation = { preview: vi.fn(), apply: vi.fn() };
  const tokens = { issue: vi.fn(), verify: vi.fn() };
  const mutation = { withLockedRun: vi.fn() };
  const dispatcher = { dispatch: vi.fn() };
  const service = new RunActionService(
    db as never,
    invalidation as never,
    tokens as never,
    mutation as never,
    dispatcher as never,
  );
  const resolveRetrySeed = (
    service as unknown as {
      resolveRetrySeed: (
        runId: string,
        stageKey: string,
        itemIndex: number | undefined,
      ) => Promise<unknown>;
    }
  ).resolveRetrySeed.bind(service);
  return { resolveRetrySeed };
}

describe('RunActionService.resolveRetrySeed (item-scoped retry seed)', () => {
  it('builds an item-scoped seed for an iterating stage whose item is in a retryable state', async () => {
    const { resolveRetrySeed } = serviceWithDb([
      [{ graph: [iteratingStage] }], // graph load
      [{ id: 'execution-broll' }], // stage_execution lookup
      [{ state: 'failed' }], // stage_item lookup
    ]);

    await expect(resolveRetrySeed('run-1', 'broll', 2)).resolves.toEqual({
      items: [{ stageKey: 'broll', itemIndex: 2 }],
    });
  });

  it('returns the unscoped whole-stage seed when itemIndex is omitted, touching the DB not at all', async () => {
    const { resolveRetrySeed } = serviceWithDb([]);
    await expect(resolveRetrySeed('run-1', 'draft', undefined)).resolves.toEqual({
      stageKeys: ['draft'],
    });
  });

  it('throws when itemIndex is given for a stage that does not declare iterate', async () => {
    const { resolveRetrySeed } = serviceWithDb([[{ graph: [nonIteratingStage] }]]);
    await expect(resolveRetrySeed('run-1', 'draft', 0)).rejects.toThrow(/does not iterate/);
  });

  it("throws 'not found' when the item index doesn't exist on the iterating stage", async () => {
    const { resolveRetrySeed } = serviceWithDb([
      [{ graph: [iteratingStage] }],
      [{ id: 'execution-broll' }],
      [], // no stage_item row at that index
    ]);
    await expect(resolveRetrySeed('run-1', 'broll', 9)).rejects.toThrow(
      /Retry target item 9 of broll not found/,
    );
  });

  it.each(['pending', 'running', 'awaiting_approval'] as const)(
    "throws when the target item's state is '%s'",
    async (state) => {
      const { resolveRetrySeed } = serviceWithDb([
        [{ graph: [iteratingStage] }],
        [{ id: 'execution-broll' }],
        [{ state }],
      ]);
      await expect(resolveRetrySeed('run-1', 'broll', 0)).rejects.toThrow(/cannot be retried yet/);
    },
  );
});
