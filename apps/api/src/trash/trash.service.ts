import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, isNotNull, lt } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprint, channel } from '../db/schema/index';
import { ChannelService } from '../channel/channel.service';
import { BlueprintService } from '../blueprint/blueprint.service';

/** How long a deleted channel or blueprint can be restored. */
export const TRASH_DAYS = 30;
const PURGE_EVERY_MS = 60 * 60 * 1000;

/** The trash: channels and blueprints deleted in the app (or by the assistant), restorable for
 * `TRASH_DAYS`, then deleted for good with the usual cascades. */
@Injectable()
export class TrashService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrashService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly channels: ChannelService,
    private readonly blueprints: BlueprintService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.purge().catch((error: unknown) =>
        this.logger.warn({ err: error }, 'trash purge failed'),
      );
    }, PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list() {
    const [channels, blueprints] = await Promise.all([
      this.channels.listTrashed(),
      this.blueprints.listTrashed(),
    ]);
    const purgeAt = (deletedAt: string | null) =>
      deletedAt ? new Date(Date.parse(deletedAt) + TRASH_DAYS * 86_400_000).toISOString() : null;
    return {
      days: TRASH_DAYS,
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        counts: c.counts,
        deletedAt: c.deletedAt ? new Date(c.deletedAt).toISOString() : null,
        purgeAt: purgeAt(c.deletedAt),
      })),
      blueprints: blueprints.map((b) => ({
        id: b.id,
        name: b.name,
        channelId: b.channelId,
        channelName: b.channelName,
        deletedAt: b.deletedAt ? new Date(b.deletedAt).toISOString() : null,
        purgeAt: purgeAt(b.deletedAt),
      })),
    };
  }

  /** Deletes for good what has been in the trash longer than `TRASH_DAYS`. */
  async purge(now = Date.now()): Promise<{ channels: number; blueprints: number }> {
    const cutoff = new Date(now - TRASH_DAYS * 86_400_000).toISOString();
    const oldBlueprints = await this.db
      .select({ id: blueprint.id })
      .from(blueprint)
      .where(and(isNotNull(blueprint.deletedAt), lt(blueprint.deletedAt, cutoff)));
    const oldChannels = await this.db
      .select({ id: channel.id })
      .from(channel)
      .where(and(isNotNull(channel.deletedAt), lt(channel.deletedAt, cutoff)));
    let blueprints = 0;
    let channels = 0;
    // Each is locked and re-checked against the cutoff as it is deleted: one restored since the
    // list above was read is left alone.
    for (const { id } of oldBlueprints) {
      await this.blueprints.delete(id, { onlyTrashedBefore: cutoff }).then(
        (deleted) => {
          if (deleted) blueprints += 1;
        },
        (error: unknown) => this.logger.warn({ err: error, blueprintId: id }, 'not purged'),
      );
    }
    for (const { id } of oldChannels) {
      await this.channels.delete(id, { onlyTrashedBefore: cutoff }).then(
        (deleted) => {
          if (deleted) channels += 1;
        },
        (error: unknown) => this.logger.warn({ err: error, channelId: id }, 'not purged'),
      );
    }
    if (blueprints || channels) this.logger.log({ blueprints, channels }, 'trash purged');
    return { channels, blueprints };
  }
}
