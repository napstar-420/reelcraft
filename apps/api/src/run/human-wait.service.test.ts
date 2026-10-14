import { describe, expect, it, vi } from 'vitest';
import { HumanWaitService } from './human-wait.service';

describe('HumanWaitService', () => {
  it('opens an idempotent durable wait and resolves it once', async () => {
    const insert = vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() }) });
    const where = vi.fn();
    const set = vi.fn().mockReturnValue({ where });
    const tx = { insert, update: vi.fn().mockReturnValue({ set }) };
    const service = new HumanWaitService({} as never);

    await service.open(tx as never, {
      runId: 'run-1',
      stageExecutionId: 'execution-1',
      kind: 'approval',
    });
    await service.resolve(tx as never, 'execution-1');

    expect(insert).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ resolvedAt: expect.any(String) });
  });

  /** A db whose waits query resolves to `rows`, and which records the ids resolved. */
  function fakeDb(rows: Array<Record<string, unknown>>) {
    const where = vi.fn();
    const inArrayWhere = { where };
    const db = {
      select: vi.fn().mockImplementation(() => {
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.innerJoin = () => chain;
        chain.leftJoin = () => chain;
        chain.where = () => Promise.resolve(rows);
        return chain;
      }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue(inArrayWhere) }),
    };
    return { db, where };
  }

  const wait = (over: Record<string, unknown>) => ({
    id: 'w',
    stageExecutionId: 'e',
    stageItemId: null,
    kind: 'approval',
    executionState: 'awaiting_approval',
    itemState: null,
    ...over,
  });

  it('counts only waits whose stage or item is still waiting', async () => {
    const { db } = fakeDb([
      wait({ id: 'live-stage' }),
      wait({ id: 'live-input', kind: 'input', executionState: 'awaiting_input' }),
      wait({ id: 'orphan-stage', executionState: 'stale' }),
      wait({
        id: 'live-item',
        stageItemId: 'i1',
        executionState: 'running',
        itemState: 'awaiting_approval',
      }),
      wait({ id: 'orphan-item', stageItemId: 'i2', executionState: 'running', itemState: 'stale' }),
    ]);
    const service = new HumanWaitService(db as never);

    const live = await service.liveOpenWaits(db as never, 'run-1');

    expect(live.map((w) => w.id)).toEqual(['live-stage', 'live-input', 'live-item']);
    expect(await service.countOpenWaits(db as never, 'run-1')).toBe(3);
  });

  it('reports approval before input, and nothing when no wait is live', async () => {
    const input = wait({ kind: 'input', executionState: 'awaiting_input' });
    const both = fakeDb([input, wait({ id: 'a' })]);
    expect(await new HumanWaitService(both.db as never).pausedStateFor(both.db as never, 'r')).toBe(
      'PAUSED_APPROVAL',
    );
    const onlyInput = fakeDb([input]);
    expect(
      await new HumanWaitService(onlyInput.db as never).pausedStateFor(onlyInput.db as never, 'r'),
    ).toBe('PAUSED_INPUT');
    const none = fakeDb([wait({ executionState: 'stale' })]);
    expect(
      await new HumanWaitService(none.db as never).pausedStateFor(none.db as never, 'r'),
    ).toBeUndefined();
  });

  it('resolves only the orphaned waits', async () => {
    const { db, where } = fakeDb([
      wait({ id: 'live' }),
      wait({ id: 'orphan', executionState: 'stale' }),
    ]);
    await new HumanWaitService(db as never).resolveNotLive(db as never, 'run-1');
    expect(where).toHaveBeenCalledOnce();
  });
});
