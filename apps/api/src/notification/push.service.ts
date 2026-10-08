import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as webpush from 'web-push';
import type { NotificationKind, PushSubscriptionDto } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { pushSubscription } from '../db/schema/index';
import { SETTING, SettingsService } from '../settings/settings.service';
import type { SentNotification } from './notification.service';

/** Push services (Apple's in particular) reject a contact that is not a real
 * address, so this is not localhost.
 * ponytail: a constant; make it an environment variable if someone needs their own. */
const VAPID_SUBJECT = 'https://github.com/napstar-420/reelcraft';

/** How long a push service holds a message for a browser that is offline. */
const TTL_SECONDS = 24 * 60 * 60;
const SEND_TIMEOUT_MS = 10_000;

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Web Push: the OS notification that arrives even with every tab closed. The
 * inbox row is the source of truth; this is a best-effort extra, so a failure
 * is logged and never reaches the run.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private keys: Promise<VapidKeys> | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async publicKey(): Promise<string> {
    return (await this.vapid()).publicKey;
  }

  async upsert(recipientId: string, dto: PushSubscriptionDto): Promise<void> {
    const now = new Date().toISOString();
    const values = {
      recipientId,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      kinds: dto.kinds,
      updatedAt: now,
    };
    await this.db
      .insert(pushSubscription)
      .values({ endpoint: dto.endpoint, ...values, createdAt: now })
      .onConflictDoUpdate({ target: pushSubscription.endpoint, set: values });
  }

  async remove(recipientId: string, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscription)
      .where(
        and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.recipientId, recipientId)),
      );
  }

  /** Sends one notification to each of the recipient's browsers that asked for
   * its kind. A browser the push service no longer knows is forgotten. */
  async send(sent: SentNotification): Promise<void> {
    const rows = await this.db
      .select()
      .from(pushSubscription)
      .where(eq(pushSubscription.recipientId, sent.recipientId));
    const kind: NotificationKind = sent.notification.kind;
    const targets = rows.filter((row) => (row.kinds as string[]).includes(kind));
    if (targets.length === 0) return;

    const vapid = await this.vapid();
    const { id, title, body, url } = sent.notification;
    const payload = JSON.stringify({ id, title, body, url });
    await Promise.all(
      targets.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload,
            {
              vapidDetails: { subject: VAPID_SUBJECT, ...vapid },
              TTL: TTL_SECONDS,
              timeout: SEND_TIMEOUT_MS,
            },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.db
              .delete(pushSubscription)
              .where(eq(pushSubscription.endpoint, row.endpoint));
            this.logger.log({ status }, 'push subscription expired and removed');
          } else {
            this.logger.warn({ err, status }, 'push not delivered');
          }
        }
      }),
    );
  }

  /** Created once and kept: browsers subscribe against this exact key, so it is
   * only replaced when the saved one is missing or cannot be read. */
  private vapid(): Promise<VapidKeys> {
    this.keys ??= this.loadOrCreate().catch((err: unknown) => {
      this.keys = undefined;
      throw err;
    });
    return this.keys;
  }

  private async loadOrCreate(): Promise<VapidKeys> {
    const privateKey = await this.settings.getSecret(SETTING.vapidPrivateKey);
    const publicKey = await this.settings.get(SETTING.vapidPublicKey);
    if (privateKey.value && publicKey) {
      return { publicKey, privateKey: privateKey.value };
    }
    // First use, a half-written pair, or a pair sealed under a secret this
    // install no longer has. Existing subscriptions were made against the old
    // key and can never receive again, so they go; browsers resubscribe on
    // their next page load.
    const fresh = webpush.generateVAPIDKeys();
    await this.settings.set(SETTING.vapidPublicKey, fresh.publicKey);
    await this.settings.setSecret(SETTING.vapidPrivateKey, fresh.privateKey);
    await this.db.delete(pushSubscription);
    return fresh;
  }
}
