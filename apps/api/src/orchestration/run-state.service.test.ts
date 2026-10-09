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
    expect(events.publish).toHaveBeenCalledWith({ type: 'run', runId: 'run-1' });
  });

  it('announces a skipped stage as a stage update', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) };
    const events = { publish: vi.fn() };
    const service = new RunStateService(db as never, events as never);

    await service.skipStage('run-1', 'exec-1', 'script');

    expect(events.publish).toHaveBeenCalledWith({
      type: 'stage',
      runId: 'run-1',
      stageKey: 'script',
    });
  });
});
