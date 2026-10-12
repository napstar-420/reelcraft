import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Timeline, type Probe } from '@reelcraft/shared';
import { isListKind, parseArtifactHandle, storedListItems } from '../artifact/clip-handle';
import { StyleRegistry } from '../capability/style.registry';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob, run } from '../db/schema';
import type { CheckResult } from './check.types';

@Injectable()
export class TimelineCheckService {
  private readonly logger = new Logger(TimelineCheckService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly styles: StyleRegistry,
  ) {}

  async run(input: {
    runId: string;
    timeline: unknown;
    allowGaps?: boolean | undefined;
    toleranceSec?: number | undefined;
    aspectRatio?: string | null | undefined;
  }): Promise<CheckResult[]> {
    const parsed = Timeline.safeParse(input.timeline);
    if (!parsed.success) {
      this.logger.warn(
        { runId: input.runId, issueCount: parsed.error.issues.length },
        'timeline failed schema check',
      );
      return [
        failed(
          'timeline.schema',
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        ),
      ];
    }
    const timeline = parsed.data;
    const results: CheckResult[] = [];
    const resources = new Map<string, Probe | undefined>();
    const handles = new Set<string>();
    // The items that name a handle, so a failure can point at them.
    const usersOf = (handle: string): Target[] =>
      timeline.tracks.flatMap((track) =>
        track.items.flatMap((item, itemIndex) =>
          (item.type === 'media' && item.handle === handle) ||
          (item.type === 'captions' && item.timingHandle === handle)
            ? [{ trackId: track.id, itemIndex }]
            : [],
        ),
      );
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        if (item.type === 'media') handles.add(item.handle);
        if (item.type === 'captions') handles.add(item.timingHandle);
      }
    }
    const [runRow] = await this.db
      .select({ assets: run.assetBindings })
      .from(run)
      .where(eq(run.id, input.runId))
      .limit(1);
    for (const handle of handles) {
      const artifactHandle = handle.startsWith('artifact:')
        ? parseArtifactHandle(handle)
        : undefined;
      if (artifactHandle) {
        const [row] = await this.db
          .select({ artifact, blob })
          .from(artifact)
          .leftJoin(blob, eq(artifact.blobId, blob.id))
          .where(
            and(
              eq(artifact.id, artifactHandle.artifactId),
              eq(artifact.runId, input.runId),
              eq(artifact.stale, false),
            ),
          )
          .limit(1);
        // One item of an image or video list is its own blob, named `artifact:<id>#<position>`.
        const clip =
          artifactHandle.clipPosition !== undefined && row && isListKind(row.artifact.kind)
            ? storedListItems(row.artifact.kind, row.artifact.data)[artifactHandle.clipPosition]
            : undefined;
        const [clipBlob] = clip
          ? await this.db.select().from(blob).where(eq(blob.id, clip.blobId)).limit(1)
          : [];
        const file = artifactHandle.clipPosition === undefined ? row?.blob : clipBlob;
        if (!row || (artifactHandle.clipPosition !== undefined && !clip) || file?.deletedAt) {
          results.push(
            failed(
              'timeline.handles_resolve',
              `${handle} is missing, stale, or deleted`,
              usersOf(handle),
            ),
          );
        } else {
          const probe =
            clip !== undefined ? clip.probe : (row.artifact.probe ?? row.blob?.probe ?? undefined);
          resources.set(handle, (probe ?? clipBlob?.probe ?? undefined) as Probe | undefined);
        }
      } else if (handle.startsWith('asset:')) {
        const assetId = handle.slice('asset:'.length);
        const binding = (runRow?.assets as Record<string, { blobId: string }> | undefined)?.[
          assetId
        ];
        if (!binding) {
          results.push(
            failed(
              'timeline.handles_resolve',
              `${handle} is not snapshotted on this run`,
              usersOf(handle),
            ),
          );
        } else {
          const [row] = await this.db
            .select()
            .from(blob)
            .where(eq(blob.id, binding.blobId))
            .limit(1);
          if (!row || row.deletedAt)
            results.push(
              failed('timeline.handles_resolve', `${handle} is deleted`, usersOf(handle)),
            );
          else resources.set(handle, row.probe as Probe | undefined);
        }
      } else {
        results.push(
          failed('timeline.handles_resolve', `${handle} is not canonical`, usersOf(handle)),
        );
      }
    }
    if (!results.some((result) => result.name === 'timeline.handles_resolve')) {
      results.push(passed('timeline.handles_resolve'));
    }

    const missingStyles = timeline.tracks.flatMap((track) =>
      track.items.flatMap((item) =>
        (item.type === 'text' || item.type === 'captions') && !this.styles.has(item.styleId)
          ? [item.styleId]
          : [],
      ),
    );
    results.push(
      missingStyles.length
        ? failed(
            'timeline.styles_exist',
            `unknown styles: ${[...new Set(missingStyles)].join(', ')}`,
          )
        : passed('timeline.styles_exist'),
    );

    const boundErrors: string[] = [];
    const boundTargets: Target[] = [];
    for (const [trackIndex, track] of timeline.tracks.entries()) {
      for (const [itemIndex, item] of track.items.entries()) {
        if (item.type !== 'media' || item.durationSec === undefined) continue;
        const duration = resources.get(item.handle)?.durationSec;
        // A still has no length (it probes as 0), so any duration fits it.
        if (
          duration !== undefined &&
          duration > 0 &&
          (item.trimInSec ?? 0) + item.durationSec > duration + 0.001 &&
          !['loop', 'freeze', 'speed'].includes(item.overflow ?? 'trim')
        ) {
          boundErrors.push(
            `track ${trackIndex} item ${itemIndex}: requested ${(item.trimInSec ?? 0) + item.durationSec}s from a ${duration}s source`,
          );
          boundTargets.push({ trackId: track.id, itemIndex });
        }
      }
    }
    results.push(
      boundErrors.length
        ? failed('timeline.source_bounds', boundErrors.join('; '), boundTargets)
        : passed('timeline.source_bounds'),
    );

    const primary = timeline.tracks.find((track) => track.type === 'video');
    const gaps = primary ? findGaps(primary) : [];
    results.push(
      !input.allowGaps && gaps.length
        ? failed(
            'timeline.coverage',
            `primary video track has gaps: ${gaps.map((gap) => gap.label).join(', ')}`,
            gaps.flatMap((gap) => gap.targets),
          )
        : passed('timeline.coverage'),
    );

    const videoEnd = maxTrackEnd(timeline, 'video', resources);
    const audioEnd = maxTrackEnd(timeline, 'audio', resources);
    const tolerance = input.toleranceSec ?? 0.25;
    results.push(
      // Video may run past the audio (a closing hold); audio cut off by the video may not.
      videoEnd > 0 && audioEnd > 0 && audioEnd - videoEnd > tolerance
        ? failed(
            'timeline.av_alignment',
            `audio ends at ${audioEnd.toFixed(3)}s, after the video ends at ${videoEnd.toFixed(3)}s`,
          )
        : passed('timeline.av_alignment'),
    );

    const expected = parseAspect(input.aspectRatio);
    const actual = timeline.canvas.width / timeline.canvas.height;
    results.push(
      expected !== undefined && Math.abs(actual - expected) > 0.01
        ? failed(
            'timeline.canvas_match',
            `canvas ratio ${actual.toFixed(4)} does not match ${input.aspectRatio}`,
          )
        : passed('timeline.canvas_match'),
    );
    const failures = results.filter((r) => !r.pass);
    if (failures.length > 0) {
      this.logger.warn(
        {
          runId: input.runId,
          checkCount: results.length,
          failCount: failures.length,
          failedCheckIds: [...new Set(failures.map((r) => r.name))],
        },
        'timeline checks failed',
      );
    } else {
      this.logger.debug(
        { runId: input.runId, checkCount: results.length },
        'timeline checks passed',
      );
    }
    return results;
  }
}

