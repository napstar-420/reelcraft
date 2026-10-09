import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  ListNotificationsResultDto,
  NotificationDto,
  NotificationKind,
} from '@reelcraft/shared';
import { ulid } from '../common/ulid';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import {
  blueprint,
  blueprintVersion,
  channel,
  humanWait,
  notification,
  run,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { LiveEvents } from '../live/live-events';
import { describeRunNotification, type NotificationTextContext } from './notification-text';

/** Both the connection and a transaction (or savepoint) satisfy this. */
type Executor = Pick<Db, 'select' | 'insert'>;

export interface NotifyInput {
  runId: string;
  kind: NotificationKind;
  /** The same key never inserts twice, so a replayed step or a retry is a no-op. */
  dedupeKey: string;
  /** Derived from the run's open wait or failed stage when omitted. */
  stageKey?: string;
  waitKind?: NotificationTextContext['waitKind'];
  hours?: 24 | 48;
}

export interface SentNotification {
  recipientId: string;
  notification: NotificationDto;
}

const LIST_LIMIT = 50;

function iso(value: string): string {
  return new Date(value).toISOString();
}

function toDto(row: typeof notification.$inferSelect): NotificationDto {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    runId: row.runId,
    stageKey: row.stageKey,
    title: row.title,
    body: row.body,
    url: row.url,
    readAt: row.readAt === null ? null : iso(row.readAt),
    createdAt: iso(row.createdAt),
  };
}

