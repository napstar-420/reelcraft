import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  ModelCapabilities,
  Modality,
  OutputDef,
} from '@reelcraft/shared';

export interface ModelInfo {
  modelId: string;
  label: string;
  modalities?: Modality[];
  unavailableModalities?: Partial<Record<Modality, string>>;
  capabilities: ModelCapabilities;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

export interface ProviderRequest {
  modality?: Modality;
  modelId: string;
  params: Record<string, unknown>;
  renderedPrompt?: string | undefined;
  system?: string | undefined;
  output?: OutputDef | undefined;
}

export interface ProviderAttachment {
  role: 'evidence' | 'download';
  localPath?: string;
  base64?: string;
  sourceUrl?: string;
  mime: string;
  filename: string;
}

export interface ProviderResult {
  output: unknown;
  costUsd: number;
  repro: { level: 'exact' | 'approximate' | 'none'; seed?: string; providerVersion?: string };
  rawResponse: unknown;
  attachments?: ProviderAttachment[];
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
  readonly modalities: readonly Modality[];
  listModels(): Promise<ModelInfo[]>;
  estimate(req: ProviderRequest): Promise<CostEstimate>;
  submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle>;
  poll(handle: JobHandle): Promise<JobStatus>;
  fetch(handle: JobHandle): Promise<ProviderResult>;
  cancel(handle: JobHandle): Promise<CancelResult>;
}
