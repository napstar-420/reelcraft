import { describe, expect, it, vi } from 'vitest';
import { RunStateService } from './run-state.service';

describe('RunStateService', () => {
  it('clears endedAt whenever a run enters RUNNING', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) };
    const events = { publish: vi.fn() };
    const service = new RunStateService(db as never, events as never);

    await service.transition('run-1', 'RUNNING');

    expect(set).toHaveBeenCalledWith({ state: 'RUNNING', endedAt: null });
  });
});
