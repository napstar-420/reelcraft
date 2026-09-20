import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Probe } from '@reefcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { artifact, blob, channel, run } from '../db/schema/index';
import { objectKey } from '../storage/object-key';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { WorkspaceService } from '../storage/workspace.service';
import { ulid } from '../common/ulid';
import { MediaProbeService } from './media-probe.service';

const execFileAsync = promisify(execFile);

export type DerivedFrameKind = 'firstFrame' | 'lastFrame';

/** Shape matches the compact descriptor `mediaManifest()`/`blobManifest()`
 * return in `binding-resolver.service.ts` — a derived frame has no artifact
 * row of its own (it's cached on the SOURCE artifact's `derived` column), so
 * there's no `artifactId` to report here; the caller (`resolve()`'s
 * `'prevItem'` case) attaches the source artifact's id to `RefProvenance`
 * itself. */
export interface DerivedFrameManifest {
  handle: string;
  kind: 'media.image';
  sourceKey?: string;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

type ArtifactRow = typeof artifact.$inferSelect;
type Executor = Db | Tx;

/**
 * §14.4 — the ffmpeg-backed `{from:'prevItem', path:'lastFrame'|'firstFrame'}`
 * shortcut. Extraction runs inline (no separate Inngest step boundary, same
 * convention as other ffmpeg-adjacent work in this module), and is cached:
 * once a frame is extracted for a given source artifact, `artifact.derived`
 * remembers its blob id so a later read never re-invokes ffmpeg. Concurrent
 * extraction attempts on the same artifact serialize on a `SELECT ... FOR
 * UPDATE` row lock, re-checking the cache under the lock before doing any
 * work — the standard "extract on first access" race guard.
 */
@Injectable()
export class DerivedFrameService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly workspaces: WorkspaceService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly probes: MediaProbeService,
  ) {}

  async extract(row: ArtifactRow, which: DerivedFrameKind): Promise<DerivedFrameManifest> {
    const cached = (row.derived as Record<string, string> | null)?.[which];
    if (cached) return this.manifestFor(cached, which, this.db);

    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(artifact)
        .where(eq(artifact.id, row.id))
        .for('update');
      if (!locked) {
        throw new Error(
          `DerivedFrameService: artifact "${row.id}" not found while extracting ${which}`,
        );
      }
      const already = (locked.derived as Record<string, string> | null)?.[which];
      if (already) return this.manifestFor(already, which, tx);

      const blobId = await this.extractAndStore(tx, locked, which);
      await tx
        .update(artifact)
        .set({
          derived: sql`coalesce(${artifact.derived}, '{}'::jsonb) || ${JSON.stringify({ [which]: blobId })}::jsonb`,
        })
        .where(eq(artifact.id, row.id));
      return this.manifestFor(blobId, which, tx);
    });
  }

  /** Thin wrapper around the actual ffmpeg invocation so unit tests can spy
   * on / replace it without shelling out to a real binary. */
  protected async runFfmpeg(args: string[]): Promise<void> {
    await execFileAsync('ffmpeg', args);
  }

  private async extractAndStore(
    tx: Tx,
    row: ArtifactRow,
    which: DerivedFrameKind,
  ): Promise<string> {
    if (!row.blobId) {
      throw new Error(
        `DerivedFrameService: artifact "${row.id}" has no source media to extract a ${which} from`,
      );
    }
    const [sourceBlob] = await tx
      .select({ objectKey: blob.objectKey })
      .from(blob)
      .where(eq(blob.id, row.blobId))
      .limit(1);
    if (!sourceBlob) {
      throw new Error(`DerivedFrameService: source blob "${row.blobId}" not found`);
    }
    const [runRow] = await tx
      .select({ channelId: run.channelId })
      .from(run)
      .where(eq(run.id, row.runId))
      .limit(1);
    if (!runRow) throw new Error(`DerivedFrameService: run "${row.runId}" not found`);
    const [channelRow] = await tx
      .select({ ownerId: channel.ownerId })
      .from(channel)
      .where(eq(channel.id, runRow.channelId))
      .limit(1);
    const ownerId = channelRow?.ownerId ?? 'local';

    return this.workspaces.withWorkspace(row.runId, async (ws) => {
      const source = await ws.pull(sourceBlob.objectKey);
      const framePath = path.join(ws.dir, `${which}.png`);
      // `-sseof -0.1` reads from 0.1s before EOF — a standard ffmpeg idiom
      // for "the last frame" that works off the container's own end of
      // stream, without needing the exact duration up front.
      const args =
        which === 'firstFrame'
          ? ['-y', '-i', source, '-frames:v', '1', framePath]
          : ['-y', '-sseof', '-0.1', '-i', source, '-frames:v', '1', framePath];
      await this.runFfmpeg(args);
      const bytes = await readFile(framePath);
      let probe: Probe | undefined;
      try {
        probe = await this.probes.probe(framePath);
      } catch {
        // A frame PNG has no audio/duration for ffprobe to report on some
        // builds — the manifest degrades gracefully to no width/height
        // rather than failing the whole extraction over a probe quirk.
        probe = undefined;
      }
      const blobId = ulid();
      const key = objectKey.derivedFrame(ownerId, runRow.channelId, row.runId, blobId);
      const put = await this.storage.put(key, createReadStream(framePath), { mime: 'image/png' });
      await tx.insert(blob).values({
        id: blobId,
        ownerId,
        scope: 'run',
        runId: row.runId,
        bucket: '',
        objectKey: key,
        mime: 'image/png',
        bytes: put.bytes,
        etag: put.etag,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(probe && { probe }),
      });
      return blobId;
    });
  }

  private async manifestFor(
    blobId: string,
    which: DerivedFrameKind,
    executor: Executor,
  ): Promise<DerivedFrameManifest> {
    const [blobRow] = await executor
      .select({ objectKey: blob.objectKey, probe: blob.probe })
      .from(blob)
      .where(eq(blob.id, blobId))
      .limit(1);
    if (!blobRow) {
      throw new Error(`DerivedFrameService: derived frame blob "${blobId}" not found`);
    }
    const probe = blobRow.probe as {
      streams?: Array<{ type?: string; width?: number; height?: number }>;
    } | null;
    const video = probe?.streams?.find((stream) => stream.type === 'video');
    return {
      handle: `prevItem:${which}`,
      kind: 'media.image',
      ...(blobRow.objectKey && { sourceKey: blobRow.objectKey }),
      ...(video?.width !== undefined && { width: video.width }),
      ...(video?.height !== undefined && { height: video.height }),
      hasAudio: false,
    };
  }
}
