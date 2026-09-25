import { Injectable } from '@nestjs/common';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { ProviderRegistry } from '../../provider/provider.registry';

interface BrowserAutomationConfig {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
  startUrl?: string;
}

@Capability('browser.automate')
@Injectable()
export class BrowserAutomateCapability implements CapabilityImpl<BrowserAutomationConfig> {
  readonly modality = 'browser' as const;
  readonly kind = 'async' as const;
  readonly label = 'Automate Browser';
  readonly description =
    'Use Codex with BrowserOS Neo and its persistent signed-in browser profile.';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      startUrl: { type: 'string' },
    },
  };

  constructor(private readonly providers: ProviderRegistry) {}

  slots(): SlotDef[] {
    return [];
  }

  allowedOutputs(): Array<'data'> {
    return ['data'];
  }

  validate(config: BrowserAutomationConfig, stage: StageDef): ValidationIssue[] {
    if (stage.output.kind !== 'data') {
      return [
        {
          path: 'output.kind',
          message: 'browser automation requires data output',
          severity: 'error',
        },
      ];
    }
    if (!config.startUrl) return [];
    try {
      const url = new URL(config.startUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') return [];
    } catch {
      // Report the same authoring error for malformed and unsupported URLs.
    }
    return [
      {
        path: 'config.startUrl',
        message: 'browser startUrl must use HTTP or HTTPS',
        severity: 'error',
      },
    ];
  }

  estimateCost(ctx: ExecCtx<BrowserAutomationConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate(this.request(ctx));
  }

  submit(ctx: ExecCtx<BrowserAutomationConfig>): Promise<JobHandle> {
    return this.providers.get(ctx.config.provider).submit(this.request(ctx), ctx.idempotencyKey);
  }

  poll(handle: JobHandle): Promise<JobStatus> {
    return this.providers.get(handle.providerId).poll(handle);
  }

  async fetch(handle: JobHandle): Promise<ExecResult> {
    const result = await this.providers.get(handle.providerId).fetch(handle);
    return {
      output: result.output,
      ...(result.attachments && { attachments: result.attachments }),
      costUsd: result.costUsd,
      repro: result.repro,
    };
  }

  cancel(handle: JobHandle) {
    return this.providers.get(handle.providerId).cancel(handle);
  }

  private request(ctx: ExecCtx<BrowserAutomationConfig>) {
    return {
      modality: 'browser' as const,
      modelId: ctx.config.modelId,
      params: {
        ...(ctx.config.params ?? {}),
        ...(ctx.config.startUrl && { startUrl: ctx.config.startUrl }),
      },
      renderedPrompt: ctx.renderedPrompt,
      system: ctx.systemPrompt,
      output: ctx.output,
    };
  }
}
