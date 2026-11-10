import { executionEligibility, scopeHasWork } from './execution-eligibility';
import { ACCEPTED_OUTCOMES, loadOutputHistory } from './outdated-output';
import { unresolvedCancellation } from './cancellation-risk';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  disabledAncestor,
  CreateBlueprintVersionDto,
  StageDef,
  ancestorsOf,
  descendantsOf,
  stageDependencies,
  stageFreshness,
  definitionKey,
  blueprintGeneration,
  generationStage,
  type StageRunPlanRequestDto,
  type ConfirmStageRunPlanDto,
  type StageRunPlanDto,
  type ConfigLayer,
} from '@reelcraft/shared';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import {
  blueprintVersion,
  run,
  stageExecution,
  stageEvent,
  artifact,
  artifactAttachment,
  blob,
  stageAttempt,
  stageItem,
  ledgerEntry,
} from '../db/schema/index';
import { mergeLayer } from '../run-config/layer-merge';
import { toUsd } from '../common/money';
import { ulid } from '../common/ulid';
import { ArtifactService } from '../artifact/artifact.service';
import { MemoryService } from '../artifact/memory.service';
import { RunService } from './run.service';
import { InvalidationService } from './invalidation.service';
import { PreviewTokenService, previewPayloadDigest } from './preview-token.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { EngineConfig } from '../config/engine-config';
import { engineDefaults } from '../run-config/engine-defaults';
import { channel } from '../db/schema/index';

type RecheckTarget = { itemId: string | null; itemIndex?: number; artifactId: string };

/** One server-owned plan backs preview and confirm; a token binds the choice and run revision. */
@Injectable()
export class RunStagePlanService {
  private readonly logger = new Logger(RunStagePlanService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly runs: RunService,
    private readonly invalidation: InvalidationService,
    private readonly tokens: PreviewTokenService,
    private readonly mutation: RunMutationService,
    private readonly dispatcher: RunWakeupDispatcher,
    private readonly configs: ConfigResolverService,
    private readonly engine: EngineConfig,
    private readonly artifacts: ArtifactService,
    private readonly memory: MemoryService,
  ) {}

