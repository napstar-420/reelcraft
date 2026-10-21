import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { MotionSource, motionFiles } from '@reelcraft/shared';
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
import { checkMotionCode, describeMotionIssues } from '../motion/motion-code-check';
import { LocalComputeCapability } from './assembly.capability';

type MotionRenderConfig = { maxWaitSec?: number };

const SOURCE_FILE = 'source.json';

/** The file a motion graphic renders to: a WebM with an alpha channel when it is transparent. */
export function motionOutputFile(source: Pick<MotionSource, 'background'>): {
  filename: string;
  mime: string;
} {
  return source.background === 'transparent'
    ? { filename: 'motion.webm', mime: 'video/webm' }
    : { filename: 'motion.mp4', mime: 'video/mp4' };
}

/** The job that renders a motion graphic with the render worker: the source, and the files its
 * code loads copied in under their own names. */
export function motionRenderSpec(p: {
  source: MotionSource;
  resources: Record<string, { sourceKey?: string }>;
  maxWaitSec: number;
  browserExecutable?: string | undefined;
  stills?: boolean;
}): ComputeSpec {
  const inputs: Array<{ sourceKey: string; asFilename: string }> = [];
  const missing: string[] = [];
  for (const asset of p.source.assets ?? []) {
    const sourceKey = p.resources[asset.handle]?.sourceKey;
    if (sourceKey) inputs.push({ sourceKey, asFilename: asset.name });
    else missing.push(asset.name);
  }
  // A font is copied in with its file's own extension, so the browser can tell what it is.
  const fonts = (p.source.fonts ?? []).flatMap((font) => {
    const sourceKey = p.resources[font.handle]?.sourceKey;
    if (!sourceKey) {
      missing.push(`${font.name} (the font ${font.family})`);
      return [];
    }
    const ext = path.extname(sourceKey).toLowerCase();
    const name = ext && !font.name.toLowerCase().endsWith(ext) ? `${font.name}${ext}` : font.name;
    inputs.push({ sourceKey, asFilename: name });
    return [{ ...font, name }];
  });
  if (missing.length) {
    throw new Error(`motion.render cannot find the file(s) ${missing.join(', ')}`);
  }
  const source = fonts.length ? { ...p.source, fonts } : p.source;
  const worker = path.resolve(__dirname, '../../../../render-worker/dist/cli.js');
  return {
    command: process.execPath,
    args: [
      worker,
      'motion',
      `{input:${SOURCE_FILE}}`,
      '{output}',
      ...(p.browserExecutable ? [p.browserExecutable] : []),
      ...(p.stills ? ['--stills'] : []),
    ],
    inputs,
    files: [{ asFilename: SOURCE_FILE, contents: JSON.stringify(source) }],
    outputFilename: motionOutputFile(p.source).filename,
    maxWaitSec: p.maxWaitSec,
  };
}

/**
 * Renders a motion graphic (one Remotion component and its size, length and data) into a video
 * clip to place on a timeline. Transparent graphics become a WebM with an alpha channel. Runs the
 * render worker locally: free.
 */
@Capability('motion.render')
@Injectable()
export class MotionRenderCapability extends LocalComputeCapability<MotionRenderConfig> {
  readonly modality = 'compute' as const;
  readonly label = 'Render Motion Graphic';
  readonly description =
    'Render a motion graphic (Remotion code) into a video clip, transparent or not, to place on a timeline.';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      maxWaitSec: { type: 'number', minimum: 1, description: 'How long to wait; default 900' },
    },
  };

  constructor(
    compute: ComputeJobService,
    private readonly config: EngineConfig,
  ) {
    super(compute);
  }

  slots(): SlotDef[] {
    return [{ name: 'source', accepts: ['data'], required: true, cardinality: 'one' }];
  }

  allowedOutputs(): OutputKind[] {
    return ['media.video'];
  }

  /** The files the graphic loads, so the stage runner finds them in storage. */
  resourceHandles(slots: Record<string, unknown>): string[] {
    const source = MotionSource.safeParse(slots.source);
    return source.success ? motionFiles(source.data).map((file) => file.handle) : [];
  }

  validate(_config: MotionRenderConfig, stage: StageDef): ValidationIssue[] {
    return stage.output.kind === 'media.video'
      ? []
      : [
          {
            path: 'output.kind',
            message: 'Render Motion Graphic produces a video',
            severity: 'error',
          },
        ];
  }

  async submit(ctx: ExecCtx<MotionRenderConfig>): Promise<JobHandle> {
    const parsed = MotionSource.safeParse(ctx.slots.source);
    if (!parsed.success) {
      throw new Error(
        `motion.render: the source is not a motion graphic: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const issues = checkMotionCode(parsed.data.code);
    if (issues.length) {
      throw new Error(
        `motion.render: the code can't be rendered:\n${describeMotionIssues(issues)}`,
      );
    }
    const handle = await this.compute.spawn(
      ctx.idempotencyKey,
      motionRenderSpec({
        source: parsed.data,
        resources: ctx.resources ?? {},
        maxWaitSec: ctx.config.maxWaitSec ?? 900,
        browserExecutable: this.config.remotionBrowserExecutable,
      }),
    );
    return this.jobHandle(handle);
  }

  async fetch(
    handle: JobHandle,
    ctx: ExecCtx<MotionRenderConfig>,
  ): Promise<ExecResult<MediaSource>> {
    const source = MotionSource.parse(ctx.slots.source);
    const file = motionOutputFile(source);
    return {
      output: {
        kind: 'media.video',
        localPath: await this.compute.collect(handle.payload as ComputeHandle),
        ...file,
      },
      costUsd: 0,
      repro: { level: 'exact', providerVersion: 'remotion-4.0.526' },
    };
  }
}
