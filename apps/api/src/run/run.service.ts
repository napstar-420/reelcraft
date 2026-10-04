import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type {
  CreateRunDto,
  ConfigLayer,
  ReferenceImage,
  RoleDef,
  ListRunsQueryDto,
  Probe,
} from '@reelcraft/shared';
import { InputDef, RoleDef as RoleDefSchema, StageDef } from '@reelcraft/shared';
import { RUN_ACTION_ALLOWED_STATES } from './run-action-policy';
import { findFinalVideo } from '../artifact/final-video';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  asset,
  artifact,
  artifactAttachment,
  runWakeup,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  character,
  humanWait,
  run,
  stageAttempt,
  stageEvent,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd, toUsd } from '../common/money';
import { EngineConfig } from '../config/engine-config';
import { CapabilityRegistry } from '../capability/capability.registry';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { engineDefaults } from '../run-config/engine-defaults';
import { mergeLayer } from '../run-config/layer-merge';
import { LedgerService } from '../budget/ledger.service';
import { collectAssetIds, roleRefsOf } from '../blueprint/collect-asset-refs';
import { RunInputService } from './run-input.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { PINNED_PROVIDERS, PROVIDER_LABELS, ProviderRegistry } from '../provider/provider.registry';
import { modalityForCapability } from '../capability/modality-for-capability';
import { BlobService } from '../artifact/blob.service';
import type { RoleBinding } from '../artifact/binding-resolver.service';
import { canonicalJson } from '../json-schema/schema-hash';
import {
  copyReusedStages,
  reusableStageKeys,
  untilStageIndex,
  type SourceExecutionSummary,
} from './run-seed';

/**
 * §5/§12/§21 — run start resolves and snapshots resolved_config, keyed per
 * stage (matches `RunDetailDto.resolvedConfig`'s `Record<stageKey,
 * ConfigLayer>` shape), by merging engine -> channel -> blueprint -> stage
 * layers through `ConfigResolverService.resolveRunConfig` (§5.2).
 */
@Injectable()
export class RunService {
  private readonly logger = new Logger(RunService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly engineConfig: EngineConfig,
    private readonly configResolver: ConfigResolverService,
    private readonly capabilities: CapabilityRegistry,
    private readonly ledger: LedgerService,
    private readonly runInputs: RunInputService,
    private readonly runMutation: RunMutationService,
    private readonly wakeupDispatcher: RunWakeupDispatcher,
    private readonly providers: ProviderRegistry,
    private readonly blobs: BlobService,
  ) {}

