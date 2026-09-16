import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ConfigLayer, ModelPin, StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { run } from '../db/schema/index';
import { mergeLayer, mergeLayers } from './layer-merge';
import { stageDefLayer } from './stage-def-layer';

export interface EffectiveStageConfig {
  layer: ConfigLayer;
  model?: ModelPin;
  retryLimit: number;
  polling: { intervalSec: number; maxWaitSec: number };
  /** StageDef.config verbatim — the capability's own Cfg, not a ConfigLayer field. */
  capabilityConfig: Record<string, unknown>;
}

/**
 * §5 — splits pure merge semantics (`resolveRunConfig`, no DB, fully
 * unit-testable) from the DB-reading per-stage lookup (`effectiveStageConfig`),
 * which is the only sanctioned read path per §5.3: it reads
 * `run.resolved_config[stageKey]` merged with `run.overrides[stageKey]`,
 * never any other combination of layers.
 */
@Injectable()
export class ConfigResolverService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  resolveRunConfig(args: {
    graph: StageDef[];
    engine: ConfigLayer;
    channelDefaults: ConfigLayer;
    blueprintDefaults: ConfigLayer;
  }): Record<string, ConfigLayer> {
    const base = mergeLayers(args.engine, args.channelDefaults, args.blueprintDefaults);
    const result: Record<string, ConfigLayer> = {};
    for (const stage of args.graph) {
      result[stage.key] = mergeLayer(base, stageDefLayer(stage));
    }
    return result;
  }

  async effectiveStageConfig(
    runId: string,
    stageKey: string,
    stage: StageDef,
  ): Promise<EffectiveStageConfig> {
    const [row] = await this.db
      .select({ resolvedConfig: run.resolvedConfig, overrides: run.overrides })
      .from(run)
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new Error(`ConfigResolverService: run ${runId} not found`);

    const resolvedByStage = row.resolvedConfig as Record<string, ConfigLayer>;
    const overridesByStage = row.overrides as Record<string, ConfigLayer>;
    const base = resolvedByStage[stageKey] ?? {};
    const override = overridesByStage[stageKey] ?? {};
    const layer = mergeLayer(base, override);

    const model = toModelPin(layer.model);
    return {
      layer,
      ...(model !== undefined && { model }),
      retryLimit: layer.retryLimit ?? stage.retryLimit,
      polling: {
        intervalSec: layer.polling?.intervalSec ?? 5,
        maxWaitSec: layer.polling?.maxWaitSec ?? 120,
      },
      capabilityConfig: stage.config,
    };
  }
}

function toModelPin(pin: ConfigLayer['model']): ModelPin | undefined {
  if (!pin || !pin.provider || !pin.modelId) return undefined;
  return {
    provider: pin.provider,
    modelId: pin.modelId,
    ...(pin.version !== undefined && pin.version !== null && { version: pin.version }),
    params: pin.params ?? {},
  };
}
