import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Subscription } from 'rxjs';
import type { AssistantWatchDto, NotificationDto, NotificationKind } from '@reelcraft/shared';
import { ulid } from '../../common/ulid';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { assistantWatch, notification } from '../../db/schema/index';
import { LiveEvents } from '../../live/live-events';
import { AssistantSettingsService } from './assistant-settings.service';
import { FINAL_KINDS, WAKE_KINDS, wakeText } from './wake-text';

type WatchRow = typeof assistantWatch.$inferSelect;

/** Wakes a chat with a message (set by `AssistantService`, which runs the turn). */
export type WakeHandler = (sessionId: string, text: string) => Promise<void>;

/**
 * Chats watching runs. A run's notifications (written durably where the run changes) are the
 * signal: a failure, a review or input it waits for, a budget stop, its end. Each wakes the
 * watching chat with what happened, up to Settings' wake limit. On boot, notifications newer than
 * a watch last acted on are replayed, so a restart loses nothing.
 */
@Injectable()
export class AssistantWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantWatchService.name);
  private subscription: Subscription | undefined;
  private wakeHandler: WakeHandler | undefined;
  /** Watches being handled, so a burst of notifications for one run is handled in order. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: LiveEvents,
    private readonly settings: AssistantSettingsService,
  ) {}

  setWakeHandler(handler: WakeHandler): void {
    this.wakeHandler = handler;
  }

  async onModuleInit(): Promise<void> {
    this.subscription = this.events.all().subscribe((event) => {
      if (event.type !== 'notification') return;
      this.enqueue(() => this.handle(event.notification));
    });
    this.enqueue(() => this.replay());
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /** Starts watching (idempotent per chat and run). */
  async watch(sessionId: string, runId: string): Promise<AssistantWatchDto[]> {
    const [open] = await this.db
      .select()
      .from(assistantWatch)
      .where(
        and(
          eq(assistantWatch.sessionId, sessionId),
          eq(assistantWatch.runId, runId),
          isNull(assistantWatch.endedAt),
        ),
      )
      .limit(1);
    if (!open) {
      await this.db.insert(assistantWatch).values({ id: ulid(), sessionId, runId });
    }
    return this.publish(sessionId);
  }

  async unwatch(sessionId: string, runId: string): Promise<AssistantWatchDto[]> {
    await this.end(
      and(
        eq(assistantWatch.sessionId, sessionId),
        eq(assistantWatch.runId, runId),
        isNull(assistantWatch.endedAt),
      ),
      'stopped',
    );
    return this.publish(sessionId);
  }

  async list(sessionId: string): Promise<AssistantWatchDto[]> {
    const { maxWakesPerRun } = await this.settings.get();
    const rows = await this.db
      .select()
      .from(assistantWatch)
      .where(and(eq(assistantWatch.sessionId, sessionId), isNull(assistantWatch.endedAt)))
      .orderBy(asc(assistantWatch.createdAt));
    return rows.map((row) => ({
      runId: row.runId,
      wakeCount: row.wakeCount,
      maxWakes: maxWakesPerRun,
      createdAt: row.createdAt,
    }));
  }

  /** Removes a chat's watches (the chat is being deleted). */
  async forgetSession(tx: Pick<Db, 'delete'>, sessionId: string): Promise<void> {
    await tx.delete(assistantWatch).where(eq(assistantWatch.sessionId, sessionId));
  }

  private enqueue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'assistant watch not handled');
    });
  }

  /** For tests: resolves once everything queued so far is handled. */
  idle(): Promise<void> {
    return this.chain;
  }

  private async handle(
    note: Pick<NotificationDto, 'runId' | 'kind' | 'title' | 'body' | 'createdAt'>,
  ): Promise<void> {
    if (!WAKE_KINDS.has(note.kind)) return;
    const watches = await this.db
      .select()
      .from(assistantWatch)
      .where(and(eq(assistantWatch.runId, note.runId), isNull(assistantWatch.endedAt)));
    for (const watch of watches) await this.wakeOne(watch, note);
  }

  private async wakeOne(
    watch: WatchRow,
    note: Pick<NotificationDto, 'runId' | 'kind' | 'title' | 'body' | 'createdAt'>,
  ): Promise<void> {
    if (watch.lastNotifiedAt && note.createdAt <= watch.lastNotifiedAt) return;
    const { maxWakesPerRun } = await this.settings.get();
    const wake = watch.wakeCount + 1;
    const final = FINAL_KINDS.has(note.kind as NotificationKind) || wake >= maxWakesPerRun;
    await this.db
      .update(assistantWatch)
      .set({
        wakeCount: wake,
        lastNotifiedAt: note.createdAt,
        ...(final && {
          endedAt: sql`now()`,
          endedReason: FINAL_KINDS.has(note.kind as NotificationKind) ? 'finished' : 'limit',
        }),
      })
      .where(eq(assistantWatch.id, watch.id));
    await this.publish(watch.sessionId);
    const text = wakeText({
      runId: note.runId,
      kind: note.kind as NotificationKind,
      title: note.title,
      body: note.body,
      wake,
      maxWakes: maxWakesPerRun,
    });
    this.logger.log(
      { sessionId: watch.sessionId, runId: note.runId, kind: note.kind, wake },
      'assistant woken',
    );
    await this.wakeHandler?.(watch.sessionId, text);
  }

  /** Notifications that arrived while the API was down: each open watch gets the newest one. */
  private async replay(): Promise<void> {
    const open = await this.db.select().from(assistantWatch).where(isNull(assistantWatch.endedAt));
    for (const watch of open) {
      const [latest] = await this.db
        .select()
        .from(notification)
        .where(
          and(
            eq(notification.runId, watch.runId),
            inArray(notification.kind, [...WAKE_KINDS]),
            gt(notification.createdAt, watch.lastNotifiedAt ?? watch.createdAt),
          ),
        )
        .orderBy(sql`${notification.createdAt} desc`)
        .limit(1);
      if (latest) await this.wakeOne(watch, latest as never);
    }
  }

  private async end(where: ReturnType<typeof and>, reason: string): Promise<void> {
    await this.db
      .update(assistantWatch)
      .set({ endedAt: sql`now()`, endedReason: reason })
      .where(where);
  }

  private async publish(sessionId: string): Promise<AssistantWatchDto[]> {
    const watches = await this.list(sessionId);
    this.events.publish({ type: 'assistant', sessionId, event: { type: 'watches', watches } });
    return watches;
  }
}
