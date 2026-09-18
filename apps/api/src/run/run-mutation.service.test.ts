import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RunActionPolicy } from './run-action-policy';
import { RunMutationService } from './run-mutation.service';

function queryResult<T>(rows: T[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn().mockResolvedValue(rows),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

describe('RunMutationService', () => {
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
    const service = new RunMutationService(db as never, new RunActionPolicy());
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
    const service = new RunMutationService(db as never, new RunActionPolicy());

    await expect(
      service.withLockedRun('run-1', 'resume', ['FAILED'], mutate, 'run/resumed'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mutate).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('reports a missing run without invoking the callback', async () => {
    const tx = { select: vi.fn().mockReturnValue(queryResult([])) };
    const db = {
      transaction: vi.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
    };
    const mutate = vi.fn();
    const service = new RunMutationService(db as never, new RunActionPolicy());

    await expect(
      service.withLockedRun('missing', 'resume', ['FAILED'], mutate, 'run/resumed'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mutate).not.toHaveBeenCalled();
  });
});
