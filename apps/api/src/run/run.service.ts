import { Inject, Injectable } from '@nestjs/common';
import type { Inngest } from 'inngest';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CreateRunDto, ConfigLayer } from '@reefcraft/shared';
import { InputDef, StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { asset, blob, blueprintVersion, channel, run, stageExecution } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { INNGEST_CLIENT } from '../orchestration/inngest.client';
import { RunStateService } from '../orchestration/run-state.service';
import { EngineConfig } from '../config/engine-config';
import { CapabilityRegistry } from '../capability/capability.registry';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { engineDefaults } from '../run-config/engine-defaults';
import { LedgerService } from '../budget/ledger.service';
import { collectAssetIds } from '../blueprint/collect-asset-refs';
import { RunInputService } from './run-input.service';

/**
 * §5/§12/§21 — run start resolves and snapshots resolved_config, keyed per
 * stage (matches `RunDetailDto.resolvedConfig`'s `Record<stageKey,
 * ConfigLayer>` shape), by merging engine -> channel -> blueprint -> stage
 * layers through `ConfigResolverService.resolveRunConfig` (§5.2).
 */
@Injectable()
export class RunService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(INNGEST_CLIENT) private readonly inngest: Inngest,
    private readonly engineConfig: EngineConfig,
    private readonly configResolver: ConfigResolverService,
    private readonly capabilities: CapabilityRegistry,
    private readonly ledger: LedgerService,
    private readonly runState: RunStateService,
    private readonly runInputs: RunInputService,
  ) {}

  /** §6.2/§21 — inserts the run in `CREATED` without sending `run/started`.
   * `CREATED` is a real, meaningful window now: media inputs need a run id
   * to attach their blob to (`blob.scope='input'`'s CHECK constraint), so
   * they can only be uploaded/attached after `create()` and before `start()`.
   * Text/data inputs already present in `dto.inputs` are recorded as
   * `$input:<key>` artifacts inline, in the same transaction. */
  async create(dto: CreateRunDto) {
    const [version] = await this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, dto.blueprintVersionId))
      .limit(1);
    if (!version) throw new Error(`BlueprintVersion ${dto.blueprintVersionId} not found`);
    if (!version.runnable)
      throw new Error(`BlueprintVersion ${dto.blueprintVersionId} failed validation`);

    const [channelRow] = await this.db
      .select({ defaults: channel.defaults })
      .from(channel)
      .where(eq(channel.id, dto.channelId))
      .limit(1);
    if (!channelRow) throw new Error(`Channel ${dto.channelId} not found`);

    const graph = StageDef.array().parse(version.graph);
    const inputDefs = InputDef.array().parse(version.inputs);
    const runId = ulid();

    const resolvedConfig = this.configResolver.resolveRunConfig({
      graph,
      engine: engineDefaults(this.engineConfig),
      channelDefaults: channelRow.defaults as ConfigLayer,
      blueprintDefaults: version.defaults as ConfigLayer,
    });
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

    await this.runInputs.assertInputsSatisfied(runId, inputDefs);

    const assetBindings = await this.resolveAssetBindings(graph, current.channelId);
    await this.db.update(run).set({ assetBindings }).where(eq(run.id, runId));

    await this.inngest.send({ name: 'run/started', data: { runId } });

    return this.get(runId);
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

  /** §12.4 — the one budget mutation allowed while `RUNNING`; also the only
   * way to unblock a `PAUSED_BUDGET` run, since `raiseBudget` alone widens
   * the cap but doesn't resume the orchestrator. */
  async raiseBudget(runId: string, capUsd: number) {
    await this.ledger.raiseBudget({ runId, newCapUsd: capUsd });
    return this.get(runId);
  }

  /** §12.1/§12.4 — scoped deliberately to `PAUSED_BUDGET -> RUNNING` only.
   * Resuming a `FAILED` run and patching `run.overrides` (the only recovery
   * a `stage_cap_exceeded` block has) are both phase 4's full §12.4 action
   * matrix, not this phase. */
  async resume(runId: string) {
    const current = await this.get(runId);
    if (current.state !== 'PAUSED_BUDGET') {
      throw new Error(`RunService.resume: run ${runId} is ${current.state}, not PAUSED_BUDGET`);
    }
    await this.runState.transition(runId, 'RUNNING');
    await this.inngest.send({ name: 'run/resumed', data: { runId } });
    return this.get(runId);
  }

  async get(runId: string) {
    const [row] = await this.db.select().from(run).where(eq(run.id, runId)).limit(1);
    if (!row) throw new Error(`Run ${runId} not found`);
    const executions = await this.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, runId));
    return { ...row, stageExecutions: executions };
  }

  async list() {
    return this.db.select().from(run);
  }
}
