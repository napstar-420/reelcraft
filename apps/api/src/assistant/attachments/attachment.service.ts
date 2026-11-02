import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import {
  Probe,
  type AssistantAttachmentDto,
  type AssistantAttachmentKind,
  type AssistantAttachmentRef,
  type CreateAssistantAttachmentDto,
} from '@reelcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../../db/drizzle.provider';
import { assistantAttachment, blob } from '../../db/schema/index';
import { ulid } from '../../common/ulid';
import { EngineConfig } from '../../config/engine-config';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { objectKey } from '../../storage/object-key';
import { WorkspaceService } from '../../storage/workspace.service';
import { MediaProbeService } from '../../artifact/media-probe.service';
import { queueStorageOrphans } from '../../artifact/storage-orphans';
import {
  attachmentKind,
  attachmentMime,
  attachmentProblem,
  extOf,
  mediaFacts,
} from './attachment.logic';

/** Unsent attachments older than this are deleted. */
const UNSENT_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

type Row = typeof assistantAttachment.$inferSelect & {
  mime: string;
  bytes: number;
  probe: unknown;
  objectKey: string;
};

/** Files the user gives the assistant. Same two-step upload as the Library (`AssetService`):
 * a presigned PUT, then a confirm that checks the file and writes the rows. */
@Injectable()
export class AttachmentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentService.name);
  private sweeper: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly config: EngineConfig,
    private readonly workspaces: WorkspaceService,
    private readonly probes: MediaProbeService,
  ) {}

  onModuleInit(): void {
    this.sweeper = setInterval(() => {
      void this.sweepUnsent().catch((error: unknown) =>
        this.logger.warn({ err: error }, 'unsent attachment sweep failed'),
      );
    }, SWEEP_EVERY_MS);
    this.sweeper.unref();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  async requestUpload(ownerId: string, ext: string) {
    const blobId = ulid();
    const key = objectKey.assistantAttachment(ownerId, blobId, ext.toLowerCase());
    const uploadUrl = await this.storage.presignPut(key, this.config.presignTtlSec);
    return { blobId, objectKey: key, uploadUrl };
  }

  async create(
    ownerId: string,
    dto: CreateAssistantAttachmentDto,
  ): Promise<AssistantAttachmentDto> {
    const ext = extOf(dto.objectKey);
    if (dto.objectKey !== objectKey.assistantAttachment(ownerId, dto.blobId, ext)) {
      throw new BadRequestException({
        code: 'attachment_key_mismatch',
        message: 'Upload the file with the link from POST assistant/attachments/upload.',
      });
    }
    const stat = await this.storage.stat(dto.objectKey);
    return this.store({
      ownerId,
      blobId: dto.blobId,
      key: dto.objectKey,
      name: dto.name,
      mime: stat.mime,
      bytes: stat.bytes,
      etag: stat.etag ?? null,
      sha256: dto.sha256 ?? 'unhashed',
      source: 'upload',
      sourceUrl: null,
    });
  }

  /** Stores a file already in storage at `key` as an attachment (an upload, or a downloaded link).
   * Probes media, applies the limits, and deletes the object when it's refused. */
  async store(input: {
    ownerId: string;
    blobId: string;
    key: string;
    name: string;
    mime: string;
    bytes: number;
    etag: string | null;
    sha256: string;
    source: 'upload' | 'link';
    sourceUrl: string | null;
  }): Promise<AssistantAttachmentDto> {
    const ext = extOf(input.key);
    const mime = attachmentMime(input.mime, ext);
    const kind = attachmentKind(mime, ext);
    let probe: Probe | undefined;
    if (kind !== 'file' && input.bytes > 0) {
      probe = await this.workspaces
        .withWorkspace(input.blobId, async (ws) => this.probes.probe(await ws.pull(input.key)))
        .catch(() => undefined);
    }
    const facts = mediaFacts(probe, kind);
    const problem = attachmentProblem({
      kind,
      bytes: input.bytes,
      durationSec: facts.durationSec,
      probed: probe !== undefined,
    });
    if (problem) {
      await queueStorageOrphans(this.db, [input.key], 'upload_rejected');
      throw new BadRequestException({ code: 'attachment_rejected', message: problem });
    }
    const id = ulid();
    await this.db.transaction(async (tx) => {
      await tx.insert(blob).values({
        id: input.blobId,
        ownerId: input.ownerId,
        scope: 'assistant',
        bucket: this.config.s3.bucket,
        objectKey: input.key,
        mime,
        bytes: input.bytes,
        sha256: input.sha256,
        etag: input.etag,
        probe,
      });
      await tx.insert(assistantAttachment).values({
        id,
        ownerId: input.ownerId,
        blobId: input.blobId,
        name: input.name,
        kind,
        source: input.source,
        sourceUrl: input.sourceUrl,
      });
    });
    return this.get(id);
  }

  async get(id: string): Promise<AssistantAttachmentDto> {
    const [row] = await this.rows(eq(assistantAttachment.id, id));
    if (!row) throw new NotFoundException(`No attachment ${id}`);
    return toDto(row);
  }

  /** The stored file behind an attachment, for the media tools. */
  async file(id: string): Promise<{
    blobId: string;
    objectKey: string;
    mime: string;
    kind: AssistantAttachmentKind;
    name: string;
    probe: Probe | null;
  }> {
    const [row] = await this.rows(eq(assistantAttachment.id, id));
    if (!row) throw new NotFoundException(`No attachment ${id}`);
    const parsed = Probe.safeParse(row.probe);
    return {
      blobId: row.blobId,
      objectKey: row.objectKey,
      mime: row.mime,
      kind: row.kind as AssistantAttachmentKind,
      name: row.name,
      probe: parsed.success ? parsed.data : null,
    };
  }

  /** The attachments of one chat, oldest first. */
  async listForSession(sessionId: string): Promise<AssistantAttachmentDto[]> {
    return (await this.rows(eq(assistantAttachment.sessionId, sessionId))).map(toDto);
  }

  /** Binds unsent attachments to the chat a message is sent in. An attachment already sent in this
   * chat can be sent again; one from another chat can't. */
  async claim(
    ownerId: string,
    sessionId: string,
    ids: string[],
  ): Promise<AssistantAttachmentRef[]> {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const rows = await this.rows(inArray(assistantAttachment.id, unique));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      const row = byId.get(id);
      if (!row || row.ownerId !== ownerId) {
        throw new BadRequestException({
          code: 'attachment_missing',
          message: `No attachment ${id}.`,
        });
      }
      if (row.sessionId && row.sessionId !== sessionId) {
        throw new BadRequestException({
          code: 'attachment_other_chat',
          message: `"${row.name}" was sent in another chat. Attach it again.`,
        });
      }
    }
    await this.db
      .update(assistantAttachment)
      .set({ sessionId })
      .where(and(inArray(assistantAttachment.id, unique), isNull(assistantAttachment.sessionId)));
    return unique.map((id) => toRef(byId.get(id)!));
  }

  /** Removes an attachment that hasn't been sent (a sent one is deleted with its chat). */
  async deleteUnsent(ownerId: string, id: string): Promise<void> {
    const [row] = await this.rows(eq(assistantAttachment.id, id));
    if (!row || row.ownerId !== ownerId) throw new NotFoundException(`No attachment ${id}`);
    if (row.sessionId) {
      throw new BadRequestException({
        code: 'attachment_sent',
        message: 'This file was sent in a chat; it is deleted with the chat.',
      });
    }
    await this.db.transaction((tx) => this.deleteRows(tx, [row]));
  }

  /** Deletes a chat's attachments and queues their files (call inside the chat's delete). */
  async deleteForSession(tx: Tx, sessionId: string): Promise<void> {
    const rows = await tx
      .select({
        id: assistantAttachment.id,
        blobId: assistantAttachment.blobId,
        objectKey: blob.objectKey,
      })
      .from(assistantAttachment)
      .innerJoin(blob, eq(blob.id, assistantAttachment.blobId))
      .where(eq(assistantAttachment.sessionId, sessionId));
    await this.deleteRows(tx, rows);
  }

  /** Deletes attachments uploaded but never sent. */
  async sweepUnsent(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - UNSENT_TTL_MS).toISOString();
    const rows = await this.db
      .select({
        id: assistantAttachment.id,
        blobId: assistantAttachment.blobId,
        objectKey: blob.objectKey,
      })
      .from(assistantAttachment)
      .innerJoin(blob, eq(blob.id, assistantAttachment.blobId))
      .where(and(isNull(assistantAttachment.sessionId), lt(assistantAttachment.createdAt, cutoff)));
    if (rows.length) await this.db.transaction((tx) => this.deleteRows(tx, rows));
    return rows.length;
  }

  private async deleteRows(
    tx: Tx,
    rows: Array<{ id: string; blobId: string; objectKey: string }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await queueStorageOrphans(
      tx,
      rows.map((r) => r.objectKey),
      'assistant_attachment_deleted',
    );
    await tx.delete(assistantAttachment).where(
      inArray(
        assistantAttachment.id,
        rows.map((r) => r.id),
      ),
    );
    await tx
      .delete(blob)
      .where(or(...rows.map((r) => and(eq(blob.id, r.blobId), eq(blob.scope, 'assistant')))));
  }

  private rows(where: SQL | undefined): Promise<Row[]> {
    return this.db
      .select({
        id: assistantAttachment.id,
        ownerId: assistantAttachment.ownerId,
        sessionId: assistantAttachment.sessionId,
        blobId: assistantAttachment.blobId,
        name: assistantAttachment.name,
        kind: assistantAttachment.kind,
        source: assistantAttachment.source,
        sourceUrl: assistantAttachment.sourceUrl,
        createdAt: assistantAttachment.createdAt,
        mime: blob.mime,
        bytes: blob.bytes,
        probe: blob.probe,
        objectKey: blob.objectKey,
      })
      .from(assistantAttachment)
      .innerJoin(blob, eq(blob.id, assistantAttachment.blobId))
      .where(where)
      .orderBy(assistantAttachment.createdAt) as Promise<Row[]>;
  }
}

function toDto(row: Row): AssistantAttachmentDto {
  const parsed = Probe.safeParse(row.probe);
  const kind = row.kind as AssistantAttachmentKind;
  return {
    id: row.id,
    blobId: row.blobId,
    name: row.name,
    kind,
    mime: row.mime,
    bytes: row.bytes,
    ...mediaFacts(parsed.success ? parsed.data : null, kind),
    source: row.source === 'link' ? 'link' : 'upload',
    sourceUrl: row.sourceUrl,
    sessionId: row.sessionId,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function toRef(row: Row): AssistantAttachmentRef {
  const { id, blobId, name, kind, mime, width, height, durationSec, source, sourceUrl } =
    toDto(row);
  return { id, blobId, name, kind, mime, width, height, durationSec, source, sourceUrl };
}
