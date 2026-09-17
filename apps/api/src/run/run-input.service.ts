import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InputDef } from '@reefcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { artifact, blob, blueprintVersion, channel, run } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter';
import { objectKey } from '../storage/object-key';
import { EngineConfig } from '../config/engine-config';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { ArtifactService } from '../artifact/artifact.service';

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
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly engineConfig: EngineConfig,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly artifacts: ArtifactService,
  ) {}

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
    const { state, ownerId, inputDefs } = await this.loadContext(runId);
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
    for (const [index, item] of blobs.entries()) {
      const stat = await this.storage.stat(item.objectKey);
      await this.db.insert(blob).values({
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
      });
      await this.artifacts.recordInputArtifact({
        runId,
        key: inputKey,
        kind,
        blobId: item.blobId,
        ...(many && { itemIndex: index }),
      });
    }
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