  private async build(runId: string, request: StageRunPlanRequestDto) {
    const current = await this.runs.get(runId);
    const versions = await this.db
      .select()
      .from(blueprintVersion)
      .where(
        inArray(blueprintVersion.id, [current.blueprintVersionId, request.blueprintVersionId]),
      );
    const source = versions.find((v) => v.id === current.blueprintVersionId);
    const requested = versions.find((v) => v.id === request.blueprintVersionId);
    if (!source || !requested || source.blueprintId !== requested.blueprintId)
      throw new ConflictException('Blueprint version does not belong to this run');
    const before = CreateBlueprintVersionDto.parse(source);
    const draft = CreateBlueprintVersionDto.parse(requested);
    const freshness = stageFreshness(before, draft);
    const oldDeps = stageDependencies(before.graph);
    const newDeps = stageDependencies(draft.graph);
    const passed = new Set(
      current.stageExecutions.filter((e) => e.state === 'passed').map((e) => e.stageKey),
    );
    const target = before.graph.find((s) => s.key === request.stageKey);
    const edited = draft.graph.find((s) => s.key === request.stageKey);
    const targetExecution = current.stageExecutions.find((e) => e.stageKey === request.stageKey);
    // What a re-check judges in place: the stage's current output, or each passed item's.
    const recheckTargets: RecheckTarget[] = [];
    let unfinishedItems = false;
    if (request.mode === 'validate' && targetExecution?.state === 'passed') {
      if (target?.iterate) {
        const items = await this.db
          .select()
          .from(stageItem)
          .where(eq(stageItem.stageExecutionId, targetExecution.id));
        for (const item of items) {
          if (targetExecution.itemCount !== null && item.itemIndex >= targetExecution.itemCount)
            continue;
          if (request.itemIndex !== undefined && item.itemIndex !== request.itemIndex) continue;
          if (item.state !== 'passed' || !item.outputArtifactId) unfinishedItems = true;
          else
            recheckTargets.push({
              itemId: item.id,
              itemIndex: item.itemIndex,
              artifactId: item.outputArtifactId,
            });
        }
      } else if (targetExecution.outputArtifactId) {
        recheckTargets.push({ itemId: null, artifactId: targetExecution.outputArtifactId });
      }
    }

    let blockedReason: string | null = null;
    if (current.availableActions?.busy || current.state === 'CREATED')
      blockedReason = 'Wait for execution to settle before starting another action.';
    if (request.stageKey && (!target || !edited))
      blockedReason = 'This stage was added or removed. Start a new run for the changed graph.';
    const validationErrors = (
      requested.validation as Array<{ severity: string; message: string }>
    ).filter((issue) => issue.severity === 'error');
    if (
      !requested.runnable &&
      (!request.stageKey ||
        validationErrors.some((issue) => !issue.message.startsWith('Disabled ancestor:')))
    )
      blockedReason = 'Fix blueprint validation errors before running.';
    const disabled = request.stageKey
      ? disabledAncestor(draft.graph, request.stageKey)
      : draft.graph.find((s) => disabledAncestor(draft.graph, s.key));
    if (disabled)
      blockedReason = `Disabled ancestor: ${disabled.label || disabled.key}. Enable it before running this stage.`;
    if (
      definitionKey(before.graph.map((s) => s.key).sort()) !==
      definitionKey(draft.graph.map((s) => s.key).sort())
    )
      blockedReason =
        'Stages were added or removed. Start a new run for the changed graph; existing outputs remain available.';
    if (definitionKey(blueprintGeneration(before)) !== definitionKey(blueprintGeneration(draft)))
      blockedReason =
        'Blueprint inputs, roles, or format changed. Start a new run to apply those changes.';
    // Other defaults (models, retries, budget) only change how stages run: a re-run applies them.
    const defaultsChanged = definitionKey(before.defaults) !== definitionKey(draft.defaults);
    if (request.mode === 'reuse' && !request.stageKey && !request.action)
      blockedReason = 'Choose a single stage to use existing upstream outputs.';
    if (request.mode === 'reuse' && request.scope === 'descendants' && request.stageKey)
      blockedReason = 'Rebuilding descendants requires applying the draft changes.';
    // A changed consumer contract cannot be assumed compatible with old upstream outputs.
    const contract = (stage: StageDef) => ({
      ...generationStage(stage),
      instructions: undefined,
      config: undefined,
    });
    if (
      request.mode === 'reuse' &&
      request.itemIndex === undefined &&
      target &&
      edited &&
      definitionKey(contract(target)) !== definitionKey(contract(edited))
    )
      blockedReason =
        'The selected stage’s bindings, dependencies, iteration, or output contract changed. Rebuild its dependencies to apply this safely.';

    if (request.mode === 'validate') {
      // A re-check judges the output as it is: nothing upstream or downstream changes.
      if (!target || !edited || !request.stageKey || request.scope !== 'stage')
        blockedReason = 'Choose one stage to re-check.';
      else if (freshness.changedStageKeys.includes(request.stageKey))
        blockedReason =
          'This stage changed since its output was made. Re-run it to apply the change.';
      else if (targetExecution?.state !== 'passed')
        blockedReason = 'Re-check needs a stage that has finished.';
      else if (unfinishedItems)
        blockedReason =
          request.itemIndex === undefined
            ? 'Some items are unfinished or out of date. Continue the run before re-checking the stage.'
            : 'This item is unfinished or out of date. Re-run it instead.';
      else if (!recheckTargets.length) blockedReason = 'There is no stored output to re-check.';
    }
    if (request.mode === 'validate' && edited && !edited.qc && edited.checks.length === 0)
      blockedReason = 'This stage has no checks or quality criteria to run.';
    // Supplying: the candidate becomes the stage's (or item's) output, and what follows goes stale.
    let candidate: typeof artifact.$inferSelect | undefined;
    if (request.mode === 'supply') {
      [candidate] = request.artifactId
        ? await this.db.select().from(artifact).where(eq(artifact.id, request.artifactId)).limit(1)
        : [];
      const used = candidate
        ? await this.db
            .select({ id: stageAttempt.id })
            .from(stageAttempt)
            .where(eq(stageAttempt.artifactId, candidate.id))
            .limit(1)
        : [];
      if (!target || !edited || !request.stageKey || request.scope !== 'stage')
        blockedReason = 'Choose one stage to supply an output for.';
      else if (request.action !== 'rerun')
        blockedReason = 'Supplying an output replaces the stage’s output.';
      else if (freshness.changedStageKeys.includes(request.stageKey))
        blockedReason =
          'This stage changed since its output was made. Re-run it to apply the change, or undo it first.';
      else if (target.iterate && request.itemIndex === undefined)
        blockedReason = 'Choose which item to supply an output for.';
      else if (
        !candidate ||
        candidate.runId !== runId ||
        candidate.producerStageKey !== request.stageKey ||
        (candidate.itemIndex ?? undefined) !== request.itemIndex ||
        !candidate.stale ||
        used.length
      )
        blockedReason = 'The output to use is no longer available. Supply it again.';
    }
    const graphForScope = request.mode !== 'rebuild' ? before.graph : draft.graph;
    const deps = stageDependencies(graphForScope);
    // Outputs an earlier change made out of date: items of a done stage (one item re-run upstream),
    // or a whole stage that had an accepted output. Continue redoes them, or keeps them as they are.
    const history = await loadOutputHistory(this.db, current.stageExecutions);
    const staleItemRows = current.stageExecutions.length
      ? await this.db
          .select({ executionId: stageItem.stageExecutionId, index: stageItem.itemIndex })
          .from(stageItem)
          .where(
            and(
              inArray(
                stageItem.stageExecutionId,
                current.stageExecutions.map((e) => e.id),
              ),
              eq(stageItem.state, 'stale'),
            ),
          )
      : [];
    const outdated = current.stageExecutions.flatMap((e) => {
      if (e.state === 'passed') {
        const indexes = staleItemRows
          .filter((r) => r.executionId === e.id && (e.itemCount === null || r.index < e.itemCount))
          .map((r) => r.index)
          .sort((a, b) => a - b);
        return indexes.length ? [{ stageKey: e.stageKey, itemIndexes: indexes }] : [];
      }
      // A whole iterating stage has no single output to keep, so it always runs again.
      return e.state === 'stale' &&
        !e.isIterating &&
        history.acceptedExecutions.has(e.id) &&
        !history.failedExecutions.has(e.id)
        ? [{ stageKey: e.stageKey, itemIndexes: [] }]
        : [];
    });
    const keepOutdated =
      request.action === 'continue' && !request.stageKey && request.outdatedOutputs === 'keep';
    const keptOutdated = keepOutdated ? outdated : [];
    // Kept outputs count as finished, so Continue neither runs them nor stops at them.
    for (const entry of keptOutdated) passed.add(entry.stageKey);
    const staleItemKeys = new Set(
      keepOutdated ? [] : outdated.filter((o) => o.itemIndexes.length).map((o) => o.stageKey),
    );
    // Continue works inside the run's scope while that scope has unfinished work. Once it is
    // all done (a one-stage or one-item re-run, say) it carries on with the rest of the run.
    const scoped = current.executionScope?.stageKeys;
    const scopeOpen = scopeHasWork(scoped, passed, staleItemKeys);
    const widened = request.action === 'continue' && !request.stageKey && !!scoped && !scopeOpen;
    const keep = request.stageKey
      ? new Set([
          request.stageKey,
          ...(request.scope === 'through' || !request.action
            ? ancestorsOf(deps, request.stageKey)
            : []),
        ])
      : new Set(
          request.action === 'continue'
            ? scoped && scopeOpen
              ? scoped
              : current.stageExecutions
                  .filter((e) => e.state !== 'skipped' || e.skipReason)
                  .map((e) => e.stageKey)
            : graphForScope.map((s) => s.key),
        );
    const roots = new Set<string>();
    const regenerate = request.action === 'rerun' || !request.action;
    if (request.stageKey && (regenerate || request.mode === 'validate'))
      roots.add(request.stageKey);
    if (!request.stageKey && regenerate) for (const key of keep) roots.add(key);
    if (request.mode === 'rebuild') {
      for (const key of [...freshness.changedStageKeys, ...freshness.validationStageKeys])
        if (keep.has(key)) roots.add(key);
    }

    const affected = new Set(roots);
    for (const key of roots)
      for (const edges of [oldDeps, newDeps])
        for (const child of descendantsOf(edges, key)) affected.add(child);
    const execute = new Set(
      [...affected].filter((key) => request.scope === 'descendants' || keep.has(key)),
    );
    if (!regenerate)
      for (const key of keep) if (!passed.has(key) || staleItemKeys.has(key)) execute.add(key);
    // Through-stage and rebuild-descendants operations explicitly include prerequisites.
    if (
      (request.scope !== 'stage' || !request.action) &&
      !(request.action === 'continue' && !request.stageKey)
    )
      for (const key of [...execute])
        for (const ancestor of ancestorsOf(deps, key))
          if (
            !passed.has(ancestor) ||
            (request.mode === 'rebuild' && freshness.staleStageKeys.includes(ancestor))
          )
            execute.add(ancestor);
    if (request.action && request.stageKey && request.scope === 'stage') {
      const availabilityGraph = before.graph.map((stage) => ({
        ...stage,
        disabled: draft.graph.find((s) => s.key === stage.key)?.disabled ?? false,
      }));
      const eligibility = executionEligibility(
        availabilityGraph,
        current.stageExecutions.map((execution) => ({
          ...execution,
          completedItems: execution.availableActions?.completedItems ?? 0,
        })),
        current.inputs as Record<string, unknown>,
        current.state,
        current.availableActions?.busy,
      ).stages[request.stageKey];
      if (
        eligibility?.blockedReason &&
        !(
          eligibility.blockedReason.startsWith('Disabled ancestor:') &&
          !disabledAncestor(draft.graph, request.stageKey)
        )
      )
        blockedReason ??= eligibility.blockedReason;
      if (request.action === 'continue' && !eligibility?.continue)
        blockedReason ??= 'This stage has no interrupted work to continue.';
      if (
        request.action === 'run' &&
        !eligibility?.run &&
        !freshness.staleStageKeys.includes(request.stageKey)
      )
        blockedReason ??= 'Use Continue stage or Re-run stage for existing work.';
    }
    if (request.itemIndex !== undefined) {
      if (
        request.action !== 'rerun' ||
        !target?.iterate ||
        !targetExecution ||
        request.itemIndex >= (targetExecution.itemCount ?? 0)
      )
        blockedReason = 'Choose an existing iteration item to re-run.';
    }
    const changedKeys = new Set(
      [...execute].filter(
        (key) =>
          (request.mode === 'rebuild' ||
            (key === request.stageKey &&
              request.action !== 'continue' &&
              request.itemIndex === undefined)) &&
          (defaultsChanged ||
            definitionKey(before.graph.find((s) => s.key === key)) !==
              definitionKey(draft.graph.find((s) => s.key === key))),
      ),
    );
    const availabilityChangedStageKeys = draft.graph
      .filter(
        (stage) => !!stage.disabled !== !!before.graph.find((s) => s.key === stage.key)?.disabled,
      )
      .map((s) => s.key);
    const graph = graphForScope
      .map((s) =>
        changedKeys.has(s.key)
          ? (draft.graph.find((d) => d.key === s.key) ?? s)
          : (before.graph.find((d) => d.key === s.key) ?? s),
      )
      .map((stage) =>
        availabilityChangedStageKeys.includes(stage.key)
          ? { ...stage, disabled: draft.graph.find((s) => s.key === stage.key)?.disabled ?? false }
          : stage,
      );
    // Continue (no stage chosen) gives a reconnected stage its new wiring when it runs again,
    // so only one that wouldn't run is a problem. A single-stage request never rewires.
    const rewired = before.graph.filter(
      (s) => definitionKey(oldDeps.get(s.key)) !== definitionKey(newDeps.get(s.key)),
    );
    const notApplied = request.stageKey ? rewired[0] : rewired.find((s) => !execute.has(s.key));
    if (request.mode === 'rebuild' && notApplied)
      blockedReason = `${notApplied.label || notApplied.key} was rewired. Use Continue to apply it, or start a new test run.`;
    if (
      request.itemIndex !== undefined &&
      request.mode === 'rebuild' &&
      [...freshness.changedStageKeys, ...freshness.validationStageKeys].includes(request.stageKey!)
    )
      blockedReason =
        'The stage definition changed. Re-run the stage to apply it to every item, or use its pinned definition to re-run one item.';
    const [channelRow] = await this.db
      .select()
      .from(channel)
      .where(eq(channel.id, current.channelId));
    if (!channelRow) throw new ConflictException('Channel no longer exists');
    let config = this.configs.resolveRunConfig({
      graph,
      engine: engineDefaults(this.engine),
      channelDefaults: channelRow.defaults as ConfigLayer,
      blueprintDefaults: requested.defaults as ConfigLayer,
    });
    if (current.dryRun) config = this.runs.applyDryRunOverride(graph, config);
    const pinnedAssets = current.assetBindings as Record<string, { blobId: string; kind: string }>;
    let assetBindings = pinnedAssets;
    if (request.mode === 'rebuild') {
      try {
        const selectedAssets = await this.runs.resolveAssetBindings(
          graph.filter((stage) => execute.has(stage.key)),
          current.channelId,
        );
        if (
          Object.entries(selectedAssets).some(
            ([id, binding]) => pinnedAssets[id] && pinnedAssets[id]!.blobId !== binding.blobId,
          )
        )
          blockedReason =
            'A referenced asset was replaced since this run. Use existing snapshots or start a new run to adopt replaced assets.';
        assetBindings = { ...pinnedAssets, ...selectedAssets };
      } catch (error) {
        blockedReason =
          error instanceof Error ? error.message : 'A referenced asset is unavailable.';
      }
    }
    try {
      const effectiveConfig: Record<string, ConfigLayer> = {};
      const resolved = current.resolvedConfig as Record<string, ConfigLayer>;
      const overrides = current.overrides as Record<string, ConfigLayer>;
      for (const stage of graph.filter((s) => execute.has(s.key)))
        effectiveConfig[stage.key] = mergeLayer(
          changedKeys.has(stage.key) ? (config[stage.key] ?? {}) : (resolved[stage.key] ?? {}),
          overrides[stage.key] ?? {},
        );
      const selectedGraph = graph.filter((stage) => execute.has(stage.key));
      await this.runs.assertProviderPins(selectedGraph, effectiveConfig);
      await this.runs.assertReferenceLimits(
        selectedGraph,
        effectiveConfig,
        current.roleBindings as Record<string, { references: unknown[] }>,
      );
    } catch (error) {
      blockedReason =
        error instanceof Error ? error.message : 'Stage provider configuration is unavailable.';
    }
    const configFingerprint = previewPayloadDigest({
      config,
      concurrentBranches: current.concurrentBranches,
      executionEpoch: current.executionEpoch,
      assetBindings,
      recheckArtifactIds: recheckTargets.map((t) => t.artifactId),
      suppliedArtifactId: request.mode === 'supply' ? request.artifactId : undefined,
      skipValidation: request.mode === 'supply' ? !!request.skipValidation : undefined,
    });
    const preview = await this.invalidation.preview({
      runId,
      seed:
        request.mode === 'validate'
          ? { stageKeys: [] }
          : request.itemIndex !== undefined && request.stageKey
            ? { items: [{ stageKey: request.stageKey, itemIndex: request.itemIndex }] }
            : { stageKeys: [...roots], forcedStageKeys: [...affected] },
    });
    const uncertain = current.stageExecutions.length
      ? await this.db
          .select({ id: stageAttempt.id, stageKey: stageExecution.stageKey })
          .from(stageAttempt)
          .innerJoin(stageExecution, eq(stageAttempt.stageExecutionId, stageExecution.id))
          .where(and(eq(stageExecution.runId, runId), unresolvedCancellation()))
      : [];
    const uncertainAttemptIds = uncertain.filter((a) => execute.has(a.stageKey)).map((a) => a.id);
    if (uncertainAttemptIds.length && !request.allowUncertainRestart)
      blockedReason ??=
        'Provider cancellation could not be confirmed. Restarting unfinished requests may incur additional charges. Confirm this risk before continuing.';
    const executionIds = current.stageExecutions
      .filter((e) => execute.has(e.stageKey))
      .map((e) => e.id);
    const savedItems = executionIds.length
      ? await this.db
          .select({ executionId: stageItem.stageExecutionId, index: stageItem.itemIndex })
          .from(stageItem)
          .where(
            and(inArray(stageItem.stageExecutionId, executionIds), eq(stageItem.state, 'passed')),
          )
      : [];
    const retainedItemCount = savedItems.filter((item) => {
      const execution = current.stageExecutions.find((e) => e.id === item.executionId);
      return (
        (execution?.itemCount === null || item.index < (execution?.itemCount ?? 0)) &&
        !preview.closure.affectedItems.some(
          (affected) =>
            affected.stageExecutionId === item.executionId &&
            (affected.itemIndex === undefined || affected.itemIndex === item.index),
        )
      );
    }).length;
    const plan: Omit<StageRunPlanDto, 'previewToken'> = {
      request,
      uncertainAttemptIds,
      retainedItemCount,
      outdated,
      availabilityChangedStageKeys,
      runStageKeys: graph.filter((s) => execute.has(s.key)).map((s) => s.key),
      skippedStageKeys: graph.filter((s) => execute.has(s.key) && s.disabled).map((s) => s.key),
      reusedStageKeys: graph
        .filter(
          (s) =>
            passed.has(s.key) &&
            !execute.has(s.key) &&
            !preview.closure.affectedStageKeys.includes(s.key),
        )
        .map((s) => s.key),
      staleStageKeys: freshness.staleStageKeys.filter((key) => passed.has(key)),
      validationStageKeys: freshness.validationStageKeys.filter((key) => passed.has(key)),
      invalidatedStageKeys: preview.closure.affectedStageKeys.filter(
        (key) => passed.has(key) && !execute.has(key),
      ),
      estimatedRerunUsd:
        request.mode === 'validate'
          ? (await this.lastQcSpend(runId, edited?.qc ? request.stageKey : undefined)) *
            recheckTargets.length
          : request.mode === 'supply'
            ? request.skipValidation
              ? 0
              : await this.lastQcSpend(runId, edited?.qc ? request.stageKey : undefined)
            : request.itemIndex !== undefined
              ? preview.costs
                  .filter((c) => execute.has(c.stageKey))
                  .reduce((sum, c) => sum + c.estimatedRerunUsd, 0)
              : current.stageExecutions
                  .filter((e) => execute.has(e.stageKey))
                  .reduce((sum, e) => sum + toUsd(e.costUsd), 0),
      blockedReason,
    };
    return {
      current,
      source,
      requested,
      graph,
      execute,
      widened,
      keptOutdated,
      changedKeys,
      preview,
      plan,
      config,
      configFingerprint,
      assetBindings,
      recheckTargets,
      candidate,
    };
  }