function reasonOf(failure: unknown): string | null {
  const reason = (failure as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? reason : null;
}

/**
 * The in-app inbox. A row is written where the thing happens (inside the
 * transaction that changes the run, or in the Inngest step right after), and
 * only a row that was really inserted is announced, so a replay never tells
 * the user twice.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: LiveEvents,
  ) {}

  /** Writes the row and returns it, or null for a dry run (fake provider, free,
   * not worth an alert), a deleted run, or a key that already exists. */
  async insertForRun(executor: Executor, input: NotifyInput): Promise<SentNotification | null> {
    const context = await this.loadContext(executor, input);
    if (!context) return null;
    const text = describeRunNotification(input.kind, context.text);
    const [row] = await executor
      .insert(notification)
      .values({
        id: ulid(),
        recipientId: context.recipientId,
        kind: input.kind,
        runId: input.runId,
        stageKey: context.text.stageKey ?? null,
        title: text.title,
        body: text.body,
        url: text.url,
        dedupeKey: input.dedupeKey,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: notification.dedupeKey })
      .returning();
    return row ? { recipientId: row.recipientId, notification: toDto(row) } : null;
  }

  /** For use inside a run's own transaction: runs in a savepoint and swallows
   * failure, because a notification must never roll back or block a state change. */
  async insertSafely(tx: Tx, input: NotifyInput): Promise<SentNotification | null> {
    try {
      return await tx.transaction((savepoint) => this.insertForRun(savepoint, input));
    } catch (err) {
      this.logger.warn({ err, runId: input.runId, kind: input.kind }, 'notification not recorded');
      return null;
    }
  }

  /** Announces a row that is already committed. Never throws. */
  deliver(sent: SentNotification | null | undefined): void {
    if (!sent) return;
    try {
      this.events.publish({ type: 'notification', ...sent });
    } catch (err) {
      this.logger.warn({ err }, 'notification not delivered');
    }
  }

  /** Insert and announce, for callers outside a transaction. */
  async notifyRun(input: NotifyInput): Promise<void> {
    this.deliver(await this.insertForRun(this.db, input));
  }

  async list(recipientId: string): Promise<ListNotificationsResultDto> {
    const rows = await this.db
      .select()
      .from(notification)
      .where(eq(notification.recipientId, recipientId))
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(LIST_LIMIT);
    const [counts] = await this.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notification)
      .where(and(eq(notification.recipientId, recipientId), isNull(notification.readAt)));
    return { items: rows.map(toDto), unreadCount: counts?.unread ?? 0 };
  }

  async markRead(recipientId: string, id: string): Promise<void> {
    const rows = await this.db
      .update(notification)
      .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
      .where(and(eq(notification.id, id), eq(notification.recipientId, recipientId)))
      .returning({ id: notification.id });
    if (rows.length === 0) throw new NotFoundException(`Notification ${id} not found`);
    this.events.publish({ type: 'notifications', recipientId });
  }

  async markAllRead(recipientId: string): Promise<void> {
    await this.db
      .update(notification)
      .set({ readAt: new Date().toISOString() })
      .where(and(eq(notification.recipientId, recipientId), isNull(notification.readAt)));
    this.events.publish({ type: 'notifications', recipientId });
  }

  private async loadContext(
    executor: Executor,
    input: NotifyInput,
  ): Promise<{ recipientId: string; text: NotificationTextContext } | null> {
    const [row] = await executor
      .select({
        dryRun: run.dryRun,
        recipientId: channel.ownerId,
        channelName: channel.name,
        blueprintName: blueprint.name,
        draft: blueprintVersion.draft,
        graph: blueprintVersion.graph,
      })
      .from(run)
      .innerJoin(channel, eq(run.channelId, channel.id))
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .innerJoin(blueprint, eq(blueprintVersion.blueprintId, blueprint.id))
      .where(eq(run.id, input.runId))
      .limit(1);
    if (!row || row.dryRun) return null;

    let stageKey = input.stageKey ?? null;
    let waitKind = input.waitKind ?? null;
    let reason: string | null = null;

    if (input.kind === 'awaiting_approval' || input.kind === 'awaiting_input') {
      if (stageKey === null || waitKind === null) {
        const [wait] = await executor
          .select({ kind: humanWait.kind, stageKey: stageExecution.stageKey })
          .from(humanWait)
          .innerJoin(stageExecution, eq(humanWait.stageExecutionId, stageExecution.id))
          .where(and(eq(humanWait.runId, input.runId), isNull(humanWait.resolvedAt)))
          .orderBy(desc(humanWait.waitingSince))
          .limit(1);
        stageKey ??= wait?.stageKey ?? null;
        waitKind ??= wait?.kind ?? null;
      }
    } else if (input.kind === 'failed') {
      const failed = await this.findFailure(executor, input.runId);
      stageKey ??= failed?.stageKey ?? null;
      reason = failed?.reason ?? null;
    }

    const stage = (row.graph as Array<{ key?: unknown; label?: unknown }>).find(
      (s) => s.key === stageKey,
    );
    return {
      recipientId: row.recipientId,
      text: {
        runId: input.runId,
        blueprintName: row.blueprintName,
        channelName: row.channelName,
        draft: row.draft,
        stageKey,
        stageLabel: typeof stage?.label === 'string' ? stage.label : null,
        waitKind,
        reason,
        ...(input.hours !== undefined && { hours: input.hours }),
      },
    };
  }

  /** An iterating stage fails on its item and leaves the stage row alone, so
   * the reason is on the stage or, failing that, on a failed item. */
  private async findFailure(
    executor: Executor,
    runId: string,
  ): Promise<{ stageKey: string; reason: string | null } | null> {
    const [stage] = await executor
      .select({ stageKey: stageExecution.stageKey, failure: stageExecution.failure })
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.state, 'failed')))
      .limit(1);
    if (stage) return { stageKey: stage.stageKey, reason: reasonOf(stage.failure) };
    const [item] = await executor
      .select({ stageKey: stageExecution.stageKey, failure: stageItem.failure })
      .from(stageItem)
      .innerJoin(stageExecution, eq(stageItem.stageExecutionId, stageExecution.id))
      .where(and(eq(stageExecution.runId, runId), eq(stageItem.state, 'failed')))
      .limit(1);
    return item ? { stageKey: item.stageKey, reason: reasonOf(item.failure) } : null;
  }
}
