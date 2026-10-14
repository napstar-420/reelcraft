import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  Probe,
  StageDef,
  Timeline,
  type Ref,
  type TimelineCheckResponseDto,
  type TimelineResource,
} from '@reelcraft/shared';
import { BlobService } from '../artifact/blob.service';
import { MemoryService } from '../artifact/memory.service';
import { writerArtifactId } from '../artifact/memory-writer';
import { timingMapOf } from '../artifact/timing-map';
import {
  LIST_KINDS,
  clipHandle,
  isListKind,
  listItemKind,
  parseArtifactHandle,
  storedListItems,
  type StoredClip,
} from '../artifact/clip-handle';
import { TimelineCheckService } from '../check/timeline-check.service';
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
import { ConfigResolverService } from '../run-config/config-resolver.service';
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
  /** Set for one clip of a `media.video_list` artifact. */
  clipPosition?: number | undefined;
  blobId?: string | undefined;
  kind: string;
  /** What the editor shows for this file instead of its handle. */
  label?: string | undefined;
  probe?: unknown;
  data?: unknown;
};

/** Run states in which a person can answer a wait: which one it is depends on
 * which kind of wait is open, and a run can hold several at once. */
const HUMAN_WAIT_STATES = ['PAUSED_APPROVAL', 'PAUSED_INPUT'] as const;

