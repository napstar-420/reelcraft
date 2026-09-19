import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { CreateAssetDto } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { asset, blob, channel } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { objectKey } from '../storage/object-key';
import { EngineConfig } from '../config/engine-config';
import { WorkspaceService } from '../storage/workspace.service';
import { MediaProbeService } from '../artifact/media-probe.service';

/**
 * §3.3 — reusable channel material with a lifetime longer than a run.
 * Upload is a two-step flow, same shape as `RunInputService`'s media
 * inputs: `requestUpload` issues a presigned PUT and writes nothing; `create`
 * confirms the upload happened (via `storage.stat()`) and writes the
 * `blob`+`asset` rows.
 */
@Injectable()
export class AssetService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly engineConfig: EngineConfig,
    private readonly workspaces: WorkspaceService,
    private readonly probes: MediaProbeService,
  ) {}

  async requestUpload(
    channelId: string,
    ext: string,
  ): Promise<{ blobId: string; objectKey: string; uploadUrl: string }> {
    const ownerId = await this.requireChannelOwner(channelId);
    const blobId = ulid();
    const key = objectKey.asset(ownerId, channelId, blobId, ext);
    const uploadUrl = await this.storage.presignPut(key, this.engineConfig.presignTtlSec);
    return { blobId, objectKey: key, uploadUrl };
  }

  async create(channelId: string, dto: CreateAssetDto) {
    const ownerId = await this.requireChannelOwner(channelId);
    const stat = await this.storage.stat(dto.objectKey);
    const probe = dto.kind.startsWith('media.')
      ? await this.workspaces.withWorkspace(dto.blobId, async (workspace) =>
          this.probes.probe(await workspace.pull(dto.objectKey)),
        )
      : undefined;

    await this.db.insert(blob).values({
      id: dto.blobId,
      ownerId,
      scope: 'asset',
      bucket: this.engineConfig.s3.bucket,
      objectKey: dto.objectKey,
      mime: stat.mime,
      bytes: stat.bytes,
      sha256: dto.sha256,
      etag: stat.etag,
      probe,
    });

    const id = ulid();
    await this.db.insert(asset).values({
      id,
      ownerId,
      channelId,
      name: dto.name,
      kind: dto.kind,
      blobId: dto.blobId,
      tags: dto.tags,
    });
    return this.get(id);
  }

  /** Excludes assets whose backing blob is soft-deleted (`delete()` below) —
   * a deleted asset shouldn't appear in listings even though its row
   * technically still exists (§4.5's pattern, applied to assets rather than
   * the run-scoped retention sweep it was written for). */
  async list(channelId: string) {
    const rows = await this.db
      .select({ asset })
      .from(asset)
      .innerJoin(blob, eq(asset.blobId, blob.id))
      .where(and(eq(asset.channelId, channelId), isNull(blob.deletedAt)));
    return rows.map((r) => r.asset);
  }

  async get(id: string) {
    const [row] = await this.db.select().from(asset).where(eq(asset.id, id)).limit(1);
    if (!row) throw new Error(`Asset ${id} not found`);
    return row;
  }

  /** Soft-delete via `blob.deletedAt` rather than removing the `asset` row —
   * §4.5's pattern, though assets are channel-scoped and never collected by
   * the run-scoped retention sweep, so this is a direct delete-marking, not
   * a `gc_eligible` flip. Known limitation: `asset_channel_id_name_uq`
   * still holds the deleted row's name, so re-uploading under the same name
   * requires the deleted row to be dealt with first — acceptable for phase
   * 4's scope, revisit if this proves annoying in practice. */
  async delete(id: string): Promise<void> {
    const row = await this.get(id);
    await this.db
      .update(blob)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(blob.id, row.blobId));
  }

  private async requireChannelOwner(channelId: string): Promise<string> {
    const [row] = await this.db
      .select({ ownerId: channel.ownerId })
      .from(channel)
      .where(eq(channel.id, channelId))
      .limit(1);
    if (!row) throw new Error(`Channel ${channelId} not found`);
    return row.ownerId;
  }
}
