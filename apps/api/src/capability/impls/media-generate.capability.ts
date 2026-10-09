import { Injectable } from '@nestjs/common';
import { MAX_IMAGE_COUNT } from '@reelcraft/shared';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  MediaSource,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult, ImageListOutput } from '../capability.interface';
import { unwrapText } from '../../common/unwrap-text';
import { ProviderRegistry } from '../../provider/provider.registry';

interface MediaConfig {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
  operation?: 'probe' | 'transcribe_align';
  /** Generate Image only: how many images one run makes (`media.image_list`). */
  count?: number;
  /** Generate Image only: what to do when fewer images come back than asked for. */
  onShortfall?: 'warn' | 'fail';
}

function isImageList(output: unknown): output is ImageListOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    Array.isArray((output as { images?: unknown }).images)
  );
}

abstract class ProviderMediaCapability implements CapabilityImpl<MediaConfig> {
  abstract readonly modality: string;
  abstract readonly outputKind: Extract<
    OutputKind,
    'media.image' | 'media.video' | 'media.audio' | 'data'
  >;
  abstract readonly label: string;
  abstract readonly description: string;
  readonly kind = 'async' as const;
  readonly configSchema: JsonSchema = { type: 'object' };
  constructor(protected readonly providers: ProviderRegistry) {}
  slots(_cfg: MediaConfig): SlotDef[] {
    return [];
  }
  allowedOutputs(_cfg: MediaConfig): OutputKind[] {
    return [this.outputKind];
  }
  prepare(ctx: ExecCtx<MediaConfig>): ExecCtx<MediaConfig> {
    const descriptions = new Set<string>();
    for (const value of Object.values(ctx.slots)) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (
          candidate &&
          typeof candidate === 'object' &&
          typeof (candidate as { characterDescription?: unknown }).characterDescription === 'string'
        ) {
          descriptions.add((candidate as { characterDescription: string }).characterDescription);
        }
      }
    }
    const identity = [...descriptions]
      .map((description) => `Character identity: ${description}`)
      .join('\n');
    return { ...ctx, renderedPrompt: [ctx.renderedPrompt, identity].filter(Boolean).join('\n') };
  }
  async estimateCost(ctx: ExecCtx<MediaConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate(this.providerRequest(ctx));
  }
  async submit(ctx: ExecCtx<MediaConfig>): Promise<JobHandle> {
    return this.providers
      .get(ctx.config.provider)
      .submit(this.providerRequest(ctx), ctx.idempotencyKey);
  }
  async poll(handle: JobHandle): Promise<JobStatus> {
    return this.providers.get(handle.providerId).poll(handle);
  }
  async fetch(handle: JobHandle, _ctx: ExecCtx<MediaConfig>): Promise<ExecResult<unknown>> {
    const result = await this.providers.get(handle.providerId).fetch(handle);
    return {
      output: result.output as MediaSource,
      costUsd: result.costUsd,
      repro: result.repro,
      ...(result.attachments && { attachments: result.attachments }),
      ...(result.timing && { timing: result.timing }),
    };
  }
  async cancel(handle: JobHandle) {
    return this.providers.get(handle.providerId).cancel(handle);
  }

  /** Request params a modality adds of its own. */
  protected extraParams(_ctx: ExecCtx<MediaConfig>): Record<string, unknown> {
    return {};
  }

  private providerRequest(ctx: ExecCtx<MediaConfig>) {
    return {
      modality: this.modality as 'image' | 'video' | 'audio' | 'media',
      modelId: ctx.config.modelId,
      params: {
        ...ctx.config.params,
        slots: ctx.slots,
        __mediaKind: this.outputKind,
        ...this.extraParams(ctx),
      },
      renderedPrompt: ctx.renderedPrompt,
      system: ctx.systemPrompt,
    };
  }
}

