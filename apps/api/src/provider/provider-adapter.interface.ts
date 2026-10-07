import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  ModelCapabilities,
  Modality,
  OutputDef,
  PronunciationDictionaryListDto,
  TimingMap,
  VoiceListDto,
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

/** What the editor narrows a text-to-speech voice list by. */
export interface VoiceQuery {
  /** The speech model the voice is for: a provider's voices can differ per model. */
  modelId?: string | undefined;
  search?: string | undefined;
  language?: string | undefined;
  gender?: string | undefined;
  /** From a previous page's `nextCursor`. */
  cursor?: string | undefined;
  limit?: number | undefined;
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
  /** Speech that comes with word timings (ElevenLabs): when each word is spoken. */
  timing?: TimingMap;
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
  /** Text-to-speech providers: the voices to pick from. */
  listVoices?(query: VoiceQuery): Promise<VoiceListDto>;
  /** Text-to-speech providers: why these params can't be used together, if they can't. */
  speechConflict?(modelId: string, params: Record<string, unknown>): string | undefined;
  /** Text-to-speech providers with pronunciation dictionaries in the account. */
  listPronunciationDictionaries?(): Promise<PronunciationDictionaryListDto>;
}
