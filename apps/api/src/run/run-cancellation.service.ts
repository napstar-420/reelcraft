import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { StageDef, type JobHandle } from '@reefcraft/shared';
import { LedgerService } from '../budget/ledger.service';
import { CapabilityRegistry } from '../capability/capability.registry';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprintVersion, run, stageAttempt, stageExecution } from '../db/schema/index';
import { HumanWaitService } from './human-wait.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';

const CANCELLABLE_STATES = [
  'CREATED',
  'RUNNING',
  'PAUSED_BUDGET',
  'PAUSED_APPROVAL',
  'PAUSED_INPUT',
  'FAILED',
] as const;

@Injectable()
export class RunCancellationService {
  private readonly logger = new Logger(RunCancellationService.name);

  constructor(
    private readonly mutation: RunMutationService,
    private readonly dispatcher: RunWakeupDispatcher,
    private readonly waits: HumanWaitService,
    @Optional() @Inject(DRIZZLE) private readonly db?: Db,
    @Optional() private readonly capabilities?: CapabilityRegistry,
    @Optional() private readonly ledger?: LedgerService,
  ) {}

  async cancel(runId: string) {
    const result = await this.mutation.withLockedRun(
      runId,
      'cancel',
      CANCELLABLE_STATES,
      async (tx) => {
        await tx
          .update(run)
          .set({ state: 'CANCELLED', endedAt: new Date().toISOString() })
          .where(eq(run.id, runId));
        await this.waits.resolveAll(tx, runId);
      },
      'run/cancelled',
    );
    await this.settleOutstanding(runId);
    try {
      await this.dispatcher.dispatch(result.wakeupId);
    } catch (error) {
      this.logger.warn(
        `Cancellation ${result.wakeupId} will be retried: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { state: 'CANCELLED' as const, revision: result.revision };
  }

  private async settleOutstanding(runId: string): Promise<void> {
    if (!this.db || !this.capabilities || !this.ledger) return;
    const [context] = await this.db
      .select({ graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!context) return;
    const stages = new Map(
      StageDef.array()
        .parse(context.graph)
        .map((stage) => [stage.key, stage]),
    );
    const attempts = await this.db
      .select({
        id: stageAttempt.id,
        stageKey: stageExecution.stageKey,
        jobHandle: stageAttempt.jobHandle,
      })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(
        and(
          eq(stageExecution.runId, runId),
          eq(stageAttempt.phase, 'submitted'),
          isNotNull(stageAttempt.jobHandle),
        ),
      );

    for (const attempt of attempts) {
      const stage = stages.get(attempt.stageKey);
      if (!stage) continue;
      let cancellation: { confirmed: boolean; billed?: boolean; reason?: string };
      try {
        const cancel = this.capabilities.get(stage.capability).cancel;
        cancellation = cancel
          ? await cancel.call(
              this.capabilities.get(stage.capability),
              attempt.jobHandle as JobHandle,
            )
          : { confirmed: false, reason: 'capability does not support cancellation' };
      } catch (error) {
        cancellation = {
          confirmed: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      const reservationId = await this.ledger.reservationIdFor(attempt.id);
      if (cancellation.confirmed && cancellation.billed !== true) {
        await this.ledger.settleRelease({
          runId,
          stageKey: attempt.stageKey,
          stageAttemptId: attempt.id,
          reservationId,
        });
      } else {
        await this.ledger.settleProvisional({
          runId,
          stageKey: attempt.stageKey,
          stageAttemptId: attempt.id,
          reservationId,
        });
      }
      await this.db
        .update(stageAttempt)
        .set({
          outcome: 'cancelled',
          phase: 'settled',
          reviewNote: cancellation.reason ?? null,
        })
        .where(eq(stageAttempt.id, attempt.id));
    }
  }
}
