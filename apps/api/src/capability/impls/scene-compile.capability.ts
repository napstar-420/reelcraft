import { Injectable } from '@nestjs/common';
import { ModelErrorCode, SceneSpec, TimingMap, VectorAssetSet } from '@reelcraft/shared';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
  VectorAsset,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { WhiteboardAssetRegistry } from '../whiteboard/asset.registry';
import { compileScenes, SceneCompileError, type CompileWarning } from '../whiteboard/scene-compile';
import {
  WHITEBOARD_THEME_IDS,
  WHITEBOARD_THEMES,
  type WhiteboardThemeId,
} from '../whiteboard/themes';

interface SceneCompileConfig {
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p';
  fps?: number;
  theme?: WhiteboardThemeId;
  hand?: 'none' | 'marker' | 'pencil';
  captions?: boolean;
  captionStyle?: string;
}

type Payload =
  | { timeline: unknown; warnings: CompileWarning[]; scenes: unknown }
  | { error: { code: string; message: string } };

const ASPECTS = ['16:9', '9:16'] as const;
const RESOLUTIONS = ['720p', '1080p'] as const;
const HANDS = ['none', 'marker', 'pencil'] as const;

/** A media slot's value: its manifest, or the first of a list of them. */
const one = (value: unknown): Record<string, unknown> | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
};

/**
 * Puts a hand-drawn video together from a plan: where each drawing goes, when it is drawn (by the
 * words in the voice-over), and how the camera moves between scenes. It makes no choices a model
 * could get wrong: layouts come from templates, times from the voice-over. Free and instant.
 */
