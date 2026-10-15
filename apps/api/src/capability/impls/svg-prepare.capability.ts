import { Injectable } from '@nestjs/common';
import { DrawingNeed } from '@reelcraft/shared';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { z } from 'zod';
import { BuiltinDrawings } from '../vector/builtin-drawings';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { prepareDrawings, unwrapDrawings, type DrawingRejection } from '../vector/drawing-prepare';

type Payload = {
  assets: unknown[];
  rejected: DrawingRejection[];
  fallbacks: string[];
  received: number;
};

const Needs = z.array(DrawingNeed);

/**
 * Checks the drawings a run's model made, and puts the ones that can be used into one set a
 * timeline can place. A drawing that can't be used is left out and listed in
 * the stage log; a built-in drawing takes its place when the plan named one, so one bad drawing never stops a
 * run. Free and instant.
 */
@Capability('svg.prepare')
@Injectable()
export class SvgPrepareCapability implements CapabilityImpl<Record<string, never>> {
  readonly modality = 'compute' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Prepare Drawings';
  readonly description =
    'Check the drawings a model made and gather the usable ones into a set to place on a timeline.';
  readonly configSchema: JsonSchema = { type: 'object', properties: {} };

  constructor(private readonly builtin: BuiltinDrawings) {}

  slots(): SlotDef[] {
    return [
      {
        name: 'drawings',
        accepts: [{ type: 'array' }, { type: 'object' }],
        required: true,
        cardinality: 'one',
      },
      {
        name: 'needs',
        accepts: [{ type: 'array' }, { type: 'object' }],
        required: false,
        cardinality: 'one',
      },
    ];
  }

  allowedOutputs(): OutputKind[] {
    return ['data'];
  }

  validate(_config: Record<string, never>, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (stage.output.kind !== 'data') {
      issues.push({
        path: 'output.kind',
        message: 'Prepare Drawings produces data',
        severity: 'error',
      });
    }
    if (stage.iterate) {
      issues.push({
        path: 'iterate',
        message: 'Prepare Drawings gathers all the drawings at once; it cannot iterate',
        severity: 'error',
      });
    }
    return issues;
  }

  async estimateCost(): Promise<CostEstimate> {
    return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' };
  }

  async submit(ctx: ExecCtx<Record<string, never>>): Promise<JobHandle> {
    const drawings = unwrapDrawings(ctx.slots.drawings);
    // What was asked for: a list of needs, or an object that holds one as `needs`.
    const asked = ctx.slots.needs as { needs?: unknown } | unknown[] | undefined;
    const needs = Needs.safeParse(Array.isArray(asked) ? asked : asked?.needs);
    const { assets, rejected, fallbacks } = prepareDrawings({
      drawings,
      needs: needs.success ? needs.data : undefined,
      builtin: (id) => {
        const entry = this.builtin.get(id);
        return (
          entry && {
            id: entry.id,
            label: entry.label,
            viewBox: entry.viewBox,
            strokes: entry.strokes,
            source: 'builtin' as const,
          }
        );
      },
    });
    return {
      providerId: 'local-sync',
      externalId: ctx.idempotencyKey,
      payload: { assets, rejected, fallbacks, received: drawings.length } satisfies Payload,
    };
  }

  async poll(): Promise<JobStatus> {
    return { done: true, outcome: 'succeeded' };
  }

  async fetch(handle: JobHandle, ctx: ExecCtx<Record<string, never>>): Promise<ExecResult> {
    const payload = handle.payload as Payload;
    for (const rejection of payload.rejected) {
      ctx.logger.log(
        `svg.prepare: left out "${rejection.id}": ${rejection.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    return {
      output: { assets: payload.assets },
      costUsd: 0,
      repro: { level: 'exact' },
      providerMeta: {
        received: payload.received,
        accepted: payload.assets.length,
        rejected: payload.rejected,
        builtinFallbacks: payload.fallbacks,
      },
    };
  }
}
