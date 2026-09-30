import { Injectable } from '@nestjs/common';
import {
  ModelErrorCode,
  ModelErrorReply,
  type CostEstimate,
  type JobHandle,
  type JobStatus,
  type JsonSchema,
  type ModelError,
  type OutputKind,
  type SlotDef,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import type { ProviderRequest } from '../../provider/provider-adapter.interface';
import { ProviderRegistry } from '../../provider/provider.registry';

/** Strict structured output can't emit the text-style error reply, so data
 * stages get this envelope instead (the `<error_reporting>` data variant).
 * Flat, no nullables: the shared JSON Schema dialect has no unions. */
export function errorEnvelopeSchema(schema: JsonSchema): JsonSchema {
  return {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', ...ModelErrorCode.options] },
      message: { type: 'string' },
      result: schema,
    },
    required: ['status', 'message', 'result'],
  };
}

function parseTextReply(text: string): unknown {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!body.startsWith('{') || !body.endsWith('}')) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Unwraps the data envelope and detects a structured error reply. A reply
 * that isn't one passes through untouched, so ordinary outputs mentioning
 * "error" are never flagged. */
export function readModelReply(
  output: unknown,
  outputKind: OutputKind | undefined,
): { output: unknown; modelError?: ModelError } {
  if (outputKind === 'data') {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return { output };
    const envelope = output as Record<string, unknown>;
    if (!('status' in envelope) || !('result' in envelope)) return { output };
    if (envelope.status === 'ok') return { output: envelope.result };
    const code = ModelErrorCode.safeParse(envelope.status);
    if (!code.success) return { output };
    const message =
      typeof envelope.message === 'string' && envelope.message.trim()
        ? envelope.message.trim()
        : 'The model gave no details.';
    return { output, modelError: { code: code.data, message } };
  }
  const candidate = typeof output === 'string' ? parseTextReply(output) : output;
  const reply = ModelErrorReply.safeParse(candidate);
  return reply.success ? { output, modelError: reply.data.reelcraft_error } : { output };
}

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

  // Files reach the model through Context bindings (see `request`), not slots.
  slots(_cfg: TextGenerateConfig): SlotDef[] {
    return [];
  }

  allowedOutputs(_cfg: TextGenerateConfig): OutputKind[] {
    return ['text', 'data', 'timeline'];
  }

  private request(ctx: ExecCtx<TextGenerateConfig>): ProviderRequest {
    const files = ctx.files ?? [];
    const params = ctx.config.params ?? {};
    return {
      modality: 'text',
      modelId: ctx.config.modelId,
      params: files.length > 0 ? { ...params, slots: { files } } : params,
      renderedPrompt: ctx.renderedPrompt,
      system: ctx.systemPrompt,
      output:
        ctx.output?.kind === 'data'
          ? { ...ctx.output, schema: errorEnvelopeSchema(ctx.output.schema) }
          : ctx.output,
    };
  }

  async estimateCost(ctx: ExecCtx<TextGenerateConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate(this.request(ctx));
  }

  async submit(ctx: ExecCtx<TextGenerateConfig>): Promise<JobHandle> {
    return this.providers.get(ctx.config.provider).submit(this.request(ctx), ctx.idempotencyKey);
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    const adapter = this.providers.get(handle.providerId);
    return adapter.poll(handle);
  }

  async fetch(handle: JobHandle, ctx: ExecCtx<TextGenerateConfig>): Promise<ExecResult> {
    const adapter = this.providers.get(handle.providerId);
    const result = await adapter.fetch(handle);
    const { output, modelError } = readModelReply(result.output, ctx.output?.kind);
    const raw = result.rawResponse;
    // OpenRouter's body repeats the output under `choices`; keep the rest.
    const providerMeta =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'choices'))
        : undefined;
    return {
      output,
      costUsd: result.costUsd,
      repro: result.repro,
      ...(providerMeta && { providerMeta }),
      ...(modelError && { modelError }),
    };
  }

  async cancel(handle: JobHandle) {
    const adapter = this.providers.get(handle.providerId);
    return adapter.cancel(handle);
  }
}
