import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SystemHealthDto } from '@reelcraft/shared';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';

@Controller('system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly config: EngineConfig,
  ) {}

  /** Healthy means the API is serving and can reach its database. */
  @Get('health')
  async health(): Promise<SystemHealthDto> {
    try {
      await this.db.execute(sql`select 1`);
    } catch (err) {
      this.logger.warn({ err }, 'health check: database unreachable');
      throw new ServiceUnavailableException('database unreachable');
    }
    return { status: 'ok', version: this.config.version };
  }
}