@Capability('image.generate')
@Injectable()
export class ImageGenerateCapability extends ProviderMediaCapability {
  readonly modality = 'image';
  readonly outputKind = 'media.image' as const;
  readonly label = 'Generate Image';
  readonly description = 'Generate one image, or several, from a prompt.';
  override readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      count: {
        type: 'integer',
        minimum: 2,
        maximum: MAX_IMAGE_COUNT,
        description: `How many images to make from the prompt, 2 to ${MAX_IMAGE_COUNT}. Only for an Images output.`,
      },
      onShortfall: {
        type: 'string',
        enum: ['warn', 'fail'],
        description:
          'If fewer images come back than asked for. Warn and continue keeps the images that came back and notes the shortfall in the stage log. Fail and retry counts the attempt as a provider error and tries again, like any other crash. Defaults to warn.',
      },
    },
  };
  constructor(providers: ProviderRegistry) {
    super(providers);
  }
  slots(): SlotDef[] {
    return [{ name: 'references', accepts: ['media.image'], required: false, cardinality: 'many' }];
  }
  override allowedOutputs(_cfg: MediaConfig): OutputKind[] {
    return ['media.image', 'media.image_list'];
  }
  validate(cfg: MediaConfig, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const count = cfg?.count;
    if (stage.output.kind === 'media.image_list') {
      if (count === undefined || !Number.isInteger(count) || count < 2 || count > MAX_IMAGE_COUNT) {
        issues.push({
          path: 'config.count',
          message: `Images needs a number of images, 2 to ${MAX_IMAGE_COUNT}`,
          severity: 'error',
        });
      }
      if (stage.iterate) {
        issues.push({
          path: 'iterate',
          message:
            'Images makes all its images in one run; it cannot iterate. Use Image for one image per item',
          severity: 'error',
        });
      }
      if (stage.writes && Object.keys(stage.writes).length > 0) {
        issues.push({
          path: 'writes',
          message:
            'an image list cannot be written to memory; bind it from the next stage with prev',
          severity: 'error',
        });
      }
    } else {
      if (count !== undefined && count !== 1) {
        issues.push({
          path: 'config.count',
          message: 'Number of images only applies to an Images output',
          severity: 'error',
        });
      }
      if (cfg?.onShortfall !== undefined) {
        issues.push({
          path: 'config.onShortfall',
          message: 'If fewer images come back only applies to an Images output',
          severity: 'error',
        });
      }
    }
    return issues;
  }
  protected override extraParams(ctx: ExecCtx<MediaConfig>): Record<string, unknown> {
    return this.requestedCount(ctx) > 1 ? { count: this.requestedCount(ctx) } : {};
  }
  override async fetch(handle: JobHandle, ctx: ExecCtx<MediaConfig>): Promise<ExecResult<unknown>> {
    const result = await super.fetch(handle, ctx);
    const requested = this.requestedCount(ctx);
    if (requested <= 1) return result;

    // A provider that can make only one image hands back a single source.
    const returned = isImageList(result.output)
      ? result.output.images
      : [result.output as MediaSource];
    if (returned.length === 0) throw new Error('The provider returned no images');
    const images = returned.slice(0, requested);
    if (images.length === requested) return { ...result, output: { images } };

    const message = `The provider returned ${images.length} of ${requested} images`;
    const shortfall = { requested, returned: images.length };
    // The call was billed either way: `fail` hands the runner the reason to
    // settle the cost and retry, instead of throwing past the ledger.
    return ctx.config.onShortfall === 'fail'
      ? { ...result, output: { images }, rejection: message, providerMeta: { shortfall } }
      : { ...result, output: { images }, providerMeta: { shortfall, warning: message } };
  }

  private requestedCount(ctx: ExecCtx<MediaConfig>): number {
    return ctx.config.count ?? 1;
  }
}

@Capability('video.generate')
@Injectable()
export class VideoGenerateCapability extends ProviderMediaCapability {
  readonly modality = 'video';
  readonly outputKind = 'media.video' as const;
  readonly label = 'Generate Video';
  readonly description = 'Generate a video clip from a prompt.';
  constructor(providers: ProviderRegistry) {
    super(providers);
  }
  slots(): SlotDef[] {
    return [
      { name: 'startFrame', accepts: ['media.image'], required: false, cardinality: 'one' },
      { name: 'endFrame', accepts: ['media.image'], required: false, cardinality: 'one' },
      { name: 'references', accepts: ['media.image'], required: false, cardinality: 'many' },
    ];
  }
}

@Capability('audio.speech')
@Injectable()
export class AudioSpeechCapability extends ProviderMediaCapability {
  readonly modality = 'audio';
  readonly outputKind = 'media.audio' as const;
  readonly label = 'Generate Speech';
  readonly description = 'Synthesize speech audio from text.';
  // It speaks its `text` slot as written: nothing here is a prompt.
  readonly noInstructions = true;
  constructor(providers: ProviderRegistry) {
    super(providers);
  }
  slots(): SlotDef[] {
    return [{ name: 'text', accepts: ['text'], required: true, cardinality: 'one' }];
  }
  // A `memory` ref to a text stage's output resolves to its `{ text }` storage wrapper.
  override prepare(ctx: ExecCtx<MediaConfig>): ExecCtx<MediaConfig> {
    return super.prepare({
      ...ctx,
      slots: { ...ctx.slots, text: unwrapText('text', ctx.slots.text) },
    });
  }
}

@Capability('media.analyze')
@Injectable()
export class MediaAnalyzeCapability extends ProviderMediaCapability {
  readonly modality = 'media';
  readonly outputKind = 'data' as const;
  readonly label = 'Analyze Media';
  readonly description = 'Probe or transcribe/align existing media.';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['transcribe_align', 'probe'],
        description:
          'Transcribe align: speech to text with word timings, using Deepgram (paid). Probe: reads the duration and streams locally (free). Defaults to Transcribe align.',
      },
    },
  };
  constructor(providers: ProviderRegistry) {
    super(providers);
  }
  slots(): SlotDef[] {
    return [
      {
        name: 'source',
        accepts: ['media.audio', 'media.video'],
        required: true,
        cardinality: 'one',
      },
    ];
  }
  async estimateCost(ctx: ExecCtx<MediaConfig>): Promise<CostEstimate> {
    if (ctx.config.operation === 'probe')
      return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' };
    return super.estimateCost(ctx);
  }
  async submit(ctx: ExecCtx<MediaConfig>): Promise<JobHandle> {
    if (ctx.config.operation === 'probe')
      return {
        providerId: 'media-local',
        externalId: ctx.idempotencyKey,
        payload: { probe: (ctx.slots.source as { probe?: unknown } | undefined)?.probe },
      };
    return super.submit(ctx);
  }
  async poll(handle: JobHandle): Promise<JobStatus> {
    if (handle.providerId === 'media-local') return { done: true, outcome: 'succeeded' };
    return super.poll(handle);
  }
  async fetch(handle: JobHandle, ctx: ExecCtx<MediaConfig>): Promise<ExecResult<unknown>> {
    if (handle.providerId === 'media-local')
      return {
        output: (handle.payload as { probe: unknown }).probe,
        costUsd: 0,
        repro: { level: 'exact' },
      };
    return super.fetch(handle, ctx);
  }
}
