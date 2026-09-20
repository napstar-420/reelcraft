import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConfigLayer, StageDef, type ConfigLayer as ConfigLayerType } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprintVersion, run } from '../db/schema/index';
import { mergeLayer } from '../run-config/layer-merge';
import { InvalidationService, type InvalidationPreview } from './invalidation.service';
import { PreviewTokenService } from './preview-token.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';

const RETRY_STATES = [
  'PAUSED_BUDGET',
  'PAUSED_APPROVAL',
  'PAUSED_INPUT',
  'FAILED',
  'COMPLETED',
] as const;

interface RetryTokenPreview {
  fingerprint: string;
}

@Injectable()
export class RunActionService {
  private readonly logger = new Logger(RunActionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly invalidation: InvalidationService,
    private readonly tokens: PreviewTokenService,
    private readonly mutation: RunMutationService,
    private readonly dispatcher: RunWakeupDispatcher,
  ) {}

  async previewInvalidation(runId: string, stageKey: string, itemIndex?: number) {
    if (itemIndex !== undefined) {
      throw new ConflictException('Item invalidation is not available until iteration support');
    }
    return this.buildStagePreview(runId, stageKey, 'invalidation_preview');
  }

  async previewStageRetry(runId: string, stageKey: string) {
    return this.buildStagePreview(runId, stageKey, 'retry');
  }

  async confirmStageRetry(runId: string, stageKey: string, previewToken: string) {
    const payload = { stageKey };
    const revision = await this.currentRevision(runId);
    const claims = this.tokens.verify<RetryTokenPreview>(previewToken, {
      action: 'retry',
      runId,
      runRevision: revision,
      proposedPayload: payload,
    });
    const preview = await this.invalidation.preview({ runId, seed: { stageKeys: [stageKey] } });
    if (claims.preview.fingerprint !== preview.fingerprint) {
      throw new ConflictException('The invalidation preview changed; request a new preview');
    }

    const result = await this.mutation.withLockedRun(
      runId,
      'retry',
      RETRY_STATES,
      async (tx, lockedRun) => {
        if (lockedRun.revision !== claims.runRevision) {
          throw new ConflictException('The run changed; request a new preview');
        }
        await this.invalidation.apply(tx, {
          runId,
          closure: preview.closure,
          targetStageKey: stageKey,
        });
      },
      'run/resumed',
    );
    await this.dispatchBestEffort(result.wakeupId);
    return { accepted: true, revision: result.revision };
  }

