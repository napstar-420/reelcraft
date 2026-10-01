import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { EngineConfig } from '../config/engine-config';
import type { Db } from '../db/drizzle.provider';
import { SystemController } from './system.controller';

const config = { version: '1.2.3' } as EngineConfig;

describe('SystemController.health', () => {
  it('reports ok with the running version when the database answers', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) } as unknown as Db;

    await expect(new SystemController(db, config).health()).resolves.toEqual({
      status: 'ok',
      version: '1.2.3',
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as unknown as Db;

    await expect(new SystemController(db, config).health()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
