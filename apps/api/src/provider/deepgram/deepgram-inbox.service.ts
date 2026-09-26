import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { providerJob } from '../../db/schema';
import { ulid } from '../../common/ulid';

@Injectable()
export class DeepgramInboxService {
  private readonly logger = new Logger(DeepgramInboxService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async createOrGet(idempotencyKey: string, payload: unknown) {
    const [existing] = await this.db
      .select()
      .from(providerJob)
      .where(
        and(eq(providerJob.provider, 'deepgram'), eq(providerJob.idempotencyKey, idempotencyKey)),
      )
      .limit(1);
    if (existing) return existing;
    const row = {
      id: ulid(),
      provider: 'deepgram',
      idempotencyKey,
      callbackToken: randomBytes(24).toString('hex'),
      state: 'submitting' as const,
      payload,
    };
    try {
      await this.db.insert(providerJob).values(row);
    } catch (error) {
      this.logger.warn(
        { providerId: 'deepgram', jobId: row.id, err: error },
        'deepgram inbox insert conflicted',
      );
      const [again] = await this.db
        .select()
        .from(providerJob)
        .where(
          and(eq(providerJob.provider, 'deepgram'), eq(providerJob.idempotencyKey, idempotencyKey)),
        )
        .limit(1);
      if (again) return again;
      throw new Error('DeepgramInbox: unable to create provider job');
    }
    return row;
  }

  async markSubmitted(id: string, externalId: string) {
    await this.db
      .update(providerJob)
      .set({ state: 'submitted', externalId })
      .where(eq(providerJob.id, id));
  }
  async get(id: string) {
    const [row] = await this.db.select().from(providerJob).where(eq(providerJob.id, id)).limit(1);
    return row;
  }
  async accept(token: string, payload: unknown): Promise<boolean> {
    const [job] = await this.db
      .select()
      .from(providerJob)
      .where(and(eq(providerJob.provider, 'deepgram'), eq(providerJob.callbackToken, token)))
      .limit(1);
    if (!job) {
      this.logger.warn({ providerId: 'deepgram' }, 'deepgram callback token not recognized');
      return false;
    }
    if (job.state === 'completed') {
      this.logger.debug({ providerId: 'deepgram', jobId: job.id }, 'deepgram callback duplicate');
      return true;
    }
    await this.db
      .update(providerJob)
      .set({ state: 'completed', result: payload, completedAt: new Date().toISOString() })
      .where(eq(providerJob.id, job.id));
    this.logger.log(
      { providerId: 'deepgram', jobId: job.id, externalId: job.externalId },
      'deepgram callback accepted',
    );
    return true;
  }
}
