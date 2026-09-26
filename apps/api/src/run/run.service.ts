import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { CreateRunDto, ConfigLayer, ReferenceImage, Ref, RoleDef } from '@reelcraft/shared';
import { InputDef, RoleDef as RoleDefSchema, StageDef } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  asset,
  artifact,
  artifactAttachment,
  blob,
  blueprint,
  blueprintVersion,
  channel,
  character,
  humanWait,
  run,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd, toUsd } from '../common/money';
import { EngineConfig } from '../config/engine-config';
import { CapabilityRegistry } from '../capability/capability.registry';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { engineDefaults } from '../run-config/engine-defaults';
import { LedgerService } from '../budget/ledger.service';
import { collectAssetIds } from '../blueprint/collect-asset-refs';
import { RunInputService } from './run-input.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { ProviderRegistry } from '../provider/provider.registry';
import { modalityForCapability } from '../capability/modality-for-capability';
import { BlobService } from '../artifact/blob.service';

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
    this.assertTextStagesHaveMaxTokens(graph, resolvedConfig);

    await this.db.transaction(async (tx) => {
      await tx.insert(run).values({
        id: runId,
        channelId: dto.channelId,
        blueprintVersionId: dto.blueprintVersionId,
        state: 'CREATED',
        inputs: dto.inputs,
        roleBindings: dto.roleBindings,
        resolvedConfig,
        dryRun: options?.dryRun ?? false,
        budgetCapUsd: fromUsd(dto.budgetCapUsd),
      });

      for (const stage of graph) {
        await tx.insert(stageExecution).values({
          id: ulid(),
          runId,
          stageKey: stage.key,
          state: 'pending',
        });
      }

      await this.runInputs.recordProvidedInputs(tx, runId, inputDefs, dto.inputs);
    });

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

    await this.dispatchBestEffort(mutation.wakeupId);

    return this.get(runId);
  }

  /** Resolves blueprint-selected references once, before the start wakeup.
   * Snapshots include storage locations, so later Character edits/deletes do
   * not change a paid run's identity conditioning. */
  private async resolveRoleBindings(roles: RoleDef[], channelId: string) {
    if (roles.length === 0) return {};
    const result: Record<
      string,
      {
        characterId: string;
        name: string;
        description: string;
        references: Array<{ blobId: string; sourceKey: string; mime: string; probe?: unknown }>;
      }
    > = {};
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
      const roles = Object.values(stage.slots).filter(
        (ref): ref is Extract<Ref, { from: 'role' }> =>
          ref.from === 'role' && roleKeys.has(ref.roleKey),
      );
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

  /** §16.5 — the validator only warns (it can't see the channel layer where
   * `max_tokens` usually lives, `blueprint-validator.service.ts`'s own
   * comment on that warning). Once the full layer stack has resolved, an
   * unbounded text reservation is a real bug, not a warning: `ceilingUsd`
   * can't be honest without it (§16.5's "input is boundable but output is
   * not unless max_tokens is set"). Thrown loudly here rather than
   * discovered later as a budget-reservation failure with a confusing cause. */
  private assertTextStagesHaveMaxTokens(
    graph: StageDef[],
    resolvedConfig: Record<string, ConfigLayer>,
  ): void {
    for (const stage of graph) {
      const impl = this.capabilities.get(stage.capability);
      if (impl.modality !== 'text') continue;
      const maxTokens = resolvedConfig[stage.key]?.model?.params?.['max_tokens'];
      if (typeof maxTokens !== 'number') {
        throw new Error(
          `RunService.create: stage "${stage.key}" is text-modality with no effective ` +
            'model.params.max_tokens (§16.5) — cannot compute an honest cost ceiling',
        );
      }
    }
  }

  /** Chunk 5 — a dry run is a real `run` row driven through the unchanged
   * async pipeline (locked product decision #1), not a bespoke synchronous
   * path. `startDryRun` just resolves `(blueprintId, version)` to the
   * `channelId`/`blueprintVersionId` pair `create()` needs, then reuses
   * `create()`/`start()` verbatim with `{dryRun: true}`. */
  async startDryRun(blueprintId: string, version: number, budgetCapUsd = 1) {
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
        and(eq(blueprintVersion.blueprintId, blueprintId), eq(blueprintVersion.version, version)),
      )
      .limit(1);
    if (!versionRow) {
      throw new NotFoundException(`Blueprint ${blueprintId} version ${version} not found`);
    }

    const created = await this.create(
      {
        channelId: blueprintRow.channelId,
        blueprintVersionId: versionRow.id,
        inputs: {},
        roleBindings: {},
        budgetCapUsd,
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
   * consumes a model pin at all) is left completely untouched. `text`'s
   * injected `max_tokens: 256` is what makes `assertTextStagesHaveMaxTokens`
   * pass for a dry run without that assertion itself needing to change. */
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
            params: modality === 'text' ? { max_tokens: 256 } : {},
          },
        }),
        ...(stage.qc && {
          qc: { ...layer.qc, model: { provider: 'fake', modelId: 'fake-judge-1', params: {} } },
        }),
      };
    }
    return overridden;
  }

  /** §12.4 — the one budget mutation allowed while `RUNNING`; also the only
   * way to unblock a `PAUSED_BUDGET` run, since `raiseBudget` alone widens
   * the cap but doesn't resume the orchestrator. */
  async raiseBudget(runId: string, capUsd: number) {
    await this.ledger.raiseBudget({ runId, newCapUsd: capUsd });
    return this.get(runId);
  }

  /** §12.4 — both budget pauses and failed runs are explicit recovery
   * points. The durable wakeup claim performs the actual transition only if
   * the persisted source state and revision are still current. */
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
      ['PAUSED_BUDGET', 'FAILED'],
      async () => undefined,
      'run/resumed',
    );
    await this.dispatchBestEffort(mutation.wakeupId);
    return this.get(runId);
  }

  private async dispatchBestEffort(wakeupId: string): Promise<void> {
    try {
      await this.wakeupDispatcher.dispatch(wakeupId);
    } catch (error) {
      // The committed outbox row is the source of truth. The periodic
      // dispatcher will retry this delivery, so the HTTP mutation succeeds.
      this.logger?.warn(
        `Run wakeup ${wakeupId} was committed but could not be dispatched immediately: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
    return {
      ...row,
      stageExecutions: await Promise.all(
        executions.map(async (execution) => {
          const definition = definitions.get(execution.stageKey);
          const capability = definition?.capability ?? 'unknown';
          return {
            ...execution,
            attemptCount: attemptCounts.get(execution.id) ?? 0,
            capability,
            interaction: this.capabilities.get(capability).interaction?.kind ?? null,
            attachments: (
              await Promise.all(
                (attachmentsByArtifact.get(execution.outputArtifactId ?? '') ?? []).map(
                  async (attachment) => {
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
                  },
                ),
              )
            ).filter((attachment) => attachment !== undefined),
          };
        }),
      ),
    };
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

    const attachments = await this.db
      .select()
      .from(artifactAttachment)
      .where(eq(artifactAttachment.artifactId, candidate.id));
    const [stillOpen] = await this.db
      .select({ id: humanWait.id })
      .from(humanWait)
      .where(and(eq(humanWait.id, wait.id), isNull(humanWait.resolvedAt)))
      .limit(1);
    if (!stillOpen)
      throw new ConflictException('The approval was resolved while loading its candidate');

    const preview = candidate.blobId
      ? await this.blobs.readUrl(runRow.ownerId, candidate.blobId)
      : undefined;
    const safeAttachments = (
      await Promise.all(
        attachments.map(async (attachment) => {
          const access = await this.blobs.readUrl(runRow.ownerId, attachment.blobId);
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
      artifact: {
        id: candidate.id,
        kind: candidate.kind,
        data: candidate.data,
        previewUrl: preview?.status === 'live' ? preview.url : null,
        attachments: safeAttachments,
      },
    };
  }

  /** §21/Chunk 5 — dry runs write real ledger rows (locked product decision
   * #1's accepted consequence), so the default listing excludes them; an
   * explicit `includeDryRuns` opts back in. */
  async list(includeDryRuns = false) {
    if (includeDryRuns) return this.db.select().from(run);
    return this.db.select().from(run).where(eq(run.dryRun, false));
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
      if (pin.provider !== 'codex' && pin.provider !== 'openrouter') continue;
      let model;
      try {
        model = (await this.providers.get(pin.provider).listModels()).find(
          (candidate) => candidate.modelId === pin.modelId,
        );
      } catch (error) {
        throw new ConflictException(
          `RunService.start: ${pin.provider === 'codex' ? 'Codex' : 'OpenRouter'} model discovery failed: ${(error as Error).message}`,
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
          `RunService.start: Codex model "${String(pin.modelId)}" is unavailable`,
        );
      }
      if (!model.modalities?.includes(modality)) {
        throw new ConflictException(
          `RunService.start: Codex model "${model.modelId}" is unavailable for ${modality} stages`,
        );
      }
      const effort = pin.params?.reasoningEffort;
      if (typeof effort !== 'string' || !model.supportedReasoningEfforts?.includes(effort)) {
        throw new ConflictException(
          `RunService.start: reasoning effort "${String(effort)}" is unsupported by Codex model "${model.modelId}"`,
        );
      }
    }
  }
}
