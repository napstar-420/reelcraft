import { HttpException, NotImplementedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import type { Db } from '../db/drizzle.provider';
import { type AgentStatus, type UpdateAgentClient, UpdateAgentError } from './update-agent.client';
import { UpdateController } from './update.controller';

const config = { version: '0.2.0' } as EngineConfig;

function dbWithRunning(count: number): Db {
  const where = vi.fn().mockResolvedValue([{ count }]);
  return { select: () => ({ from: () => ({ where }) }) } as unknown as Db;
}

const agentStatus: AgentStatus = {
  current: { version: '0.2.0', source: 'image' },
  image: { version: '0.2.0', runtime: 3 },
  updatesEnabled: true,
  latest: null,
  phase: 'idle',
  progress: null,
  lastCheckedAt: null,
  lastError: null,
  lastResult: null,
};

describe('UpdateController', () => {
  it("adds the running-run count to the agent's status", async () => {
    const agent = {
      status: vi.fn().mockResolvedValue(agentStatus),
    } as unknown as UpdateAgentClient;

    await expect(new UpdateController(dbWithRunning(2), config, agent).status()).resolves.toEqual({
      ...agentStatus,
      managed: true,
      activeRuns: 2,
    });
  });

  it('reports an unmanaged install when there is no agent', async () => {
    const agent = { status: vi.fn().mockResolvedValue(null) } as unknown as UpdateAgentClient;

    const status = await new UpdateController(dbWithRunning(0), config, agent).status();
    expect(status).toMatchObject({
      managed: false,
      updatesEnabled: false,
      current: { version: '0.2.0', source: 'image' },
    });
  });

  it('refuses to install without an agent', async () => {
    const agent = { install: vi.fn().mockResolvedValue(null) } as unknown as UpdateAgentClient;

    await expect(
      new UpdateController(dbWithRunning(0), config, agent).install({ version: '0.2.1' }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it("passes the agent's refusal through as an HTTP error", async () => {
    const agent = {
      install: vi.fn().mockRejectedValue(new UpdateAgentError('already in progress', 409)),
    } as unknown as UpdateAgentClient;

    const err = await new UpdateController(dbWithRunning(0), config, agent)
      .install({ version: '0.2.1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
  });
});
