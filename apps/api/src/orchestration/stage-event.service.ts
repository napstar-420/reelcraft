import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { stageEvent } from '../db/schema/index';
import { sanitizeForLog } from '../common/redact';
import { ulid } from '../common/ulid';

export type StageEventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StageEventContext {
  runId: string;
  stageExecutionId: string;
  stageKey: string;
  stageAttemptId?: string | undefined;
  attemptNo?: number | undefined;
  itemIndex?: number | undefined;
}

/** Writes the user-facing stage log (`stage_event`) and mirrors it to the
 * server log. Server-side, only warnings, errors and `attempt.finished` stay
 * at their level; the step-by-step trail goes to debug so it doesn't drown
 * the run lifecycle. */
@Injectable()
export class StageEventService {
  // Plain PinoLogger + setContext rather than @InjectPinoLogger: that
  // decorator's providers are collected when LoggerModule.forRoot runs, which
  // can be before this file is imported.
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StageEventService.name);
  }

  async record(
    ctx: StageEventContext,
    level: StageEventLevel,
    type: string,
    message: string,
    data?: unknown,
  ): Promise<void> {
    const serverLevel = level === 'info' && type !== 'attempt.finished' ? 'debug' : level;
    this.logger[serverLevel](
      {
        runId: ctx.runId,
        stageKey: ctx.stageKey,
        attemptNo: ctx.attemptNo,
        itemIndex: ctx.itemIndex,
        event: type,
      },
      message,
    );
    // A failed log write must never fail the stage itself.
    try {
      await this.db.insert(stageEvent).values({
        id: ulid(),
        runId: ctx.runId,
        stageExecutionId: ctx.stageExecutionId,
        stageAttemptId: ctx.stageAttemptId ?? null,
        itemIndex: ctx.itemIndex ?? null,
        level,
        type,
        message,
        data: data === undefined ? null : sanitizeForLog(data),
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn({ err: error, runId: ctx.runId, event: type }, 'stage event write failed');
    }
  }
}
