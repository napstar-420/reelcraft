import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  ConfirmCharacterReferenceDto,
  CreateCharacterDto,
  PromoteCharacterReferenceDto,
  UpdateCharacterDto,
  UpdateCharacterReferenceDto,
} from '@reefcraft/shared';
import type { ReferenceImage } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob, character, channel, run } from '../db/schema';
import { ulid } from '../common/ulid';
import { EngineConfig } from '../config/engine-config';
import { objectKey } from '../storage/object-key';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';

/** Persistent channel identity assets (§18). Bytes always flow directly
 * between browser/provider and object storage; this service only confirms or
 * copies durable objects and maintains the Character snapshot metadata. */
@Injectable()
export class CharacterService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly config: EngineConfig,
  ) {}

  async list(channelId: string) {
    await this.requireChannel(channelId);
    return this.db
      .select()
      .from(character)
      .where(and(eq(character.channelId, channelId), eq(character.scope, 'channel')));
  }

  async get(id: string) {
    const [row] = await this.db.select().from(character).where(eq(character.id, id)).limit(1);
    if (!row || row.scope !== 'channel') throw new NotFoundException(`Character ${id} not found`);
    return row;
  }

  async create(channelId: string, dto: CreateCharacterDto) {
    const channelRow = await this.requireChannel(channelId);
    const id = ulid();
    await this.db.insert(character).values({
      id,
      ownerId: channelRow.ownerId,
      channelId,
      scope: 'channel',
      name: dto.name,
      description: dto.description,
      referenceSet: [],
      readiness: 'draft',
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateCharacterDto) {
    await this.get(id);
    await this.db.update(character).set(dto).where(eq(character.id, id));
    return this.get(id);
  }

  async requestReferenceUpload(id: string, ext: string) {
    const row = await this.get(id);
    const blobId = ulid();
    const key = objectKey.characterRef(row.ownerId, id, blobId);
    return {
      blobId,
      objectKey: key,
      uploadUrl: await this.storage.presignPut(key, this.config.presignTtlSec),
      ext,
    };
  }

  async confirmReference(id: string, dto: ConfirmCharacterReferenceDto) {
    const row = await this.get(id);
    const expectedObjectKey = objectKey.characterRef(row.ownerId, id, dto.blobId);
    if (dto.objectKey !== expectedObjectKey) {
      throw new BadRequestException(
        'reference object key does not match the issued upload location',
      );
    }
    const stat = await this.storage.stat(dto.objectKey);
    if (!stat.mime.startsWith('image/'))
      throw new BadRequestException('character references must be images');
    const refs = this.references(row);
    if (refs.some((ref) => ref.blobId === dto.blobId))
      throw new BadRequestException('reference already exists');
    await this.db.transaction(async (tx) => {
      await tx.insert(blob).values({
        id: dto.blobId,
        ownerId: row.ownerId,
        scope: 'character',
        characterId: id,
        bucket: this.config.s3.bucket,
        objectKey: dto.objectKey,
        mime: stat.mime,
        bytes: stat.bytes,
        sha256: dto.sha256,
        etag: stat.etag,
      });
      refs.push({
        blobId: dto.blobId,
        view: dto.view,
        caption: dto.caption,
        origin: 'uploaded',
        order: dto.order ?? refs.length,
      });
      await tx
        .update(character)
        .set(this.referencePatch(refs, row.primaryRefId))
        .where(eq(character.id, id));
    });
    return this.get(id);
  }

  async updateReference(id: string, blobId: string, dto: UpdateCharacterReferenceDto) {
    const row = await this.get(id);
    const refs = this.references(row);
    const index = refs.findIndex((ref) => ref.blobId === blobId);
    if (index < 0) throw new NotFoundException(`Reference ${blobId} not found`);
    refs[index] = {
      ...refs[index]!,
      ...(dto.view !== undefined && { view: dto.view }),
      ...(dto.caption !== undefined && { caption: dto.caption }),
      ...(dto.order !== undefined && { order: dto.order }),
    };
    await this.db
      .update(character)
      .set(this.referencePatch(refs, row.primaryRefId))
      .where(eq(character.id, id));
    return this.get(id);
  }

  async setPrimary(id: string, blobId: string) {
    const row = await this.get(id);
    if (!this.references(row).some((ref) => ref.blobId === blobId))
      throw new BadRequestException('primary reference must belong to the character');
    await this.db
      .update(character)
      .set(this.referencePatch(this.references(row), blobId))
      .where(eq(character.id, id));
    return this.get(id);
  }

  async deleteReference(id: string, blobId: string): Promise<void> {
    const row = await this.get(id);
    const refs = this.references(row);
    if (!refs.some((ref) => ref.blobId === blobId))
      throw new NotFoundException(`Reference ${blobId} not found`);
    const remaining = refs.filter((ref) => ref.blobId !== blobId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(blob)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(blob.id, blobId), eq(blob.characterId, id)));
      await tx
        .update(character)
        .set(this.referencePatch(remaining, row.primaryRefId === blobId ? null : row.primaryRefId))
        .where(eq(character.id, id));
    });
  }

  async promoteReference(id: string, dto: PromoteCharacterReferenceDto) {
    const target = await this.get(id);
    const [source] = await this.db
      .select({ artifact, blob, channelId: run.channelId })
      .from(artifact)
      .innerJoin(run, eq(artifact.runId, run.id))
      .innerJoin(blob, eq(artifact.blobId, blob.id))
      .where(
        and(
          eq(artifact.id, dto.artifactId),
          eq(artifact.kind, 'media.image'),
          eq(artifact.stale, false),
          isNull(blob.deletedAt),
        ),
      )
      .limit(1);
    if (!source || source.channelId !== target.channelId)
      throw new BadRequestException('artifact is not an active image from this channel');
    const blobId = ulid();
    const key = objectKey.characterRef(target.ownerId, id, blobId);
    const copied = await this.storage.copy(source.blob.objectKey, key);
    const refs = this.references(target);
    await this.db.transaction(async (tx) => {
      await tx.insert(blob).values({
        id: blobId,
        ownerId: target.ownerId,
        scope: 'character',
        characterId: id,
        bucket: this.config.s3.bucket,
        objectKey: key,
        mime: source.blob.mime,
        bytes: copied.bytes,
        sha256: source.blob.sha256,
        etag: copied.etag,
      });
      refs.push({
        blobId,
        view: dto.view,
        caption: dto.caption,
        origin: 'generated',
        sourceArtifactId: dto.artifactId,
        order: refs.length,
      });
      await tx
        .update(character)
        .set(this.referencePatch(refs, target.primaryRefId))
        .where(eq(character.id, id));
    });
    return this.get(id);
  }

  private references(row: typeof character.$inferSelect): ReferenceImage[] {
    return (row.referenceSet as ReferenceImage[]).slice().sort((a, b) => a.order - b.order);
  }
  private referencePatch(refs: ReferenceImage[], primaryRefId: string | null) {
    const normalized = refs.map((ref, order) => ({ ...ref, order }));
    return {
      referenceSet: normalized,
      primaryRefId,
      readiness: normalized.length > 0 ? ('ready' as const) : ('draft' as const),
    };
  }
  private async requireChannel(id: string) {
    const [row] = await this.db.select().from(channel).where(eq(channel.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Channel ${id} not found`);
    return row;
  }
}
