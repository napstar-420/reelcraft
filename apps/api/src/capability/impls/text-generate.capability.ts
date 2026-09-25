import { Injectable } from '@nestjs/common';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SlotDef,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { ProviderRegistry } from '../../provider/provider.registry';

export interface TextGenerateConfig {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
}

/**
 * §7.3 — text modality, sync. Phase 1 supports `output.kind: 'text'` on the
 * happy path; `data` output is accepted but its implicit Ajv check (§4.2)
 * arrives in phase 2.
 */
@Capability('text.generate')
@Injectable()
export class TextGenerateCapability implements CapabilityImpl<TextGenerateConfig> {
  readonly modality = 'text' as const;
  readonly kind = 'sync' as const;
  readonly label = 'Generate Text';
  readonly description = 'Generate text with an LLM from a prompt.';
  // Permissive by design: the provider/modelId pin lives on the resolved
  // model layer (§5), not StageDef.config — see the interface doc comment.
  readonly configSchema: JsonSchema = { type: 'object' };

  constructor(private readonly providers: ProviderRegistry) {}

  // Functions of config per §7.1, even where phase 1's answer is constant —
  // the signature must not change when vision/context slots are added later.
  slots(_cfg: TextGenerateConfig): SlotDef[] {
    return [];
  }

  allowedOutputs(_cfg: TextGenerateConfig): OutputKind[] {
    return ['text', 'data', 'timeline'];
  }

  async estimateCost(ctx: ExecCtx<TextGenerateConfig>): Promise<CostEstimate> {
    const adapter = this.providers.get(ctx.config.provider);
    return adapter.estimate({
      modality: 'text',
      modelId: ctx.config.modelId,
      params: ctx.config.params ?? {},
      renderedPrompt: ctx.renderedPrompt,
      system: ctx.systemPrompt,
      output: ctx.output,
    });
  }

  async submit(ctx: ExecCtx<TextGenerateConfig>): Promise<JobHandle> {
    const adapter = this.providers.get(ctx.config.provider);
    return adapter.submit(
      {
        modality: 'text',
        modelId: ctx.config.modelId,
        params: ctx.config.params ?? {},
        renderedPrompt: ctx.renderedPrompt,
        system: ctx.systemPrompt,
        output: ctx.output,
      },
      ctx.idempotencyKey,
    );
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    const adapter = this.providers.get(handle.providerId);
    return adapter.poll(handle);
  }

  async fetch(handle: JobHandle, _ctx: ExecCtx<TextGenerateConfig>): Promise<ExecResult> {
    const adapter = this.providers.get(handle.providerId);
    const result = await adapter.fetch(handle);
    return {
      output: result.output,
      costUsd: result.costUsd,
      repro: result.repro,
    };
  }

  async cancel(handle: JobHandle) {
    const adapter = this.providers.get(handle.providerId);
    return adapter.cancel(handle);
  }
}
