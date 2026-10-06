import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type {
  ConfigLayer,
  CreateBlueprintVersionDto,
  UpdateBlueprintDto,
  ValidationIssue,
  VersionBump,
} from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  asset,
  blob,
  blueprint,
  blueprintVersion,
  character,
  channel,
  run,
} from '../db/schema/index';
import { deleteRunsCascade } from '../run/run-cascade';
import { queueStorageOrphans } from '../artifact/storage-orphans';
import { ulid } from '../common/ulid';
import { BlueprintValidatorService } from './blueprint-validator.service';
import { collectAssetIds, roleRefsOf } from './collect-asset-refs';
import {
  buildValidationContext,
  type AssetLookup,
  type BlueprintValidationInput,
  type CharacterLookup,
} from './validation-context';
import { resolveBoundType } from './binding-types';
import { isFileKind, modelAcceptsKind } from '../common/file-inputs';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { QcAudioService } from '../qc/qc-audio';
import { EngineConfig } from '../config/engine-config';
import { engineDefaults } from '../run-config/engine-defaults';
import { PINNED_PROVIDERS, PROVIDER_LABELS, ProviderRegistry } from '../provider/provider.registry';
import { QC_VIDEO_UNAVAILABLE, judgeWatchesVideo } from '../qc/qc-video';
import { modalityForCapability } from '../capability/modality-for-capability';
import { stageReferenceLimit } from '../common/reference-limit';
import type { ModelInfo } from '../provider/provider-adapter.interface';

@Injectable()
export class BlueprintService {
  private readonly logger = new Logger(BlueprintService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly validator: BlueprintValidatorService,
    private readonly configResolver: ConfigResolverService,
    private readonly engineConfig: EngineConfig,
    private readonly providers: ProviderRegistry,
    private readonly qcAudio: QcAudioService,
  ) {}

  /** `POST /blueprints`: a new blueprint, refusing a name already used in the
   * channel (409 `blueprint_name_taken`, with the existing id so the UI can
   * offer to open it). `ensureBlueprint` keeps its idempotent behaviour for
   * tests. */
  async createBlueprint(
    channelId: string,
    name: string,
    dto?: { description?: string | undefined; tags?: string[] | undefined },
  ): Promise<string> {
    await this.assertNameFree(channelId, name);
    return this.ensureBlueprint(channelId, name, dto);
  }