  /** §6.2/§21 — inserts the run in `CREATED` without sending `run/started`.
   * `CREATED` is a real, meaningful window now: media inputs need a run id
   * to attach their blob to (`blob.scope='input'`'s CHECK constraint), so
   * they can only be uploaded/attached after `create()` and before `start()`.
   * Text/data inputs already present in `dto.inputs` are recorded as
   * `$input:<key>` artifacts inline, in the same transaction. */
  async create(dto: CreateRunDto, options?: { dryRun?: boolean }) {
    const [version] = await this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, dto.blueprintVersionId))
      .limit(1);
    if (!version) throw new Error(`BlueprintVersion ${dto.blueprintVersionId} not found`);
    if (!version.runnable)
      throw new Error(`BlueprintVersion ${dto.blueprintVersionId} failed validation`);
    const [versionBlueprint] = await this.db
      .select({ channelId: blueprint.channelId })
      .from(blueprint)
      .where(eq(blueprint.id, version.blueprintId))
      .limit(1);
    if (!versionBlueprint || versionBlueprint.channelId !== dto.channelId) {
      throw new ConflictException('Blueprint version does not belong to the requested channel');
    }

    const [channelRow] = await this.db
      .select({ defaults: channel.defaults })
      .from(channel)
      .where(eq(channel.id, dto.channelId))
      .limit(1);
    if (!channelRow) throw new Error(`Channel ${dto.channelId} not found`);

    const graph = StageDef.array().parse(version.graph);
    const inputDefs = InputDef.array().parse(version.inputs);
    const runId = ulid();

    let resolvedConfig = this.configResolver.resolveRunConfig({
      graph,
      engine: engineDefaults(this.engineConfig),
      channelDefaults: channelRow.defaults as ConfigLayer,
      blueprintDefaults: version.defaults as ConfigLayer,
    });
    if (options?.dryRun) {
      resolvedConfig = this.applyDryRunOverride(graph, resolvedConfig);
    }

    const graphKeys = new Set(graph.map((s) => s.key));
    for (const key of [...dto.rerunStageKeys, ...(dto.untilStageKey ? [dto.untilStageKey] : [])]) {
      if (!graphKeys.has(key)) {
        throw new ConflictException(`Stage "${key}" is not part of this blueprint version`);
      }
    }
    const stopIndex = untilStageIndex(graph, dto.untilStageKey);

    // Canvas "run this stage" / "run to here" — see run-seed.ts and the
    // run-stages-from-canvas plan. Copies a still-valid prefix of a previous
    // run's finished stages into this new run instead of re-executing them.
    let seed: { sourceRunId: string; stageKeys: string[] } | undefined;
    let mergedInputs = dto.inputs;
    if (dto.seedFromRunId) {
      const source = await this.get(dto.seedFromRunId);
      if (source.channelId !== dto.channelId) {
        throw new ConflictException('seedFromRunId belongs to a different channel');
      }
      const [sourceVersion] = await this.db
        .select()
        .from(blueprintVersion)
        .where(eq(blueprintVersion.id, source.blueprintVersionId))
        .limit(1);
      if (!sourceVersion || sourceVersion.blueprintId !== version.blueprintId) {
        throw new ConflictException('seedFromRunId belongs to a different blueprint');
      }
      const sourceGraph = StageDef.array().parse(sourceVersion.graph);
      const sourceInputDefs = InputDef.array().parse(sourceVersion.inputs);
      const newInputByKey = new Map(inputDefs.map((d) => [d.key, d]));
      for (const def of sourceInputDefs) {
        const newDef = newInputByKey.get(def.key);
        if (!newDef || canonicalJson(def) !== canonicalJson(newDef)) {
          throw new ConflictException(
            `Input "${def.key}" changed shape since the seed run — cannot reuse it`,
          );
        }
      }
      for (const [key, value] of Object.entries(dto.inputs)) {
        if (
          key in (source.inputs as Record<string, unknown>) &&
          canonicalJson(value) !== canonicalJson((source.inputs as Record<string, unknown>)[key])
        ) {
          throw new ConflictException(`Input "${key}" conflicts with the seed run's value`);
        }
      }
      mergedInputs = { ...(source.inputs as Record<string, unknown>), ...dto.inputs };

      const sourceRoles = RoleDefSchema.array().parse(sourceVersion.roles ?? []);
      const newRoles = RoleDefSchema.array().parse(version.roles ?? []);
      const newAssetBindings = await this.resolveAssetBindings(graph, dto.channelId);

      const iteratingExecutionIds = source.stageExecutions
        .filter((e) => e.isIterating)
        .map((e) => e.id);
      const nonPassedItemExecutionIds = new Set<string>();
      if (iteratingExecutionIds.length > 0) {
        const rows = await this.db
          .select({ stageExecutionId: stageItem.stageExecutionId })
          .from(stageItem)
          .where(
            and(
              inArray(stageItem.stageExecutionId, iteratingExecutionIds),
              sql`${stageItem.state} != 'passed'`,
            ),
          );
        for (const row of rows) nonPassedItemExecutionIds.add(row.stageExecutionId);
      }
      const sourceExecutions: SourceExecutionSummary[] = source.stageExecutions.map((e) => ({
        stageKey: e.stageKey,
        state: e.state,
        needsItemWork: nonPassedItemExecutionIds.has(e.id),
      }));

      const stageKeys = reusableStageKeys({
        sourceGraph,
        newGraph: graph,
        sourceResolvedConfig: source.resolvedConfig as Record<string, ConfigLayer>,
        sourceOverrides: (source.overrides ?? {}) as Record<string, ConfigLayer>,
        newResolvedConfig: resolvedConfig,
        sourceAssetBindings: source.assetBindings as Record<
          string,
          { blobId: string; kind: string }
        >,
        newAssetBindings,
        sourceRoles,
        newRoles,
        sourceExecutions,
        rerunStageKeys: dto.rerunStageKeys,
      });
      if (stageKeys.length > 0) seed = { sourceRunId: dto.seedFromRunId, stageKeys };
    }

    await this.db.transaction(async (tx) => {
      await tx.insert(run).values({
        id: runId,
        channelId: dto.channelId,
        blueprintVersionId: dto.blueprintVersionId,
        state: 'CREATED',
        inputs: mergedInputs,
        roleBindings: dto.roleBindings,
        resolvedConfig,
        dryRun: options?.dryRun ?? false,
        budgetCapUsd: fromUsd(dto.budgetCapUsd),
      });

      const newExecutionIdByKey = new Map<string, string>();
      const reusedKeys = new Set(seed?.stageKeys ?? []);
      for (const [index, stage] of graph.entries()) {
        const id = ulid();
        newExecutionIdByKey.set(stage.key, id);
        const state = reusedKeys.has(stage.key)
          ? 'passed'
          : stopIndex !== undefined && index > stopIndex
            ? 'skipped'
            : 'pending';
        await tx.insert(stageExecution).values({ id, runId, stageKey: stage.key, state });
      }

      if (seed) {
        await copyReusedStages(tx, {
          sourceRunId: seed.sourceRunId,
          runId,
          stageKeys: seed.stageKeys,
          newExecutionIdByKey,
        });
      }

      await this.runInputs.recordProvidedInputs(tx, runId, inputDefs, mergedInputs);
    });
    this.logger.log(
      {
        runId,
        channelId: dto.channelId,
        blueprintVersionId: dto.blueprintVersionId,
        dryRun: options?.dryRun ?? false,
      },
      'run created',
    );

    return this.get(runId);
  }

  /** §6.2/§21 — the other half of the create/start split: asserts every
   * required input is satisfied, snapshots `{from:'asset'}` refs into
   * `run.assetBindings` (immutable from here on, §3.7), then sends
   * `run/started` for real — `run.orchestrate`'s `mark-running` step is what
   * actually flips `state` to `RUNNING`. */
  async start(runId: string) {
    const current = await this.get(runId);
    if (current.state !== 'CREATED') {
      throw new Error(`RunService.start: run ${runId} is ${current.state}, not CREATED`);
    }

    const [version] = await this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, current.blueprintVersionId))
      .limit(1);
    if (!version) throw new Error(`BlueprintVersion ${current.blueprintVersionId} not found`);
    const graph = StageDef.array().parse(version.graph);
    const inputDefs = InputDef.array().parse(version.inputs);
    const roles = RoleDefSchema.array().parse(version.roles ?? []);

    await this.runInputs.assertInputsSatisfied(runId, inputDefs);

    const [assetBindings, roleBindings] = await Promise.all([
      this.resolveAssetBindings(graph, current.channelId),
      this.resolveRoleBindings(roles, current.channelId),
    ]);
    await this.assertReferenceLimits(
      graph,
      current.resolvedConfig as Record<string, ConfigLayer>,
      roleBindings,
    );
    await this.assertProviderPins(graph, current.resolvedConfig as Record<string, ConfigLayer>);
    const mutation = await this.runMutation.withLockedRun(
      runId,
      'start',
      ['CREATED'],
      async (tx) => {
        await tx
          .update(run)
          .set({ assetBindings, ...(Object.keys(roleBindings).length > 0 && { roleBindings }) })
          .where(eq(run.id, runId));
      },
      'run/started',
    );
    this.logger.log(
      { runId, wakeupId: mutation.wakeupId, revision: mutation.revision },
      'run started',
    );

    await this.dispatchBestEffort(mutation.wakeupId);

    return this.get(runId);
  }

  /** Resolves blueprint-selected references once, before the start wakeup.
   * Snapshots include storage locations, so later Character edits/deletes do
   * not change a paid run's identity conditioning. */
  private async resolveRoleBindings(roles: RoleDef[], channelId: string) {
    if (roles.length === 0) return {};
    const result: Record<string, RoleBinding> = {};
    for (const role of roles) {
      const referenceBlobIds = role.referenceBlobIds ?? [];
      if (!role.characterId || referenceBlobIds.length === 0) {
        throw new ConflictException(
          `RunService.start: role "${role.key}" has no selected Character references`,
        );
      }
      const [row] = await this.db
        .select()
        .from(character)
        .where(
          and(
            eq(character.id, role.characterId),
            eq(character.channelId, channelId),
            eq(character.scope, 'channel'),
          ),
        )
        .limit(1);
      if (row?.deletedAt)
        throw new ConflictException(
          `RunService.start: the Character for role "${role.key}" was deleted; choose another one in Blueprint settings`,
        );
      if (!row || row.readiness !== 'ready')
        throw new ConflictException(
          `RunService.start: Character for role "${role.key}" is not ready`,
        );
      const refs = row.referenceSet as ReferenceImage[];
      const selected = referenceBlobIds
        .map((id) => refs.find((ref) => ref.blobId === id))
        .filter((ref): ref is ReferenceImage => Boolean(ref));
      if (selected.length !== referenceBlobIds.length)
        throw new ConflictException(
          `RunService.start: role "${role.key}" selects a reference not owned by its Character`,
        );
      const rows = await this.db
        .select({ id: blob.id, objectKey: blob.objectKey, mime: blob.mime, probe: blob.probe })
        .from(blob)
        .where(
          and(
            inArray(blob.id, referenceBlobIds),
            eq(blob.characterId, row.id),
            isNull(blob.deletedAt),
          ),
        );
      if (rows.length !== selected.length)
        throw new ConflictException(`RunService.start: role "${role.key}" has a deleted reference`);
      const byId = new Map(rows.map((ref) => [ref.id, ref]));
      const primaryFirst = selected
        .slice()
        .sort(
          (a, b) => Number(b.blobId === row.primaryRefId) - Number(a.blobId === row.primaryRefId),
        );
      result[role.key] = {
        characterId: row.id,
        name: row.name,
        description: row.description,
        references: primaryFirst.map((ref) => {
          const source = byId.get(ref.blobId)!;
          return {
            blobId: source.id,
            sourceKey: source.objectKey,
            mime: source.mime,
            view: ref.view,
            ...(ref.caption && { caption: ref.caption }),
            ...(source.probe != null && { probe: source.probe }),
          };
        }),
      };
    }
    return result;
  }

  /** A pinned model's advertised limit is the authority. Missing metadata is
   * deliberately a start failure: silently truncating selected identity
   * references makes a blueprint non-reproducible. */
  private async assertReferenceLimits(
    graph: StageDef[],
    resolvedConfig: Record<string, ConfigLayer>,
    roleBindings: Record<string, { references: Array<unknown> }>,
  ): Promise<void> {
    const roleKeys = new Set(Object.keys(roleBindings));
    if (roleKeys.size === 0) return;
    for (const stage of graph) {
      const roles = roleRefsOf(stage).filter((ref) => roleKeys.has(ref.roleKey));
      if (roles.length === 0) continue;
      const model = resolvedConfig[stage.key]?.model;
      if (!model?.provider || !model.modelId)
        throw new ConflictException(
          `RunService.start: role-consuming stage "${stage.key}" has no pinned model`,
        );
      const info = (await this.providers.get(model.provider).listModels()).find(
        (candidate) => candidate.modelId === model.modelId,
      );
      const maxRefs = info?.capabilities.maxRefs ?? info?.capabilities.image?.maxReferences;
      if (!info || maxRefs === undefined)
        throw new ConflictException(
          `RunService.start: model "${model.modelId}" does not declare a reference limit`,
        );
      if (
        stage.capability === 'video.generate' &&
        !info.capabilities.video?.inputs.includes('references')
      ) {
        throw new ConflictException(
          `RunService.start: model "${model.modelId}" does not support reference-image conditioning`,
        );
      }
      for (const ref of roles) {
        const count = roleBindings[ref.roleKey]!.references.length;
        if (count > maxRefs)
          throw new ConflictException(
            `RunService.start: role "${ref.roleKey}" selects ${count} references but model "${model.modelId}" accepts ${maxRefs}`,
          );
      }
    }
  }

  /** §6.2 — walks every `{from:'asset'}` ref in the graph and snapshots the
   * CURRENT asset->blob binding. A runnable blueprint version already proves
   * every such ref names a real, same-channel, media-kind asset at SAVE
   * time (`blueprint.service.ts`'s `assetsById` plumbing) — but assets are
   * mutable/deletable channel resources, not pinned to the blueprint
   * version, so a real (if rare) race exists between save and this run's
   * start: re-verify rather than trust the earlier validation blindly. */
  private async resolveAssetBindings(
    graph: StageDef[],
    channelId: string,
  ): Promise<Record<string, { blobId: string; kind: string }>> {
    const assetIds = collectAssetIds(graph);
    if (assetIds.length === 0) return {};

    // A soft-deleted asset (`blob.deletedAt` set, `AssetService.delete`)
    // must not resolve for a NEW run even though its row still exists —
    // treated identically to "no longer exists" below.
    const rows = await this.db
      .select({ id: asset.id, channelId: asset.channelId, kind: asset.kind, blobId: asset.blobId })
      .from(asset)
      .innerJoin(blob, eq(asset.blobId, blob.id))
      .where(and(inArray(asset.id, assetIds), isNull(blob.deletedAt)));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const bindings: Record<string, { blobId: string; kind: string }> = {};
    for (const assetId of assetIds) {
      const row = byId.get(assetId);
      if (!row) {
        throw new Error(`RunService.start: referenced asset "${assetId}" no longer exists`);
      }
      if (row.channelId !== channelId) {
        throw new Error(
          `RunService.start: referenced asset "${assetId}" belongs to a different channel`,
        );
      }
      bindings[assetId] = { blobId: row.blobId, kind: row.kind };
    }
    return bindings;
  }

  /** Chunk 5 — a dry run is a real `run` row driven through the unchanged
   * async pipeline (locked product decision #1), not a bespoke synchronous
   * path. `startDryRun` just resolves `(blueprintId, version)` to the
   * `channelId`/`blueprintVersionId` pair `create()` needs, then reuses
   * `create()`/`start()` verbatim with `{dryRun: true}`. */
  async startDryRun(
    blueprintId: string,
    version: { major: number; minor: number },
    budgetCapUsd = 1,
  ) {
    const [blueprintRow] = await this.db
      .select({ channelId: blueprint.channelId })
      .from(blueprint)
      .where(eq(blueprint.id, blueprintId))
      .limit(1);
    if (!blueprintRow) throw new NotFoundException(`Blueprint ${blueprintId} not found`);

    const [versionRow] = await this.db
      .select({ id: blueprintVersion.id })
      .from(blueprintVersion)
      .where(
        and(
          eq(blueprintVersion.blueprintId, blueprintId),
          eq(blueprintVersion.major, version.major),
          eq(blueprintVersion.minor, version.minor),
          eq(blueprintVersion.draft, false),
        ),
      )
      .limit(1);
    if (!versionRow) {
      throw new NotFoundException(
        `Blueprint ${blueprintId} version ${version.major}.${version.minor} not found`,
      );
    }

    const created = await this.create(
      {
        channelId: blueprintRow.channelId,
        blueprintVersionId: versionRow.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd,
        rerunStageKeys: [],
      },
      { dryRun: true },
    );
    return this.start(created.id);
  }

  /** Chunk 5 — forces every stage's model pin to the fake provider
   * regardless of what the graph authors (locked product decision #1), plus
   * `qc.model` on any stage declaring `stage.qc`, so a QC judge call never
   * reaches a real provider either. A modality with no fake model (`human`/
   * `publish`/`compute`, and `media.analyze`'s `probe` path, which never
   * consumes a model pin at all) is left completely untouched. */
  private applyDryRunOverride(
    graph: StageDef[],
    resolvedConfig: Record<string, ConfigLayer>,
  ): Record<string, ConfigLayer> {
    const fakeModelByModality: Record<string, string> = {
      text: 'fake-text-1',
      image: 'fake-image-1',
      video: 'fake-video-1',
      audio: 'fake-audio-1',
    };
    const overridden: Record<string, ConfigLayer> = {};
    for (const stage of graph) {
      const layer = resolvedConfig[stage.key] ?? {};
      const modality = modalityForCapability(stage.capability);
      const fakeModelId = fakeModelByModality[modality];
      overridden[stage.key] = {
        ...layer,
        ...(fakeModelId !== undefined && {
          model: {
            provider: 'fake',
            modelId: fakeModelId,
            params: {},
          },
        }),
        ...(stage.qc && {
          qc: { ...layer.qc, model: { provider: 'fake', modelId: 'fake-judge-1', params: {} } },
        }),
      };
    }
    return overridden;
  }

  /** §12.4 — the one budget mutation allowed while `RUNNING`. With
   * `stageKey` it raises that stage's own cap for this run instead of the
   * run cap. A `PAUSED_BUDGET` run is resumed in the same request. */
  async raiseBudget(runId: string, capUsd: number, stageKey?: string) {
    if (stageKey) await this.ledger.raiseStageCap({ runId, stageKey, newCapUsd: capUsd });
    else await this.ledger.raiseBudget({ runId, newCapUsd: capUsd });
    this.logger.log({ runId, capUsd, stageKey }, 'run budget raised');
    // A run paused for budget continues straight away; in any other state
    // raising a cap only widens it.
    const current = await this.get(runId);
    if (current.state !== 'PAUSED_BUDGET') return current;
    try {
      return await this.resume(runId);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      this.logger.warn({ runId, err: error }, 'raised budget but the run could not resume');
      return this.get(runId);
    }
  }

  /** §12.4 — budget pauses and failed runs are explicit recovery points
   * with a cursor precondition (the cursor execution must actually still be
   * mid-flight). A manual pause (`PAUSED_MANUAL`) skips that precondition:
   * the cursor can legitimately be `passed` (paused right after a stage
   * finished) or `running` (paused while the current attempt was still
   * being allowed to finish) — the orchestrator re-derives what to do next
   * either way. The durable wakeup claim performs the actual transition
   * only if the persisted source state and revision are still current. */
  async resume(runId: string) {
    const current = await this.get(runId);
    if (current.state === 'PAUSED_BUDGET' || current.state === 'FAILED') {
      const cursor = current.cursorStageKey
        ? current.stageExecutions.find((execution) => execution.stageKey === current.cursorStageKey)
        : undefined;
      if (
        !cursor ||
        ['passed', 'skipped', 'awaiting_approval', 'awaiting_input'].includes(cursor.state)
      ) {
        throw new ConflictException(
          `Run ${runId} has no resumable cursor execution in state ${current.state}`,
        );
      }
    }
    const mutation = await this.runMutation.withLockedRun(
      runId,
      'resume',
      RUN_ACTION_ALLOWED_STATES.resume,
      async () => undefined,
      'run/resumed',
    );
    this.logger.log(
      { runId, wakeupId: mutation.wakeupId, fromState: current.state },
      'run resumed',
    );
    await this.dispatchBestEffort(mutation.wakeupId);
    return this.get(runId);
  }

  /** §12.4 — manual pause. Unlike cancel, this must stay resumable: it flips
   * `run.state` to `PAUSED_MANUAL` synchronously (so the API reflects it
   * immediately) but does NOT hard-cancel the in-flight Inngest function —
   * the orchestrator's own runnable checks (before the next stage/item) are
   * what actually halt progress, letting whatever attempt is already
   * in-flight finish and commit normally. No listener exists for
   * `run/paused` (the state flip alone is sufficient); this mirrors other
   * unlistened outbox events like `run/config-updated`. */
  async pause(runId: string) {
    const mutation = await this.runMutation.withLockedRun(
      runId,
      'pause',
      RUN_ACTION_ALLOWED_STATES.pause,
      async (tx) => {
        await tx.update(run).set({ state: 'PAUSED_MANUAL' }).where(eq(run.id, runId));
      },
      'run/paused',
    );
    this.logger.log({ runId, wakeupId: mutation.wakeupId }, 'run paused');
    await this.dispatchBestEffort(mutation.wakeupId);
    return this.get(runId);
  }

  private async dispatchBestEffort(wakeupId: string): Promise<void> {
    try {
      await this.wakeupDispatcher.dispatch(wakeupId);
    } catch (error) {
      // The committed outbox row is the source of truth. The periodic
      // dispatcher will retry this delivery, so the HTTP mutation succeeds.
      this.logger?.warn({ wakeupId, err: error }, 'run wakeup dispatch deferred to retry');
    }
  }

  async get(runId: string) {
    const [row] = await this.db.select().from(run).where(eq(run.id, runId)).limit(1);
    if (!row) throw new Error(`Run ${runId} not found`);
    const executions = await this.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, runId));
    const [version] = await this.db
      .select({ graph: blueprintVersion.graph })
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, row.blueprintVersionId))
      .limit(1);
    const graph = StageDef.array().parse(version?.graph ?? []);
    const definitions = new Map(graph.map((stage) => [stage.key, stage]));
    const attemptRows = executions.length
      ? await this.db
          .select({ stageExecutionId: stageAttempt.stageExecutionId })
          .from(stageAttempt)
          .where(
            inArray(
              stageAttempt.stageExecutionId,
              executions.map((execution) => execution.id),
            ),
          )
      : [];
    const attemptCounts = new Map<string, number>();
    for (const attempt of attemptRows) {
      attemptCounts.set(
        attempt.stageExecutionId,
        (attemptCounts.get(attempt.stageExecutionId) ?? 0) + 1,
      );
    }
    const outputArtifactIds = executions
      .map((execution) => execution.outputArtifactId)
      .filter((id): id is string => id !== null);
    const attachmentRows = outputArtifactIds.length
      ? await this.db
          .select()
          .from(artifactAttachment)
          .where(inArray(artifactAttachment.artifactId, outputArtifactIds))
      : [];
    const [owner] = await this.db
      .select({ ownerId: channel.ownerId })
      .from(channel)
      .where(eq(channel.id, row.channelId))
      .limit(1);
    const attachmentsByArtifact = new Map<string, Array<(typeof attachmentRows)[number]>>();
    for (const attachment of attachmentRows) {
      const values = attachmentsByArtifact.get(attachment.artifactId) ?? [];
      values.push(attachment);
      attachmentsByArtifact.set(attachment.artifactId, values);
    }
    const final = await findFinalVideo(this.db, runId);
    const budgetBlock = row.state === 'PAUSED_BUDGET' ? await this.budgetBlock(row) : null;
    const resumeAt = row.state === 'PAUSED_QUOTA' ? await this.quotaResumeAt(runId) : null;
    return {
      ...row,
      budgetBlock,
      resumeAt,
      finalVideo: final
        ? {
            artifactId: final.artifactId,
            blobId: final.blobId,
            ...(final.probe?.durationSec !== undefined && { durationSec: final.probe.durationSec }),
            ...(final.posterBlobId && { posterBlobId: final.posterBlobId }),
          }
        : null,
      stageExecutions: await Promise.all(
        executions.map(async (execution) => {
          const definition = definitions.get(execution.stageKey);
          const capability = definition?.capability ?? 'unknown';
          return {
            ...execution,
            label: definition?.label || execution.stageKey,
            output: definition?.output ?? null,
            attemptCount: attemptCounts.get(execution.id) ?? 0,
            capability,
            interaction: this.capabilities.get(capability).interaction?.kind ?? null,
            attachments: (
              await Promise.all(
                (attachmentsByArtifact.get(execution.outputArtifactId ?? '') ?? [])
                  .filter((attachment) => attachment.role !== 'clip')
                  .map(async (attachment) => {
                    const access = await this.blobs.readUrl(
                      owner?.ownerId ?? 'local',
                      attachment.blobId,
                    );
                    if (access?.status !== 'live') return undefined;
                    return {
                      id: attachment.id,
                      blobId: attachment.blobId,
                      role: attachment.role,
                      filename: attachment.filename,
                      mime: attachment.mime,
                      url: access.url,
                    };
                  }),
              )
            ).filter((attachment) => attachment !== undefined),
          };
        }),
      ),
    };
  }

  /** When a `PAUSED_QUOTA` run resumes by itself: the held-back wakeup's time. */
  private async quotaResumeAt(runId: string): Promise<string | null> {
    const [wakeup] = await this.db
      .select({ notBefore: runWakeup.notBefore })
      .from(runWakeup)
      .where(
        and(
          eq(runWakeup.runId, runId),
          isNull(runWakeup.dispatchedAt),
          isNotNull(runWakeup.notBefore),
        ),
      )
      .orderBy(desc(runWakeup.createdAt))
      .limit(1);
    return wakeup?.notBefore ?? null;
  }

  /** Which cap paused a `PAUSED_BUDGET` run: the latest `budget_blocked`
   * attempt's recorded reason (`stage-runner.service.ts`), so the Raise
   * budget dialog raises the cap that actually blocks it. */
  private async budgetBlock(row: typeof run.$inferSelect) {
    const [event] = await this.db
      .select({ data: stageEvent.data, stageKey: stageExecution.stageKey })
      .from(stageEvent)
      .innerJoin(stageExecution, eq(stageExecution.id, stageEvent.stageExecutionId))
      .where(
        and(
          eq(stageEvent.runId, row.id),
          eq(stageEvent.type, 'attempt.finished'),
          sql`${stageEvent.data}->>'outcome' = 'budget_blocked'`,
        ),
      )
      .orderBy(desc(stageEvent.id))
      .limit(1);
    const stageKey = event?.stageKey ?? row.cursorStageKey;
    if (!stageKey) return null;
    const reason = (event?.data as { reason?: unknown } | null)?.reason;
    if (reason !== 'stage_cap_exceeded')
      return { scope: 'run' as const, stageKey, stageCapUsd: null };
    const resolved = (row.resolvedConfig ?? {}) as Record<string, ConfigLayer>;
    const overrides = (row.overrides ?? {}) as Record<string, ConfigLayer>;
    const stageCapUsd =
      mergeLayer(resolved[stageKey] ?? {}, overrides[stageKey] ?? {}).budget?.stageCapUsd ?? null;
    return { scope: 'stage' as const, stageKey, stageCapUsd };
  }

  async approvalCandidate(runId: string, stageKey: string) {
    const [runRow] = await this.db
      .select({ state: run.state, cursorStageKey: run.cursorStageKey, ownerId: channel.ownerId })
      .from(run)
      .innerJoin(channel, eq(channel.id, run.channelId))
      .where(eq(run.id, runId))
      .limit(1);
    if (!runRow) throw new NotFoundException(`Run ${runId} not found`);
    if (runRow.state !== 'PAUSED_APPROVAL' || runRow.cursorStageKey !== stageKey) {
      throw new ConflictException(`Run ${runId} is not awaiting approval at ${stageKey}`);
    }

    const [execution] = await this.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)))
      .limit(1);
    if (!execution) throw new NotFoundException(`Stage ${stageKey} not found in run ${runId}`);

    const [wait] = await this.db
      .select()
      .from(humanWait)
      .where(
        and(
          eq(humanWait.runId, runId),
          eq(humanWait.stageExecutionId, execution.id),
          eq(humanWait.kind, 'approval'),
          isNull(humanWait.resolvedAt),
        ),
      )
      .limit(1);
    if (!wait) throw new ConflictException('No open approval wait exists for this stage');

    let itemIndex: number | null = null;
    if (wait.stageItemId) {
      const [item] = await this.db
        .select()
        .from(stageItem)
        .where(
          and(
            eq(stageItem.id, wait.stageItemId),
            eq(stageItem.stageExecutionId, execution.id),
            eq(stageItem.state, 'awaiting_approval'),
          ),
        )
        .limit(1);
      if (!item)
        throw new ConflictException('The approval wait no longer matches an open stage item');
      itemIndex = item.itemIndex;
    } else if (execution.state !== 'awaiting_approval') {
      throw new ConflictException('The stage is no longer awaiting approval');
    }

    const attemptWhere = wait.stageItemId
      ? eq(stageAttempt.stageItemId, wait.stageItemId)
      : isNull(stageAttempt.stageItemId);
    const [attempt] = await this.db
      .select()
      .from(stageAttempt)
      .where(
        and(
          eq(stageAttempt.stageExecutionId, execution.id),
          attemptWhere,
          eq(stageAttempt.phase, 'awaiting_approval'),
          eq(stageAttempt.outcome, 'awaiting_approval'),
        ),
      )
      .orderBy(desc(stageAttempt.attemptNo))
      .limit(1);
    if (!attempt?.artifactId) throw new ConflictException('No pending approval candidate exists');

    const artifactWhere =
      itemIndex === null ? isNull(artifact.itemIndex) : eq(artifact.itemIndex, itemIndex);
    const [candidate] = await this.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.id, attempt.artifactId),
          eq(artifact.runId, runId),
          eq(artifact.producerStageKey, stageKey),
          artifactWhere,
          eq(artifact.stale, true),
        ),
      )
      .limit(1);
    if (!candidate) throw new ConflictException('The approval candidate is no longer available');

    const [stillOpen] = await this.db
      .select({ id: humanWait.id })
      .from(humanWait)
      .where(and(eq(humanWait.id, wait.id), isNull(humanWait.resolvedAt)))
      .limit(1);
    if (!stillOpen)
      throw new ConflictException('The approval was resolved while loading its candidate');

    return {
      stageKey,
      itemIndex,
      attempt: {
        id: attempt.id,
        attemptNo: attempt.attemptNo,
        checkResults: attempt.checkResults,
        qcVerdict: attempt.qcVerdict,
        costUsd: toUsd(attempt.costUsd),
        createdAt: attempt.createdAt,
      },
      artifact: await this.toArtifactView(runRow.ownerId, candidate),
    };
  }

  /** The current (non-stale) output of a stage, one entry per item for an
   * iterating stage. Works in any run state, unlike `approvalCandidate`. */
  async stageOutput(runId: string, stageKey: string) {
    const [runRow] = await this.db
      .select({ ownerId: channel.ownerId })
      .from(run)
      .innerJoin(channel, eq(channel.id, run.channelId))
      .where(eq(run.id, runId))
      .limit(1);
    if (!runRow) throw new NotFoundException(`Run ${runId} not found`);
    const rows = await this.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, runId),
          eq(artifact.producerStageKey, stageKey),
          eq(artifact.stale, false),
        ),
      )
      .orderBy(asc(artifact.itemIndex));
    return {
      stageKey,
      items: await Promise.all(
        rows.map(async (row) => ({
          itemIndex: row.itemIndex,
          artifact: await this.toArtifactView(runRow.ownerId, row),
        })),
      ),
    };
  }

  private async toArtifactView(ownerId: string, row: typeof artifact.$inferSelect) {
    const attachments = await this.db
      .select()
      .from(artifactAttachment)
      .where(eq(artifactAttachment.artifactId, row.id));
    const preview = row.blobId ? await this.blobs.readUrl(ownerId, row.blobId) : undefined;
    const safeAttachments = (
      await Promise.all(
        attachments.map(async (attachment) => {
          const access = await this.blobs.readUrl(ownerId, attachment.blobId);
          if (access?.status !== 'live') return undefined;
          if (attachment.role !== 'evidence' && attachment.role !== 'download') return undefined;
          return {
            id: attachment.id,
            role: attachment.role,
            filename: attachment.filename,
            mime: attachment.mime,
            url: access.url,
          };
        }),
      )
    ).filter((value) => value !== undefined);
    const clips =
      row.kind === 'media.video_list'
        ? (
            await Promise.all(
              (
                ((row.data as { clips?: unknown[] } | null)?.clips ?? []) as Array<{
                  index: number;
                  label: string | null;
                  blobId: string;
                  probe: Probe | null;
                }>
              ).map(async (clip) => {
                const access = await this.blobs.readUrl(ownerId, clip.blobId);
                if (access?.status !== 'live') return undefined;
                return {
                  index: clip.index,
                  label: clip.label,
                  url: access.url,
                  probe: clip.probe ?? null,
                };
              }),
            )
          ).filter((clip) => clip !== undefined)
        : undefined;
    return {
      id: row.id,
      kind: row.kind,
      ...(clips && { clips }),
      // Subtitle cues are shown inline, so their (small) text rides along
      // with the view rather than the browser fetching the presigned URL.
      data:
        row.kind === 'file.subtitles' && row.blobId
          ? {
              ...(row.data as object),
              text: (await this.blobs.readText(ownerId, row.blobId, 256 * 1024)) ?? null,
            }
          : row.data,
      previewUrl: preview?.status === 'live' ? preview.url : null,
      probe: (row.probe as Probe | null) ?? null,
      attachments: safeAttachments,
    };
  }

  /** §21/Chunk 5 — dry runs write real ledger rows (locked product decision
   * #1's accepted consequence), so the default listing excludes them; an
   * explicit `includeDryRuns` opts back in. Backs the Runs tab's list page:
   * joins in channel/blueprint display names so the UI never needs N+1
   * lookups per row. `innerJoin` is safe because `run.channelId`,
   * `run.blueprintVersionId`, and `blueprintVersion.blueprintId` are all
   * NOT NULL FKs today — if that invariant ever changes (e.g. hard deletes),
   * this would silently drop affected runs from the list instead of erroring. */
  async list(query: ListRunsQueryDto) {
    const conditions = [
      query.includeDryRuns ? undefined : eq(run.dryRun, false),
      query.includeDrafts ? undefined : eq(blueprintVersion.draft, false),
      query.channelId ? eq(run.channelId, query.channelId) : undefined,
      query.state ? eq(run.state, query.state) : undefined,
      query.blueprintId ? eq(blueprintVersion.blueprintId, query.blueprintId) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
    const where = conditions.length ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        id: run.id,
        channelId: run.channelId,
        channelName: channel.name,
        blueprintId: blueprint.id,
        blueprintName: blueprint.name,
        blueprintVersionId: run.blueprintVersionId,
        blueprintVersion: sql<string>`${blueprintVersion.major} || '.' || ${blueprintVersion.minor}`,
        state: run.state,
        dryRun: run.dryRun,
        draft: blueprintVersion.draft,
        budgetCapUsd: run.budgetCapUsd,
        spentUsd: run.spentUsd,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        // Raw, fully-qualified SQL (not interpolated Column objects): see
        // ChannelService.countsSelection for why — an interpolated Column
        // renders unqualified and collides with the outer query's own
        // columns of the same name in a correlated subquery.
        posterBlobId: sql<string | null>`(
          select a.derived->>'poster' from artifact a
          where a.run_id = run.id and a.stale = false and a.derived->>'poster' is not null
          order by a.created_at desc limit 1
        )`,
      })
      .from(run)
      .innerJoin(channel, eq(channel.id, run.channelId))
      .innerJoin(blueprintVersion, eq(blueprintVersion.id, run.blueprintVersionId))
      .innerJoin(blueprint, eq(blueprint.id, blueprintVersion.blueprintId));
    const countQuery = this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(run)
      .innerJoin(blueprintVersion, eq(blueprintVersion.id, run.blueprintVersionId));

    const [rows, countRows] = await Promise.all([
      (where ? baseQuery.where(where) : baseQuery)
        .orderBy(desc(run.startedAt))
        .limit(query.limit)
        .offset(query.offset),
      where ? countQuery.where(where) : countQuery,
    ]);
    const total = countRows[0]?.count ?? 0;

    return {
      items: rows.map((row) => ({
        ...row,
        budgetCapUsd: toUsd(row.budgetCapUsd),
        spentUsd: toUsd(row.spentUsd),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async listStageEvents(runId: string, stageKey: string, attemptId?: string) {
    return this.db
      .select({
        id: stageEvent.id,
        stageAttemptId: stageEvent.stageAttemptId,
        itemIndex: stageEvent.itemIndex,
        level: stageEvent.level,
        type: stageEvent.type,
        message: stageEvent.message,
        data: stageEvent.data,
        createdAt: stageEvent.createdAt,
      })
      .from(stageEvent)
      .innerJoin(stageExecution, eq(stageEvent.stageExecutionId, stageExecution.id))
      .where(
        and(
          eq(stageExecution.runId, runId),
          eq(stageExecution.stageKey, stageKey),
          attemptId ? eq(stageEvent.stageAttemptId, attemptId) : undefined,
        ),
      )
      .orderBy(asc(stageEvent.id));
  }

  async listStageAttempts(runId: string, stageKey: string) {
    const rows = await this.db
      .select({
        id: stageAttempt.id,
        attemptNo: stageAttempt.attemptNo,
        outcome: stageAttempt.outcome,
        renderedPrompt: stageAttempt.renderedPrompt,
        phase: stageAttempt.phase,
        actor: stageAttempt.actor,
        artifactId: stageAttempt.artifactId,
        reviewNote: stageAttempt.reviewNote,
        critiqueTargetStageKey: stageAttempt.critiqueTargetStageKey,
        checkResults: stageAttempt.checkResults,
        qcVerdict: stageAttempt.qcVerdict,
        costUsd: stageAttempt.costUsd,
        createdAt: stageAttempt.createdAt,
      })
      .from(stageAttempt)
      .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)))
      .orderBy(asc(stageAttempt.attemptNo));
    return rows.map((attempt) => ({ ...attempt, costUsd: toUsd(attempt.costUsd) }));
  }
  private async assertProviderPins(
    graph: StageDef[],
    resolvedConfig: Record<string, ConfigLayer>,
  ): Promise<void> {
    for (const stage of graph) {
      const pin = resolvedConfig[stage.key]?.model;
      if (!pin?.provider) continue;
      const modality = modalityForCapability(stage.capability);
      if (pin.provider === 'openrouter' && stage.output.kind !== 'data') continue;
      if (!PINNED_PROVIDERS.has(pin.provider)) continue;
      const label = PROVIDER_LABELS[pin.provider];
      let model;
      try {
        model = (await this.providers.get(pin.provider).listModels()).find(
          (candidate) => candidate.modelId === pin.modelId,
        );
      } catch (error) {
        this.logger.warn(
          { providerId: pin.provider, modelId: pin.modelId, err: error },
          'provider model discovery failed',
        );
        throw new ConflictException(
          `RunService.start: ${label} model discovery failed: ${(error as Error).message}`,
        );
      }
      if (pin.provider === 'openrouter') {
        if (!model?.capabilities.supportsStructuredOutput) {
          throw new ConflictException(
            `RunService.start: OpenRouter model "${String(pin.modelId)}" does not support structured output`,
          );
        }
        continue;
      }
      if (!model) {
        throw new ConflictException(
          `RunService.start: ${label} model "${String(pin.modelId)}" is unavailable`,
        );
      }
      if (!model.modalities?.includes(modality)) {
        throw new ConflictException(
          `RunService.start: ${model.unavailableModalities?.[modality] ?? `${label} model "${model.modelId}" is unavailable for ${modality} stages`}`,
        );
      }
      const effort = pin.params?.reasoningEffort;
      if (typeof effort !== 'string' || !model.supportedReasoningEfforts?.includes(effort)) {
        throw new ConflictException(
          `RunService.start: reasoning effort "${String(effort)}" is unsupported by ${label} model "${model.modelId}"`,
        );
      }
    }
  }
}
