import { Inject, Injectable } from '@nestjs/common';
import type { Inngest } from 'inngest';
import { eq } from 'drizzle-orm';
import type { CreateRunDto, ConfigLayer } from '@reefcraft/shared';
import { StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprintVersion, channel, run, stageExecution } from '../db/schema/index';
import { ulid } from '../common/ulid';
import { fromUsd } from '../common/money';
import { INNGEST_CLIENT } from '../orchestration/inngest.client';
import { RunStateService } from '../orchestration/run-state.service';
import { EngineConfig } from '../config/engine-config';
import { CapabilityRegistry } from '../capability/capability.registry';
import { ConfigResolverService } from '../run-config/config-resolver.service';
import { engineDefaults } from '../run-config/engine-defaults';
import { LedgerService } from '../budget/ledger.service';

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
  ) {}

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
    });

    await this.inngest.send({ name: 'run/started', data: { runId } });

    return this.get(runId);
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
