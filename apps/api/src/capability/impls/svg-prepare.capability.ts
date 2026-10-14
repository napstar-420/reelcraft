import { Injectable } from '@nestjs/common';
import { AssetNeed } from '@reelcraft/shared';
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
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import {
  prepareDrawings,
  unwrapDrawings,
  type DrawingRejection,
} from '../whiteboard/drawing-prepare';

type Payload = { assets: unknown[]; rejected: DrawingRejection[]; received: number };

const Needs = z.array(AssetNeed);

/**
 * Checks the drawings a run's model made for a hand-drawn video, and puts the ones that can be
 * used into one set for Compile Scenes. A drawing that can't be used is left out and listed in
 * the stage log; the video uses a built-in drawing in its place, so one bad drawing never stops a
 * run. Free and instant.
 */
@Capability('svg.prepare')
@Injectable()
export class SvgPrepareCapability implements CapabilityImpl<Record<string, never>> {
  readonly modality = 'compute' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Prepare Drawings';
  readonly description =
    'Check the drawings a model made for a hand-drawn video and gather the usable ones into a set for Compile Scenes.';
  readonly configSchema: JsonSchema = { type: 'object', properties: {} };

  slots(): SlotDef[] {
    return [
      {
        name: 'drawings',
        accepts: [{ type: 'array' }, { type: 'object' }],
        required: true,
        cardinality: 'one',
      },
      { name: 'scenes', accepts: [{ type: 'object' }], required: false, cardinality: 'one' },
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
    const plan = ctx.slots.scenes as { assetNeeds?: unknown } | undefined;
    const needs = Needs.safeParse(plan?.assetNeeds);
    const { assets, rejected } = prepareDrawings({
      drawings,
      needs: needs.success ? needs.data : undefined,
    });
    return {
      providerId: 'local-sync',
      externalId: ctx.idempotencyKey,
      payload: { assets, rejected, received: drawings.length } satisfies Payload,
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
      },
    };
  }
}
