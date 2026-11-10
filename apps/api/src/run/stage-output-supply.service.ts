import { basename } from 'node:path';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  CreateBlueprintVersionDto,
  definitionKey,
  StageDef,
  Timeline,
  type CreateStageOutputCandidateDto,
  type Probe,
} from '@reelcraft/shared';
import { ArtifactService } from '../artifact/artifact.service';
import { ArtifactAttachmentService } from '../artifact/artifact-attachment.service';
import { BlobService } from '../artifact/blob.service';
import { FileArtifactService } from '../artifact/file-artifact.service';
import { MediaArtifactService } from '../artifact/media-artifact.service';
import { TimelineCheckService } from '../check/timeline-check.service';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  artifact,
  asset,
  blob,
  blueprintVersion,
  channel,
  run,
  stageExecution,
} from '../db/schema/index';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { audioPolicyViolation } from '../orchestration/audio-policy';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { WorkspaceService } from '../storage/workspace.service';

/** A file to use as (part of) the output. `blobId` is for the assistant's chat attachments and is
 * never accepted from the HTTP API. */
export type SuppliedFile = { assetId: string } | { artifactId: string } | { blobId: string };

export type SupplyOptions = {
  by: 'user' | 'assistant';
  /** Overrides `dto.files`, so the assistant can add its own attachments. */
  files?: SuppliedFile[];
};

type OwnedRun = typeof run.$inferSelect & { ownerId: string };

const FILE_KINDS = ['media.image', 'media.video', 'media.audio', 'media.model'] as const;
const SUBTITLE_FORMATS = ['srt', 'vtt'] as const;

/** Turns a person's (or the assistant's) output into a candidate artifact. The candidate is a
 * born-stale artifact row nothing reads yet; the stage-run plan (`mode: 'supply'`) makes it the
 * stage's output. The output contract is always validated here, whether or not the stage's own
 * checks and quality review are later skipped: a timeline whose handles don't resolve, or data
 * that breaks its schema, would break everything after it. */
