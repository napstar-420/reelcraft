import { Inject, Injectable } from '@nestjs/common';
import type { Inngest } from 'inngest';
import { eq } from 'drizzle-orm';
import type { CreateRunDto } from '@reefcraft/shared';
import type { StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprintVersion, run, stageExecution } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { INNGEST_CLIENT } from '../orchestration/inngest.client';

/**
 * §12/§21 — run start snapshots a flattened resolved_config. Phase 1 has no
 * ConfigResolver yet (phase 2), so this snapshot is the blueprint version's
 * `defaults` as-is; the column is populated correctly from day one even
 * though the merge logic it will eventually hold does not exist yet.
 */
@Injectable()
export class RunService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(INNGEST_CLIENT) private readonly inngest: Inngest,
  ) {}

  async create(dto: CreateRunDto) {
    const [version] = await this.db
      .select()
      .from(blueprintVersion)
      .where(eq(blueprintVersion.id, dto.blueprintVersionId))
      .limit(1);
    if (!version) throw new Error(`BlueprintVersion ${dto.blueprintVersionId} not found`);
    if (!version.runnable) throw new Error(`BlueprintVersion ${dto.blueprintVersionId} failed validation`);

    const graph = version.graph as StageDef[];
    const runId = ulid();

    await this.db.transaction(async (tx) => {
      await tx.insert(run).values({
        id: runId,
        channelId: dto.channelId,
        blueprintVersionId: dto.blueprintVersionId,
        state: 'CREATED',
        inputs: dto.inputs,
        roleBindings: dto.roleBindings,
        resolvedConfig: version.defaults,
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
    });

    await this.inngest.send({ name: 'run/started', data: { runId } });

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
