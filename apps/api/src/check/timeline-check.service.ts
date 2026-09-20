import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Timeline, type Probe } from '@reefcraft/shared';
import { StyleRegistry } from '../capability/style.registry';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blob, run } from '../db/schema';
import type { CheckResult } from './check.types';

@Injectable()
export class TimelineCheckService {
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
      if (handle.startsWith('artifact:')) {
        const id = handle.slice('artifact:'.length);
        const [row] = await this.db
          .select({ artifact, blob })
          .from(artifact)
          .leftJoin(blob, eq(artifact.blobId, blob.id))
          .where(
            and(eq(artifact.id, id), eq(artifact.runId, input.runId), eq(artifact.stale, false)),
          )
          .limit(1);
        if (!row || row.blob?.deletedAt) {
          results.push(
            failed('timeline.handles_resolve', `${handle} is missing, stale, or deleted`),
          );
        } else {
          resources.set(
            handle,
            (row.artifact.probe ?? row.blob?.probe ?? undefined) as Probe | undefined,
          );
        }
      } else if (handle.startsWith('asset:')) {
        const assetId = handle.slice('asset:'.length);
        const binding = (runRow?.assets as Record<string, { blobId: string }> | undefined)?.[
          assetId
        ];
        if (!binding) {
          results.push(
            failed('timeline.handles_resolve', `${handle} is not snapshotted on this run`),
          );
        } else {
          const [row] = await this.db
            .select()
            .from(blob)
            .where(eq(blob.id, binding.blobId))
            .limit(1);
          if (!row || row.deletedAt)
            results.push(failed('timeline.handles_resolve', `${handle} is deleted`));
          else resources.set(handle, row.probe as Probe | undefined);
        }
      } else {
        results.push(failed('timeline.handles_resolve', `${handle} is not canonical`));
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
    for (const [trackIndex, track] of timeline.tracks.entries()) {
      for (const [itemIndex, item] of track.items.entries()) {
        if (item.type !== 'media' || item.durationSec === undefined) continue;
        const duration = resources.get(item.handle)?.durationSec;
        if (
          duration !== undefined &&
          (item.trimInSec ?? 0) + item.durationSec > duration + 0.001 &&
          !['loop', 'freeze', 'speed'].includes(item.overflow ?? 'trim')
        ) {
          boundErrors.push(
            `track ${trackIndex} item ${itemIndex}: requested ${(item.trimInSec ?? 0) + item.durationSec}s from a ${duration}s source`,
          );
        }
      }
    }
    results.push(
      boundErrors.length
        ? failed('timeline.source_bounds', boundErrors.join('; '))
        : passed('timeline.source_bounds'),
    );

    const primary = timeline.tracks.find((track) => track.type === 'video');
    const gaps = primary ? findGaps(primary.items.filter((item) => item.type === 'media')) : [];
    results.push(
      !input.allowGaps && gaps.length
        ? failed('timeline.coverage', `primary video track has gaps: ${gaps.join(', ')}`)
        : passed('timeline.coverage'),
    );

    const videoEnd = maxTrackEnd(timeline, 'video', resources);
    const audioEnd = maxTrackEnd(timeline, 'audio', resources);
    const tolerance = input.toleranceSec ?? 0.25;
    results.push(
      videoEnd > 0 && audioEnd > 0 && Math.abs(videoEnd - audioEnd) > tolerance
        ? failed(
            'timeline.av_alignment',
            `audio ends at ${audioEnd.toFixed(3)}s and video ends at ${videoEnd.toFixed(3)}s`,
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
    return results;
  }
}

function failed(name: string, message: string): CheckResult {
  return { name, kind: 'builtin', pass: false, fault: 'artifact', message };
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
function findGaps(
  items: Array<Extract<Timeline['tracks'][number]['items'][number], { type: 'media' }>>,
) {
  const sorted = [...items].sort((a, b) => a.startSec - b.startSec);
  const gaps: string[] = [];
  let end = 0;
  for (const item of sorted) {
    if (item.startSec > end + 0.001) gaps.push(`${end.toFixed(3)}-${item.startSec.toFixed(3)}s`);
    end = Math.max(end, item.startSec + (item.durationSec ?? 0));
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