  private async assertNameFree(channelId: string, name: string, exceptId?: string) {
    const [existing] = await this.db
      .select({ id: blueprint.id })
      .from(blueprint)
      .where(
        and(
          eq(blueprint.channelId, channelId),
          eq(blueprint.name, name),
          ...(exceptId ? [ne(blueprint.id, exceptId)] : []),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException({
        code: 'blueprint_name_taken',
        message: `A blueprint named "${name}" already exists in this channel`,
        blueprintId: existing.id,
      });
    }
  }

  async ensureBlueprint(
    channelId: string,
    name: string,
    dto?: { description?: string | undefined; tags?: string[] | undefined },
  ): Promise<string> {
    const [existing] = await this.db
      .select()
      .from(blueprint)
      .where(and(eq(blueprint.channelId, channelId), eq(blueprint.name, name)))
      .limit(1);
    if (existing) return existing.id;

    const id = ulid();
    await this.db.insert(blueprint).values({
      id,
      channelId,
      name,
      description: dto?.description,
      tags: dto?.tags,
    });
    this.logger.log({ blueprintId: id, channelId }, 'blueprint created');
    return id;
  }

  // Raw, fully-qualified identifiers (not interpolated Column objects) —
  // see ChannelService.countsSelection for why: an interpolated Column
  // renders unqualified in a `sql` template and collides with a same-named
  // column from the subquery's own tables.
  private runStatsSelection() {
    return {
      runCount: sql<number>`(
        select count(*)::int from run r
        inner join blueprint_version bv on bv.id = r.blueprint_version_id
        where bv.blueprint_id = blueprint.id and not r.dry_run and not bv.draft
      )`.as('run_count'),
      latestPosterBlobId: sql<string | null>`(
        select a.derived->>'poster' from run r
        inner join blueprint_version bv on bv.id = r.blueprint_version_id
        inner join artifact a on a.run_id = r.id
        where bv.blueprint_id = blueprint.id
          and not bv.draft
          and r.state = 'COMPLETED'
          and a.stale = false
          and a.derived->>'poster' is not null
        order by r.ended_at desc
        limit 1
      )`.as('latest_poster_blob_id'),
    };
  }

  async listByChannel(channelId: string) {
    const rows = await this.db
      .select({ blueprint, ...this.runStatsSelection() })
      .from(blueprint)
      .where(eq(blueprint.channelId, channelId));
    return rows.map((r) => ({
      ...r.blueprint,
      runCount: r.runCount,
      latestPosterBlobId: r.latestPosterBlobId,
    }));
  }

  async update(id: string, dto: UpdateBlueprintDto) {
    const current = await this.getBlueprint(id);
    if (dto.name !== undefined && dto.name !== current.name) {
      await this.assertNameFree(current.channelId, dto.name, id);
    }
    await this.db.update(blueprint).set(dto).where(eq(blueprint.id, id));
    this.logger.log({ blueprintId: id, fields: Object.keys(dto) }, 'blueprint updated');
    return this.getBlueprint(id);
  }

  /** Permanently deletes a blueprint with all its versions and runs (and
   * any blueprint-scoped characters). Refuses while one of its runs is still
   * in progress. Files are queued for the storage cleanup sweep. */
  async delete(id: string): Promise<void> {
    await this.getBlueprint(id);
    const versionIds = (
      await this.db
        .select({ id: blueprintVersion.id })
        .from(blueprintVersion)
        .where(eq(blueprintVersion.blueprintId, id))
    ).map((row) => row.id);
    const runRows = versionIds.length
      ? await this.db
          .select({ id: run.id, endedAt: run.endedAt })
          .from(run)
          .where(inArray(run.blueprintVersionId, versionIds))
      : [];
    const open = runRows.filter((row) => row.endedAt === null).length;
    if (open > 0) {
      throw new ConflictException(
        `This blueprint has ${open} run(s) still in progress; cancel them or wait for them to finish before deleting it.`,
      );
    }
    await this.db.transaction(async (tx) => {
      await deleteRunsCascade(
        tx,
        runRows.map((row) => row.id),
        'blueprint_deleted',
      );
      const characterIds = (
        await tx.select({ id: character.id }).from(character).where(eq(character.blueprintId, id))
      ).map((row) => row.id);
      if (characterIds.length) {
        const files = await tx
          .delete(blob)
          .where(inArray(blob.characterId, characterIds))
          .returning({ objectKey: blob.objectKey });
        await queueStorageOrphans(
          tx,
          files.map((file) => file.objectKey),
          'blueprint_deleted',
        );
        await tx.delete(character).where(inArray(character.id, characterIds));
      }
      await tx.update(blueprint).set({ currentVersionId: null }).where(eq(blueprint.id, id));
      await tx.delete(blueprintVersion).where(eq(blueprintVersion.blueprintId, id));
      await tx.delete(blueprint).where(eq(blueprint.id, id));
    });
    this.logger.log({ blueprintId: id, runCount: runRows.length }, 'blueprint deleted');
  }

  async getBlueprint(id: string) {
    const [row] = await this.db
      .select({ blueprint, ...this.runStatsSelection() })
      .from(blueprint)
      .where(eq(blueprint.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Blueprint ${id} not found`);
    return { ...row.blueprint, runCount: row.runCount, latestPosterBlobId: row.latestPosterBlobId };
  }

  /** Saves are numbered major.minor: the first is 1.0, a save bumps minor,
   * `bump: 'major'` goes to (major + 1).0. `draft: true` stores an immutable
   * snapshot for a canvas run of unsaved edits: it reuses the latest saved
   * number (0.0 if none), never becomes `currentVersionId`, and is hidden
   * from `listVersions`. Saving clears `workingDraft`. */
  async createVersion(
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
    { draft = false, bump = 'minor' }: { draft?: boolean; bump?: VersionBump } = {},
  ) {
    const { issues, runnable } = await this.computeValidation(blueprintId, dto);

    const [latest] = await this.db
      .select({ major: blueprintVersion.major, minor: blueprintVersion.minor })
      .from(blueprintVersion)
      .where(and(eq(blueprintVersion.blueprintId, blueprintId), eq(blueprintVersion.draft, false)))
      .orderBy(desc(blueprintVersion.major), desc(blueprintVersion.minor))
      .limit(1);
    const next = draft
      ? (latest ?? { major: 0, minor: 0 })
      : !latest
        ? { major: 1, minor: 0 }
        : bump === 'major'
          ? { major: latest.major + 1, minor: 0 }
          : { major: latest.major, minor: latest.minor + 1 };

    const id = ulid();
    await this.db.transaction(async (tx) => {
      await tx.insert(blueprintVersion).values({
        id,
        blueprintId,
        ...next,
        graph: dto.graph,
        inputs: dto.inputs,
        roles: dto.roles,
        defaults: dto.defaults,
        budget: dto.budget,
        validation: issues,
        runnable,
        draft,
      });
      if (draft) return;
      // §3.4 — insert blueprint, insert version, THEN update the pointer;
      // current_version_id has no FK in the schema (see db/schema/blueprint.ts).
      await tx
        .update(blueprint)
        .set({ currentVersionId: id, workingDraft: null })
        .where(eq(blueprint.id, blueprintId));
    });

    this.logger.log(
      {
        blueprintId,
        blueprintVersionId: id,
        version: `${next.major}.${next.minor}`,
        draft,
        runnable,
        issues: issues.length,
        stages: dto.graph.length,
      },
      'blueprint version created',
    );
    return this.getVersion(id);
  }

  /** The no-persist half of `createVersion`, extracted so
   * `POST /blueprints/:id/validate` reuses exactly this logic rather than
   * duplicating it. Requires the blueprint to already exist (it needs the
   * blueprint's own `channelId` for asset/character channel-scoping), so a
   * draft graph is always validated against a real blueprint, not a fully
   * hypothetical one. */
  private async computeValidation(
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
  ): Promise<{ issues: ValidationIssue[]; runnable: boolean }> {
    const [blueprintRow] = await this.db
      .select({ channelId: blueprint.channelId, defaults: channel.defaults })
      .from(blueprint)
      .innerJoin(channel, eq(blueprint.channelId, channel.id))
      .where(eq(blueprint.id, blueprintId))
      .limit(1);
    if (!blueprintRow) throw new Error(`Blueprint ${blueprintId} not found`);

    const [assetsById, charactersById] = await Promise.all([
      this.loadAssetsById(dto.graph),
      this.loadCharactersById(dto.roles),
    ]);

    const validationInput: BlueprintValidationInput = {
      graph: dto.graph,
      inputs: dto.inputs,
      roles: dto.roles,
      assetsById,
      blueprintChannelId: blueprintRow.channelId,
      charactersById,
    };
    const issues = this.validator.validate(validationInput);
    issues.push(...(await this.validateReferenceLimits(dto, blueprintRow.defaults as ConfigLayer)));
    issues.push(...(await this.validateProviderPins(dto, blueprintRow.defaults as ConfigLayer)));
    issues.push(...(await this.validateQcTranscript(dto)));
    issues.push(...(await this.validateQcVideo(dto)));
    issues.push(
      ...(await this.validateFileInputs(
        dto,
        blueprintRow.defaults as ConfigLayer,
        validationInput,
      )),
    );
    const runnable = issues.every((i) => i.severity !== 'error');
    return { issues, runnable };
  }

  async validateOnly(
    blueprintId: string,
    dto: CreateBlueprintVersionDto,
  ): Promise<{ issues: ValidationIssue[]; runnable: boolean }> {
    return this.computeValidation(blueprintId, dto);
  }

  async getVersion(id: string) {
    const [row] = await this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, id))
      .limit(1);
    if (!row) throw new Error(`BlueprintVersion ${id} not found`);
    return row;
  }

  async listVersions(blueprintId: string) {
    const rows = await this.db
      .select({
        version: blueprintVersion,
        runCount: sql<number>`(
          select count(*)::int from run r
          where r.blueprint_version_id = blueprint_version.id and not r.dry_run
        )`.as('run_count'),
      })
      .from(blueprintVersion)
      .where(and(eq(blueprintVersion.blueprintId, blueprintId), eq(blueprintVersion.draft, false)))
      .orderBy(desc(blueprintVersion.major), desc(blueprintVersion.minor));
    return rows.map((row) => ({ ...row.version, runCount: row.runCount }));
  }

  async setWorkingDraft(id: string, workingDraft: CreateBlueprintVersionDto | null) {
    await this.getBlueprint(id);
    await this.db.update(blueprint).set({ workingDraft }).where(eq(blueprint.id, id));
    return this.getBlueprint(id);
  }

  /** loads every asset referenced by a `{from:'asset'}` ref in the
   * graph, by id, so the (synchronous, DB-free) validator can check
   * existence/channel/kind without touching the database itself. Deliberately
   * NOT scoped to the blueprint's own channel in the query — an asset from a
   * different channel must still resolve to a row (so the validator can
   * distinguish "unknown asset" from "wrong channel" with two separate
   * error messages), it's the validator that rejects the channel mismatch. */
  private async loadAssetsById(
    graph: CreateBlueprintVersionDto['graph'],
  ): Promise<Map<string, AssetLookup>> {
    const assetIds = collectAssetIds(graph);
    if (assetIds.length === 0) return new Map();
    // A soft-deleted asset (`blob.deletedAt`, `AssetService.delete`) must
    // read as "unknown asset" here too — excluded from the map rather than
    // special-cased, so the validator's existing "unknown asset" error
    // covers it for free.
    const rows = await this.db
      .select({ id: asset.id, kind: asset.kind, channelId: asset.channelId })
      .from(asset)
      .innerJoin(blob, eq(asset.blobId, blob.id))
      .where(and(inArray(asset.id, assetIds), isNull(blob.deletedAt)));
    return new Map(rows.map((r) => [r.id, { kind: r.kind, channelId: r.channelId }]));
  }

  private async loadCharactersById(
    roles: CreateBlueprintVersionDto['roles'],
  ): Promise<Map<string, CharacterLookup>> {
    const ids = roles.flatMap((role) => (role.characterId ? [role.characterId] : []));
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: character.id,
        channelId: character.channelId,
        readiness: character.readiness,
        referenceSet: character.referenceSet,
        deletedAt: character.deletedAt,
      })
      .from(character)
      .where(and(inArray(character.id, ids), eq(character.scope, 'channel')));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          channelId: row.channelId ?? '',
          readiness: row.readiness,
          deleted: row.deletedAt !== null,
          referenceBlobIds: new Set(
            (row.referenceSet as Array<{ blobId: string }>).map((ref) => ref.blobId),
          ),
        },
      ]),
    );
  }

  /** "Include transcript" needs a judge model that can listen to audio, or a
   * Deepgram key to transcribe it (see `QcAudioService`). */
  private async validateQcTranscript(dto: CreateBlueprintVersionDto): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const stage of dto.graph) {
      if (!stage.qc?.media?.includeTranscript || stage.output.kind !== 'media.audio') continue;
      const mode = await this.qcAudio.mode(stage.qc.model);
      if (mode.mode === 'unavailable') {
        issues.push({
          path: `stages.${stage.key}.qc.media.includeTranscript`,
          message: mode.reason,
          severity: 'error',
        });
      }
    }
    return issues;
  }

  /** QC on a video list needs a judge that can watch video. */
  private async validateQcVideo(dto: CreateBlueprintVersionDto): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const stage of dto.graph) {
      if (!stage.qc || stage.output.kind !== 'media.video_list') continue;
      if (!(await judgeWatchesVideo(this.providers, stage.qc.model))) {
        issues.push({
          path: `stages.${stage.key}.qc.model`,
          message: QC_VIDEO_UNAVAILABLE,
          severity: 'error',
        });
      }
    }
    return issues;
  }

  private async validateProviderPins(
    dto: CreateBlueprintVersionDto,
    channelDefaults: ConfigLayer,
  ): Promise<ValidationIssue[]> {
    const config = this.configResolver.resolveRunConfig({
      graph: dto.graph,
      engine: engineDefaults(this.engineConfig),
      channelDefaults,
      blueprintDefaults: dto.defaults,
    });
    const issues: ValidationIssue[] = [];
    for (const stage of dto.graph) {
      const pin = config[stage.key]?.model;
      if (!pin?.provider) continue;
      const modality = modalityForCapability(stage.capability);
      if (pin.provider === 'openrouter' && stage.output.kind !== 'data') continue;
      if (!PINNED_PROVIDERS.has(pin.provider)) continue;
      const label = PROVIDER_LABELS[pin.provider];
      try {
        const model = (await this.providers.get(pin.provider).listModels()).find(
          (candidate) => candidate.modelId === pin.modelId,
        );
        if (pin.provider === 'openrouter') {
          if (!model?.capabilities.supportsStructuredOutput) {
            issues.push({
              path: `stages.${stage.key}.model.modelId`,
              message: `OpenRouter model "${String(pin.modelId)}" does not support structured output`,
              severity: 'error',
            });
          }
          continue;
        }
        const effort = pin.params?.reasoningEffort;
        if (!model) {
          issues.push({
            path: `stages.${stage.key}.model.modelId`,
            message: `${label} model "${String(pin.modelId)}" is not available`,
            severity: 'error',
          });
        } else if (!model.modalities?.includes(modality)) {
          issues.push({
            path: `stages.${stage.key}.model.modelId`,
            message:
              model.unavailableModalities?.[modality] ??
              `${label} model "${model.modelId}" is unavailable for ${modality} stages`,
            severity: 'error',
          });
        } else if (
          typeof effort !== 'string' ||
          !model.supportedReasoningEfforts?.includes(effort)
        ) {
          issues.push({
            path: `stages.${stage.key}.model.params.reasoningEffort`,
            message: `reasoning effort "${String(effort)}" is not supported by ${label} model "${model.modelId}"`,
            severity: 'error',
          });
        }
      } catch (error) {
        this.logger.warn(
          { stageKey: stage.key, provider: pin.provider, modelId: pin.modelId, err: error },
          'model discovery failed during blueprint validation',
        );
        issues.push({
          path: `stages.${stage.key}.model`,
          message: `${label} model discovery failed: ${(error as Error).message}`,
          severity: 'error',
        });
      }
    }
    return issues;
  }
  /** A stage's `attach` keys must name Context bindings that resolve to files
   * its model can read. Kind-agnostic: any non-JSON bound kind is a file
   * (`isFileKind`), checked against the model's declared `inputKinds`. */
  private async validateFileInputs(
    dto: CreateBlueprintVersionDto,
    channelDefaults: ConfigLayer,
    validationInput: BlueprintValidationInput,
  ): Promise<ValidationIssue[]> {
    const ctx = buildValidationContext(validationInput);
    const issues: ValidationIssue[] = [];
    const stagesWithFiles = dto.graph.flatMap((stage, index) => {
      const files = (stage.attach ?? []).flatMap((name) => {
        const path = `stages.${stage.key}.context.${name}`;
        const ref = stage.context[name];
        if (!ref) {
          issues.push({
            path: `stages.${stage.key}.attach`,
            message: `"${name}" is not a Context binding of this stage`,
            severity: 'error',
          });
          return [];
        }
        const { type, issue } = resolveBoundType(ref, ctx, index, path);
        if (issue) return []; // already reported by the synchronous validator
        if (!isFileKind(type.kind)) {
          issues.push({
            path,
            message: `"${name}" is ${type.kind}, not a file, so it can't be attached`,
            severity: 'error',
          });
          return [];
        }
        // Files known at save time; prev/memory/input counts are only
        // known at run time, where `loadReferenceFiles` enforces the cap.
        const count =
          ref.from === 'asset'
            ? 1
            : ref.from === 'role'
              ? (dto.roles.find((role) => role.key === ref.roleKey)?.referenceBlobIds?.length ?? 0)
              : 0;
        return [{ path, kind: type.kind, count }];
      });
      return files.length > 0 ? [{ stage, files }] : [];
    });
    if (stagesWithFiles.length === 0) return issues;

    const config = this.configResolver.resolveRunConfig({
      graph: dto.graph,
      engine: engineDefaults(this.engineConfig),
      channelDefaults,
      blueprintDefaults: dto.defaults,
    });
    for (const { stage, files } of stagesWithFiles) {
      const pin = config[stage.key]?.model;
      if (!pin?.provider) continue;
      let model: ModelInfo | undefined;
      try {
        model = (await this.providers.get(pin.provider).listModels()).find(
          (candidate) => candidate.modelId === pin.modelId,
        );
      } catch (error) {
        this.logger.warn(
          { stageKey: stage.key, provider: pin.provider, modelId: pin.modelId, err: error },
          'model discovery failed during file-input validation',
        );
        continue;
      }
      // An unknown model is already reported by `validateProviderPins`.
      if (!model) continue;
      const accepted = model.capabilities.inputKinds ?? [];
      for (const file of files) {
        if (modelAcceptsKind(accepted, file.kind)) continue;
        issues.push({
          path: file.path,
          message: `Model "${model.modelId}" can't read ${file.kind} inputs — pick a model that supports them or remove this binding`,
          severity: 'error',
        });
      }
      // A single over-limit role is already reported by
      // `validateReferenceLimits`; this catches bindings that only exceed
      // the cap together (e.g. character images + a background asset).
      const maxFiles = model.capabilities.maxRefs;
      const total = files.reduce((sum, file) => sum + file.count, 0);
      if (maxFiles !== undefined && files.length > 1 && total > maxFiles) {
        issues.push({
          path: `stages.${stage.key}.attach`,
          message: `attaches ${total} files but model "${model.modelId}" reads at most ${maxFiles} per request`,
          severity: 'error',
        });
      }
    }
    return issues;
  }

  /** Validate the authored selection against the same merged model pins a
   * run will use. This rejects over-limit blueprints at save time instead of
   * letting providers silently drop identity references. */
  private async validateReferenceLimits(
    dto: CreateBlueprintVersionDto,
    channelDefaults: ConfigLayer,
  ): Promise<ValidationIssue[]> {
    const selectedByRole = new Map(
      dto.roles.map((role) => [role.key, role.referenceBlobIds?.length ?? 0]),
    );
    if (selectedByRole.size === 0) return [];
    const config = this.configResolver.resolveRunConfig({
      graph: dto.graph,
      engine: engineDefaults(this.engineConfig),
      channelDefaults,
      blueprintDefaults: dto.defaults,
    });
    const issues: ValidationIssue[] = [];
    for (const stage of dto.graph) {
      const used = roleRefsOf(stage);
      if (used.length === 0) continue;
      const model = config[stage.key]?.model;
      if (!model?.provider || !model.modelId) {
        issues.push({
          path: `stages.${stage.key}`,
          message: 'a role-consuming stage requires a pinned model with a declared reference limit',
          severity: 'error',
        });
        continue;
      }
      let info: ModelInfo | undefined;
      try {
        info = (await this.providers.get(model.provider).listModels()).find(
          (candidate) => candidate.modelId === model.modelId,
        );
      } catch (error) {
        this.logger.warn(
          { stageKey: stage.key, provider: model.provider, err: error },
          'provider lookup failed during blueprint validation',
        );
        issues.push({
          path: `stages.${stage.key}`,
          message: `unknown provider "${model.provider}" for a role-consuming stage`,
          severity: 'error',
        });
        continue;
      }
      // Flow uploads references as browser ingredients, so its limit is the
      // Codex browser job's input cap, not the model's image-generation one.
      const maxRefs = stageReferenceLimit(stage.capability, info?.capabilities);
      if (maxRefs === undefined || (!info && stage.capability !== 'browser.flow_video')) {
        issues.push({
          path: `stages.${stage.key}`,
          message: `model "${model.modelId}" does not declare a reference limit`,
          severity: 'error',
        });
        continue;
      }
      if (
        stage.capability === 'video.generate' &&
        !info?.capabilities.video?.inputs.includes('references')
      ) {
        issues.push({
          path: `stages.${stage.key}`,
          message: `model "${model.modelId}" does not support reference-image conditioning`,
          severity: 'error',
        });
        continue;
      }
      for (const ref of used) {
        if ((selectedByRole.get(ref.roleKey) ?? 0) > maxRefs) {
          issues.push({
            path: `roles.${ref.roleKey}.referenceBlobIds`,
            message: `selected references exceed ${model.modelId}'s limit of ${maxRefs}`,
            severity: 'error',
          });
        }
      }
    }
    return issues;
  }
}
