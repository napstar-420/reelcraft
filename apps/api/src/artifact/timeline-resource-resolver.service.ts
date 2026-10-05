import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Timeline } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob, run } from '../db/schema';
import { parseArtifactHandle, storedClips } from './clip-handle';

export type ResolvedTimelineResource = {
  handle: string;
  kind: string;
  sourceKey?: string;
  probe?: unknown;
  data?: unknown;
};

@Injectable()
export class TimelineResourceResolverService {
  private readonly logger = new Logger(TimelineResourceResolverService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async resolve(runId: string, value: unknown): Promise<Record<string, ResolvedTimelineResource>> {
    const timeline = Timeline.parse(value);
    const handles = new Set<string>();
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        if (item.type === 'media') handles.add(item.handle);
        if (item.type === 'captions') handles.add(item.timingHandle);
      }
    }
    const [runRow] = await this.db
      .select({ assets: run.assetBindings })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    const result: Record<string, ResolvedTimelineResource> = {};
    for (const handle of handles) {
      const parsed = parseArtifactHandle(handle);
      if (parsed?.clipPosition !== undefined) {
        const resolved = await this.resolveClip(
          runId,
          handle,
          parsed.artifactId,
          parsed.clipPosition,
        );
        if (resolved) result[handle] = resolved;
      } else if (parsed) {
        const [row] = await this.db
          .select({ artifact, blob })
          .from(artifact)
          .leftJoin(blob, eq(artifact.blobId, blob.id))
          .where(
            and(
              eq(artifact.id, parsed.artifactId),
              eq(artifact.runId, runId),
              eq(artifact.stale, false),
            ),
          )
          .limit(1);
        if (!row || row.blob?.deletedAt) {
          this.logger.warn(
            { runId, handle, reason: row ? 'blob deleted' : 'artifact not active' },
            'timeline handle unresolved',
          );
          continue;
        }
        result[handle] = {
          handle,
          kind: row.artifact.kind,
          ...(row.blob?.objectKey && { sourceKey: row.blob.objectKey }),
          ...(row.artifact.probe !== null && { probe: row.artifact.probe }),
          ...(row.artifact.data !== null && { data: row.artifact.data }),
        };
      } else if (handle.startsWith('asset:')) {
        const assetId = handle.slice('asset:'.length);
        const binding = (
          runRow?.assets as Record<string, { blobId: string; kind: string }> | undefined
        )?.[assetId];
        if (!binding) {
          this.logger.warn(
            { runId, handle, reason: 'asset not bound' },
            'timeline handle unresolved',
          );
          continue;
        }
        const [row] = await this.db.select().from(blob).where(eq(blob.id, binding.blobId)).limit(1);
        if (!row || row.deletedAt) {
          this.logger.warn(
            {
              runId,
              handle,
              blobId: binding.blobId,
              reason: row ? 'blob deleted' : 'blob missing',
            },
            'timeline handle unresolved',
          );
          continue;
        }
        result[handle] = {
          handle,
          kind: binding.kind,
          sourceKey: row.objectKey,
          ...(row.probe !== null && { probe: row.probe }),
        };
      }
    }
    this.logger.debug(
      { runId, handles: handles.size, resolved: Object.keys(result).length },
      'timeline resources resolved',
    );
    return result;
  }

  /** One clip of a `media.video_list` artifact (`artifact:<id>#<position>`). */
  private async resolveClip(
    runId: string,
    handle: string,
    artifactId: string,
    position: number,
  ): Promise<ResolvedTimelineResource | undefined> {
    const [row] = await this.db
      .select({ data: artifact.data })
      .from(artifact)
      .where(
        and(
          eq(artifact.id, artifactId),
          eq(artifact.runId, runId),
          eq(artifact.kind, 'media.video_list'),
          eq(artifact.stale, false),
        ),
      )
      .limit(1);
    const clip = storedClips(row?.data)[position];
    const [blobRow] = clip
      ? await this.db.select().from(blob).where(eq(blob.id, clip.blobId)).limit(1)
      : [];
    if (!clip || !blobRow || blobRow.deletedAt) {
      this.logger.warn(
        { runId, handle, reason: 'clip not available' },
        'timeline handle unresolved',
      );
      return undefined;
    }
    return {
      handle,
      kind: 'media.video',
      sourceKey: blobRow.objectKey,
      ...(clip.probe !== null && clip.probe !== undefined && { probe: clip.probe }),
    };
  }
}
