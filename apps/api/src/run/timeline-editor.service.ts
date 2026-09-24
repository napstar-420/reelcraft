import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  Probe,
  StageDef,
  Timeline,
  TimingMap,
  type Ref,
  type TimelineResource,
} from '@reelcraft/shared';
import { BlobService } from '../artifact/blob.service';
import { StyleRegistry } from '../capability/style.registry';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  artifact,
  blob,
  blueprintVersion,
  channel,
  humanWait,
  run,
  runMemory,
  stageAttempt,
  stageExecution,
} from '../db/schema';
import { HumanActionService } from './human-action.service';

type Context = {
  run: typeof run.$inferSelect;
  ownerId: string;
  graph: StageDef[];
  stage: StageDef;
  execution: typeof stageExecution.$inferSelect;
  wait: typeof humanWait.$inferSelect;
};

type SourceRow = {
  assetId?: string | undefined;
  artifactId: string;
  blobId?: string | undefined;
  kind: string;
  probe?: unknown;
  data?: unknown;
};

@Injectable()
export class TimelineEditorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly blobs: BlobService,
    private readonly styles: StyleRegistry,
    private readonly humanActions: HumanActionService,
  ) {}

  async session(runId: string, stageKey: string) {
    let context = await this.loadContext(runId, stageKey);
    const authorized = await this.authorizedSources(context);
    if (!context.wait.draft) {
      const initial =
        authorized.sourceTimeline ?? this.initialTimeline(context, authorized.resources);
      await this.db
        .update(humanWait)
        .set({ draft: initial, draftUpdatedAt: new Date().toISOString() })
        .where(and(eq(humanWait.id, context.wait.id), isNull(humanWait.draft)));
      context = await this.loadContext(runId, stageKey);
    }
    const [latestAttempt] = await this.db
      .select({ checkResults: stageAttempt.checkResults })
      .from(stageAttempt)
      .where(eq(stageAttempt.stageExecutionId, context.execution.id))
      .orderBy(desc(stageAttempt.attemptNo))
      .limit(1);
    return {
      runId,
      stageKey,
      runRevision: context.run.revision,
      draftRevision: context.wait.draftRevision,
      timeline: Timeline.parse(context.wait.draft),
      resources: authorized.resources,
      timingMaps: authorized.timingMaps,
      styles: this.styles.list(),
      checkResults: latestAttempt?.checkResults ?? [],
      readOnly:
        context.wait.resolvedAt !== null ||
        context.run.state !== 'PAUSED_INPUT' ||
        context.run.cursorStageKey !== stageKey,
    };
  }

  async save(
    runId: string,
    stageKey: string,
    input: { draftRevision: number; timeline: Timeline; force?: boolean | undefined },
  ) {
    const context = await this.loadContext(runId, stageKey);
    this.requireEditable(context);
    const authorized = await this.authorizedSources(context);
    this.validateTimelineReferences(input.timeline, authorized.allowedHandles);
    const nextRevision = context.wait.draftRevision + 1;
    const condition = input.force
      ? and(eq(humanWait.id, context.wait.id), isNull(humanWait.resolvedAt))
      : and(
          eq(humanWait.id, context.wait.id),
          eq(humanWait.draftRevision, input.draftRevision),
          isNull(humanWait.resolvedAt),
        );
    const rows = await this.db
      .update(humanWait)
      .set({
        draft: input.timeline,
        draftRevision: nextRevision,
        draftUpdatedAt: new Date().toISOString(),
      })
      .where(condition)
      .returning({ draftRevision: humanWait.draftRevision });
    if (rows.length === 0) {
      const latest = await this.loadContext(runId, stageKey);
      throw new ConflictException({
        code: 'timeline_draft_conflict',
        draftRevision: latest.wait.draftRevision,
      });
    }
    return { draftRevision: rows[0]!.draftRevision };
  }

  async submit(runId: string, stageKey: string, draftRevision: number) {
    const context = await this.loadContext(runId, stageKey);
    this.requireEditable(context);
    if (context.wait.draftRevision !== draftRevision) {
      throw new ConflictException({
        code: 'timeline_draft_conflict',
        draftRevision: context.wait.draftRevision,
      });
    }
    const timeline = Timeline.parse(context.wait.draft);
    const authorized = await this.authorizedSources(context);
    this.validateTimelineReferences(timeline, authorized.allowedHandles);
    return this.humanActions.submitInput(runId, stageKey, timeline, draftRevision);
  }

  private requireEditable(context: Context) {
    if (
      context.wait.resolvedAt ||
      context.run.state !== 'PAUSED_INPUT' ||
      context.run.cursorStageKey !== context.stage.key
    ) {
      throw new ConflictException('The timeline editor is no longer active');
    }
  }

  private validateTimelineReferences(timeline: Timeline, allowedHandles: Set<string>) {
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        const handle =
          item.type === 'captions'
            ? item.timingHandle
            : item.type === 'media'
              ? item.handle
              : undefined;
        if (handle && !allowedHandles.has(handle)) {
          throw new ConflictException(`Timeline handle "${handle}" is not available to this stage`);
        }
        if (item.type !== 'media' && item.type !== 'text' && !this.styles.has(item.styleId)) {
          throw new ConflictException(`Unknown timeline style "${item.styleId}"`);
        }
        if (item.type === 'text' && !this.styles.has(item.styleId)) {
          throw new ConflictException(`Unknown timeline style "${item.styleId}"`);
        }
      }
    }
  }

  private initialTimeline(context: Context, resources: TimelineResource[]): Timeline {
    const visuals = resources.filter(
      (resource) => resource.kind === 'media.video' || resource.kind === 'media.image',
    );
    const firstProbe = visuals
      .map((resource) => Probe.safeParse(resource.probe))
      .find((p) => p.success);
    const firstVideo = firstProbe?.success
      ? firstProbe.data.streams.find((stream) => stream.type === 'video')
      : undefined;
    const format = (
      context.run.resolvedConfig as Record<
        string,
        { format?: { resolution?: string; fps?: number } }
      >
    )[context.stage.key]?.format;
    const resolution = format?.resolution?.match(/^(\d+)x(\d+)$/);
    const width = resolution ? Number(resolution[1]) : (firstVideo?.width ?? 1080);
    const height = resolution ? Number(resolution[2]) : (firstVideo?.height ?? 1920);
    const fps = format?.fps ?? firstVideo?.fps ?? 30;
    let cursor = 0;
    return {
      version: 1,
      canvas: { width, height, fps, background: '#000000' },
      tracks: [
        {
          id: 'video-main',
          type: 'video',
          items: visuals.map((resource) => {
            const parsed = Probe.safeParse(resource.probe);
            const durationSec =
              parsed.success && parsed.data.durationSec > 0 ? parsed.data.durationSec : 5;
            const item = {
              type: 'media' as const,
              handle: resource.handle,
              startSec: cursor,
              durationSec,
              fit: 'cover' as const,
              overflow: 'trim' as const,
            };
            cursor += durationSec;
            return item;
          }),
        },
      ],
    };
  }

  private async authorizedSources(context: Context) {
    const resources: TimelineResource[] = [];
    const timingMaps: Record<string, import('@reelcraft/shared').TimingMap> = {};
    const allowedHandles = new Set<string>();
    let sourceTimeline: Timeline | undefined;
    for (const [slotName, ref] of Object.entries(context.stage.slots)) {
      const rows = await this.rowsForRef(context, ref);
      for (const row of rows) {
        const handle = row.assetId ? `asset:${row.assetId}` : `artifact:${row.artifactId}`;
        allowedHandles.add(handle);
        if (slotName === 'timeline' && row.data) {
          const parsed = Timeline.safeParse(row.data);
          if (parsed.success) sourceTimeline = parsed.data;
        }
        const timing = TimingMap.safeParse(row.data);
        if (timing.success) timingMaps[handle] = timing.data;
        if (!row.blobId || !row.kind?.startsWith('media.')) continue;
        const access = await this.blobs.readUrl(context.ownerId, row.blobId);
        if (access?.status !== 'live') continue;
        resources.push({
          handle,
          kind: row.kind as TimelineResource['kind'],
          url: access.url,
          ...(row.probe !== null && row.probe !== undefined ? { probe: row.probe } : {}),
        });
      }
    }
    if (sourceTimeline) {
      for (const track of sourceTimeline.tracks) {
        for (const item of track.items) {
          if (item.type === 'media') allowedHandles.add(item.handle);
          if (item.type === 'captions') allowedHandles.add(item.timingHandle);
        }
      }
      await this.addTimelineResources(context, sourceTimeline, resources);
      await this.addTimelineTimingMaps(context, sourceTimeline, timingMaps);
    }
    return {
      resources: dedupeResources(resources),
      timingMaps,
      allowedHandles,
      sourceTimeline,
    };
  }

  private async addTimelineTimingMaps(
    context: Context,
    timeline: Timeline,
    timingMaps: Record<string, import('@reelcraft/shared').TimingMap>,
  ) {
    const handles = new Set(
      timeline.tracks.flatMap((track) =>
        track.items.flatMap((item) => (item.type === 'captions' ? [item.timingHandle] : [])),
      ),
    );
    for (const handle of handles) {
      if (!handle.startsWith('artifact:')) continue;
      const [row] = await this.db
        .select({ data: artifact.data })
        .from(artifact)
        .where(
          and(
            eq(artifact.id, handle.slice('artifact:'.length)),
            eq(artifact.runId, context.run.id),
            eq(artifact.stale, false),
          ),
        )
        .limit(1);
      const parsed = TimingMap.safeParse(row?.data);
      if (parsed.success) timingMaps[handle] = parsed.data;
    }
  }

  private async addTimelineResources(
    context: Context,
    timeline: Timeline,
    resources: TimelineResource[],
  ) {
    const handles = new Set(
      timeline.tracks.flatMap((track) =>
        track.items.flatMap((item) => (item.type === 'media' ? [item.handle] : [])),
      ),
    );
    for (const handle of handles) {
      if (!handle.startsWith('artifact:')) continue;
      const id = handle.slice('artifact:'.length);
      const [row] = await this.db
        .select({ artifact, blob })
        .from(artifact)
        .innerJoin(blob, eq(artifact.blobId, blob.id))
        .where(
          and(eq(artifact.id, id), eq(artifact.runId, context.run.id), eq(artifact.stale, false)),
        )
        .limit(1);
      if (!row || !row.artifact.kind.startsWith('media.')) continue;
      const access = await this.blobs.readUrl(context.ownerId, row.blob.id);
      if (access?.status === 'live') {
        resources.push({
          handle,
          kind: row.artifact.kind as TimelineResource['kind'],
          url: access.url,
          ...(row.artifact.probe !== null && row.artifact.probe !== undefined
            ? { probe: row.artifact.probe }
            : {}),
        });
      }
    }
  }

  private async rowsForRef(context: Context, ref: Ref): Promise<SourceRow[]> {
    if (ref.from === 'asset') {
      const binding = (
        context.run.assetBindings as Record<string, { blobId: string; kind: string }>
      )[ref.assetId];
      if (!binding) return [];
      const [blobRow] = await this.db
        .select()
        .from(blob)
        .where(eq(blob.id, binding.blobId))
        .limit(1);
      return blobRow
        ? [
            {
              assetId: ref.assetId,
              artifactId: '',
              blobId: binding.blobId,
              kind: binding.kind,
              probe: blobRow.probe,
              data: undefined,
            },
          ]
        : [];
    }
    if (ref.from === 'input') {
      const rows = await this.db
        .select()
        .from(artifact)
        .where(
          and(
            eq(artifact.runId, context.run.id),
            eq(artifact.producerStageKey, `$input:${ref.inputKey}`),
            eq(artifact.stale, false),
          ),
        );
      return rows
        .filter((row) => ref.index === undefined || row.itemIndex === ref.index)
        .map(toSourceRow);
    }
    if (ref.from === 'prev') {
      const index = context.graph.findIndex((stage) => stage.key === context.stage.key);
      const previous = context.graph[index - 1];
      if (!previous) return [];
      const rows = await this.db
        .select()
        .from(artifact)
        .where(
          and(
            eq(artifact.runId, context.run.id),
            eq(artifact.producerStageKey, previous.key),
            eq(artifact.stale, false),
          ),
        );
      return rows.map(toSourceRow);
    }
    if (ref.from === 'memory') {
      const [memory] = await this.db
        .select()
        .from(runMemory)
        .where(and(eq(runMemory.runId, context.run.id), eq(runMemory.memKey, ref.key)))
        .orderBy(desc(runMemory.version))
        .limit(1);
      if (!memory || memory.tombstone) return [];
      if (!memory.artifactId) {
        return [
          {
            artifactId: memory.id,
            blobId: undefined,
            kind: memory.kind,
            probe: undefined,
            data: memory.data,
          },
        ];
      }
      const [row] = await this.db
        .select()
        .from(artifact)
        .where(eq(artifact.id, memory.artifactId))
        .limit(1);
      return row ? [toSourceRow(row)] : [];
    }
    if (ref.from === 'const') {
      const parsed = Timeline.safeParse(ref.value);
      return parsed.success
        ? [
            {
              artifactId: `const:${context.stage.key}`,
              blobId: undefined,
              kind: 'timeline',
              probe: undefined,
              data: parsed.data,
            },
          ]
        : [];
    }
    return [];
  }

  private async loadContext(runId: string, stageKey: string): Promise<Context> {
    const [row] = await this.db
      .select({ run, graph: blueprintVersion.graph, ownerId: channel.ownerId })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .innerJoin(channel, eq(run.channelId, channel.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    const graph = StageDef.array().parse(row.graph);
    const stage = graph.find((candidate) => candidate.key === stageKey);
    if (!stage || stage.capability !== 'human.timeline_edit') {
      throw new NotFoundException(`Timeline editor stage ${stageKey} not found`);
    }
    const [execution] = await this.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)))
      .limit(1);
    if (!execution) throw new NotFoundException(`Stage execution ${stageKey} not found`);
    const [wait] = await this.db
      .select()
      .from(humanWait)
      .where(and(eq(humanWait.stageExecutionId, execution.id), eq(humanWait.kind, 'timeline_edit')))
      .orderBy(desc(humanWait.waitingSince))
      .limit(1);
    if (!wait) throw new ConflictException('The timeline editor has not opened yet');
    return { run: row.run, ownerId: row.ownerId, graph, stage, execution, wait };
  }
}

function toSourceRow(row: typeof artifact.$inferSelect): SourceRow {
  return {
    artifactId: row.id,
    blobId: row.blobId ?? undefined,
    kind: row.kind,
    probe: row.probe,
    data: row.data,
  };
}

function dedupeResources(resources: TimelineResource[]) {
  return [...new Map(resources.map((resource) => [resource.handle, resource])).values()];
}
