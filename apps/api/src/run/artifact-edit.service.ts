import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { StageDef } from '@reelcraft/shared';
import { ArtifactService } from '../artifact/artifact.service';
import { MemoryService } from '../artifact/memory.service';
import { ulid } from '../common/ulid';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact, blueprintVersion, run, stageAttempt, stageExecution } from '../db/schema/index';
import { SchemaValidatorService } from '../json-schema/schema-validator.service';
import { HumanWaitService } from './human-wait.service';
import { InvalidationService } from './invalidation.service';
import { PreviewTokenService } from './preview-token.service';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';

interface EditInput {
  value: unknown;
  sourceArtifactId?: string;
  previewToken?: string;
}

@Injectable()
export class ArtifactEditService {
  private readonly logger = new Logger(ArtifactEditService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly invalidation: InvalidationService,
    private readonly tokens: PreviewTokenService,
    private readonly mutation: RunMutationService,
    private readonly dispatcher: RunWakeupDispatcher,
    private readonly artifacts: ArtifactService,
    private readonly memory: MemoryService,
    private readonly schemaValidator: SchemaValidatorService,
    private readonly waits: HumanWaitService,
  ) {}

  async edit(runId: string, stageKey: string, input: EditInput) {
    const context = await this.loadContext(runId, stageKey, input.sourceArtifactId);
    const data = this.validateValue(context.stage, input.value);
    const payload = { stageKey, value: input.value, sourceArtifactId: context.sourceArtifactId };
    const preview = await this.invalidation.preview({ runId, seed: { stageKeys: [stageKey] } });

    if (!input.previewToken) {
      const issued = this.tokens.issue({
        action: 'edit_artifact',
        runId,
        runRevision: context.run.revision,
        proposedPayload: payload,
        preview: { fingerprint: preview.fingerprint },
      });
      return {
        previewToken: issued.token,
        expiresAt: issued.expiresAt,
        sourceArtifactId: context.sourceArtifactId,
        affectedStageKeys: preview.closure.affectedStageKeys,
        spentUsd: preview.totals.spentUsd,
        estimatedRerunUsd: preview.totals.estimatedRerunUsd,
      };
    }

    const claims = this.tokens.verify<{ fingerprint: string }>(input.previewToken, {
      action: 'edit_artifact',
      runId,
      runRevision: context.run.revision,
      proposedPayload: payload,
    });
    if (claims.preview.fingerprint !== preview.fingerprint) {
      throw new ConflictException('The edit preview changed; request a new preview');
    }

    const result = await this.mutation.withLockedRun(
      runId,
      'edit_artifact',
      ['PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'FAILED', 'COMPLETED'],
      async (tx, lockedRun) => {
        if (lockedRun.revision !== claims.runRevision) {
          throw new ConflictException('The run changed; request a new preview');
        }
        const [source] = await tx
          .select({ id: artifact.id })
          .from(artifact)
          .where(
            and(
              eq(artifact.id, context.sourceArtifactId),
              eq(artifact.runId, runId),
              eq(artifact.producerStageKey, stageKey),
            ),
          )
          .limit(1);
        if (!source) throw new ConflictException('The source artifact is no longer available');

        await this.invalidation.apply(tx, {
          runId,
          closure: preview.closure,
          targetStageKey: stageKey,
        });
        const newArtifactId = await this.artifacts.recordAttemptArtifact(
          {
            runId,
            producerStageKey: stageKey,
            kind: context.stage.output.kind,
            data,
            ...(context.stage.output.kind === 'data'
              ? { schemaHash: this.schemaValidator.hashOf(context.stage.output.schema) }
              : {}),
            reproLevel: 'none',
            costUsd: 0,
            userAuthored: true,
          },
          tx,
        );
        const [attemptNumber] = await tx
          .select({ max: sql<number>`coalesce(max(${stageAttempt.attemptNo}), 0)::int` })
          .from(stageAttempt)
          .where(eq(stageAttempt.stageExecutionId, context.execution.id));
        await tx.insert(stageAttempt).values({
          id: ulid(),
          stageExecutionId: context.execution.id,
          attemptNo: (attemptNumber?.max ?? 0) + 1,
          outcome: 'user_edit',
          phase: 'settled',
          actor: 'user',
          artifactId: newArtifactId,
          resolvedInputs: { manualEdit: { sourceArtifactId: context.sourceArtifactId } },
        });
        await this.artifacts.finalize(
          {
            runId,
            stageExecutionId: context.execution.id,
            producerStageKey: stageKey,
            newArtifactId,
            applyWrites: this.memory.buildWriteCallback(context.stage, {
              runId,
              stageKey,
              kind: context.stage.output.kind,
              data,
            }),
          },
          tx,
        );
        await tx
          .update(stageExecution)
          .set({ state: 'passed', failure: null, endedAt: new Date().toISOString() })
          .where(eq(stageExecution.id, context.execution.id));
        await this.waits.resolve(tx, context.execution.id);
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

  private validateValue(stage: StageDef, value: unknown): unknown {
    if (stage.output.kind === 'text') {
      if (typeof value !== 'string')
        throw new UnprocessableEntityException('Text edits require a string');
      return { text: value };
    }
    if (stage.output.kind === 'data') {
      const violations = this.schemaValidator.validate(stage.output.schema, value);
      if (violations.length > 0)
        throw new UnprocessableEntityException({ code: 'schema_invalid', violations });
      return value;
    }
    throw new UnprocessableEntityException('Media artifact edits are not available until Phase 5');
  }

  private async loadContext(runId: string, stageKey: string, requestedSource?: string) {
    const [row] = await this.db
      .select({ run, graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    const stage = StageDef.array()
      .parse(row.graph)
      .find((candidate) => candidate.key === stageKey);
    if (!stage) throw new NotFoundException(`Stage ${stageKey} not found`);
    const [execution] = await this.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, runId), eq(stageExecution.stageKey, stageKey)))
      .limit(1);
    if (!execution) throw new NotFoundException(`Execution ${stageKey} not found`);

    let sourceArtifactId = requestedSource ?? execution.outputArtifactId ?? undefined;
    if (!sourceArtifactId) {
      const [candidate] = await this.db
        .select({ artifactId: stageAttempt.artifactId })
        .from(stageAttempt)
        .where(eq(stageAttempt.stageExecutionId, execution.id))
        .orderBy(desc(stageAttempt.attemptNo))
        .limit(1);
      sourceArtifactId = candidate?.artifactId ?? undefined;
    }
    if (!sourceArtifactId) throw new ConflictException('No source artifact exists for this edit');
    return { run: row.run, stage, execution, sourceArtifactId };
  }
}