  /** What judging one output cost last time: the stage's newest QC charge, or nothing without QC. */
  private async lastQcSpend(runId: string, stageKey: string | undefined): Promise<number> {
    if (!stageKey) return 0;
    const [last] = await this.db
      .select({ amountUsd: ledgerEntry.amountUsd })
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.runId, runId),
          eq(ledgerEntry.stageKey, stageKey),
          eq(ledgerEntry.category, 'qc'),
          eq(ledgerEntry.kind, 'actual'),
        ),
      )
      .orderBy(desc(ledgerEntry.createdAt))
      .limit(1);
    return last ? toUsd(last.amountUsd) : 0;
  }

  /** Supplying: a created user attempt points at the candidate, which the engine then judges
   * (checks and quality review, unless skipped) and finalizes like any generated output, so
   * memory writes, approval and review-on-failure work the same way. */
  private async requestSupply(
    tx: Tx,
    built: Awaited<ReturnType<RunStagePlanService['build']>>,
    request: StageRunPlanRequestDto,
    executionEpoch: number,
  ) {
    const candidate = built.candidate!;
    const execution = built.current.stageExecutions.find((e) => e.stageKey === request.stageKey)!;
    // Re-checked under the lock, so one candidate can't be used twice.
    const [fresh] = await tx
      .select({ stale: artifact.stale })
      .from(artifact)
      .where(eq(artifact.id, candidate.id))
      .for('update');
    const [used] = await tx
      .select({ id: stageAttempt.id })
      .from(stageAttempt)
      .where(eq(stageAttempt.artifactId, candidate.id))
      .limit(1);
    if (!fresh?.stale || used)
      throw new ConflictException('The output to use is no longer available. Supply it again.');
    const [item] =
      request.itemIndex !== undefined
        ? await tx
            .select({ id: stageItem.id })
            .from(stageItem)
            .where(
              and(
                eq(stageItem.stageExecutionId, execution.id),
                eq(stageItem.itemIndex, request.itemIndex),
              ),
            )
        : [];
    const by = (candidate.repro as { supplied?: { by?: 'user' | 'assistant' } } | null)?.supplied
      ?.by;
    const skipValidation = !!request.skipValidation;
    const slot = and(
      eq(stageAttempt.stageExecutionId, execution.id),
      item ? eq(stageAttempt.stageItemId, item.id) : isNull(stageAttempt.stageItemId),
    );
    const [latest] = await tx
      .select({ max: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)::int` })
      .from(stageAttempt)
      .where(slot);
    await tx.insert(stageAttempt).values({
      id: ulid(),
      stageExecutionId: execution.id,
      stageItemId: item?.id ?? null,
      attemptNo: (latest?.max ?? 0) + 1,
      actor: 'user',
      outcome: 'user_edit',
      phase: 'created',
      executionEpoch,
      artifactId: candidate.id,
      resolvedInputs: { supplied: { by: by ?? 'user', skipValidation } },
    });
    await tx
      .update(artifact)
      .set({
        repro: { supplied: { by: by ?? 'user', validation: skipValidation ? 'skip' : 'run' } },
      })
      .where(eq(artifact.id, candidate.id));
    // Now in use: its files are no longer up for collection.
    const blobIds = [
      candidate.blobId,
      ...((
        (
          candidate.data as {
            clips?: Array<{ blobId: string }>;
            images?: Array<{ blobId: string }>;
          } | null
        )?.clips ?? []
      ).map((c) => c.blobId) as string[]),
      ...(((candidate.data as { images?: Array<{ blobId: string }> } | null)?.images ?? []).map(
        (c) => c.blobId,
      ) as string[]),
    ].filter((id): id is string => !!id);
    if (blobIds.length)
      await tx
        .update(blob)
        .set({ gcEligible: false, gcEligibleAt: null })
        .where(inArray(blob.id, blobIds));
    await tx.insert(stageEvent).values({
      id: ulid(),
      runId: built.current.id,
      stageExecutionId: execution.id,
      level: 'info',
      type: 'stage.output_supplied',
      message: skipValidation
        ? 'Output supplied; checks and quality review skipped'
        : 'Output supplied',
      data: {
        artifactId: candidate.id,
        by: by ?? 'user',
        skipValidation,
        ...(request.itemIndex !== undefined && { itemIndex: request.itemIndex }),
      },
      createdAt: new Date().toISOString(),
    });
  }

  /** A re-check asks the engine to judge each stored output again: a created user attempt that
   * points at the current output, which stays active, so nothing downstream changes. */
  private async requestRecheck(
    tx: Tx,
    stageExecutionId: string,
    targets: RecheckTarget[],
    executionEpoch: number,
  ) {
    for (const target of targets) {
      const slot = and(
        eq(stageAttempt.stageExecutionId, stageExecutionId),
        target.itemId
          ? eq(stageAttempt.stageItemId, target.itemId)
          : isNull(stageAttempt.stageItemId),
      );
      // Keep the producing attempt's reads, so invalidation still sees what the output used.
      const [producer] = await tx
        .select({ resolvedInputs: stageAttempt.resolvedInputs })
        .from(stageAttempt)
        .where(and(slot, eq(stageAttempt.artifactId, target.artifactId)))
        .orderBy(desc(stageAttempt.attemptNo))
        .limit(1);
      const [latest] = await tx
        .select({ max: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)::int` })
        .from(stageAttempt)
        .where(slot);
      await tx.insert(stageAttempt).values({
        id: ulid(),
        stageExecutionId,
        stageItemId: target.itemId,
        attemptNo: (latest?.max ?? 0) + 1,
        actor: 'user',
        outcome: 'user_edit',
        phase: 'created',
        executionEpoch,
        artifactId: target.artifactId,
        resolvedInputs: {
          ...((producer?.resolvedInputs as Record<string, unknown> | undefined) ?? {}),
          recheck: { inPlace: true },
        },
      });
      if (target.itemId)
        await tx.update(stageItem).set({ state: 'pending' }).where(eq(stageItem.id, target.itemId));
    }
  }

  /** "Use outdated": each kept output is recorded again as the stage's (or item's) current one, so
   * the run carries on from it and later stages read it, memory writes included. */
  private async keepOutdated(
    tx: Tx,
    runId: string,
    graph: StageDef[],
    executions: Array<{ id: string; stageKey: string }>,
    kept: Array<{ stageKey: string; itemIndexes: number[] }>,
  ) {
    for (const entry of kept) {
      const stage = graph.find((s) => s.key === entry.stageKey)!;
      const execution = executions.find((e) => e.stageKey === entry.stageKey)!;
      if (!entry.itemIndexes.length) {
        await this.reuseOutput(tx, runId, stage, execution.id);
        await tx
          .update(stageExecution)
          .set({ state: 'passed', failure: null, endedAt: new Date().toISOString() })
          .where(eq(stageExecution.id, execution.id));
        continue;
      }
      for (const itemIndex of entry.itemIndexes) {
        const [item] = await tx
          .select({ id: stageItem.id })
          .from(stageItem)
          .where(
            and(eq(stageItem.stageExecutionId, execution.id), eq(stageItem.itemIndex, itemIndex)),
          );
        await this.reuseOutput(tx, runId, stage, execution.id, item && { id: item.id, itemIndex });
      }
    }
  }

  private async reuseOutput(
    tx: Tx,
    runId: string,
    stage: StageDef,
    stageExecutionId: string,
    item?: { id: string; itemIndex: number },
  ) {
    const slot = and(
      eq(stageAttempt.stageExecutionId, stageExecutionId),
      item ? eq(stageAttempt.stageItemId, item.id) : isNull(stageAttempt.stageItemId),
    );
    const [last] = await tx
      .select({ artifactId: stageAttempt.artifactId })
      .from(stageAttempt)
      .where(
        and(
          slot,
          inArray(stageAttempt.outcome, ACCEPTED_OUTCOMES),
          isNotNull(stageAttempt.artifactId),
        ),
      )
      .orderBy(desc(stageAttempt.createdAt))
      .limit(1);
    const [old] = last?.artifactId
      ? await tx.select().from(artifact).where(eq(artifact.id, last.artifactId))
      : [];
    if (!old)
      throw new ConflictException(`${stage.key} has no earlier output to keep. Review a new plan.`);
    // The old artifact stays as it was; a copy becomes the current one, sharing its files.
    const id = ulid();
    await tx.insert(artifact).values({
      ...old,
      id,
      stale: true,
      generation: old.generation + 1,
      costUsd: '0',
      createdAt: new Date().toISOString(),
    });
    const attachments = await tx
      .select()
      .from(artifactAttachment)
      .where(eq(artifactAttachment.artifactId, old.id));
    if (attachments.length)
      await tx
        .insert(artifactAttachment)
        .values(attachments.map((attachment) => ({ ...attachment, id: ulid(), artifactId: id })));
    // Invalidation may have queued its file for collection; it is in use again.
    if (old.blobId)
      await tx
        .update(blob)
        .set({ gcEligible: false, gcEligibleAt: null })
        .where(eq(blob.id, old.blobId));
    const [latest] = await tx
      .select({ max: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)::int` })
      .from(stageAttempt)
      .where(slot);
    await tx.insert(stageAttempt).values({
      id: ulid(),
      stageExecutionId,
      stageItemId: item?.id ?? null,
      attemptNo: (latest?.max ?? 0) + 1,
      outcome: 'user_edit',
      phase: 'settled',
      actor: 'user',
      artifactId: id,
      resolvedInputs: { keptOutdated: { sourceArtifactId: old.id } },
    });
    await this.artifacts.finalize(
      {
        runId,
        stageExecutionId,
        producerStageKey: stage.key,
        itemIndex: item?.itemIndex,
        stageItemId: item?.id,
        newArtifactId: id,
        applyWrites: this.memory.buildWriteCallback(stage, {
          runId,
          stageKey: stage.key,
          kind: old.kind,
          data: old.data,
          artifactId: id,
          ...(item && { itemIndex: item.itemIndex }),
        }),
      },
      tx,
    );
  }

  async preview(runId: string, request: StageRunPlanRequestDto): Promise<StageRunPlanDto> {
    const built = await this.build(runId, request);
    const issued = this.tokens.issue({
      action: 'stage_plan',
      runId,
      runRevision: built.current.revision,
      proposedPayload: request,
      preview: {
        plan: built.plan,
        invalidation: built.preview.fingerprint,
        configFingerprint: built.configFingerprint,
      },
    });
    return { ...built.plan, previewToken: issued.token };
  }

  async confirm(runId: string, dto: ConfirmStageRunPlanDto) {
    const { previewToken, ...request } = dto;
    const built = await this.build(runId, request);
    const claims = this.tokens.verify(previewToken, {
      action: 'stage_plan',
      runId,
      runRevision: built.current.revision,
      proposedPayload: request,
    });
    if (
      definitionKey(claims.preview) !==
      definitionKey({
        plan: built.plan,
        invalidation: built.preview.fingerprint,
        configFingerprint: built.configFingerprint,
      })
    )
      throw new ConflictException('The execution plan changed. Review a new preview.');
    if (built.plan.blockedReason) throw new ConflictException(built.plan.blockedReason);
    const result = await this.mutation.withLockedRun(
      runId,
      built.current.state === 'FAILED' ? 'retry' : 'continue',
      [
        'COMPLETED',
        'FAILED',
        'IDLE',
        'CANCELLED',
        'PAUSED_MANUAL',
        'PAUSED_BUDGET',
        'PAUSED_QUOTA',
        'PAUSED_APPROVAL',
        'PAUSED_INPUT',
      ],
      async (tx, locked) => {
        if (locked.revision !== built.current.revision)
          throw new ConflictException('The run changed. Review a new preview.');
        // Only a changed graph needs a draft snapshot; an unchanged one keeps the run on its
        // own version, so a production run stays pinned to the saved version it started from.
        // Re-run stages that took the draft's defaults (a new default model, say) carry them too.
        const defaultsApplied =
          built.changedKeys.size > 0 &&
          definitionKey(built.source.defaults) !== definitionKey(built.requested.defaults);
        const graphChanged =
          defaultsApplied ||
          definitionKey(built.graph) !==
            definitionKey(CreateBlueprintVersionDto.parse(built.source).graph);
        const snapshotId = graphChanged ? ulid() : built.source.id;
        if (graphChanged)
          await tx.insert(blueprintVersion).values({
            ...built.source,
            id: snapshotId,
            graph: built.graph,
            defaults: defaultsApplied ? built.requested.defaults : built.source.defaults,
            draft: true,
            createdAt: new Date().toISOString(),
          });
        if (request.mode === 'supply') {
          await this.invalidation.apply(tx, {
            runId,
            closure: built.preview.closure,
            targetStageKey: request.stageKey!,
            gcBlobs: false,
          });
          await this.requestSupply(tx, built, request, locked.executionEpoch + 1);
        } else if (request.mode === 'validate')
          await this.requestRecheck(
            tx,
            built.current.stageExecutions.find((e) => e.stageKey === request.stageKey)!.id,
            built.recheckTargets,
            locked.executionEpoch + 1,
          );
        else
          await this.invalidation.apply(tx, {
            runId,
            closure: built.preview.closure,
            targetStageKey: request.stageKey ?? built.plan.runStageKeys[0]!,
            gcBlobs: false,
          });

        await this.keepOutdated(
          tx,
          runId,
          built.graph,
          built.current.stageExecutions,
          built.keptOutdated,
        );
        for (const stage of built.graph.filter((s) => built.execute.has(s.key) && !s.iterate)) {
          const execution = built.current.stageExecutions.find((e) => e.stageKey === stage.key)!;
          if (execution.isIterating)
            await tx
              .update(stageExecution)
              .set({ isIterating: false, itemCount: null })
              .where(eq(stageExecution.id, execution.id));
        }
        const pending = built.current.stageExecutions
          .filter((e) => built.execute.has(e.stageKey) && !e.waiting)
          .map((e) => e.id);
        const deferred = built.current.stageExecutions
          .filter((e) => !pending.includes(e.id) && e.state === 'skipped' && !e.skipReason)
          .map((e) => e.id);
        if (deferred.length)
          await tx
            .update(stageExecution)
            .set({ state: 'pending', skipReason: null })
            .where(inArray(stageExecution.id, deferred));
        if (pending.length) {
          // Recover legacy cancelled items without changing passed outputs or saved waits.
          await tx
            .update(stageItem)
            .set({ state: 'pending' })
            .where(
              and(inArray(stageItem.stageExecutionId, pending), eq(stageItem.state, 'running')),
            );
          await tx
            .update(stageAttempt)
            .set({ phase: 'settled' })
            .where(
              and(
                inArray(stageAttempt.stageExecutionId, pending),
                eq(stageAttempt.outcome, 'cancelled'),
                inArray(stageAttempt.phase, ['created', 'reserved', 'submitting', 'submitted']),
              ),
            );
          await tx
            .update(stageExecution)
            .set({
              state: 'pending',
              skipReason: null,
              failure: null,
              startedAt: null,
              endedAt: null,
            })
            .where(inArray(stageExecution.id, pending));
        }
        const resolvedConfig = { ...(built.current.resolvedConfig as Record<string, ConfigLayer>) };
        for (const key of built.changedKeys) resolvedConfig[key] = built.config[key] ?? {};
        await tx
          .update(run)
          .set({
            blueprintVersionId: snapshotId,
            executionEpoch: locked.executionEpoch + 1,
            executionScope: {
              kind:
                request.stageKey ||
                (request.action === 'continue' &&
                  built.current.executionScope?.kind === 'selection' &&
                  !built.widened)
                  ? 'selection'
                  : 'blueprint',
              stageKeys: [...built.execute],
            },
            resolvedConfig,
            assetBindings: built.assetBindings,
          })
          .where(eq(run.id, runId));
        const [execution] = built.current.stageExecutions.filter(
          (e) => e.stageKey === (request.stageKey ?? built.plan.runStageKeys[0]),
        );
        if (execution) {
          const retained = await tx
            .select({ id: artifact.id, stageKey: artifact.producerStageKey })
            .from(artifact)
            .where(and(eq(artifact.runId, runId), eq(artifact.stale, false)));
          await tx.insert(stageEvent).values({
            id: ulid(),
            runId,
            stageExecutionId: execution.id,
            level: 'info',
            type: 'stage.execution_plan',
            message:
              request.mode === 'supply'
                ? 'Using the supplied output'
                : request.mode === 'validate'
                  ? 'Re-checking the stored output'
                  : request.mode === 'reuse'
                    ? 'Explicitly using existing upstream outputs'
                    : 'Applying draft changes and rebuilding affected work',
            data: {
              ...built.plan,
              sourceVersionId: built.source.id,
              snapshotId,
              requestedVersionId: built.requested.id,
              reusedArtifacts: retained
                .filter((a) => built.plan.reusedStageKeys.includes(a.stageKey))
                .map((a) => a.id),
            },
            createdAt: new Date().toISOString(),
          });
        }
      },
      'run/resumed',
    );
    // The transaction's durable wakeup remains authoritative if immediate delivery fails.
    await this.dispatcher
      .dispatch(result.wakeupId)
      .catch((error) =>
        this.logger.warn(
          { runId, wakeupId: result.wakeupId, err: error },
          'execution plan wakeup deferred to retry',
        ),
      );
    return { accepted: true, revision: result.revision, runId };
  }
}
