import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { SceneSource } from '@reelcraft/shared';
import type {
  JobHandle,
  JsonSchema,
  MediaSource,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { BLENDER_VERSION, blenderEnv } from '../../blender/blender-runtime';
import { BlenderRuntime } from '../../blender/blender-runtime.service';
import { EngineConfig } from '../../config/engine-config';
import { ComputeJobService, type ComputeHandle } from '../../storage/compute-job.service';
import { Capability } from '../capability.decorator';
import type { ExecCtx, ExecResult } from '../capability.interface';
import {
  framesKey,
  outputFilename,
  sceneHandles,
  sceneRenderSpec,
  type ModelFormat,
  type RenderEngine,
  type SceneQuality,
} from '../scene/scene-job';
import { LocalComputeCapability } from './assembly.capability';

type SceneRenderConfig = {
  quality?: SceneQuality;
  renderEngine?: RenderEngine;
  modelFormat?: ModelFormat;
  maxWaitSec?: number;
};

type SceneHandle = ComputeHandle & { framesDir: string; mode: 'video' | 'model'; filename: string };

/** Long scenes on a CPU take a while; the stage's `maxWaitSec` raises it. */
const DEFAULT_MAX_WAIT_SEC = 4 * 60 * 60;

const MIME: Record<string, string> = {
  'scene.mp4': 'video/mp4',
  'scene.webm': 'video/webm',
  'model.glb': 'model/gltf-binary',
  'model.blend': 'application/x-blender',
};

/**
 * Renders a scene program (from Write Scene) with its engine, locally and for free: into a clip to
 * place on a timeline, or, with a 3D model output, into a model that other scenes load. Rendering
 * the same scene again gives the same frames; a retry keeps the frames an earlier attempt made.
 */
@Capability('scene.render')
@Injectable()
export class SceneRenderCapability extends LocalComputeCapability<SceneRenderConfig> {
  readonly modality = 'compute' as const;
  readonly label = 'Render Scene';
  readonly description =
    'Render a scene a model wrote (2D or 3D, in Blender) into a video clip, or export it as a 3D model.';
  readonly noInstructions = true;
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      quality: {
        type: 'string',
        enum: ['draft', 'final'],
        description: 'Draft renders at half size with fewer samples; default final',
      },
      renderEngine: {
        type: 'string',
        enum: ['auto', 'eevee', 'cycles', 'workbench'],
        description:
          'auto: EEVEE on a GPU, Cycles on the CPU otherwise. The scene may choose its own.',
      },
      modelFormat: {
        type: 'string',
        enum: ['glb', 'blend'],
        description: 'File type for a 3D model output; default glb',
      },
      maxWaitSec: {
        type: 'number',
        minimum: 1,
        description: `How long the render may take; default ${DEFAULT_MAX_WAIT_SEC}`,
      },
    },
  };

  constructor(
    compute: ComputeJobService,
    private readonly config: EngineConfig,
    private readonly blender: BlenderRuntime,
  ) {
    super(compute);
  }

  slots(): SlotDef[] {
    return [{ name: 'scene', accepts: [{ type: 'object' }], required: true, cardinality: 'one' }];
  }

  allowedOutputs(): OutputKind[] {
    return ['media.video', 'media.model'];
  }

  validate(_config: SceneRenderConfig, stage: StageDef): ValidationIssue[] {
    return stage.output.kind === 'media.video' || stage.output.kind === 'media.model'
      ? []
      : [
          {
            path: 'output.kind',
            message: 'Render Scene produces a video or a 3D model',
            severity: 'error',
          },
        ];
  }

  resourceHandles(slots: Record<string, unknown>): string[] {
    const source = SceneSource.safeParse(slots.scene);
    return source.success ? sceneHandles(source.data) : [];
  }

  async submit(ctx: ExecCtx<SceneRenderConfig>): Promise<JobHandle> {
    const parsed = SceneSource.safeParse(ctx.slots.scene);
    if (!parsed.success) {
      throw new Error(`The scene input is not a scene: ${parsed.error.issues[0]?.message}`);
    }
    const source = parsed.data;
    const mode = ctx.output?.kind === 'media.model' ? 'model' : 'video';
    const quality = ctx.config.quality ?? 'final';
    const renderEngine = ctx.config.renderEngine ?? 'auto';
    const modelFormat = ctx.config.modelFormat ?? 'glb';
    // Under `jobs/`, so a scene that never finishes is swept with the other old job folders.
    const framesDir = path.join(
      this.config.workspaceRoot,
      'jobs',
      `frames-${framesKey(source, quality, renderEngine)}`,
    );
    const spec = sceneRenderSpec({
      source,
      mode,
      modelFormat,
      quality,
      renderEngine,
      resources: ctx.resources ?? {},
      blender: await this.blender.binary(),
      framesDir,
      maxWaitSec: ctx.config.maxWaitSec ?? DEFAULT_MAX_WAIT_SEC,
      env: blenderEnv(process.env),
    });
    const handle = await this.compute.spawn(ctx.idempotencyKey, spec);
    const payload: SceneHandle = {
      ...handle,
      framesDir,
      mode,
      filename: outputFilename(mode, source, modelFormat),
    };
    return { providerId: 'local-compute', externalId: handle.jobId, payload };
  }

  async fetch(handle: JobHandle): Promise<ExecResult<MediaSource>> {
    const scene = handle.payload as SceneHandle;
    return {
      output: {
        kind: scene.mode === 'model' ? 'media.model' : 'media.video',
        localPath: await this.compute.collect(scene),
        filename: scene.filename,
        mime: MIME[scene.filename] ?? 'application/octet-stream',
      },
      costUsd: 0,
      repro: { level: 'exact', providerVersion: `blender-${BLENDER_VERSION}` },
    };
  }

  async cleanup(handle: JobHandle): Promise<void> {
    await super.cleanup(handle);
    // The clip is stored; the frames it was made from are not needed again.
    await rm((handle.payload as SceneHandle).framesDir, { recursive: true, force: true });
  }
}
