import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { CheckDef } from '@reefcraft/shared';
import { StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprintVersion, run } from '../db/schema/index';
import { ArtifactService, type ArtifactRecord } from '../artifact/artifact.service';
import {
  BindingResolverService,
  type BindingScope,
  type RefEnvelope,
} from '../artifact/binding-resolver.service';
import { CheckRunner } from './check-runner.service';
import type { CheckResult } from './check.types';

/**
 * §editor Chunk 2 — `POST /checks/test`. Lets an author test a check
 * against a real past-run artifact ahead of wiring it into a blueprint's
 * `checks[]`. Duplicates the small `prevStageKey`/`inputs`/bindings query
 * `StageRunnerService.loadStageContext` already does rather than importing
 * it: `CheckModule` is already imported by `OrchestrationModule` (which
 * owns `StageRunnerService`), so reaching back the other way would cycle
 * the module graph.
 */
@Injectable()
export class CheckTestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly artifacts: ArtifactService,
    private readonly bindings: BindingResolverService,
    private readonly runner: CheckRunner,
  ) {}

  async test(check: CheckDef, artifactId: string): Promise<CheckResult> {
    const artifactRow = await this.artifacts.getById(artifactId);

    let resolvedRefs: Array<Record<string, RefEnvelope>> = [{}];
    if (check.type === 'script' && check.refs && Object.keys(check.refs).length > 0) {
      const scope = await this.buildScope(artifactRow);
      const { refs } = await this.bindings.resolveRefEnvelopes(check.refs, scope);
      resolvedRefs = [refs];
    }

    const results = await this.runner.run({
      checks: [check],
      artifact: { kind: artifactRow.kind, data: artifactRow.data, probe: artifactRow.probe },
      resolvedRefs,
    });
    return results[0]!;
  }

  private async buildScope(artifactRow: ArtifactRecord): Promise<BindingScope> {
    const [row] = await this.db
      .select({
        graph: blueprintVersion.graph,
        inputs: run.inputs,
        assetBindings: run.assetBindings,
        roleBindings: run.roleBindings,
      })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, artifactRow.runId))
      .limit(1);
    if (!row) throw new Error(`CheckTestService: run ${artifactRow.runId} not found`);

    const graph = StageDef.array().parse(row.graph);
    const index = graph.findIndex((stage) => stage.key === artifactRow.producerStageKey);
    const prevStageKey = index > 0 ? graph[index - 1]?.key : undefined;

    return {
      runId: artifactRow.runId,
      prevStageKey,
      inputs: row.inputs as Record<string, unknown>,
      assetBindings: row.assetBindings as BindingScope['assetBindings'],
      roleBindings: row.roleBindings as BindingScope['roleBindings'],
      stageKey: artifactRow.producerStageKey,
      itemIndex: artifactRow.itemIndex,
    };
  }
}
