import type {
  JsonSchema,
  ModelCapabilities,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reefcraft/shared';
import type { CostEstimate, JobHandle, JobStatus } from '@reefcraft/shared';

/**
 * §7.2/Appendix A — deliberately absent: database access, the run object,
 * other stages, and any memory-write capability. Enforced by this type, not
 * by convention: a capability physically cannot reach those things because
 * nothing here provides them.
 */
export interface ExecCtx<Cfg> {
  runId: string;
  stageKey: string;
  attemptNo: number;
  itemIndex?: number | undefined;
  config: Cfg;
  slots: Record<string, unknown>;
  context: Record<string, unknown>;
  renderedPrompt?: string | undefined;
  idempotencyKey: string;
  logger: { log: (msg: string) => void; error: (msg: string, err?: unknown) => void };
  resources?: Record<
    string,
    { handle: string; kind: string; sourceKey?: string; probe?: unknown; data?: unknown }
  >;
}

export interface ExecResult<Out = unknown> {
  output: Out;
  costUsd: number;
  repro: { level: 'exact' | 'approximate' | 'none'; seed?: string; providerVersion?: string };
  rawResponseRef?: string;
}

export interface CancelResult {
  confirmed: boolean;
  billed?: boolean;
  reason?: string;
}

/** §7.2 — the estimate/submit/poll/fetch/cancel split exists so the
 * orchestrator can place step boundaries correctly (§13.3). Never collapse
 * into a single execute(): a transport retry would submit a second paid job. */
export interface CapabilityImpl<Cfg = Record<string, unknown>> {
  readonly modality: string;
  readonly kind: 'sync' | 'async';
  readonly interaction?: { kind: 'form' | 'timeline_editor' };
  /** §4.2/§16.2 — the restricted-dialect shape of `StageDef.config` this
   * capability accepts, backing `GET /capabilities` (`CapabilityDto`,
   * `packages/shared/src/dto/capability.dto.ts`) and save-time validation.
   * Describes the AUTHORED `StageDef.config` shape, not the merged runtime
   * `Cfg` this interface is generic over — e.g. `LlmGenerate`'s `provider`/
   * `modelId` arrive from the resolved model pin layer
   * (`ConfigResolverService`), not from `StageDef.config` itself; its
   * `configSchema` must not require them. A capability with no config
   * declares `{type: 'object'}`. */
  readonly configSchema: JsonSchema;
  slots(cfg: Cfg): SlotDef[];
  allowedOutputs(cfg: Cfg): OutputKind[];
  validate?(cfg: Cfg, stage: StageDef, caps: ModelCapabilities): ValidationIssue[];

  estimateCost(ctx: ExecCtx<Cfg>): Promise<CostEstimate>;
  submit(ctx: ExecCtx<Cfg>): Promise<JobHandle>;
  poll(handle: JobHandle): Promise<JobStatus>;
  fetch(handle: JobHandle, ctx: ExecCtx<Cfg>): Promise<ExecResult>;
  cancel?(handle: JobHandle): Promise<CancelResult>;
  cleanup?(handle: JobHandle): Promise<void>;
}
