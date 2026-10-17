import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, inArray, notInArray, lt, sql, or, isNull } from 'drizzle-orm';
import { StageDef, type JobHandle } from '@reelcraft/shared';
import { LedgerService } from '../budget/ledger.service';
import { CapabilityRegistry } from '../capability/capability.registry';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { LiveEvents } from '../live/live-events';
import { NotificationService } from '../notification/notification.service';
import { blueprintVersion, run, stageAttempt, stageExecution, stageItem } from '../db/schema/index';
import { HumanWaitService } from './human-wait.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { RUN_ACTION_ALLOWED_STATES } from './run-action-policy';

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
    @Optional() private readonly events?: LiveEvents,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async cancel(runId: string) {
    const result = await this.mutation.withLockedRun(
      runId,
      'cancel',
      RUN_ACTION_ALLOWED_STATES.cancel,
      async (tx, locked) => {
        await tx
          .update(run)
          .set({ state: 'CANCELLING', executionEpoch: locked.executionEpoch + 1 })
          .where(eq(run.id, runId));

        return this.notifications?.insertSafely(tx, {
          runId,
          kind: 'cancelled',
          dedupeKey: `cancelled:${runId}:${locked.executionEpoch}`,
        });
      },
      'run/cancelled',
    );
    this.logger.log(
      { runId, wakeupId: result.wakeupId, revision: result.revision },
      'run cancelled',
    );
    // Persisted cancellation also reconciles in Inngest if this process stops here.
    try {
      await this.dispatcher.dispatch(result.wakeupId);
    } catch (error) {
      this.logger.warn({ runId, err: error }, 'cancellation dispatch deferred');
    }
    await this.reconcileCancellation(runId);
    this.events?.publish({ type: 'run', runId });
    this.notifications?.deliver(result.value);
    return { state: 'CANCELLED' as const, revision: result.revision };
  }

  async reconcileCancellation(runId: string, interruptedEpoch?: number): Promise<void> {
    if (!this.db) return;
    const [owner] = await this.db.select().from(run).where(eq(run.id, runId));
    if (
      !owner ||
      owner.state !== 'CANCELLING' ||
      (interruptedEpoch !== undefined && owner.executionEpoch !== interruptedEpoch + 1)
    )
      return;
    await this.settleOutstanding(runId, owner.executionEpoch);
    await this.db
      .update(run)
      .set({ state: 'CANCELLED', endedAt: new Date().toISOString() })
      .where(
        and(
          eq(run.id, runId),
          eq(run.state, 'CANCELLING'),
          eq(run.executionEpoch, owner.executionEpoch),
        ),
      );
    this.events?.publish({ type: 'run', runId });
  }

  private async settleOutstanding(runId: string, cancelledEpoch: number): Promise<void> {
    if (!this.db || !this.capabilities || !this.ledger) return;
    const retired = sql`exists (select 1 from ${run} where ${run.id} = ${runId} and ${run.executionEpoch} = ${cancelledEpoch} and ${run.state} = 'CANCELLING')`;
    await this.db
      .update(stageExecution)
      .set({ state: 'cancelled', endedAt: new Date().toISOString() })
      .where(
        and(
          eq(stageExecution.runId, runId),
          retired,
          notInArray(stageExecution.state, [
            'passed',
            'failed',
            'stale',
            'skipped',
            'cancelled',
            'pending',
            'awaiting_approval',
            'awaiting_input',
          ]),
        ),
      );
    await this.db
      .update(stageItem)
      .set({ state: 'pending' })
      .where(
        and(
          inArray(
            stageItem.stageExecutionId,
            this.db
              .select({ id: stageExecution.id })
              .from(stageExecution)
              .where(eq(stageExecution.runId, runId)),
          ),
          eq(stageItem.state, 'running'),
          retired,
        ),
      );
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
        phase: stageAttempt.phase,
      })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(
        and(
          eq(stageExecution.runId, runId),
          lt(stageAttempt.executionEpoch, cancelledEpoch),
          or(
            inArray(stageAttempt.phase, ['created', 'reserved', 'submitting', 'submitted']),
            and(
              eq(stageAttempt.phase, 'settled'),
              isNull(stageAttempt.durationMs),
              eq(stageAttempt.actor, 'engine'),
              eq(stageAttempt.outcome, 'success'),
              eq(stageExecution.state, 'cancelled'),
            ),
          ),
        ),
      );

    for (const attempt of attempts) {
      const stage = stages.get(attempt.stageKey);
      if (!stage) continue;
      let cancellation: { confirmed: boolean; billed?: boolean; reason?: string | undefined };
      try {
        const cancel = this.capabilities.get(stage.capability).cancel;
        cancellation =
          attempt.phase === 'settled'
            ? {
                confirmed: false,
                reason:
                  'Checks or quality control were interrupted; a provider request may still be billed',
              }
            : !attempt.jobHandle
              ? {
                  confirmed: ['created', 'reserved'].includes(attempt.phase),
                  reason:
                    attempt.phase === 'submitting'
                      ? 'Provider submission was interrupted; billing is uncertain'
                      : undefined,
                }
              : cancel
                ? await cancel.call(
                    this.capabilities.get(stage.capability),
                    attempt.jobHandle as JobHandle,
                  )
                : { confirmed: false, reason: 'capability does not support cancellation' };
      } catch (error) {
        this.logger.warn(
          { runId, stageKey: attempt.stageKey, stageAttemptId: attempt.id, err: error },
          'provider job cancellation failed',
        );
        cancellation = {
          confirmed: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      const reservationId = await this.ledger.reservationIdFor(attempt.id).catch(() => undefined);
      this.logger.log(
        {
          runId,
          stageKey: attempt.stageKey,
          stageAttemptId: attempt.id,
          reservationId,
          confirmed: cancellation.confirmed,
          billed: cancellation.billed === true,
        },
        'in-flight attempt cancelled',
      );
      if (reservationId && cancellation.confirmed && cancellation.billed !== true) {
        await this.ledger.settleRelease({
          runId,
          stageKey: attempt.stageKey,
          stageAttemptId: attempt.id,
          reservationId,
        });
      } else if (reservationId) {
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
          cancellationConfirmed: cancellation.confirmed,
          phase: 'settled',
          reviewNote: cancellation.reason ?? null,
        })
        .where(
          and(
            eq(stageAttempt.id, attempt.id),
            or(
              isNull(stageAttempt.cancellationConfirmed),
              eq(stageAttempt.cancellationConfirmed, false),
            ),
          ),
        );
    }
  }
}
