import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunActionPolicy } from './run-action-policy';
import { RunMutationService } from './run-mutation.service';

/** The locked run select (`.for('update')`) and, after it, the trash check (`.limit(1)`). */
function queryResult<T>(rows: T[], owner: Record<string, unknown> = {}) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    innerJoin: vi.fn(),
    for: vi.fn().mockResolvedValue(rows),
    limit: vi
      .fn()
      .mockResolvedValue([{ blueprintDeletedAt: null, channelDeletedAt: null, ...owner }]),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  return query;
}

const events = { publish: vi.fn() };

describe('RunMutationService', () => {
  beforeEach(() => events.publish.mockClear());

  it('locks, mutates, increments once, and inserts the revision-bound wakeup atomically', async () => {
    const lockedRun = {
      id: 'run-1',
      state: 'FAILED',
      revision: 4,
    };
    const selectQuery = queryResult([lockedRun]);
    const returning = vi.fn().mockResolvedValue([{ revision: 5 }]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const tx = {
      select: vi.fn().mockReturnValue(selectQuery),
      update: vi.fn().mockReturnValue({ set: updateSet }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };
    const db = {
      transaction: vi.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
    };
    const service = new RunMutationService(db as never, new RunActionPolicy(), events as never);
    const mutate = vi.fn().mockResolvedValue({ changed: true });

    const result = await service.withLockedRun(
      'run-1',
      'resume',
      ['FAILED'],
      mutate,
      'run/resumed',
    );

    expect(selectQuery.for).toHaveBeenCalledWith('update');
    expect(mutate).toHaveBeenCalledWith(tx, lockedRun);
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        runId: 'run-1',
        action: 'resume',
        sourceState: 'FAILED',
        expectedRevision: 5,
        eventName: 'run/resumed',
      }),
    );
    expect(result).toEqual({
      value: { changed: true },
      revision: 5,
      wakeupId: expect.any(String),
    });
    expect(events.publish).toHaveBeenCalledWith({ type: 'run', runId: 'run-1' });
  });

  it('refuses to wake a run whose blueprint is in the trash, but lets it be cancelled', async () => {
    const lockedRun = { id: 'run-1', state: 'FAILED', revision: 4, blueprintVersionId: 'v1' };
    const selectQuery = queryResult([lockedRun], { blueprintDeletedAt: '2026-11-01' });
    const returning = vi.fn().mockResolvedValue([{ revision: 5 }]);
    const tx = {
      select: vi.fn().mockReturnValue(selectQuery),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    };
    const db = {
      transaction: vi.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
    };
    const service = new RunMutationService(db as never, new RunActionPolicy(), events as never);
    const mutate = vi.fn().mockResolvedValue(null);
    await expect(service.withLockedRun('run-1', 'resume', ['FAILED'], mutate)).rejects.toThrow(
      /in the trash/,
    );
    expect(mutate).not.toHaveBeenCalled();
    await service.withLockedRun('run-1', 'cancel', ['FAILED'], mutate, 'run/cancelled');
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the mutation or write a wakeup when policy rejects the state', async () => {
    const selectQuery = queryResult([{ id: 'run-1', state: 'COMPLETED', revision: 8 }]);
    const tx = {
      select: vi.fn().mockReturnValue(selectQuery),
      update: vi.fn(),
      insert: vi.fn(),
    };
    const db = {
      transaction: vi.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
    };
    const mutate = vi.fn();
    const service = new RunMutationService(db as never, new RunActionPolicy(), events as never);

    await expect(
      service.withLockedRun('run-1', 'resume', ['FAILED'], mutate, 'run/resumed'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mutate).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('reports a missing run without invoking the callback', async () => {
    const tx = { select: vi.fn().mockReturnValue(queryResult([])) };
    const db = {
      transaction: vi.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
    };
    const mutate = vi.fn();
    const service = new RunMutationService(db as never, new RunActionPolicy(), events as never);

    await expect(
      service.withLockedRun('missing', 'resume', ['FAILED'], mutate, 'run/resumed'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mutate).not.toHaveBeenCalled();
  });
});
