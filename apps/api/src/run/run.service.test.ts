import { describe, expect, it, vi } from 'vitest';
import { RunService } from './run.service';

function updateQuery() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { set, where };
}

function makeService() {
  const versionQuery = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue([
      {
        id: 'version-1',
        graph: [],
        inputs: [],
      },
    ]),
  };
  versionQuery.from.mockReturnValue(versionQuery);
  versionQuery.where.mockReturnValue(versionQuery);

  const dbUpdate = updateQuery();
  const db = {
    select: vi.fn().mockReturnValue(versionQuery),
    update: vi.fn().mockReturnValue({ set: dbUpdate.set }),
  };
  const txUpdate = updateQuery();
  const tx = { update: vi.fn().mockReturnValue({ set: txUpdate.set }) };
  const runMutation = {
    withLockedRun: vi.fn(
      async (
        _runId: string,
        _action: string,
        _states: string[],
        callback: (txArg: typeof tx, row: object) => Promise<unknown>,
      ) => {
        await callback(tx, { id: 'run-1', state: 'CREATED', revision: 0 });
        return { value: undefined, revision: 1, wakeupId: 'wake-1' };
      },
    ),
  };
  const wakeupDispatcher = { dispatch: vi.fn().mockResolvedValue(true) };
  const inngest = { send: vi.fn().mockResolvedValue(undefined) };
  const runState = { transition: vi.fn() };
  const runInputs = { assertInputsSatisfied: vi.fn().mockResolvedValue(undefined) };

  const service = Object.assign(Object.create(RunService.prototype) as object, {
    db,
    inngest,
    engineConfig: {},
    configResolver: {},
    capabilities: {},
    ledger: {},
    runState,
    runInputs,
    runMutation,
    wakeupDispatcher,
  }) as unknown as RunService;

  return {
    service,
    db,
    dbUpdate,
    tx,
    txUpdate,
    runMutation,
    wakeupDispatcher,
    inngest,
    runState,
    runInputs,
  };
}

describe('RunService durable control wakeups', () => {
  it('starts through a locked mutation, snapshots assets in its transaction, and dispatches after commit', async () => {
    const setup = makeService();
    const current = {
      id: 'run-1',
      state: 'CREATED',
      blueprintVersionId: 'version-1',
      channelId: 'channel-1',
      stageExecutions: [],
    };
    vi.spyOn(setup.service, 'get').mockResolvedValue(current as never);
    vi.spyOn(setup.service as never, 'resolveAssetBindings').mockResolvedValue({
      logo: {
        blobId: 'blob-1',
        kind: 'media.image',
      },
    });

    const result = await setup.service.start('run-1');

    expect(setup.runMutation.withLockedRun).toHaveBeenCalledWith(
      'run-1',
      'start',
      ['CREATED'],
      expect.any(Function),
      'run/started',
    );
    expect(setup.txUpdate.set).toHaveBeenCalledWith({
      assetBindings: { logo: { blobId: 'blob-1', kind: 'media.image' } },
    });
    expect(setup.wakeupDispatcher.dispatch).toHaveBeenCalledWith('wake-1');
    expect(setup.inngest.send).not.toHaveBeenCalled();
    expect(result.state).toBe('CREATED');
  });

  it.each(['PAUSED_BUDGET', 'FAILED'] as const)(
    'creates a durable resume wakeup from %s and leaves the run parked until claim',
    async (state) => {
      const setup = makeService();
      setup.runMutation.withLockedRun.mockResolvedValue({
        value: undefined,
        revision: 6,
        wakeupId: 'wake-resume',
      });
      vi.spyOn(setup.service, 'get').mockResolvedValue({
        state,
        cursorStageKey: 'draft',
        stageExecutions: [{ stageKey: 'draft', state: 'failed' }],
      } as never);

      const result = await setup.service.resume('run-1');

      expect(setup.runMutation.withLockedRun).toHaveBeenCalledWith(
        'run-1',
        'resume',
        ['PAUSED_BUDGET', 'PAUSED_MANUAL', 'FAILED'],
        expect.any(Function),
        'run/resumed',
      );
      expect(setup.wakeupDispatcher.dispatch).toHaveBeenCalledWith('wake-resume');
      expect(setup.runState.transition).not.toHaveBeenCalled();
      expect(setup.inngest.send).not.toHaveBeenCalled();
      expect(result.state).toBe(state);
    },
  );

  it('pauses a RUNNING run by flipping state inside the locked mutation', async () => {
    const setup = makeService();
    vi.spyOn(setup.service, 'get').mockResolvedValue({
      state: 'PAUSED_MANUAL',
      cursorStageKey: 'draft',
      stageExecutions: [{ stageKey: 'draft', state: 'running' }],
    } as never);

    const result = await setup.service.pause('run-1');

    expect(setup.runMutation.withLockedRun).toHaveBeenCalledWith(
      'run-1',
      'pause',
      ['RUNNING'],
      expect.any(Function),
      'run/paused',
    );
    expect(setup.txUpdate.set).toHaveBeenCalledWith({ state: 'PAUSED_MANUAL' });
    expect(setup.wakeupDispatcher.dispatch).toHaveBeenCalledWith('wake-1');
    expect(result.state).toBe('PAUSED_MANUAL');
  });

  it('keeps a committed start successful when immediate dispatch fails', async () => {
    const setup = makeService();
    vi.spyOn(setup.service, 'get').mockResolvedValue({
      id: 'run-1',
      state: 'CREATED',
      blueprintVersionId: 'version-1',
      channelId: 'channel-1',
      stageExecutions: [],
    } as never);
    vi.spyOn(setup.service as never, 'resolveAssetBindings').mockResolvedValue({});
    setup.wakeupDispatcher.dispatch.mockRejectedValue(new Error('inngest unavailable'));

    await expect(setup.service.start('run-1')).resolves.toMatchObject({ state: 'CREATED' });
  });
});

