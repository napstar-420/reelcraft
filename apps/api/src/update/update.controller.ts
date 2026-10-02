import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { InstallUpdateDto, type UpdateStatusDto } from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { run } from '../db/schema';
import { type AgentStatus, UpdateAgentClient, UpdateAgentError } from './update-agent.client';

/** In-app updates for the self-hosted image. The API only relays requests:
 * the update agent in the image does the checking, verifying and installing,
 * so code in an app bundle can never change how updates are verified. */
@Controller('system/update')
export class UpdateController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly config: EngineConfig,
    private readonly agent: UpdateAgentClient,
  ) {}

  @Get()
  async status(): Promise<UpdateStatusDto> {
    return this.withRuns(await this.relay(() => this.agent.status()));
  }

  @Post('check')
  @HttpCode(200)
  async check(): Promise<UpdateStatusDto> {
    return this.withRuns(await this.relay(() => this.agent.check()));
  }

  /** Starts installing; the update restarts the app, so progress is read by
   * polling `GET /api/system/update` and then `/api/system/health`. */
  @Post('install')
  @HttpCode(202)
  async install(
    @Body(new ZodValidationPipe(InstallUpdateDto)) dto: InstallUpdateDto,
  ): Promise<UpdateStatusDto> {
    const status = await this.relay(() => this.agent.install(dto.version));
    if (!status) throw new NotImplementedException('This installation cannot update itself.');
    return this.withRuns(status);
  }

  private async relay(call: () => Promise<AgentStatus | null>): Promise<AgentStatus | null> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof UpdateAgentError) throw new HttpException(err.message, err.status);
      throw err;
    }
  }

  private async withRuns(status: AgentStatus | null): Promise<UpdateStatusDto> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(run)
      .where(eq(run.state, 'RUNNING'));
    const count = row?.count ?? 0;
    if (status) return { ...status, managed: true, activeRuns: count };
    return {
      managed: false,
      current: { version: this.config.version, source: 'image' },
      image: null,
      updatesEnabled: false,
      latest: null,
      phase: 'idle',
      progress: null,
      lastCheckedAt: null,
      lastError: null,
      lastResult: null,
      activeRuns: count,
    };
  }
}
