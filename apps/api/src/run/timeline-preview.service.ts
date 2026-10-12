import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { TimelinePreviewRenderDto } from '@reelcraft/shared';
import { MediaArtifactService } from '../artifact/media-artifact.service';
import { queueStorageOrphans } from '../artifact/storage-orphans';
import { TimelineResourceResolverService } from '../artifact/timeline-resource-resolver.service';
import { timelineRenderSpec } from '../capability/impls/assembly.capability';
import { StyleRegistry } from '../capability/style.registry';
import { ulid } from '../common/ulid';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blob, channel, run, timelinePreviewRender } from '../db/schema';
import { ComputeJobService, type ComputeHandle } from '../storage/compute-job.service';
import { TimelineEditorService } from './timeline-editor.service';

type Row = typeof timelinePreviewRender.$inferSelect;

/** How long a draft render may take before it is stopped. */
const DRAFT_RENDER_MAX_WAIT_SEC = 900;

/**
 * Renders the saved draft of a timeline editor stage into a video, so the person can check the real
 * result before submitting. The render is a compute job (a detached process, so it survives a
 * restart of the API); this keeps its state in `timeline_preview_render` and finishes it when asked
 * about it: no background task is needed. Each editor stage keeps only its latest render.
 */
@Injectable()
export class TimelinePreviewService {
  private readonly logger = new Logger(TimelinePreviewService.name);
  /** Renders being finished right now, so two requests don't store the same video twice. */
  private readonly settling = new Map<string, Promise<void>>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly editor: TimelineEditorService,
    private readonly resolver: TimelineResourceResolverService,
    private readonly compute: ComputeJobService,
    private readonly media: MediaArtifactService,
    private readonly styles: StyleRegistry,
    private readonly config: EngineConfig,
  ) {}

  /** Renders the saved draft, replacing any earlier render of this stage. */
  async start(runId: string, stageKey: string): Promise<TimelinePreviewRenderDto> {
    const draft = await this.editor.savedDraft(runId, stageKey);
    const resources = await this.resolver.resolve(runId, draft.timeline);
    // Building the job checks every clip has a file, so a bad draft fails here, before anything runs.
    const spec = timelineRenderSpec({
      timeline: draft.timeline,
      resources,
      styles: this.styles.tokensById(),
      quality: 'draft',
      maxWaitSec: DRAFT_RENDER_MAX_WAIT_SEC,
      browserExecutable: this.config.remotionBrowserExecutable,
    });
    await this.discardAll(runId, stageKey);
    const id = ulid();
    await this.db.insert(timelinePreviewRender).values({
      id,
      runId,
      stageKey,
      draftRevision: draft.draftRevision,
      state: 'rendering',
    });
    try {
      const handle = await this.compute.spawn(id, spec);
      await this.db
        .update(timelinePreviewRender)
        .set({ jobHandle: handle })
        .where(eq(timelinePreviewRender.id, id));
    } catch (error) {
      await this.fail(id, error instanceof Error ? error.message : String(error));
    }
    this.logger.log(
      { runId, stageKey, previewId: id, draftRevision: draft.draftRevision },
      'draft render started',
    );
    return this.toDto(await this.get(id));
  }

  /** The latest render of this stage (finishing it first if it has just stopped), or null. */
  async current(runId: string, stageKey: string): Promise<TimelinePreviewRenderDto | null> {
    const [latest] = await this.db
      .select()
      .from(timelinePreviewRender)
      .where(
        and(eq(timelinePreviewRender.runId, runId), eq(timelinePreviewRender.stageKey, stageKey)),
      )
      .orderBy(desc(timelinePreviewRender.createdAt))
      .limit(1);
    if (!latest) return null;
    if (latest.state === 'rendering' && latest.jobHandle) await this.settle(latest);
    return this.toDto(await this.get(latest.id));
  }

  /** Stops a render that is still running. */
  async cancel(runId: string, stageKey: string): Promise<TimelinePreviewRenderDto | null> {
    const rows = await this.db
      .select()
      .from(timelinePreviewRender)
      .where(
        and(
          eq(timelinePreviewRender.runId, runId),
          eq(timelinePreviewRender.stageKey, stageKey),
          eq(timelinePreviewRender.state, 'rendering'),
        ),
      );
    for (const row of rows) {
      await this.stopJob(row);
      await this.db
        .update(timelinePreviewRender)
        .set({ state: 'cancelled', finishedAt: new Date().toISOString() })
        .where(
          and(eq(timelinePreviewRender.id, row.id), eq(timelinePreviewRender.state, 'rendering')),
        );
    }
    return this.current(runId, stageKey);
  }

  private async get(id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(timelinePreviewRender)
      .where(eq(timelinePreviewRender.id, id))
      .limit(1);
    if (!row) throw new Error(`Draft render ${id} not found`);
    return row;
  }

  private toDto(row: Row): TimelinePreviewRenderDto {
    return {
      id: row.id,
      state: row.state,
      draftRevision: row.draftRevision,
      createdAt: row.createdAt,
      ...(row.error && { error: row.error }),
      ...(row.state === 'done' && row.blobId && { url: `/api/blobs/${row.blobId}` }),
    };
  }

  private async stopJob(row: Row) {
    const handle = row.jobHandle as ComputeHandle | null;
    if (handle) await this.compute.cancel(handle).catch(() => undefined);
    await this.compute.cleanup(row.id).catch(() => undefined);
  }

  private async fail(id: string, error: string) {
    this.logger.warn({ previewId: id, error }, 'draft render failed');
    await this.db
      .update(timelinePreviewRender)
      .set({ state: 'failed', error: error.slice(0, 600), finishedAt: new Date().toISOString() })
      .where(and(eq(timelinePreviewRender.id, id), eq(timelinePreviewRender.state, 'rendering')));
  }

  /** If the compute job has stopped, store its video and mark the render done (or failed). */
  private settle(row: Row): Promise<void> {
    const running = this.settling.get(row.id);
    if (running) return running;
    const work = this.finish(row).finally(() => this.settling.delete(row.id));
    this.settling.set(row.id, work);
    return work;
  }

  private async finish(row: Row) {
    const handle = row.jobHandle as ComputeHandle;
    const status = await this.compute.poll(handle);
    if (!status.done) return;
    if (status.outcome === 'failed') {
      await this.fail(row.id, status.reason);
      await this.compute.cleanup(row.id).catch(() => undefined);
      return;
    }
    try {
      const [owner] = await this.db
        .select({ ownerId: channel.ownerId, channelId: run.channelId })
        .from(run)
        .innerJoin(channel, eq(run.channelId, channel.id))
        .where(eq(run.id, row.runId))
        .limit(1);
      if (!owner) throw new Error('The run no longer exists');
      const file = await this.compute.collect(handle);
      const stored = await this.media.persist({
        ownerId: owner.ownerId,
        channelId: owner.channelId,
        runId: row.runId,
        source: { kind: 'media.video', localPath: file, mime: 'video/mp4', filename: 'draft.mp4' },
      });
      await this.db
        .update(timelinePreviewRender)
        .set({
          state: 'done',
          blobId: stored.blobId,
          jobHandle: null,
          finishedAt: new Date().toISOString(),
        })
        .where(
          and(eq(timelinePreviewRender.id, row.id), eq(timelinePreviewRender.state, 'rendering')),
        );
      this.logger.log(
        { runId: row.runId, previewId: row.id, blobId: stored.blobId },
        'draft render stored',
      );
    } catch (error) {
      await this.fail(row.id, error instanceof Error ? error.message : String(error));
    } finally {
      await this.compute.cleanup(row.id).catch(() => undefined);
    }
  }

  /** Removes every render of this stage: running ones are stopped, finished ones lose their video
   * (queued for the storage sweep). */
  private async discardAll(runId: string, stageKey: string) {
    const rows = await this.db
      .select()
      .from(timelinePreviewRender)
      .where(
        and(eq(timelinePreviewRender.runId, runId), eq(timelinePreviewRender.stageKey, stageKey)),
      );
    if (rows.length === 0) return;
    for (const row of rows) if (row.state === 'rendering') await this.stopJob(row);
    const blobIds = rows.flatMap((row) => (row.blobId ? [row.blobId] : []));
    await this.db.transaction(async (tx) => {
      await tx.delete(timelinePreviewRender).where(
        inArray(
          timelinePreviewRender.id,
          rows.map((row) => row.id),
        ),
      );
      if (blobIds.length === 0) return;
      const files = await tx
        .delete(blob)
        .where(inArray(blob.id, blobIds))
        .returning({ objectKey: blob.objectKey });
      await queueStorageOrphans(
        tx,
        files.map((file) => file.objectKey),
        'draft_render_replaced',
      );
    });
  }
}
