import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { isBuiltinAudioHandle, timelineHandles } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob, run } from '../db/schema';
import { LIST_KINDS, listItemKind, parseArtifactHandle, storedListItems } from './clip-handle';

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
    return this.resolveHandles(runId, timelineHandles(value));
  }

  /** The stored file behind each handle (`artifact:…`, `artifact:…#n`, `asset:…`). Handles that
   * can't be found are left out and logged; built-in sounds need nothing. */
  async resolveHandles(
    runId: string,
    wanted: Iterable<string>,
  ): Promise<Record<string, ResolvedTimelineResource>> {
    const handles = new Set(wanted);
    const [runRow] = await this.db
      .select({ assets: run.assetBindings })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    const result: Record<string, ResolvedTimelineResource> = {};
    for (const handle of handles) {
      // Built-in sounds ship with the renderer; there is nothing to resolve.
      if (isBuiltinAudioHandle(handle)) continue;
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
      'resources resolved',
    );
    return result;
  }

  /** One item of a `media.video_list` or `media.image_list` artifact (`artifact:<id>#<position>`). */
  private async resolveClip(
    runId: string,
    handle: string,
    artifactId: string,
    position: number,
  ): Promise<ResolvedTimelineResource | undefined> {
    const [row] = await this.db
      .select({ data: artifact.data, kind: artifact.kind })
      .from(artifact)
      .where(
        and(
          eq(artifact.id, artifactId),
          eq(artifact.runId, runId),
          inArray(artifact.kind, [...LIST_KINDS]),
          eq(artifact.stale, false),
        ),
      )
      .limit(1);
    const listKind = row?.kind === 'media.image_list' ? 'media.image_list' : 'media.video_list';
    const clip = storedListItems(listKind, row?.data)[position];
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
      kind: listItemKind(listKind),
      sourceKey: blobRow.objectKey,
      ...(clip.probe !== null && clip.probe !== undefined && { probe: clip.probe }),
    };
  }
}
