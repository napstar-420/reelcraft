import path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  MotionAnswer,
  MOTION_LIMITS,
  Timeline,
  motionAnswerJsonSchema,
  type CostEstimate,
  type JobHandle,
  type JobStatus,
  type JsonSchema,
  type MotionAssetRef,
  type MotionFontRef,
  type MotionSource,
  type OutputKind,
  type SlotDef,
  type StageDef,
  type ValidationIssue,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import type { ProviderRequest } from '../../provider/provider-adapter.interface';
import { ProviderRegistry } from '../../provider/provider.registry';
import { buildCatalog } from '../compose/catalog';
import { EngineConfig } from '../../config/engine-config';
import { motionWorkspace } from '../motion/motion-kit';
import { MOTION_SYSTEM_PROMPT, motionBrief } from '../motion/motion-prompt';
import { errorEnvelopeSchema, readModelReply } from './text-generate.capability';

export interface MotionGenerateConfig {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  background?: 'transparent' | 'opaque';
  style?: string;
}

const DEFAULT_FRAME = { width: 1920, height: 1080, fps: 30 } as const;

/** What the stage's inputs settle before the model writes anything: size, frame rate, background,
 * props and the files the code may load. */
export function motionFrame(ctx: Pick<ExecCtx<MotionGenerateConfig>, 'config' | 'slots'>): {
  base: Omit<MotionSource, 'code' | 'durationSec'>;
  durationSec?: number;
} {
  const canvas = Timeline.safeParse(ctx.slots.canvas);
  const frame = canvas.success ? canvas.data.canvas : DEFAULT_FRAME;
  const props = ctx.slots.data;
  const assets: MotionAssetRef[] = [];
  const fonts: MotionFontRef[] = [];
  const fileName = (id: string, ext: string) =>
    `${
      id
        .replace(/[^A-Za-z0-9_.-]/g, '-')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, 70) || 'file'
    }${ext}`;
  if (ctx.slots.assets !== undefined) {
    const { assets: index } = buildCatalog([{ slot: 'assets', value: ctx.slots.assets }]);
    for (const asset of index.ofKind('image')) {
      if (!asset.handle) continue;
      assets.push({ name: fileName(asset.id, '.png'), handle: asset.handle });
    }
    // Fonts are not files for the code to load: it names their family, and they load first.
    for (const asset of index.ofKind('font')) {
      if (!asset.handle) continue;
      // Named without an extension: Render Motion Graphic adds the file's own when it copies it in.
      fonts.push({
        name: fileName(`font-${asset.id}`, ''),
        handle: asset.handle,
        family: asset.family ?? asset.label ?? asset.id,
      });
    }
  }
  return {
    base: {
      version: 1,
      width: ctx.config.width ?? frame.width,
      height: ctx.config.height ?? frame.height,
      fps: ctx.config.fps ?? Math.round(frame.fps),
      background: ctx.config.background ?? 'transparent',
      ...(props && typeof props === 'object' && !Array.isArray(props)
        ? { props: props as Record<string, unknown> }
        : {}),
      ...(assets.length ? { assets: assets.slice(0, MOTION_LIMITS.maxAssets) } : {}),
      ...(fonts.length ? { fonts: fonts.slice(0, MOTION_LIMITS.maxFonts) } : {}),
    },
    ...(ctx.config.durationSec !== undefined && { durationSec: ctx.config.durationSec }),
  };
}

/**
 * Has a model write a motion graphic as Remotion code: an animated title, chart, diagram, lower
 * third, counter, transition or anything else the prompt asks for. Any text model can write it;
 * Codex and Claude also get a workspace where they can render stills of their own work and look
 * at them before answering. Render Motion Graphic turns the result into a clip.
 */