@Injectable()
export class StageOutputSupplyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly artifacts: ArtifactService,
    private readonly attachments: ArtifactAttachmentService,
    private readonly blobs: BlobService,
    private readonly files: FileArtifactService,
    private readonly media: MediaArtifactService,
    private readonly timelineChecks: TimelineCheckService,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly workspaces: WorkspaceService,
  ) {}

  async createCandidate(
    runId: string,
    stageKey: string,
    dto: CreateStageOutputCandidateDto,
    options: SupplyOptions,
  ): Promise<{ artifactId: string }> {
    const [found] = await this.db
      .select({ run, ownerId: channel.ownerId })
      .from(run)
      .innerJoin(channel, eq(channel.id, run.channelId))
      .where(eq(run.id, runId))
      .limit(1);
    if (!found) throw new NotFoundException(`Run ${runId} not found`);
    const runRow: OwnedRun = { ...found.run, ownerId: found.ownerId };
    const versions = await this.db
      .select()
      .from(blueprintVersion)
      .where(inArray(blueprintVersion.id, [runRow.blueprintVersionId, dto.blueprintVersionId]));
    const source = versions.find((v) => v.id === runRow.blueprintVersionId);
    const requested = versions.find((v) => v.id === dto.blueprintVersionId);
    if (!source || !requested || source.blueprintId !== requested.blueprintId)
      throw new ConflictException('Blueprint version does not belong to this run');
    const stage = CreateBlueprintVersionDto.parse(requested).graph.find((s) => s.key === stageKey);
    if (!stage) throw new NotFoundException(`Stage ${stageKey} not found`);
    const [execution] = await this.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)))
      .limit(1);
    if (!execution) throw new NotFoundException(`Execution ${stageKey} not found`);

    let itemIndex: number | undefined;
    if (stage.iterate) {
      if (dto.itemIndex === undefined)
        throw new UnprocessableEntityException('Choose which item to supply an output for.');
      if (execution.itemCount === null || dto.itemIndex >= execution.itemCount)
        throw new UnprocessableEntityException('This item does not exist in the run.');
      itemIndex = dto.itemIndex;
    } else if (dto.itemIndex !== undefined) {
      throw new UnprocessableEntityException('This stage has no items.');
    }

    // Files stored before a later failure (a second file that can't be read, audio that breaks the
    // output's policy) are unused: mark them for collection so they don't wait for the run's delete.
    const freeIfFailed: string[] = [];
    try {
      return await this.store(runRow, stage, dto, options, itemIndex, freeIfFailed);
    } catch (error) {
      if (freeIfFailed.length)
        await this.db
          .update(blob)
          .set({ gcEligible: true, gcEligibleAt: new Date().toISOString() })
          .where(inArray(blob.id, freeIfFailed))
          .catch(() => undefined);
      throw error;
    }
  }

  private async store(
    runRow: OwnedRun,
    stage: StageDef,
    dto: CreateStageOutputCandidateDto,
    options: SupplyOptions,
    itemIndex: number | undefined,
    freeIfFailed: string[],
  ): Promise<{ artifactId: string }> {
    const runId = runRow.id;
    const stageKey = stage.key;
    const built = await this.build(runRow, stage, dto, options, freeIfFailed);
    const iterationValue = await this.iterationValueOf(runId, stageKey, itemIndex);
    const artifactId = await this.artifacts.recordAttemptArtifact({
      runId,
      producerStageKey: stageKey,
      itemIndex,
      iterationValue,
      kind: stage.output.kind,
      data: built.data,
      ...(built.blobId && { blobId: built.blobId, probe: built.probe }),
      ...(stage.output.kind === 'data' && {
        schemaHash: this.schemaValidator.hashOf(stage.output.schema),
      }),
      reproLevel: 'none',
      // Read at confirm, when the person has chosen whether to skip checks.
      repro: {
        supplied: { by: options.by, validation: 'run', contract: definitionKey(stage.output) },
      },
      costUsd: 0,
      userAuthored: true,
    });
    if (built.links.length) await this.attachments.linkClips(artifactId, built.links);
    // Until it is confirmed, an abandoned candidate's files are swept like any other unused file.
    if (built.blobIds.length)
      await this.db
        .update(blob)
        .set({ gcEligible: true, gcEligibleAt: new Date().toISOString() })
        .where(inArray(blob.id, built.blobIds));
    return { artifactId };
  }

  /** Like the engine's own result: text as `{text}`, lists as `{clips|images: [...]}`. */
  private async build(
    runRow: OwnedRun,
    stage: StageDef,
    dto: CreateStageOutputCandidateDto,
    options: SupplyOptions,
    persistedBlobIds: string[],
  ): Promise<{
    data?: unknown;
    blobId?: string;
    probe?: Probe;
    blobIds: string[];
    links: Array<{ blobId: string; filename: string; mime: string }>;
  }> {
    const output = stage.output;
    const none = { blobIds: [], links: [] };
    if (output.kind === 'text') {
      if (typeof dto.value !== 'string')
        throw new UnprocessableEntityException('A text output must be text.');
      return { ...none, data: { text: dto.value } };
    }
    if (output.kind === 'data') {
      if (dto.value === undefined)
        throw new UnprocessableEntityException('Give the output as a value.');
      const violations = this.schemaValidator.validate(output.schema, dto.value);
      if (violations.length > 0)
        throw new UnprocessableEntityException({ code: 'schema_invalid', violations });
      return { ...none, data: dto.value };
    }
    if (output.kind === 'timeline') {
      const parsed = Timeline.safeParse(dto.value);
      if (!parsed.success)
        throw new UnprocessableEntityException({
          code: 'timeline_invalid',
          message: parsed.error.issues[0]?.message ?? 'Not a timeline',
        });
      const problems = (
        await this.timelineChecks.run({ runId: runRow.id, timeline: parsed.data })
      ).filter(
        (r) => !r.pass && (r.name === 'timeline.schema' || r.name === 'timeline.handles_resolve'),
      );
      if (problems.length)
        throw new UnprocessableEntityException({
          code: 'timeline_unresolved',
          message: problems.map((p) => p.message).join('; '),
        });
      return { ...none, data: parsed.data };
    }

    const files = options.files ?? dto.files;
    if (!files?.length) throw new UnprocessableEntityException('Choose the file(s) to use.');
    const sources = await Promise.all(files.map((file) => this.resolveFile(runRow, file)));
    const single = output.kind !== 'media.video_list' && output.kind !== 'media.image_list';
    if (single && sources.length !== 1)
      throw new UnprocessableEntityException('This output takes exactly one file.');

    if (output.kind === 'file.subtitles') {
      const [one] = sources;
      const format = SUBTITLE_FORMATS.find((f) => one!.filename.toLowerCase().endsWith(`.${f}`));
      if (!format)
        throw new UnprocessableEntityException('Subtitles must be an .srt or .vtt file.');
      const text = await this.blobs.readText(runRow.ownerId, one!.blobId, 2 * 1024 * 1024);
      if (text === undefined)
        throw new UnprocessableEntityException('That subtitle file could not be read.');
      const persisted = await this.files.persist({
        ownerId: runRow.ownerId,
        channelId: runRow.channelId,
        runId: runRow.id,
        source: { kind: 'file.subtitles', format, text },
      });
      persistedBlobIds.push(persisted.blobId);
      return {
        blobId: persisted.blobId,
        data: { format },
        blobIds: [persisted.blobId],
        links: [],
      };
    }

    const itemKind = output.kind === 'media.video_list' ? 'media.video' : 'media.image';
    const wantKind = single ? output.kind : itemKind;
    if (!(FILE_KINDS as readonly string[]).includes(wantKind))
      throw new UnprocessableEntityException('This stage output cannot be supplied from files.');
    // Each file must be what the output asks for: a picture is not a video, even though its
    // probe has a video stream.
    const mimePrefix = {
      'media.image': 'image/',
      'media.video': 'video/',
      'media.audio': 'audio/',
    }[wantKind as 'media.image' | 'media.video' | 'media.audio'];
    for (const file of sources)
      if (mimePrefix && !file.mime.startsWith(mimePrefix))
        throw new UnprocessableEntityException(
          `${file.filename} is not ${wantKind === 'media.audio' ? 'a sound' : wantKind === 'media.video' ? 'a video' : 'a picture'}.`,
        );
    const stored = [];
    for (const [index, file] of sources.entries()) {
      try {
        const persisted = await this.workspaces.withWorkspace(runRow.id, async (workspace) => {
          const localPath = await workspace.pull(file.objectKey);
          return this.media.persist({
            ownerId: runRow.ownerId,
            channelId: runRow.channelId,
            runId: runRow.id,
            source: {
              kind: wantKind as (typeof FILE_KINDS)[number],
              localPath,
              mime: file.mime,
              filename: file.filename,
            },
          });
        });
        persistedBlobIds.push(persisted.blobId);
        if (wantKind === 'media.video' && !(persisted.probe.durationSec > 0))
          throw new Error(`${file.filename} has no length, so it is not a video.`);
        stored.push({ ...persisted, index, file });
      } catch (error) {
        throw new UnprocessableEntityException(
          error instanceof Error ? error.message : 'That file could not be used.',
        );
      }
    }
    const blobIds = stored.map((s) => s.blobId);
    if (single) {
      const [one] = stored;
      const problem = audioPolicyViolation(stage, one!.probe);
      if (problem)
        throw new UnprocessableEntityException({ code: 'audio_constraint', message: problem });
      return { blobId: one!.blobId, probe: one!.probe, blobIds, links: [] };
    }
    const items = stored.map((s) => ({
      index: s.index,
      label: null,
      prompt: null,
      filename: s.file.filename,
      blobId: s.blobId,
      probe: s.probe,
    }));
    return {
      data: output.kind === 'media.video_list' ? { clips: items } : { images: items },
      blobIds,
      links: stored.map((s) => ({
        blobId: s.blobId,
        filename: s.file.filename,
        mime: s.file.mime,
      })),
    };
  }

  /** A file the person is allowed to use: a Library asset of this run's channel, another output
   * of theirs, or (assistant only) a chat attachment. Never another owner's. */
  private async resolveFile(runRow: OwnedRun, file: SuppliedFile) {
    const missing = () => new UnprocessableEntityException('That file is not available.');
    let blobId: string | undefined;
    if ('assetId' in file) {
      const [row] = await this.db
        .select()
        .from(asset)
        .where(and(eq(asset.id, file.assetId), isNull(asset.deletedAt)))
        .limit(1);
      if (!row || row.ownerId !== runRow.ownerId || row.channelId !== runRow.channelId)
        throw missing();
      blobId = row.blobId;
    } else if ('artifactId' in file) {
      const [row] = await this.db
        .select({ blobId: artifact.blobId, ownerId: channel.ownerId })
        .from(artifact)
        .innerJoin(run, eq(run.id, artifact.runId))
        .innerJoin(channel, eq(channel.id, run.channelId))
        .where(eq(artifact.id, file.artifactId))
        .limit(1);
      if (!row?.blobId || row.ownerId !== runRow.ownerId) throw missing();
      blobId = row.blobId;
    } else {
      blobId = file.blobId;
    }
    const [row] = await this.db.select().from(blob).where(eq(blob.id, blobId)).limit(1);
    if (!row || row.deletedAt || row.ownerId !== runRow.ownerId) throw missing();
    return {
      blobId: row.id,
      objectKey: row.objectKey,
      mime: row.mime,
      filename: basename(row.objectKey),
    };
  }

  /** The value an item iterates over, copied from the item's latest output so later items and
   * invalidation still see which input it belongs to. */
  private async iterationValueOf(
    runId: string,
    stageKey: string,
    itemIndex: number | undefined,
  ): Promise<unknown> {
    if (itemIndex === undefined) return undefined;
    const [latest] = await this.db
      .select({ iterationValue: artifact.iterationValue })
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, runId),
          eq(artifact.producerStageKey, stageKey),
          eq(artifact.itemIndex, itemIndex),
        ),
      )
      .orderBy(desc(artifact.createdAt))
      .limit(1);
    return latest?.iterationValue ?? undefined;
  }
}
