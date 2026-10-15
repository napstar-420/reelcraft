import { Injectable } from '@nestjs/common';
import { ModelErrorCode, PlanTheme, TimelinePlan, TimingMap } from '@reelcraft/shared';
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
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { buildCatalog, GENERAL_ASSET_SLOT } from '../compose/catalog';
import { composeTimeline, ComposeError, type ComposeWarning } from '../compose/compose-timeline';

interface ComposeConfig {
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p';
  fps?: number;
  hand?: 'none' | 'marker' | 'pencil';
  theme?: Record<string, unknown>;
  /** Names of more slots that bring assets in (`voice`, `music`, `photos`); a file takes its slot's name. */
  inputs?: string[];
}

type Payload =
  | { timeline: unknown; warnings: ComposeWarning[]; layers: unknown }
  | { error: { code: string; message: string } };

const ASPECTS = ['16:9', '9:16'] as const;
const RESOLUTIONS = ['720p', '1080p'] as const;
const HANDS = ['none', 'marker', 'pencil'] as const;

/** A slot value that is one object, or the first of a list. */
const one = (value: unknown): Record<string, unknown> | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
};

/**
 * Puts a video together from a plan of layers: it places pictures, clips, sounds, drawings, words
 * and captions at the times and places the plan gives, and moves the camera. It makes no creative
 * choices: where things go and when is the plan's (written by a model or a person). Free and
 * instant, so a plan that doesn't hold up fails fast with every problem listed.
 */
@Capability('timeline.compose')
@Injectable()
export class TimelineComposeCapability implements CapabilityImpl<ComposeConfig> {
  readonly modality = 'compute' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Compose Timeline';
  readonly description =
    'Place pictures, clips, sounds, drawings, words and captions on a timeline from a plan: where each goes and when it appears.';
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
      hand: {
        type: 'string',
        enum: [...HANDS],
        description: 'A pen or marker that follows lines as they are drawn; default none',
      },
      inputs: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string' },
        description:
          'Names of extra asset inputs, such as "voice", "music" or "photos". A file bound to one is called by its name in the plan (several: photos-1, photos-2)',
      },
      theme: {
        type: 'object',
        description: "Colours and fonts for drawn lines and words, under the plan's own theme",
        properties: {
          paper: { type: 'string' },
          ink: { type: 'string' },
          highlight: { type: 'string' },
          accents: { type: 'array', items: { type: 'string' } },
          fontHand: { type: 'string' },
          fontBody: { type: 'string' },
          strokeWidth: { type: 'number' },
          roughness: { type: 'number' },
          paperTexture: { type: 'string', enum: ['none', 'paper', 'grid'] },
        },
      },
    },
  };

  slots(config?: ComposeConfig): SlotDef[] {
    const assetKinds: SlotDef['accepts'] = [
      'media.image',
      'media.video',
      'media.audio',
      'media.image_list',
      'media.video_list',
      { type: 'object' },
    ];
    return [
      { name: 'plan', accepts: [{ type: 'object' }], required: true, cardinality: 'one' },
      { name: GENERAL_ASSET_SLOT, accepts: assetKinds, required: false, cardinality: 'many' },
      ...(config?.inputs ?? []).map((name) => ({
        name,
        accepts: assetKinds,
        required: false,
        cardinality: 'many' as const,
      })),
      { name: 'timing', accepts: [{ type: 'object' }], required: false, cardinality: 'one' },
    ];
  }

  allowedOutputs(): OutputKind[] {
    return ['timeline'];
  }

  validate(config: ComposeConfig, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (stage.output.kind !== 'timeline') {
      issues.push({
        path: 'output.kind',
        message: 'Compose Timeline produces a timeline',
        severity: 'error',
      });
    }
    if (stage.iterate) {
      issues.push({
        path: 'iterate',
        message: 'Compose Timeline puts the whole video together at once; it cannot iterate',
        severity: 'error',
      });
    }
    for (const name of config.inputs ?? []) {
      if (
        !/^[a-z][a-z0-9_-]{0,23}$/.test(name) ||
        ['plan', 'timing', GENERAL_ASSET_SLOT].includes(name)
      ) {
        issues.push({
          path: 'config.inputs',
          message: `"${name}" can't be an input name: use lowercase words joined by "-" or "_", not plan, timing or assets`,
          severity: 'error',
        });
      }
    }
    if (config.theme && !PlanTheme.safeParse(config.theme).success) {
      issues.push({ path: 'config.theme', message: 'the theme is not valid', severity: 'error' });
    }
    return issues;
  }

  async estimateCost(): Promise<CostEstimate> {
    return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' };
  }

  async submit(ctx: ExecCtx<ComposeConfig>): Promise<JobHandle> {
    return {
      providerId: 'local-sync',
      externalId: ctx.idempotencyKey,
      payload: this.compose(ctx) satisfies Payload,
    };
  }

  async poll(): Promise<JobStatus> {
    return { done: true, outcome: 'succeeded' };
  }

  async fetch(handle: JobHandle, ctx: ExecCtx<ComposeConfig>): Promise<ExecResult> {
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
    for (const warning of payload.warnings) ctx.logger.log(`timeline.compose: ${warning.message}`);
    return {
      output: payload.timeline,
      ...base,
      providerMeta: { warnings: payload.warnings, layers: payload.layers },
    };
  }

  private compose(ctx: ExecCtx<ComposeConfig>): Payload {
    const { config } = ctx;
    const fail = (message: string, code = 'input_mismatch'): Payload => ({
      error: { code, message },
    });

    const plan = TimelinePlan.safeParse(ctx.slots.plan);
    if (!plan.success) {
      const issue = plan.error.issues[0];
      return fail(`the plan is not valid: ${issue?.path.join('.') || 'plan'}: ${issue?.message}`);
    }
    const timingValue = one(ctx.slots.timing);
    const timing = timingValue ? TimingMap.safeParse(timingValue) : undefined;
    if (timing && !timing.success) {
      return fail('the timing slot is not word timings (a transcript with words and sentences)');
    }
    const sources = [GENERAL_ASSET_SLOT, ...(config.inputs ?? [])]
      .map((slot) => ({ slot, value: ctx.slots[slot] }))
      .filter((input) => input.value !== undefined);
    const { assets, problems } = buildCatalog(sources);
    if (problems.length) return fail(problems.join('; '));

    const portrait = (config.aspectRatio ?? ctx.layer?.format?.aspectRatio) === '9:16';
    const [long, short] = config.resolution === '720p' ? [1280, 720] : [1920, 1080];
    const canvas = {
      width: portrait ? short : long,
      height: portrait ? long : short,
      fps: config.fps ?? ctx.layer?.format?.fps ?? 30,
    };
    const theme = config.theme ? PlanTheme.safeParse(config.theme) : undefined;
    try {
      const result = composeTimeline({
        plan: plan.data,
        canvas,
        theme: theme?.success ? theme.data : undefined,
        assets,
        timing: timing?.success ? timing.data : undefined,
        timingHandle: typeof timingValue?.handle === 'string' ? timingValue.handle : undefined,
        hand: config.hand,
      });
      return { timeline: result.timeline, warnings: result.warnings, layers: result.layers };
    } catch (error) {
      if (error instanceof ComposeError) return fail(error.message, 'task_impossible');
      throw error;
    }
  }
}
