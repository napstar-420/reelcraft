import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Timeline } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob, run } from '../db/schema';

export type ResolvedTimelineResource = {
  handle: string;
  kind: string;
  sourceKey?: string;
  probe?: unknown;
  data?: unknown;
};

@Injectable()
export class TimelineResourceResolverService {
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
      if (handle.startsWith('artifact:')) {
        const [row] = await this.db
          .select({ artifact, blob })
          .from(artifact)
          .leftJoin(blob, eq(artifact.blobId, blob.id))
          .where(
            and(
              eq(artifact.id, handle.slice('artifact:'.length)),
              eq(artifact.runId, runId),
              eq(artifact.stale, false),
            ),
          )
          .limit(1);
        if (!row || row.blob?.deletedAt) continue;
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
        if (!binding) continue;
        const [row] = await this.db.select().from(blob).where(eq(blob.id, binding.blobId)).limit(1);
        if (!row || row.deletedAt) continue;
        result[handle] = {
          handle,
          kind: binding.kind,
          sourceKey: row.objectKey,
          ...(row.probe !== null && { probe: row.probe }),
        };
      }
    }
    return result;
  }
}