/** A drizzle query builder chain is itself a thenable — `Promise.all` treats
 * it like a promise via `.then`. Every chain method (`from`/`innerJoin`/
 * `where`/`orderBy`/`limit`/`offset`) returns the same object so any call
 * order the service uses resolves to the given rows. */
function queryChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    then: (onFulfilled: (value: unknown[]) => unknown) => Promise.resolve(rows).then(onFulfilled),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  return chain;
}

function makeListService(rows: unknown[], countRows: Array<{ count: number }>) {
  const rowChain = queryChain(rows);
  const countChain = queryChain(countRows);
  const select = vi.fn((selection: Record<string, unknown>) =>
    'count' in selection ? countChain : rowChain,
  );
  const db = { select };
  const service = Object.assign(Object.create(RunService.prototype) as object, {
    db,
  }) as unknown as RunService;
  return { service, rowChain, countChain, select };
}

describe('RunService.list', () => {
  const baseRow = {
    id: 'run-1',
    channelId: 'channel-1',
    channelName: 'My Channel',
    blueprintId: 'blueprint-1',
    blueprintName: 'My Blueprint',
    blueprintVersionId: 'version-1',
    blueprintVersion: 3,
    state: 'COMPLETED',
    dryRun: false,
    budgetCapUsd: '12.0000',
    spentUsd: '4.5000',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:05:00.000Z',
  };

  it('excludes dry runs by default and applies no filter when no other criteria are given', async () => {
    const { service, rowChain } = makeListService([baseRow], [{ count: 1 }]);

    const result = await service.list({ includeDryRuns: false, limit: 20, offset: 0 });

    expect(rowChain.where).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([{ ...baseRow, budgetCapUsd: 12, spentUsd: 4.5 }]);
    expect(result.total).toBe(1);
  });

  it('skips the where clause entirely when dry runs are included and no other filters are set', async () => {
    const { rowChain, countChain, service } = makeListService([baseRow], [{ count: 1 }]);

    await service.list({ includeDryRuns: true, limit: 20, offset: 0 });

    expect(rowChain.where).not.toHaveBeenCalled();
    expect(countChain.where).not.toHaveBeenCalled();
  });

  it.each(['channelId', 'blueprintId', 'state'] as const)(
    'applies a where clause when %s is filtered, even with dry runs included',
    async (key) => {
      const { rowChain, service } = makeListService([baseRow], [{ count: 1 }]);

      await service.list({
        includeDryRuns: true,
        limit: 20,
        offset: 0,
        [key]: key === 'state' ? 'COMPLETED' : 'some-id',
      });

      expect(rowChain.where).toHaveBeenCalledTimes(1);
    },
  );

  it('passes limit and offset through to the query and echoes them in the result', async () => {
    const { rowChain, service } = makeListService([], [{ count: 0 }]);

    const result = await service.list({ includeDryRuns: false, limit: 5, offset: 15 });

    expect(rowChain.limit).toHaveBeenCalledWith(5);
    expect(rowChain.offset).toHaveBeenCalledWith(15);
    expect(result.limit).toBe(5);
    expect(result.offset).toBe(15);
  });

  it('converts money columns to numbers via toUsd rather than passing through numeric strings', async () => {
    const { service } = makeListService(
      [{ ...baseRow, budgetCapUsd: '100.0000', spentUsd: '33.3300' }],
      [{ count: 1 }],
    );

    const result = await service.list({ includeDryRuns: false, limit: 20, offset: 0 });

    expect(result.items[0]?.budgetCapUsd).toBe(100);
    expect(result.items[0]?.spentUsd).toBe(33.33);
  });

  it('defaults total to 0 when the count query returns no rows', async () => {
    const { service } = makeListService([], []);

    const result = await service.list({ includeDryRuns: false, limit: 20, offset: 0 });

    expect(result.total).toBe(0);
  });
});