@Capability('motion.generate')
@Injectable()
export class MotionGenerateCapability implements CapabilityImpl<MotionGenerateConfig> {
  readonly modality = 'text' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Generate Motion Graphic';
  readonly description =
    'Have a model write a motion graphic (Remotion code) for anything a video needs: titles, charts, diagrams, lower thirds, transitions.';
  readonly lockedSystemPrompt = MOTION_SYSTEM_PROMPT;
  readonly requiresTemplate = true;
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      durationSec: {
        type: 'number',
        minimum: MOTION_LIMITS.minSec,
        maximum: MOTION_LIMITS.maxSec,
        description: 'How long the graphic runs; unset lets the model choose',
      },
      width: {
        type: 'integer',
        minimum: 16,
        maximum: MOTION_LIMITS.maxSide,
        description: 'Default: the canvas, else 1920',
      },
      height: {
        type: 'integer',
        minimum: 16,
        maximum: MOTION_LIMITS.maxSide,
        description: 'Default: the canvas, else 1080',
      },
      fps: {
        type: 'integer',
        minimum: 1,
        maximum: 60,
        description: 'Default: the canvas, else 30',
      },
      background: {
        type: 'string',
        enum: ['transparent', 'opaque'],
        description: 'transparent (default) lays the graphic over other video',
      },
      style: { type: 'string', description: 'Look and feel: colours, fonts, mood' },
    },
  };

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly engine: EngineConfig,
  ) {}

  slots(): SlotDef[] {
    return [
      { name: 'data', accepts: [{ type: 'object' }], required: false, cardinality: 'one' },
      {
        name: 'assets',
        accepts: ['media.image', 'media.image_list', { type: 'object' }],
        required: false,
        cardinality: 'many',
      },
      { name: 'canvas', accepts: ['timeline'], required: false, cardinality: 'one' },
    ];
  }

  allowedOutputs(): OutputKind[] {
    return ['data'];
  }

  validate(_config: MotionGenerateConfig, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (stage.output.kind !== 'data') {
      issues.push({
        path: 'output.kind',
        message: 'Generate Motion Graphic produces data (the code and its settings)',
        severity: 'error',
      });
    }
    if (!stage.checks?.some((c) => c.type === 'builtin' && 'key' in c && c.key === 'motion_code')) {
      issues.push({
        path: 'checks',
        message:
          'Add the motion_code check so code that breaks the rules is sent back to the model to fix',
        severity: 'warning',
      });
    }
    return issues;
  }

  private request(ctx: ExecCtx<MotionGenerateConfig>): ProviderRequest {
    const { base, durationSec } = motionFrame(ctx);
    const files = (base.assets ?? []).map((a) => a.name);
    const fonts = (base.fonts ?? []).map((font) => font.family);
    const brief = motionBrief({
      source: base,
      durationSec,
      props: base.props,
      files,
      fonts,
      style: ctx.config.style,
    });
    // Agents that work with files (Codex, Claude) can check and test-render the code before
    // answering. Other providers ignore these.
    const workspace = motionWorkspace({
      frame: base,
      durationSec,
      props: base.props,
      files,
      fonts,
      checker: path.resolve(__dirname, '../motion/motion-code-check.js'),
      worker: path.resolve(__dirname, '../../../../render-worker/dist/cli.js'),
      browser: this.engine.remotionBrowserExecutable,
    });
    return {
      modality: 'text',
      modelId: ctx.config.modelId,
      params: {
        ...(ctx.config.params ?? {}),
        __workspace: { files: workspace.files },
        __allowedCommands: workspace.commands,
        __workspaceInstructions: workspace.instructions,
      },
      renderedPrompt: `${ctx.renderedPrompt ?? ''}\n\n${brief}`.trim(),
      system: MOTION_SYSTEM_PROMPT,
      output: {
        kind: 'data',
        schema: errorEnvelopeSchema(motionAnswerJsonSchema),
      },
    };
  }

  async estimateCost(ctx: ExecCtx<MotionGenerateConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate(this.request(ctx));
  }

  async submit(ctx: ExecCtx<MotionGenerateConfig>): Promise<JobHandle> {
    return this.providers.get(ctx.config.provider).submit(this.request(ctx), ctx.idempotencyKey);
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    return this.providers.get(handle.providerId).poll(handle);
  }

  async fetch(handle: JobHandle, ctx: ExecCtx<MotionGenerateConfig>): Promise<ExecResult> {
    const result = await this.providers.get(handle.providerId).fetch(handle);
    const reply = readModelReply(result.output, 'data');
    const base = { costUsd: result.costUsd, repro: result.repro };
    if (reply.modelError) return { ...base, output: reply.output, modelError: reply.modelError };
    const answer = MotionAnswer.safeParse(reply.output);
    if (!answer.success) {
      return {
        ...base,
        output: reply.output,
        rejection: `The model's answer is not a motion graphic: ${answer.error.issues[0]?.message ?? ''}`,
      };
    }
    const { base: frame, durationSec } = motionFrame(ctx);
    const source: MotionSource = {
      ...frame,
      code: answer.data.code,
      durationSec: durationSec ?? answer.data.durationSec ?? 5,
      ...(answer.data.notes && { notes: answer.data.notes }),
    };
    return { ...base, output: source };
  }

  async cancel(handle: JobHandle) {
    return this.providers.get(handle.providerId).cancel(handle);
  }
}
