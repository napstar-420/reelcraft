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
        ['PAUSED_BUDGET', 'FAILED'],
        expect.any(Function),
        'run/resumed',
      );
      expect(setup.wakeupDispatcher.dispatch).toHaveBeenCalledWith('wake-resume');
      expect(setup.runState.transition).not.toHaveBeenCalled();
      expect(setup.inngest.send).not.toHaveBeenCalled();
      expect(result.state).toBe(state);
    },
  );

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