type Target = { trackId: string; itemIndex: number };

function failed(name: string, message: string, targets: Target[] = []): CheckResult {
  return {
    name,
    kind: 'builtin',
    pass: false,
    fault: 'artifact',
    message,
    ...(targets.length > 0 && { targets }),
  };
}
function passed(name: string): CheckResult {
  return { name, kind: 'builtin', pass: true };
}
function parseAspect(value: string | null | undefined) {
  if (!value) return undefined;
  const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  return Number(match[1]) / Number(match[2]);
}
function itemEnd(
  item: Extract<Timeline['tracks'][number]['items'][number], { type: 'media' }>,
  resources: Map<string, Probe | undefined>,
) {
  return item.startSec + (item.durationSec ?? resources.get(item.handle)?.durationSec ?? 0);
}
/** The empty stretches on a track, each with the clips on either side of it (those are what the
 * editor marks). */
function findGaps(track: Timeline['tracks'][number]): Array<{ label: string; targets: Target[] }> {
  const clips = track.items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(
      (
        entry,
      ): entry is { item: Extract<typeof entry.item, { type: 'media' }>; itemIndex: number } =>
        entry.item.type === 'media',
    )
    .sort((a, b) => a.item.startSec - b.item.startSec);
  const gaps: Array<{ label: string; targets: Target[] }> = [];
  let end = 0;
  let before: number | undefined;
  for (const { item, itemIndex } of clips) {
    if (item.startSec > end + 0.001) {
      gaps.push({
        label: `${end.toFixed(3)}-${item.startSec.toFixed(3)}s`,
        targets: [
          ...(before !== undefined ? [{ trackId: track.id, itemIndex: before }] : []),
          { trackId: track.id, itemIndex },
        ],
      });
    }
    if (item.startSec + (item.durationSec ?? 0) >= end) {
      end = item.startSec + (item.durationSec ?? 0);
      before = itemIndex;
    }
  }
  return gaps;
}
function maxTrackEnd(
  timeline: Timeline,
  type: 'video' | 'audio',
  resources: Map<string, Probe | undefined>,
) {
  return Math.max(
    0,
    ...timeline.tracks
      .filter((track) => track.type === type)
      .flatMap((track) => track.items)
      .filter((item): item is Extract<typeof item, { type: 'media' }> => item.type === 'media')
      .map((item) => itemEnd(item, resources)),
  );
}
