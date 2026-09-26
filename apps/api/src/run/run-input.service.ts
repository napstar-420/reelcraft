import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InputDef, StageDef, type PutRunInputDto } from '@reelcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { artifact, blob, blueprintVersion, channel, run } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { objectKey } from '../storage/object-key';
import { EngineConfig } from '../config/engine-config';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { ArtifactService } from '../artifact/artifact.service';
import { InvalidationService } from './invalidation.service';
import { PreviewTokenService } from './preview-token.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { WorkspaceService } from '../storage/workspace.service';
import { MediaProbeService } from '../artifact/media-probe.service';

export interface MediaUploadDescriptor {
  blobId: string;
  objectKey: string;
}

export interface AttachMediaBlob {
  blobId: string;
  objectKey: string;
  sha256: string;
}

/**
 * §6.2/§21 — run inputs as artifacts, plus the upload/attach flow media
 * inputs need since a blob can't exist before the run row does. Text/data
 * inputs already known at `RunService.create()` time go straight through
 * `recordProvidedInputs` (inside `create()`'s own transaction); media inputs
 * arrive later via `requestMediaUpload` (issues a presigned PUT, writes
 * nothing) then `attachMediaInput` (writes the `blob`+artifact rows once the
 * upload is confirmed to actually exist via `storage.stat()`).
 */
@Injectable()
export class RunInputService {
  private readonly logger = new Logger(RunInputService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly engineConfig: EngineConfig,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly artifacts: ArtifactService,
    private readonly invalidation: InvalidationService,
    private readonly tokens: PreviewTokenService,
    private readonly mutation: RunMutationService,
    private readonly dispatcher: RunWakeupDispatcher,
    private readonly workspaces: WorkspaceService,
    private readonly probes: MediaProbeService,
  ) {}

