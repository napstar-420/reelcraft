import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConfigLayer } from '@reefcraft/shared';
import type { ModelPin, StageDef } from '@reefcraft/shared';
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

    // §5.3's sanctioned read path trusts these jsonb columns are shaped
    // exactly like this — validate rather than `as`-cast, so a shape-drifted
    // row (e.g. the pre-chunk-2 flat-ConfigLayer shape) fails loudly here
    // instead of silently resolving every stage's config to `{}`.
    const resolvedByStage = parseConfigLayerMap(row.resolvedConfig, 'resolved_config');
    const overridesByStage = parseConfigLayerMap(row.overrides, 'overrides');
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

/** Parses a `run.resolved_config` / `run.overrides` jsonb column into a
 * `Record<stageKey, ConfigLayer>`, validating every entry. Deliberately
 * loops calling `ConfigLayer.parse(...)` per entry rather than building a
 * `z.record(z.string(), ConfigLayer)` wrapper: wrapping a schema imported
 * from `@reefcraft/shared` in a freshly-constructed `z.record()` here breaks
 * under Vite/vitest's module handling — `@reefcraft/shared`'s zod and this
 * file's `zod` import end up as distinct module instances, so `z.record()`'s
 * internal `value instanceof ZodType` check on `ConfigLayer` silently fails
 * and `z.record` falls back to treating the KEY schema as the value schema
 * (a confusing "expected string, received object" error, not an obvious
 * module-identity one). Calling `ConfigLayer.parse()` directly sidesteps
 * that — it never does an `instanceof` check against a "foreign" ZodType. */
function parseConfigLayerMap(raw: unknown, column: string): Record<string, ConfigLayer> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`ConfigResolverService: run.${column} is not a per-stage config map`);
  }
  const result: Record<string, ConfigLayer> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = ConfigLayer.parse(value);
  }
  return result;
}

function toModelPin(pin: ConfigLayer['model']): ModelPin | undefined {
  if (!pin) return undefined;
  // A pin with SOME fields set but not both provider and modelId is a config
  // bug (a typo'd or half-migrated model override), not "no model configured"
  // — those two look identical if this silently returned undefined for both.
  if (!pin.provider || !pin.modelId) {
    throw new Error(
      `ConfigResolverService: resolved model config is missing "${
        !pin.provider ? 'provider' : 'modelId'
      }" — a model pin must set both provider and modelId, or neither`,
    );
  }
  return {
    provider: pin.provider,
    modelId: pin.modelId,
    ...(pin.version !== undefined && pin.version !== null && { version: pin.version }),
    params: pin.params ?? {},
  };
}
