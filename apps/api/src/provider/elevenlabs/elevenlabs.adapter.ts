import { Inject, Injectable } from '@nestjs/common';
import type { CostEstimate, JobHandle, JobStatus } from '@reelcraft/shared';
import { KEY_PROVIDER, type KeyProvider } from '../key-provider';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
} from '../provider-adapter.interface';

@Injectable()
export class ElevenLabsAdapter implements ProviderAdapter {
  readonly id = 'elevenlabs';
  readonly modalities = ['audio'] as const;
  private readonly jobs = new Map<string, ProviderRequest>();
  constructor(@Inject(KEY_PROVIDER) private readonly keys: KeyProvider) {}
  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        modelId: 'eleven_turbo_v2_5',
        label: 'Eleven Turbo v2.5',
        capabilities: { supportsSeed: false, supportsIdempotency: false },
      },
    ];
  }
  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    const text = String(
      (req.params.slots as Record<string, unknown> | undefined)?.text ?? req.renderedPrompt ?? '',
    );
    const expectedUsd = text.length * Number(req.params.pricePerCharacterUsd ?? 0.000_03);
    return { expectedUsd, ceilingUsd: expectedUsd, basis: 'configured_ceiling' };
  }
  async submit(req: ProviderRequest, key: string): Promise<JobHandle> {
    this.jobs.set(key, req);
    return { providerId: this.id, externalId: key, payload: req };
  }
  async poll(): Promise<JobStatus> {
    return { done: true, outcome: 'succeeded' };
  }
  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const req = this.jobs.get(handle.externalId) ?? (handle.payload as ProviderRequest | undefined);
    if (!req) throw new Error('ElevenLabs: missing durable request');
    const apiKey = await this.keys.get(this.id);
    if (!apiKey) throw new Error('ElevenLabs: no API key configured');
    const slots = req.params.slots as Record<string, unknown> | undefined;
    const text = String(slots?.text ?? req.renderedPrompt ?? '');
    const voiceId = String(req.params.voiceId ?? '21m00Tcm4TlvDq8ikWAM');
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: req.modelId,
          output_format: req.params.outputFormat ?? 'mp3_44100_128',
        }),
      },
    );
    if (!response.ok) throw new Error(`ElevenLabs: ${response.status} ${response.statusText}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      output: {
        kind: 'media.audio',
        base64: bytes.toString('base64'),
        mime: response.headers.get('content-type') ?? 'audio/mpeg',
        filename: 'speech.mp3',
      },
      costUsd: text.length * Number(req.params.pricePerCharacterUsd ?? 0.000_03),
      repro: { level: 'none', providerVersion: req.modelId },
      rawResponse: { voiceId, characters: text.length },
    };
  }
  async cancel(): Promise<{ confirmed: boolean; billed?: boolean }> {
    return { confirmed: false };
  }
}
