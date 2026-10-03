import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { ulid } from '../common/ulid';
import { redactSecrets } from '../common/redact-secrets';
import { objectKey } from '../storage/object-key';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blob, channel, character, storageOrphan } from '../db/schema';
import { queueStorageOrphans } from './storage-orphans';
import { EngineConfig } from '../config/engine-config';

/** Thin wrapper over StorageAdapter for the object-key conventions §4.3
 * defines — raw provider responses, in particular, always go through
 * redactSecrets() before being written. */
@Injectable()
export class BlobService {
  private readonly logger = new Logger(BlobService.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly config: EngineConfig,
  ) {}

  async readUrl(
    ownerId: string,
    blobId: string,
  ): Promise<
    | { status: 'live'; url: string }
    | { status: 'gone'; blob: { id: string; mime: string; bytes: number } }
    | undefined
  > {
    const [row] = await this.db
      .select()
      .from(blob)
      .where(and(eq(blob.id, blobId), eq(blob.ownerId, ownerId)))
      .limit(1);
    if (!row) {
      this.logger.debug({ blobId }, 'blob lookup missed');
      return undefined;
    }
    if (row.deletedAt) {
      this.logger.debug({ blobId }, 'blob lookup found collected blob');
      return { status: 'gone', blob: { id: row.id, mime: row.mime, bytes: row.bytes } };
    }
    const url = await this.storage.presignGet(row.objectKey, this.config.presignTtlSec);
    this.logger.debug({ blobId, ttlSec: this.config.presignTtlSec }, 'blob presigned');
    return { status: 'live', url };
  }

  /** Reads a small text blob (a subtitles file) for inline display;
   * undefined when missing, collected, or larger than `maxBytes`. */
  async readText(ownerId: string, blobId: string, maxBytes: number): Promise<string | undefined> {
    const [row] = await this.db
      .select()
      .from(blob)
      .where(and(eq(blob.id, blobId), eq(blob.ownerId, ownerId)))
      .limit(1);
    if (!row || row.deletedAt || row.bytes > maxBytes) return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(row.objectKey)) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Bounded/idempotent retention sweep. Deleting an already-removed object
   * is accepted by compatible S3 stores; the DB stamp is the durable truth. */
  async collectEligible(limit = 100): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.blobRetentionDays * 86_400_000).toISOString();
    const rows = await this.db
      .select()
      .from(blob)
      .where(
        and(
          eq(blob.scope, 'run'),
          eq(blob.gcEligible, true),
          isNull(blob.deletedAt),
          or(isNull(blob.gcEligibleAt), lte(blob.gcEligibleAt, cutoff)),
        ),
      )
      .limit(limit);
    for (const row of rows) {
      await this.storage.delete([row.objectKey]);
      await this.db
        .update(blob)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(blob.id, row.id), isNull(blob.deletedAt)));
    }
    if (rows.length) this.logger.log({ collected: rows.length }, 'blobs collected');
    return rows.length;
  }

  /** Deletes queued orphan objects (`storage_orphan`) once they have waited
   * `blobRetentionDays`, then forgets them. Bounded and idempotent like
   * `collectEligible`: deleting a missing object is accepted. */
  async collectOrphans(limit = 500): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.blobRetentionDays * 86_400_000).toISOString();
    const rows = await this.db
      .select({ objectKey: storageOrphan.objectKey })
      .from(storageOrphan)
      .where(lte(storageOrphan.queuedAt, cutoff))
      .limit(limit);
    if (rows.length === 0) return 0;
    const keys = rows.map((row) => row.objectKey);
    await this.storage.delete(keys);
    await this.db.delete(storageOrphan).where(inArray(storageOrphan.objectKey, keys));
    this.logger.log({ collected: keys.length }, 'orphaned objects collected');
    return keys.length;
  }

  /** Finds objects left in storage by channels and characters deleted before
   * deletes queued their files, and queues them. Object keys start with
   * `<owner>/<channelId>/` or `<owner>/characters/<characterId>/`
   * (`storage/object-key.ts`); a folder is only queued when its id is a ULID
   * and no channel or character row with that id exists. */
  async queueOrphanedFolders(): Promise<number> {
    const isUlid = (value: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
    const segment = (prefix: string) => prefix.split('/').at(-2) ?? '';
    let queued = 0;
    const queueFolder = async (prefix: string) => {
      const keys = await this.storage.listAll(prefix);
      await queueStorageOrphans(this.db, keys, 'orphaned_prefix');
      queued += keys.length;
      this.logger.log({ prefix, objects: keys.length }, 'orphaned storage folder queued');
    };
    for (const ownerPrefix of (await this.storage.list('')).prefixes) {
      for (const prefix of (await this.storage.list(ownerPrefix)).prefixes) {
        const id = segment(prefix);
        if (id === 'characters') {
          for (const characterPrefix of (await this.storage.list(prefix)).prefixes) {
            const characterId = segment(characterPrefix);
            if (!isUlid(characterId)) continue;
            const [row] = await this.db
              .select({ id: character.id })
              .from(character)
              .where(eq(character.id, characterId))
              .limit(1);
            if (!row) await queueFolder(characterPrefix);
          }
          continue;
        }
        if (!isUlid(id)) continue;
        const [row] = await this.db
          .select({ id: channel.id })
          .from(channel)
          .where(eq(channel.id, id))
          .limit(1);
        if (!row) await queueFolder(prefix);
      }
    }
    return queued;
  }

  async writeRawResponse(params: {
    ownerId: string;
    channelId: string;
    runId: string;
    attemptId: string;
    payload: unknown;
  }): Promise<string> {
    const key = objectKey.rawResponse(
      params.ownerId,
      params.channelId,
      params.runId,
      params.attemptId,
    );
    const body = Buffer.from(JSON.stringify(redactSecrets(stripMediaPayloads(params.payload))));
    await this.storage.put(key, body, { mime: 'application/json' });
    this.logger.debug(
      { runId: params.runId, attemptId: params.attemptId, storageKey: key, bytes: body.length },
      'raw response stored',
    );
    return key;
  }

  newBlobId(): string {
    return ulid();
  }
}

/** Base64 media can be hundreds of MB. Audit data keeps a fingerprint and
 * metadata, never a second durable copy of the bytes. */
function stripMediaPayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMediaPayloads);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === 'base64' && typeof child === 'string') {
      next[key] = { omitted: true, bytesApprox: Math.floor((child.length * 3) / 4) };
    } else next[key] = stripMediaPayloads(child);
  }
  return next;
}