@Capability('scene.compile')
@Injectable()
export class SceneCompileCapability implements CapabilityImpl<SceneCompileConfig> {
  readonly modality = 'compute' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Compile Scenes';
  readonly description =
    'Turn a scene plan into a hand-drawn video timeline: layouts from templates, drawings timed to the voice-over, and a camera moving between scenes.';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      aspectRatio: {
        type: 'string',
        enum: [...ASPECTS],
        description: 'Frame shape; defaults to the channel format, then 16:9',
      },
      resolution: {
        type: 'string',
        enum: [...RESOLUTIONS],
        description: 'Frame size; default 1080p',
      },
      fps: {
        type: 'integer',
        minimum: 12,
        maximum: 60,
        description: 'Frames per second; default 30',
      },
      theme: {
        type: 'string',
        enum: WHITEBOARD_THEME_IDS,
        description: 'Paper, ink and colours; default whiteboard',
      },
      hand: {
        type: 'string',
        enum: [...HANDS],
        description: 'A pen or marker that follows the line as it is drawn; default marker',
      },
      captions: {
        type: 'boolean',
        description: 'Show the voice-over as captions (needs word timings)',
      },
      captionStyle: { type: 'string', description: 'A caption template id; default caption.clean' },
    },
  };

  constructor(private readonly registry: WhiteboardAssetRegistry) {}

  slots(): SlotDef[] {
    return [
      { name: 'scenes', accepts: [{ type: 'object' }], required: true, cardinality: 'one' },
      { name: 'voice', accepts: ['media.audio'], required: false, cardinality: 'one' },
      { name: 'timing', accepts: [{ type: 'object' }], required: false, cardinality: 'one' },
      { name: 'assets', accepts: [{ type: 'object' }], required: false, cardinality: 'one' },
    ];
  }

  allowedOutputs(): OutputKind[] {
    return ['timeline'];
  }

  validate(config: SceneCompileConfig, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (stage.output.kind !== 'timeline') {
      issues.push({
        path: 'output.kind',
        message: 'Compile Scenes produces a timeline',
        severity: 'error',
      });
    }
    if (stage.iterate) {
      issues.push({
        path: 'iterate',
        message: 'Compile Scenes puts the whole video together at once; it cannot iterate',
        severity: 'error',
      });
    }
    if (config.captions && !stage.slots.timing && !stage.slots.voice) {
      issues.push({
        path: 'config.captions',
        message:
          'captions need the voice-over bound to the voice slot, or its word timings to the timing slot',
        severity: 'error',
      });
    }
    return issues;
  }

  async estimateCost(): Promise<CostEstimate> {
    return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' };
  }

  async submit(ctx: ExecCtx<SceneCompileConfig>): Promise<JobHandle> {
    return {
      providerId: 'local-sync',
      externalId: ctx.idempotencyKey,
      payload: this.compile(ctx) satisfies Payload,
    };
  }

  async poll(): Promise<JobStatus> {
    return { done: true, outcome: 'succeeded' };
  }

  async fetch(handle: JobHandle, ctx: ExecCtx<SceneCompileConfig>): Promise<ExecResult> {
    const payload = handle.payload as Payload;
    const base = { costUsd: 0, repro: { level: 'exact' as const } };
    if ('error' in payload) {
      const code = ModelErrorCode.safeParse(payload.error.code);
      return {
        output: {},
        ...base,
        modelError: {
          code: code.success ? code.data : 'input_mismatch',
          message: payload.error.message,
        },
      };
    }
    for (const warning of payload.warnings) ctx.logger.log(`scene.compile: ${warning.message}`);
    return {
      output: payload.timeline,
      ...base,
      providerMeta: { warnings: payload.warnings, scenes: payload.scenes },
    };
  }

  private compile(ctx: ExecCtx<SceneCompileConfig>): Payload {
    const { config } = ctx;
    const fail = (message: string, code = 'input_mismatch'): Payload => ({
      error: { code, message },
    });

    const spec = SceneSpec.safeParse(ctx.slots.scenes);
    if (!spec.success) {
      const issue = spec.error.issues[0];
      return fail(
        `the scene plan is not valid: ${issue?.path.join('.') || 'plan'}: ${issue?.message}`,
      );
    }

    const voice = one(ctx.slots.voice);
    const timingValue = one(ctx.slots.timing);
    const timing = timingValue ? TimingMap.safeParse(timingValue) : undefined;
    if (timing && !timing.success)
      return fail('the timing slot is not word timings (a transcript with words and sentences)');
    const assetSet =
      ctx.slots.assets === undefined ? undefined : VectorAssetSet.safeParse(ctx.slots.assets);
    if (assetSet && !assetSet.success) {
      return fail(
        `the assets slot is not a set of drawings: ${assetSet.error.issues[0]?.path.join('.')}: ${assetSet.error.issues[0]?.message}`,
      );
    }
    const assets = new Map<string, VectorAsset>(
      (assetSet?.data.assets ?? []).map((asset) => [asset.id, asset]),
    );

    const portrait = (config.aspectRatio ?? ctx.layer?.format?.aspectRatio) === '9:16';
    const [long, short] = config.resolution === '720p' ? [1280, 720] : [1920, 1080];
    const canvas = {
      width: portrait ? short : long,
      height: portrait ? long : short,
      fps: config.fps ?? ctx.layer?.format?.fps ?? 30,
    };

    const voiceHandle = typeof voice?.handle === 'string' ? voice.handle : undefined;
    const voiceDuration = typeof voice?.durationSec === 'number' ? voice.durationSec : undefined;
    // Captions are named by the handle of whatever carries the word timings.
    const timingHandle =
      typeof timingValue?.handle === 'string'
        ? timingValue.handle
        : voice?.hasWordTiming === true
          ? voiceHandle
          : undefined;
    const warnings: CompileWarning[] = [];
    if (voice?.hasWordTiming === true && !timing?.success) {
      warnings.push({
        code: 'timing_missing',
        message:
          'the voice-over has word timings but they are not bound to the timing slot, so scenes are timed by how long they take to read',
      });
    }
    let captions: { handle: string; styleId: string } | undefined;
    if (config.captions) {
      if (timingHandle)
        captions = { handle: timingHandle, styleId: config.captionStyle ?? 'caption.clean' };
      else {
        warnings.push({
          code: 'captions_skipped',
          message: 'captions were asked for but there are no word timings to follow',
        });
      }
    }

    try {
      const result = compileScenes({
        spec: spec.data,
        canvas,
        theme: WHITEBOARD_THEMES[config.theme ?? 'whiteboard'],
        timing: timing?.success ? timing.data : undefined,
        voice: voiceHandle ? { handle: voiceHandle, durationSec: voiceDuration } : undefined,
        captions,
        assets,
        registry: this.registry,
        hand: config.hand ?? 'marker',
      });
      return {
        timeline: result.timeline,
        warnings: [...warnings, ...result.warnings],
        scenes: result.scenes,
      };
    } catch (error) {
      if (error instanceof SceneCompileError) return fail(error.message, 'task_impossible');
      throw error;
    }
  }
}