  async patchOverrides(
    runId: string,
    proposed: Record<string, ConfigLayerType>,
    previewToken?: string,
  ) {
    const [context] = await this.db
      .select({ run, graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!context) throw new NotFoundException(`Run ${runId} not found`);
    const stageKeys = new Set(
      StageDef.array()
        .parse(context.graph)
        .map((stage) => stage.key),
    );
    const parsed: Record<string, ConfigLayerType> = {};
    for (const [stageKey, layer] of Object.entries(proposed)) {
      if (!stageKeys.has(stageKey)) throw new ConflictException(`Unknown stage ${stageKey}`);
      parsed[stageKey] = ConfigLayer.parse(layer);
    }

    const changedStageKeys = Object.keys(parsed);
    if (changedStageKeys.length === 0) return { applied: false, revision: context.run.revision };
    const preview = await this.invalidation.preview({
      runId,
      seed: { stageKeys: changedStageKeys },
    });
    const payload = { overrides: parsed };
    const hasActiveOutputs = preview.costs.length > 0;
    if (hasActiveOutputs && !previewToken) {
      const issued = this.tokens.issue({
        action: 'patch_overrides',
        runId,
        runRevision: context.run.revision,
        proposedPayload: payload,
        preview: { fingerprint: preview.fingerprint },
      });
      return this.toApiPreview(preview, issued.token, issued.expiresAt);
    }

    let claimsRevision = context.run.revision;
    if (hasActiveOutputs) {
      const claims = this.tokens.verify<RetryTokenPreview>(previewToken!, {
        action: 'patch_overrides',
        runId,
        runRevision: context.run.revision,
        proposedPayload: payload,
      });
      if (claims.preview.fingerprint !== preview.fingerprint) {
        throw new ConflictException('The override preview changed; request a new preview');
      }
      claimsRevision = claims.runRevision;
    }

    const targetStageKey = preview.closure.affectedStageKeys[0] ?? changedStageKeys[0]!;
    const result = await this.mutation.withLockedRun(
      runId,
      'patch_overrides',
      ['PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'FAILED'],
      async (tx, lockedRun) => {
        if (lockedRun.revision !== claimsRevision) {
          throw new ConflictException('The run changed; request a new preview');
        }
        const current = lockedRun.overrides as Record<string, ConfigLayerType>;
        const next = { ...current };
        for (const [stageKey, layer] of Object.entries(parsed)) {
          next[stageKey] = mergeLayer(next[stageKey] ?? {}, layer);
        }
        await tx.update(run).set({ overrides: next }).where(eq(run.id, runId));
        if (hasActiveOutputs) {
          await this.invalidation.apply(tx, {
            runId,
            closure: preview.closure,
            targetStageKey,
          });
        }
      },
      hasActiveOutputs ? 'run/resumed' : 'run/config-updated',
    );
    await this.dispatchBestEffort(result.wakeupId);
    return { applied: true, revision: result.revision, resumes: hasActiveOutputs };
  }

  private async buildStagePreview(runId: string, stageKey: string, action: string) {
    const revision = await this.currentRevision(runId);
    const preview = await this.invalidation.preview({ runId, seed: { stageKeys: [stageKey] } });
    const issued = this.tokens.issue({
      action,
      runId,
      runRevision: revision,
      proposedPayload: { stageKey },
      preview: { fingerprint: preview.fingerprint },
    });
    return this.toApiPreview(preview, issued.token, issued.expiresAt);
  }

  private toApiPreview(preview: InvalidationPreview, previewToken: string, expiresAt: string) {
    // phase 7 chunk 5 — `affectedArtifactIds`/`costs` can now hold more than
    // one entry per stage (an iterating stage with several invalid items),
    // so they're no longer safe to zip against `affectedStageKeys` by
    // array index. Group them by stageKey instead; `affectedStageKeys` and
    // `affectedExecutionIds` themselves stay 1:1 (one entry per affected
    // stage), so that zip is still valid.
    const artifactIdsByStage = new Map<string, string[]>();
    for (const item of preview.closure.affectedItems) {
      if (!item.artifactId) continue;
      const list = artifactIdsByStage.get(item.stageKey);
      if (list) list.push(item.artifactId);
      else artifactIdsByStage.set(item.stageKey, [item.artifactId]);
    }

    return {
      previewToken,
      expiresAt,
      affected: preview.closure.affectedStageKeys.map((stageKey, index) => {
        const artifactId = artifactIdsByStage.get(stageKey)?.[0];
        const cost = preview.costs
          .filter((entry) => entry.stageKey === stageKey)
          .reduce(
            (sum, entry) => ({
              spentUsd: sum.spentUsd + entry.spentUsd,
              estimatedRerunUsd: sum.estimatedRerunUsd + entry.estimatedRerunUsd,
            }),
            { spentUsd: 0, estimatedRerunUsd: 0 },
          );
        return {
          stageKey,
          stageExecutionId: preview.closure.affectedExecutionIds[index]!,
          ...(artifactId ? { artifactId } : {}),
          spentUsd: cost.spentUsd,
          estimatedRerunUsd: cost.estimatedRerunUsd,
        };
      }),
      spentUsd: preview.totals.spentUsd,
      estimatedRerunUsd: preview.totals.estimatedRerunUsd,
    };
  }

  private async currentRevision(runId: string): Promise<number> {
    const [row] = await this.db
      .select({ revision: run.revision })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    return row.revision;
  }

  private async dispatchBestEffort(wakeupId: string): Promise<void> {
    try {
      await this.dispatcher.dispatch(wakeupId);
    } catch (error) {
      this.logger.warn(
        `Run wakeup ${wakeupId} will be retried: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
