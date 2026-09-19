import { Injectable } from '@nestjs/common';
import type { CostEstimate, JobHandle, JobStatus, JsonSchema, MediaSource, OutputKind, SlotDef } from '@reefcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { ProviderRegistry } from '../../provider/provider.registry';

interface MediaConfig { provider: string; modelId: string; params?: Record<string, unknown>; operation?: 'probe' | 'transcribe_align' }

abstract class ProviderMediaCapability implements CapabilityImpl<MediaConfig> {
  abstract readonly modality: string;
  abstract readonly outputKind: Extract<OutputKind, 'media.image' | 'media.video' | 'media.audio' | 'data'>;
  readonly kind = 'async' as const;
  readonly configSchema: JsonSchema = { type: 'object' };
  constructor(protected readonly providers: ProviderRegistry) {}
  slots(_cfg: MediaConfig): SlotDef[] { return []; }
  allowedOutputs(_cfg: MediaConfig): OutputKind[] { return [this.outputKind]; }
  async estimateCost(ctx: ExecCtx<MediaConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate({ modelId: ctx.config.modelId, params: { ...ctx.config.params, slots: ctx.slots, __mediaKind: this.outputKind }, renderedPrompt: ctx.renderedPrompt });
  }
  async submit(ctx: ExecCtx<MediaConfig>): Promise<JobHandle> {
    return this.providers.get(ctx.config.provider).submit({ modelId: ctx.config.modelId, params: { ...ctx.config.params, slots: ctx.slots, __mediaKind: this.outputKind }, renderedPrompt: ctx.renderedPrompt }, ctx.idempotencyKey);
  }
  async poll(handle: JobHandle): Promise<JobStatus> { return this.providers.get(handle.providerId).poll(handle); }
  async fetch(handle: JobHandle, _ctx: ExecCtx<MediaConfig>): Promise<ExecResult<unknown>> {
    const result = await this.providers.get(handle.providerId).fetch(handle);
    return { output: result.output as MediaSource, costUsd: result.costUsd, repro: result.repro };
  }
  async cancel(handle: JobHandle) { return this.providers.get(handle.providerId).cancel(handle); }
}

@Capability('image.generate')
@Injectable()
export class ImageGenerateCapability extends ProviderMediaCapability {
  readonly modality = 'image'; readonly outputKind = 'media.image' as const;
  slots(): SlotDef[] { return [{ name: 'references', accepts: ['media.image'], required: false, cardinality: 'many' }]; }
}

@Capability('video.generate')
@Injectable()
export class VideoGenerateCapability extends ProviderMediaCapability {
  readonly modality = 'video'; readonly outputKind = 'media.video' as const;
  slots(): SlotDef[] { return [
    { name: 'startFrame', accepts: ['media.image'], required: false, cardinality: 'one' },
    { name: 'endFrame', accepts: ['media.image'], required: false, cardinality: 'one' },
    { name: 'references', accepts: ['media.image'], required: false, cardinality: 'many' },
  ]; }
}

@Capability('audio.speech')
@Injectable()
export class AudioSpeechCapability extends ProviderMediaCapability {
  readonly modality = 'audio'; readonly outputKind = 'media.audio' as const;
  slots(): SlotDef[] { return [{ name: 'text', accepts: ['text'], required: true, cardinality: 'one' }]; }
}

@Capability('media.analyze')
@Injectable()
export class MediaAnalyzeCapability extends ProviderMediaCapability {
  readonly modality = 'media'; readonly outputKind = 'data' as const;
  slots(): SlotDef[] { return [{ name: 'source', accepts: ['media.audio', 'media.video'], required: true, cardinality: 'one' }]; }
  async estimateCost(ctx: ExecCtx<MediaConfig>): Promise<CostEstimate> {
    if (ctx.config.operation === 'probe') return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' };
    return super.estimateCost(ctx);
  }
  async submit(ctx: ExecCtx<MediaConfig>): Promise<JobHandle> {
    if (ctx.config.operation === 'probe') return { providerId: 'media-local', externalId: ctx.idempotencyKey, payload: { probe: (ctx.slots.source as { probe?: unknown } | undefined)?.probe } };
    return super.submit(ctx);
  }
  async poll(handle: JobHandle): Promise<JobStatus> {
    if (handle.providerId === 'media-local') return { done: true, outcome: 'succeeded' };
    return super.poll(handle);
  }
  async fetch(handle: JobHandle, ctx: ExecCtx<MediaConfig>): Promise<ExecResult<unknown>> {
    if (handle.providerId === 'media-local') return { output: (handle.payload as { probe: unknown }).probe, costUsd: 0, repro: { level: 'exact' } };
    return super.fetch(handle, ctx);
  }
}
