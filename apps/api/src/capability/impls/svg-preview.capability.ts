import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { VectorAssetSet } from '@reelcraft/shared';
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
import { EngineConfig } from '../../config/engine-config';
import { ComputeJobService, type ComputeHandle } from '../../storage/compute-job.service';
import { Capability } from '../capability.decorator';
import type { ExecCtx, ExecResult } from '../capability.interface';
import { previewTimeline } from '../whiteboard/drawing-preview';
import { LocalComputeCapability } from './assembly.capability';

type PreviewConfig = { columns?: number; maxWaitSec?: number };

/** The job that renders the contact sheet as a PNG with the render worker. */
export function drawingPreviewSpec(p: {
  assets: VectorAssetSet['assets'];
  columns: number;
  maxWaitSec: number;
  browserExecutable?: string | undefined;
}): ComputeSpec {
  const worker = path.resolve(__dirname, '../../../../render-worker/dist/cli.js');
  return {
    command: process.execPath,
    args: [
      worker,
      '{input:timeline.json}',
      '{input:resources.json}',
      'still',
      '{output}',
      ...(p.browserExecutable ? [p.browserExecutable] : []),
    ],
    inputs: [],
    files: [
      {
        asFilename: 'timeline.json',
        contents: JSON.stringify(previewTimeline(p.assets, p.columns)),
      },
      {
        asFilename: 'resources.json',
        contents: JSON.stringify({ media: {}, timing: {}, styles: {} }),
      },
    ],
    outputFilename: 'drawings.png',
    maxWaitSec: p.maxWaitSec,
  };
}

/**
 * Makes one picture of a set of drawings, each with its id, so they can be looked at together:
 * by a person in the run, or by a quality-control judge that can see images. Runs the render
 * worker locally: free.
 */
@Capability('svg.preview')
@Injectable()
export class SvgPreviewCapability extends LocalComputeCapability<PreviewConfig> {
  readonly modality = 'compute' as const;
  readonly label = 'Preview Drawings';
  readonly description =
    'Make one picture of a set of drawings, each with its id, to look at them together.';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      columns: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Drawings across; default 5',
      },
      maxWaitSec: { type: 'number', minimum: 1, description: 'How long to wait; default 300' },
    },
  };

  constructor(
    compute: ComputeJobService,
    private readonly config: EngineConfig,
  ) {
    super(compute);
  }

  slots(): SlotDef[] {
    return [{ name: 'assets', accepts: [{ type: 'object' }], required: true, cardinality: 'one' }];
  }

  allowedOutputs(): OutputKind[] {
    return ['media.image'];
  }

  validate(_config: PreviewConfig, stage: StageDef): ValidationIssue[] {
    return stage.output.kind === 'media.image'
      ? []
      : [{ path: 'output.kind', message: 'Preview Drawings produces an image', severity: 'error' }];
  }

  async submit(ctx: ExecCtx<PreviewConfig>): Promise<JobHandle> {
    const set = VectorAssetSet.parse(ctx.slots.assets);
    const handle = await this.compute.spawn(
      ctx.idempotencyKey,
      drawingPreviewSpec({
        assets: set.assets,
        columns: ctx.config.columns ?? 5,
        maxWaitSec: ctx.config.maxWaitSec ?? 300,
        browserExecutable: this.config.remotionBrowserExecutable,
      }),
    );
    return this.jobHandle(handle);
  }

  async fetch(handle: JobHandle): Promise<ExecResult<MediaSource>> {
    return {
      output: {
        kind: 'media.image',
        localPath: await this.compute.collect(handle.payload as ComputeHandle),
        filename: 'drawings.png',
        mime: 'image/png',
      },
      costUsd: 0,
      repro: { level: 'exact', providerVersion: 'remotion-4.0.526' },
    };
  }
}