  async putInput(runId: string, inputKey: string, dto: PutRunInputDto) {
    const context = await this.loadReplacementContext(runId, inputKey);
    if (context.run.state === 'CREATED') {
      if (!('blobs' in dto)) {
        throw new ConflictException('Text and data inputs are supplied when the run is created');
      }
      return this.attachMediaInput(runId, inputKey, dto.blobs);
    }

    const proposedPayload = 'blobs' in dto ? { blobs: dto.blobs } : { value: dto.value };
    await this.validateReplacement(context.def, proposedPayload);
    const preview = await this.invalidation.preview({ runId, seed: { inputKeys: [inputKey] } });
    if (!dto.previewToken) {
      const issued = this.tokens.issue({
        action: 'replace_input',
        runId,
        runRevision: context.run.revision,
        proposedPayload,
        preview: { fingerprint: preview.fingerprint },
      });
      return {
        previewToken: issued.token,
        expiresAt: issued.expiresAt,
        affectedStageKeys: preview.closure.affectedStageKeys,
        spentUsd: preview.totals.spentUsd,
        estimatedRerunUsd: preview.totals.estimatedRerunUsd,
      };
    }

    const claims = this.tokens.verify<{ fingerprint: string }>(dto.previewToken, {
      action: 'replace_input',
      runId,
      runRevision: context.run.revision,
      proposedPayload,
    });
    if (claims.preview.fingerprint !== preview.fingerprint) {
      throw new ConflictException('The input preview changed; request a new preview');
    }
    // Media objects are mutable outside Postgres; confirm they still exist
    // immediately before the locked replacement transaction.
    const mediaStats =
      'blobs' in dto
        ? await Promise.all(dto.blobs.map((item) => this.storage.stat(item.objectKey)))
        : [];
    const targetStageKey =
      preview.closure.affectedStageKeys[0] ?? context.graph[0]?.key ?? context.run.cursorStageKey;
    if (!targetStageKey) throw new ConflictException('The run has no stage to resume');

    const result = await this.mutation.withLockedRun(
      runId,
      'replace_input',
      ['PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'FAILED', 'COMPLETED'],
      async (tx, lockedRun) => {
        if (lockedRun.revision !== claims.runRevision) {
          throw new ConflictException('The run changed; request a new preview');
        }
        await this.invalidation.apply(tx, {
          runId,
          closure: preview.closure,
          targetStageKey,
        });

        if ('blobs' in dto) {
          const many =
            context.def.accepts.kind !== 'text' &&
            context.def.accepts.kind !== 'data' &&
            context.def.accepts.cardinality === 'many';
          for (const [index, item] of dto.blobs.entries()) {
            const stat = mediaStats[index]!;
            await tx.insert(blob).values({
              id: item.blobId,
              ownerId: context.ownerId,
              scope: 'input',
              runId,
              bucket: this.engineConfig.s3.bucket,
              objectKey: item.objectKey,
              mime: stat.mime,
              bytes: stat.bytes,
              sha256: item.sha256,
              etag: stat.etag,
            });
            await this.artifacts.recordInputArtifact(
              {
                runId,
                key: inputKey,
                kind: context.def.accepts.kind,
                blobId: item.blobId,
                ...(many ? { itemIndex: index } : {}),
              },
              tx,
            );
          }
        } else {
          const currentInputs = lockedRun.inputs as Record<string, unknown>;
          await tx
            .update(run)
            .set({ inputs: { ...currentInputs, [inputKey]: dto.value } })
            .where(eq(run.id, runId));
          await this.artifacts.recordInputArtifact(
            {
              runId,
              key: inputKey,
              kind: context.def.accepts.kind,
              data: context.def.accepts.kind === 'text' ? { text: dto.value } : dto.value,
              ...(context.def.accepts.kind === 'data'
                ? { schemaHash: this.schemaValidator.hashOf(context.def.accepts.schema) }
                : {}),
            },
            tx,
          );
        }
      },
      'run/resumed',
    );
    try {
      await this.dispatcher.dispatch(result.wakeupId);
    } catch (error) {
      this.logger.warn(
        `Run wakeup ${result.wakeupId} will be retried: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { accepted: true, revision: result.revision };
  }

  /** Called inside `RunService.create()`'s transaction — builds `$input:<key>`
   * artifacts for every declared text/data input already present in
   * `dto.inputs`. Media inputs cannot be provided this way; attempting to
   * throws loudly rather than silently ignoring the value. */
  async recordProvidedInputs(
    tx: Tx,
    runId: string,
    inputDefs: InputDef[],
    provided: Record<string, unknown>,
  ): Promise<void> {
    for (const def of inputDefs) {
      if (!(def.key in provided)) continue;
      const value = provided[def.key];

      if (def.accepts.kind === 'text') {
        if (typeof value !== 'string') {
          throw new Error(
            `RunInputService: input "${def.key}" must be a string (declared kind: text)`,
          );
        }
        await this.artifacts.recordInputArtifact(
          { runId, key: def.key, kind: 'text', data: { text: value } },
          tx,
        );
        continue;
      }

      if (def.accepts.kind === 'data') {
        const violations = this.schemaValidator.validate(def.accepts.schema, value);
        if (violations.length > 0) {
          throw new Error(
            `RunInputService: input "${def.key}" does not match its declared schema: ` +
              violations.map((v) => `${v.path} ${v.message}`).join('; '),
          );
        }
        await this.artifacts.recordInputArtifact(
          {
            runId,
            key: def.key,
            kind: 'data',
            data: value,
            schemaHash: this.schemaValidator.hashOf(def.accepts.schema),
          },
          tx,
        );
        continue;
      }

      throw new Error(
        `RunInputService: media input "${def.key}" cannot be provided at create() — a blob ` +
          'cannot exist before the run row does (§6.2). Upload via ' +
          'POST /runs/:id/inputs/:key/upload then PUT /runs/:id/inputs/:key.',
      );
    }
  }

  /** Issues a presigned PUT for a not-yet-uploaded media input blob. Writes
   * nothing — `blob`/`artifact` rows are only created once `attachMediaInput`
   * confirms the upload actually happened. */
  async requestMediaUpload(
    runId: string,
    inputKey: string,
    ext: string,
  ): Promise<MediaUploadDescriptor & { uploadUrl: string }> {
    const { state, ownerId, channelId, inputDefs } = await this.loadContext(runId);
    if (state !== 'CREATED') {
      throw new Error(
        `RunInputService: run ${runId} is ${state} — uploading a new input blob outside ` +
          'CREATED requires invalidation (phase 4 chunk 2), not yet implemented',
      );
    }
    this.requireMediaInputDef(inputDefs, inputKey); // throws if undeclared/non-media

    const blobId = ulid();
    const key = objectKey.input(ownerId, channelId, runId, blobId, ext);
    const uploadUrl = await this.storage.presignPut(key, this.engineConfig.presignTtlSec);
    return { blobId, objectKey: key, uploadUrl };
  }

  /** Confirms an upload (via `storage.stat()`) and writes the `blob` +
   * `$input:<key>` artifact row(s). Only valid while the run is `CREATED` —
   * replacing an input afterward is an invalidation trigger (§6.2), which
   * lands in phase 4 chunk 2. */
  async attachMediaInput(runId: string, inputKey: string, blobs: AttachMediaBlob[]): Promise<void> {
    const { state, ownerId, channelId, inputDefs } = await this.loadContext(runId);
    if (state !== 'CREATED') {
      throw new Error(
        `RunInputService: run ${runId} is ${state} — replacing an input outside CREATED ` +
          'requires invalidation (phase 4 chunk 2), not yet implemented',
      );
    }
    const def = this.requireMediaInputDef(inputDefs, inputKey);
    if (def.accepts.kind === 'text' || def.accepts.kind === 'data') {
      throw new Error(`RunInputService: attachMediaInput called for non-media input "${inputKey}"`);
    }
    if (def.accepts.cardinality === 'one' && blobs.length !== 1) {
      throw new Error(
        `RunInputService: input "${inputKey}" has cardinality "one" but ${blobs.length} blobs were given`,
      );
    }
    if (def.accepts.cardinality === 'many' && blobs.length === 0) {
      throw new Error(
        `RunInputService: input "${inputKey}" has cardinality "many" but no blobs given`,
      );
    }

    const kind = def.accepts.kind;
    const many = def.accepts.cardinality === 'many';
    for (const item of blobs) {
      const expectedPrefix = `${ownerId}/${channelId}/${runId}/inputs/${item.blobId}.`;
      if (
        !item.objectKey.startsWith(expectedPrefix) ||
        item.objectKey.slice(expectedPrefix.length).includes('/')
      ) {
        throw new ConflictException('Uploaded blob does not belong to this run');
      }
    }
    const stats = await Promise.all(blobs.map((item) => this.storage.stat(item.objectKey)));
    for (const stat of stats) {
      const mime = stat.mime.toLowerCase();
      const expectedMimePrefix =
        kind === 'media.image' ? 'image/' : kind === 'media.video' ? 'video/' : 'audio/';
      if (!mime.startsWith(expectedMimePrefix)) {
        throw new ConflictException(
          `Input "${inputKey}" requires ${expectedMimePrefix.slice(0, -1)} media`,
        );
      }
    }
    const probes = await Promise.all(
      blobs.map((item) =>
        this.workspaces.withWorkspace(runId, async (workspace) =>
          this.probes.probe(await workspace.pull(item.objectKey)),
        ),
      ),
    );
    const mutation = await this.mutation.withLockedRun(
      runId,
      'attach',
      ['CREATED'],
      async (tx) => {
        for (const [index, item] of blobs.entries()) {
          const stat = stats[index]!;
          await tx.insert(blob).values({
            id: item.blobId,
            ownerId,
            scope: 'input',
            runId,
            bucket: this.engineConfig.s3.bucket,
            objectKey: item.objectKey,
            mime: stat.mime,
            bytes: stat.bytes,
            sha256: item.sha256,
            etag: stat.etag,
            probe: probes[index],
          });
          await this.artifacts.recordInputArtifact(
            {
              runId,
              key: inputKey,
              kind,
              blobId: item.blobId,
              probe: probes[index],
              ...(many && { itemIndex: index }),
            },
            tx,
          );
        }
      },
      'run/input-attached',
    );
    try {
      await this.dispatcher.dispatch(mutation.wakeupId);
    } catch (error) {
      this.logger.warn(
        `Input attachment ${mutation.wakeupId} will be retried: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async inputStatus(runId: string, inputKey: string) {
    const { state, inputDefs } = await this.loadContext(runId);
    if (state !== 'CREATED') {
      throw new ConflictException(
        'Input attachment status is only available while the run is CREATED',
      );
    }
    const def = inputDefs.find((candidate) => candidate.key === inputKey);
    if (!def) throw new ConflictException(`No declared input "${inputKey}"`);
    const rows = await this.db
      .select({ id: artifact.id })
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, runId),
          eq(artifact.producerStageKey, `$input:${inputKey}`),
          eq(artifact.stale, false),
        ),
      );
    const count = rows.length;
    return { key: inputKey, count, satisfied: count > 0 };
  }

  /** Called from `RunService.start()` — every required `InputDef` must have
   * a resolvable `$input:<key>` artifact by now, at the declared cardinality
   * for media inputs. */
  async assertInputsSatisfied(runId: string, inputDefs: InputDef[]): Promise<void> {
    for (const def of inputDefs) {
      if (!def.required) continue;
      const rows = await this.db
        .select({ itemIndex: artifact.itemIndex })
        .from(artifact)
        .where(
          and(
            eq(artifact.runId, runId),
            eq(artifact.producerStageKey, `$input:${def.key}`),
            eq(artifact.stale, false),
          ),
        );
      if (rows.length === 0) {
        throw new Error(`RunService.start: required input "${def.key}" has not been provided`);
      }
      const many =
        def.accepts.kind !== 'text' && def.accepts.kind !== 'data'
          ? def.accepts.cardinality === 'many'
          : false;
      if (!many && rows.length > 1) {
        throw new Error(
          `RunService.start: input "${def.key}" has ${rows.length} active artifacts but is not cardinality "many"`,
        );
      }
    }
  }

  private async validateReplacement(
    def: InputDef,
    payload: { value?: unknown; blobs?: AttachMediaBlob[] },
  ): Promise<void> {
    if (def.accepts.kind === 'text') {
      if (!('value' in payload) || typeof payload.value !== 'string') {
        throw new ConflictException(`Input "${def.key}" requires a text value`);
      }
      return;
    }
    if (def.accepts.kind === 'data') {
      if (!('value' in payload)) throw new ConflictException(`Input "${def.key}" requires data`);
      const violations = this.schemaValidator.validate(def.accepts.schema, payload.value);
      if (violations.length > 0) {
        throw new ConflictException({ code: 'schema_invalid', violations });
      }
      return;
    }
    if (!payload.blobs) throw new ConflictException(`Input "${def.key}" requires uploaded blobs`);
    if (def.accepts.cardinality === 'one' && payload.blobs.length !== 1) {
      throw new ConflictException(`Input "${def.key}" requires exactly one blob`);
    }
    if (payload.blobs.length === 0)
      throw new ConflictException(`Input "${def.key}" requires blobs`);
    await Promise.all(payload.blobs.map((item) => this.storage.stat(item.objectKey)));
  }

  private async loadReplacementContext(runId: string, inputKey: string) {
    const [row] = await this.db
      .select({
        run,
        ownerId: channel.ownerId,
        inputDefs: blueprintVersion.inputs,
        graph: blueprintVersion.graph,
      })
      .from(run)
      .innerJoin(channel, eq(run.channelId, channel.id))
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new ConflictException(`Run ${runId} not found`);
    const def = InputDef.array()
      .parse(row.inputDefs)
      .find((candidate) => candidate.key === inputKey);
    if (!def) throw new ConflictException(`No declared input "${inputKey}"`);
    return { run: row.run, ownerId: row.ownerId, def, graph: StageDef.array().parse(row.graph) };
  }

  private requireMediaInputDef(inputDefs: InputDef[], key: string): InputDef {
    const def = inputDefs.find((d) => d.key === key);
    if (!def) throw new Error(`RunInputService: no declared input "${key}"`);
    if (def.accepts.kind === 'text' || def.accepts.kind === 'data') {
      throw new Error(
        `RunInputService: input "${key}" is kind "${def.accepts.kind}" — media upload only ` +
          'applies to media.* inputs',
      );
    }
    return def;
  }

  private async loadContext(runId: string): Promise<{
    state: string;
    ownerId: string;
    channelId: string;
    inputDefs: InputDef[];
  }> {
    const [row] = await this.db
      .select({
        state: run.state,
        channelId: run.channelId,
        ownerId: channel.ownerId,
        inputs: blueprintVersion.inputs,
      })
      .from(run)
      .innerJoin(channel, eq(run.channelId, channel.id))
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`RunInputService: run ${runId} not found`);
    return {
      state: row.state,
      ownerId: row.ownerId,
      channelId: row.channelId,
      inputDefs: InputDef.array().parse(row.inputs),
    };
  }
}
