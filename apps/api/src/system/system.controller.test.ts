import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import type { Db } from '../db/drizzle.provider';
import type { ReadinessService } from './readiness.service';
import { SystemController } from './system.controller';

const config = { version: '1.2.3' } as EngineConfig;
const ready = { ready: true } as ReadinessService;

describe('SystemController.health', () => {
  it('reports ok with the running version when the database answers', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) } as unknown as Db;

    await expect(new SystemController(db, config, ready).health()).resolves.toEqual({
      status: 'ok',
      version: '1.2.3',
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as unknown as Db;

    await expect(new SystemController(db, config, ready).health()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns 503 until start-up registration has finished', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) } as unknown as Db;
    const starting = { ready: false } as ReadinessService;

    await expect(new SystemController(db, config, starting).health()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(db.execute).not.toHaveBeenCalled();
  });
});
