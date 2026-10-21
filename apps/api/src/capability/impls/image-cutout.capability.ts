import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type {
  ComputeSpec,
  JobHandle,
  JsonSchema,
  MediaSource,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { ComputeJobService, type ComputeHandle } from '../../storage/compute-job.service';
import { Capability } from '../capability.decorator';
import type { ExecCtx, ExecResult } from '../capability.interface';
import { LocalComputeCapability } from './assembly.capability';

type CutoutConfig = { tolerance?: number; feather?: number; maxWaitSec?: number };
type ImageInput = { sourceKey?: string; filename?: string; mime?: string };

export const CUTOUT_DEFAULTS = { tolerance: 0.12, feather: 1 } as const;

/** The job that cuts the picture out with the render worker: the picture in, a PNG out. */
export function cutoutSpec(p: {
  sourceKey: string;
  filename?: string | undefined;
  tolerance: number;
  feather: number;
  maxWaitSec: number;
}): ComputeSpec {
  const ext = path.extname(p.filename ?? p.sourceKey).toLowerCase() || '.png';
  const input = `picture${ext}`;
  const worker = path.resolve(__dirname, '../../../../render-worker/dist/cli.js');
  return {
    command: process.execPath,
    args: [
      worker,
      'cutout',
      `{input:${input}}`,
      '{output}',
      String(p.tolerance),
      String(p.feather),
    ],
    inputs: [{ sourceKey: p.sourceKey, asFilename: input }],
    outputFilename: 'cutout.png',
    maxWaitSec: p.maxWaitSec,
  };
}

/**
 * Makes a picture's plain background see-through, so its subject can stand over anything: a
 * character over a scene, a product over a colour. The background is the colour around the
 * picture's edge, and only what joins the edge is removed, so the same colour inside the subject
 * stays. Ask the image stage for one subject on a single flat colour. Runs locally: free.
 */
@Capability('image.cutout')
@Injectable()
export class ImageCutoutCapability extends LocalComputeCapability<CutoutConfig> {
  readonly modality = 'compute' as const;
  readonly label = 'Cut Out Background';
  readonly description =
    "Make a picture's plain background see-through, so its subject can be placed over anything.";
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      tolerance: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: `How far from the background colour still counts as background, 0 to 1; default ${CUTOUT_DEFAULTS.tolerance}`,
      },
      feather: {
        type: 'number',
        minimum: 0,
        maximum: 4,
        description: `How many pixels the subject's edge fades in over; default ${CUTOUT_DEFAULTS.feather}`,
      },
      maxWaitSec: { type: 'number', minimum: 1, description: 'How long to wait; default 120' },
    },
  };

  constructor(compute: ComputeJobService) {
    super(compute);
  }

  slots(): SlotDef[] {
    return [{ name: 'image', accepts: ['media.image'], required: true, cardinality: 'one' }];
  }

  allowedOutputs(): OutputKind[] {
    return ['media.image'];
  }

  validate(_config: CutoutConfig, stage: StageDef): ValidationIssue[] {
    return stage.output.kind === 'media.image'
      ? []
      : [
          {
            path: 'output.kind',
            message: 'Cut Out Background produces an image',
            severity: 'error',
          },
        ];
  }

  async submit(ctx: ExecCtx<CutoutConfig>): Promise<JobHandle> {
    const image = ctx.slots.image as ImageInput | undefined;
    if (!image?.sourceKey) throw new Error('image.cutout needs a picture');
    const handle = await this.compute.spawn(
      ctx.idempotencyKey,
      cutoutSpec({
        sourceKey: image.sourceKey,
        filename: image.filename,
        tolerance: ctx.config.tolerance ?? CUTOUT_DEFAULTS.tolerance,
        feather: ctx.config.feather ?? CUTOUT_DEFAULTS.feather,
        maxWaitSec: ctx.config.maxWaitSec ?? 120,
      }),
    );
    return this.jobHandle(handle);
  }

  async fetch(handle: JobHandle): Promise<ExecResult<MediaSource>> {
    return {
      output: {
        kind: 'media.image',
        localPath: await this.compute.collect(handle.payload as ComputeHandle),
        filename: 'cutout.png',
        mime: 'image/png',
      },
      costUsd: 0,
      repro: { level: 'exact', providerVersion: 'reelcraft-cutout-1' },
    };
  }
}
