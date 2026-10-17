import { executionEligibility } from './execution-eligibility';
import { unresolvedCancellation } from './cancellation-risk';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  disabledAncestor,
  CreateBlueprintVersionDto,
  StageDef,
  ancestorsOf,
  descendantsOf,
  stageDependencies,
  stageFreshness,
  definitionKey,
  type StageRunPlanRequestDto,
  type ConfirmStageRunPlanDto,
  type StageRunPlanDto,
  type ConfigLayer,
} from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  blueprintVersion,
  run,
  stageExecution,
  stageEvent,
  artifact,
  artifactAttachment,
  stageAttempt,
  stageItem,
} from '../db/schema/index';
import { mergeLayer } from '../run-config/layer-merge';
import { toUsd } from '../common/money';
import { ulid } from '../common/ulid';
import { RunService } from './run.service';
import { InvalidationService } from './invalidation.service';
import { PreviewTokenService, previewPayloadDigest } from './preview-token.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { EngineConfig } from '../config/engine-config';
import { engineDefaults } from '../run-config/engine-defaults';
import { channel } from '../db/schema/index';

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
    const [storedCandidate] =
      request.mode === 'validate' && targetExecution
        ? await this.db
            .select({ artifactId: stageAttempt.artifactId })
            .from(stageAttempt)
            .where(
              and(
                eq(stageAttempt.stageExecutionId, targetExecution.id),
                isNotNull(stageAttempt.artifactId),
              ),
            )
            .orderBy(desc(stageAttempt.attemptNo))
            .limit(1)
        : [];
    const validationArtifactId = targetExecution?.outputArtifactId ?? storedCandidate?.artifactId;

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
    if (
      ['inputs', 'roles', 'defaults'].some(
        (key) =>
          definitionKey(before[key as 'inputs' | 'roles' | 'defaults']) !==
          definitionKey(draft[key as 'inputs' | 'roles' | 'defaults']),
      )
    )
      blockedReason =
        'Blueprint inputs, roles, or defaults changed. Start a new run to apply those changes.';
    if (request.mode === 'reuse' && !request.stageKey && !request.action)
      blockedReason = 'Choose a single stage to use existing upstream outputs.';
    if (request.mode === 'reuse' && request.scope === 'descendants' && request.stageKey)
      blockedReason = 'Rebuilding descendants requires applying the draft changes.';
    // A changed consumer contract cannot be assumed compatible with old upstream outputs.
    const contract = (stage: StageDef) => ({
      ...stage,
      label: undefined,
      disabled: undefined,
      instructions: undefined,
      qc: undefined,
      checks: undefined,
      checkMaxAttempts: undefined,
      config: undefined,
      model: undefined,
      budget: undefined,
      retryLimit: undefined,
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

    if (
      request.mode === 'validate' &&
      (!target ||
        !edited ||
        !request.stageKey ||
        !validationArtifactId ||
        target.iterate ||
        freshness.changedStageKeys.includes(request.stageKey) ||
        request.scope !== 'stage')
    )
      blockedReason =
        'Validation without regeneration requires a stored output from a non-iterating stage with only check/QC edits.';
    if (request.mode === 'validate' && edited && !edited.qc && edited.checks.length === 0)
      blockedReason = 'This stage has no checks or quality criteria to run.';
    const graphForScope = request.mode !== 'rebuild' ? before.graph : draft.graph;
    const deps = stageDependencies(graphForScope);
    const keep = request.stageKey
      ? new Set([
          request.stageKey,
          ...(request.scope === 'through' || !request.action
            ? ancestorsOf(deps, request.stageKey)
            : []),
        ])
      : new Set(
          request.action === 'continue'
            ? (current.executionScope?.stageKeys ??
                current.stageExecutions
                  .filter((e) => e.state !== 'skipped' || e.skipReason)
                  .map((e) => e.stageKey))
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
    if (!regenerate) for (const key of keep) if (!passed.has(key)) execute.add(key);
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
          definitionKey(before.graph.find((s) => s.key === key)) !==
            definitionKey(draft.graph.find((s) => s.key === key)),
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
    if (
      request.mode === 'rebuild' &&
      (definitionKey(before.graph.map((s) => s.key)) !==
        definitionKey(draft.graph.map((s) => s.key)) ||
        before.graph.some(
          (s) => definitionKey(oldDeps.get(s.key)) !== definitionKey(newDeps.get(s.key)),
        ))
    )
      blockedReason =
        'The graph was reordered or rewired. Start a new run to apply changed dependencies.';
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
      blueprintDefaults: source.defaults as ConfigLayer,
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
      validationArtifactId: request.mode === 'validate' ? validationArtifactId : undefined,
    });
    const preview = await this.invalidation.preview({
      runId,
      seed:
        request.itemIndex !== undefined && request.stageKey
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
      availabilityChangedStageKeys,
      runStageKeys: graph.filter((s) => execute.has(s.key)).map((s) => s.key),
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
        request.itemIndex !== undefined
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
      changedKeys,
      preview,
      plan,
      config,
      configFingerprint,
      assetBindings,
      validationArtifactId,
    };
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
        const snapshotId = ulid();
        await tx.insert(blueprintVersion).values({
          ...built.source,
          id: snapshotId,
          graph: built.graph,
          draft: true,
          createdAt: new Date().toISOString(),
        });
        await this.invalidation.apply(tx, {
          runId,
          closure: built.preview.closure,
          targetStageKey: request.stageKey ?? built.plan.runStageKeys[0]!,
          gcBlobs: false,
        });
        if (request.mode === 'validate') {
          const execution = built.current.stageExecutions.find(
            (e) => e.stageKey === request.stageKey,
          )!;
          const [previous] = await tx
            .select()
            .from(stageAttempt)
            .where(
              and(
                eq(stageAttempt.stageExecutionId, execution.id),
                eq(stageAttempt.artifactId, built.validationArtifactId!),
              ),
            )
            .orderBy(desc(stageAttempt.attemptNo))
            .limit(1);
          const [latest] = await tx
            .select({ attemptNo: stageAttempt.attemptNo })
            .from(stageAttempt)
            .where(eq(stageAttempt.stageExecutionId, execution.id))
            .orderBy(desc(stageAttempt.attemptNo))
            .limit(1);
          if (!previous)
            throw new ConflictException(
              'The completed output has no validation provenance. Rebuild this stage.',
            );
          const [stored] = await tx
            .select()
            .from(artifact)
            .where(eq(artifact.id, built.validationArtifactId!));
          if (!stored)
            throw new ConflictException('The output no longer exists. Review a new plan.');
          const validationOutputId = ulid();
          // Revalidation may select different media; retain the original immutable artifact.
          await tx.insert(artifact).values({
            ...stored,
            id: validationOutputId,
            stale: true,
            generation: stored.generation + 1,
            costUsd: '0',
            createdAt: new Date().toISOString(),
          });
          const attachments = await tx
            .select()
            .from(artifactAttachment)
            .where(eq(artifactAttachment.artifactId, stored.id));
          if (attachments.length)
            await tx.insert(artifactAttachment).values(
              attachments.map((attachment) => ({
                ...attachment,
                id: ulid(),
                artifactId: validationOutputId,
              })),
            );

          // A created user attempt with a stored artifact requests validation, never generation.
          await tx.insert(stageAttempt).values({
            ...previous,
            artifactId: validationOutputId,
            id: ulid(),
            invocationKey: null,
            attemptNo: (latest?.attemptNo ?? 0) + 1,
            actor: 'user',
            outcome: 'user_edit',
            phase: 'created',
            executionEpoch: locked.executionEpoch + 1,
            costUsd: '0',
            checkResults: null,
            qcVerdict: null,
            jobHandle: null,
            idempotencyKey: null,
            createdAt: new Date().toISOString(),
          });
        }

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
                  built.current.executionScope?.kind === 'selection')
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
              request.mode === 'reuse'
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
