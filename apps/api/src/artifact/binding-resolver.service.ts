import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Ref } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { artifact } from '../db/schema/index';

/**
 * Phase-1 minimal binding resolver. Supports `prev`, `input`, and `const`
 * (§6.1) — enough for a one-stage blueprint, since there is no earlier
 * stage to bind `prev` against and run inputs are the only other source of
 * data. `memory`, `role`, `item`, and `prevItem` are phases 4/7/8 and throw
 * here rather than silently resolving to nothing.
 */
@Injectable()
export class BindingResolverService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async resolve(ref: Ref, ctx: { runId: string; prevStageKey?: string; inputs: Record<string, unknown> }): Promise<unknown> {
    switch (ref.from) {
      case 'const':
        return ref.value;

      case 'input': {
        const value = ctx.inputs[ref.inputKey];
        return ref.path ? getPath(value, ref.path) : value;
      }

      case 'prev': {
        if (!ctx.prevStageKey) {
          throw new Error('BindingResolverService: {from: "prev"} on the first stage is invalid');
        }
        const [row] = await this.db
          .select()
          .from(artifact)
          .where(
            and(
              eq(artifact.runId, ctx.runId),
              eq(artifact.producerStageKey, ctx.prevStageKey),
              isNull(artifact.itemIndex),
              eq(artifact.stale, false),
            ),
          )
          .limit(1);
        if (!row) {
          throw new Error(`BindingResolverService: no active artifact for stage "${ctx.prevStageKey}"`);
        }
        return ref.path ? getPath(row.data, ref.path) : row.data;
      }

      case 'memory':
      case 'role':
      case 'item':
      case 'prevItem':
      case 'asset':
        throw new Error(
          `BindingResolverService: {from: "${ref.from}"} is not implemented in phase 1`,
        );
    }
  }
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}
