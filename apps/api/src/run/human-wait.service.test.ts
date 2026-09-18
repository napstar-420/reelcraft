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
});
