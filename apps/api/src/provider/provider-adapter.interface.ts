import type { CostEstimate, JobHandle, JobStatus, ModelCapabilities } from '@reelcraft/shared';

export interface ModelInfo {
  modelId: string;
  label: string;
  capabilities: ModelCapabilities;
}

export interface ProviderRequest {
  modelId: string;
  params: Record<string, unknown>;
  renderedPrompt?: string | undefined;
  system?: string | undefined;
}

export interface ProviderResult {
  output: unknown;
  costUsd: number;
  repro: { level: 'exact' | 'approximate' | 'none'; seed?: string; providerVersion?: string };
  rawResponse: unknown;
}

export interface CancelResult {
  confirmed: boolean;
  billed?: boolean;
  reason?: string;
}

/**
 * §8 — all external providers accessed through one uniform adapter
 * implementing the async job lifecycle: estimate -> submit -> poll -> fetch
 * -> cancel (REQ-2.5.4). Do not collapse this into a single call.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly modalities: string[];
  listModels(): Promise<ModelInfo[]>;
  estimate(req: ProviderRequest): Promise<CostEstimate>;
  submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle>;
  poll(handle: JobHandle): Promise<JobStatus>;
  fetch(handle: JobHandle): Promise<ProviderResult>;
  cancel(handle: JobHandle): Promise<CancelResult>;
}
