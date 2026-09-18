import { describe, expect, it, vi } from 'vitest';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';

function selectQuery(rows: unknown[]) {
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue(rows) };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

function updateQuery() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { set, where };
}

describe('RunWakeupDispatcher', () => {
  const pending = {
    id: 'wake-1',
    runId: 'run-1',
    action: 'resume',
    sourceState: 'FAILED',
    expectedRevision: 3,
    eventName: 'run/resumed',
    dispatchedAt: null,
  };

  it('uses the wakeup id as the stable Inngest event id and marks delivery', async () => {
    const update = updateQuery();
    const db = {
      select: vi.fn().mockReturnValue(selectQuery([pending])),
      update: vi.fn().mockReturnValue({ set: update.set }),
    };
    const inngest = { send: vi.fn().mockResolvedValue(undefined) };
    const dispatcher = new RunWakeupDispatcher(db as never, inngest as never);

    await expect(dispatcher.dispatch('wake-1')).resolves.toBe(true);

    expect(inngest.send).toHaveBeenCalledWith({
      id: 'wake-1',
      name: 'run/resumed',
      data: {
        wakeupId: 'wake-1',
        runId: 'run-1',
        action: 'resume',
        sourceState: 'FAILED',
        expectedRevision: 3,
      },
    });
    expect(update.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ dispatchedAt: expect.any(String), lastError: null }),
    );
  });

  it('records a failed attempt without marking the wakeup dispatched', async () => {
    const update = updateQuery();
    const db = {
      select: vi.fn().mockReturnValue(selectQuery([pending])),
      update: vi.fn().mockReturnValue({ set: update.set }),
    };
    const inngest = { send: vi.fn().mockRejectedValue(new Error('offline')) };
    const dispatcher = new RunWakeupDispatcher(db as never, inngest as never);

    await expect(dispatcher.dispatch('wake-1')).rejects.toThrow('offline');
    expect(update.set).toHaveBeenLastCalledWith({ lastError: 'offline' });
    expect(update.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ dispatchedAt: expect.anything() }),
    );
  });

  it('does not resend an already-dispatched wakeup', async () => {
    const db = {
      select: vi.fn().mockReturnValue(selectQuery([{ ...pending, dispatchedAt: 'already' }])),
    };
    const inngest = { send: vi.fn() };
    const dispatcher = new RunWakeupDispatcher(db as never, inngest as never);

    await expect(dispatcher.dispatch('wake-1')).resolves.toBe(false);
    expect(inngest.send).not.toHaveBeenCalled();
  });
});