@Injectable()
export class TimelineEditorService {
  private readonly logger = new Logger(TimelineEditorService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly blobs: BlobService,
    private readonly styles: StyleRegistry,
    private readonly humanActions: HumanActionService,
    private readonly memory: MemoryService,
    private readonly configResolver: ConfigResolverService,
    private readonly timelineChecks: TimelineCheckService,
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
      stageLabel: context.stage.label,
      runRevision: context.run.revision,
      draftRevision: context.wait.draftRevision,
      timeline: Timeline.parse(context.wait.draft),
      resources: authorized.resources,
      timingMaps: authorized.timingMaps,
      styles: this.styles.list(),
      checkResults: latestAttempt?.checkResults ?? [],
      readOnly:
        context.wait.resolvedAt !== null ||
        !HUMAN_WAIT_STATES.includes(context.run.state as (typeof HUMAN_WAIT_STATES)[number]),
    };
  }

  /** The saved draft, with who owns the run, for renders made from it. */
  async savedDraft(runId: string, stageKey: string) {
    const context = await this.loadContext(runId, stageKey);
    const parsed = Timeline.safeParse(context.wait.draft);
    if (!parsed.success) throw new ConflictException('There is no saved draft to render yet');
    return {
      ownerId: context.ownerId,
      channelId: context.run.channelId,
      timeline: parsed.data,
      draftRevision: context.wait.draftRevision,
    };
  }

  /** Runs the timeline checks that submitting would run, on a draft that may not be saved yet, so
   * the editor can show what is wrong before you submit. Nothing is stored. */
  async check(
    runId: string,
    stageKey: string,
    timeline: unknown,
  ): Promise<TimelineCheckResponseDto> {
    const context = await this.loadContext(runId, stageKey);
    const effective = await this.configResolver.effectiveStageConfig(
      runId,
      stageKey,
      context.stage,
    );
    const config = effective.capabilityConfig as { allowGaps?: boolean; toleranceSec?: number };
    const results = await this.timelineChecks.run({
      runId,
      timeline,
      allowGaps: config.allowGaps,
      toleranceSec: config.toleranceSec,
      aspectRatio: effective.layer.format?.aspectRatio,
    });
    return {
      results: results.map(({ name, pass, message, targets }) => ({
        name,
        pass,
        ...(message !== undefined && { message }),
        ...(targets && { targets }),
      })),
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
    this.logger.debug(
      { runId, stageKey, draftRevision: rows[0]!.draftRevision, forced: input.force === true },
      'timeline draft saved',
    );
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
      !HUMAN_WAIT_STATES.includes(context.run.state as (typeof HUMAN_WAIT_STATES)[number])
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
        const handle = row.assetId
          ? `asset:${row.assetId}`
          : row.clipPosition !== undefined
            ? clipHandle(row.artifactId, row.clipPosition)
            : `artifact:${row.artifactId}`;
        allowedHandles.add(handle);
        if (slotName === 'timeline' && row.data) {
          const parsed = Timeline.safeParse(row.data);
          if (parsed.success) sourceTimeline = parsed.data;
        }
        const timing = timingMapOf(row.data);
        if (timing) timingMaps[handle] = timing;
        if (!row.blobId || !row.kind?.startsWith('media.')) continue;
        const access = await this.blobs.readUrl(context.ownerId, row.blobId);
        if (access?.status !== 'live') continue;
        resources.push({
          handle,
          kind: row.kind as TimelineResource['kind'],
          url: mediaUrl(row.blobId),
          ...(row.label && { label: row.label }),
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
      const parsed = timingMapOf(row?.data);
      if (parsed) timingMaps[handle] = parsed;
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
      const parsed = parseArtifactHandle(handle);
      if (!parsed) continue;
      if (parsed.clipPosition !== undefined) {
        const [list] = await this.db
          .select({
            data: artifact.data,
            kind: artifact.kind,
            producerStageKey: artifact.producerStageKey,
            itemIndex: artifact.itemIndex,
          })
          .from(artifact)
          .where(
            and(
              eq(artifact.id, parsed.artifactId),
              eq(artifact.runId, context.run.id),
              inArray(artifact.kind, [...LIST_KINDS]),
              eq(artifact.stale, false),
            ),
          )
          .limit(1);
        const listKind =
          list?.kind === 'media.image_list' ? 'media.image_list' : 'media.video_list';
        const clip = storedListItems(listKind, list?.data)[parsed.clipPosition];
        const access = clip ? await this.blobs.readUrl(context.ownerId, clip.blobId) : undefined;
        if (clip && list && access?.status === 'live') {
          resources.push({
            handle,
            kind: listItemKind(listKind),
            url: mediaUrl(clip.blobId),
            label: artifactLabel(context.graph, list, clip, parsed.clipPosition),
            ...(clip.probe !== null && clip.probe !== undefined ? { probe: clip.probe } : {}),
          });
        }
        continue;
      }
      const id = parsed.artifactId;
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
          url: mediaUrl(row.blob.id),
          label: artifactLabel(context.graph, row.artifact),
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
              label: 'Asset',
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
        .flatMap((row) => toSourceRows(row, context.graph));
    }
    if (ref.from === 'prev' || ref.from === 'stage') {
      const index = context.graph.findIndex((stage) => stage.key === context.stage.key);
      const previous =
        ref.from === 'prev'
          ? context.graph[index - 1]
          : context.graph.find((stage) => stage.key === ref.stageKey);
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
      return rows.flatMap((row) => toSourceRows(row, context.graph));
    }
    if (ref.from === 'memory') {
      const [memory] = await this.db
        .select()
        .from(runMemory)
        .where(and(eq(runMemory.runId, context.run.id), eq(runMemory.memKey, ref.key)))
        .orderBy(desc(runMemory.version))
        .limit(1);
      // An iterating stage writes `key#0…key#N-1` rather than `key`.
      const memoryRows =
        memory && !memory.tombstone
          ? [memory]
          : await this.memory.listGroupCurrent(this.db, context.run.id, ref.key).catch(() => []);
      const sources: SourceRow[] = [];
      for (const row of memoryRows) sources.push(...(await this.rowsForMemory(context, row)));
      return sources;
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

  private async rowsForMemory(
    context: Context,
    memory: typeof runMemory.$inferSelect,
  ): Promise<SourceRow[]> {
    if (memory.artifactId) {
      const [row] = await this.db
        .select()
        .from(artifact)
        .where(eq(artifact.id, memory.artifactId))
        .limit(1);
      return row ? toSourceRows(row, context.graph) : [];
    }
    // A data write keeps its value in the memory row. Name it by the artifact that wrote it, the
    // only handle the checks and the render can resolve.
    const writer = await writerArtifactId(this.db, memory);
    return writer
      ? [{ artifactId: writer, kind: memory.kind, data: memory.data, probe: undefined }]
      : [];
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

/** A `media.video_list` or `media.image_list` artifact is offered to the editor as one source per item. */
function toSourceRows(row: typeof artifact.$inferSelect, graph: StageDef[]): SourceRow[] {
  if (!isListKind(row.kind)) return [toSourceRow(row, graph)];
  return storedListItems(row.kind, row.data).map((clip, position) => ({
    artifactId: row.id,
    clipPosition: position,
    blobId: clip.blobId,
    kind: listItemKind(row.kind as 'media.video_list' | 'media.image_list'),
    label: artifactLabel(graph, row, clip, position),
    probe: clip.probe,
    data: undefined,
  }));
}

function toSourceRow(row: typeof artifact.$inferSelect, graph: StageDef[]): SourceRow {
  return {
    artifactId: row.id,
    blobId: row.blobId ?? undefined,
    kind: row.kind,
    label: artifactLabel(graph, row),
    probe: row.probe,
    data: row.data,
  };
}

/** The URL the editor loads a blob from. `/api/blobs/:id` answers with a fresh signed link on
 * every request, so a preview left open never goes stale, and it stays same-origin, so no
 * storage address or CORS rule is involved. */
function mediaUrl(blobId: string): string {
  return `/api/blobs/${blobId}`;
}

/** A name a person recognises: the clip's own label, else the stage that made it (and which of
 * its items it is), e.g. "Images · 12". */
function artifactLabel(
  graph: StageDef[],
  row: Pick<typeof artifact.$inferSelect, 'producerStageKey' | 'itemIndex'>,
  clip?: StoredClip,
  position?: number,
): string {
  if (clip?.label) return clip.label;
  const stageKey = row.producerStageKey;
  const name = stageKey.startsWith('$input:')
    ? stageKey.slice('$input:'.length)
    : (graph.find((stage) => stage.key === stageKey)?.label ?? stageKey);
  const number = position ?? row.itemIndex;
  return number === null || number === undefined ? name : `${name} · ${number + 1}`;
}

function dedupeResources(resources: TimelineResource[]) {
  return [...new Map(resources.map((resource) => [resource.handle, resource])).values()];
}
