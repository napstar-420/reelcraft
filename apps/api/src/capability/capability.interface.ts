import type {
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
}

export interface ExecResult<Out = unknown> {
  output: Out;
  costUsd: number;
  repro: { level: 'exact' | 'approximate' | 'none'; seed?: string; providerVersion?: string };
  rawResponseRef?: string;
}

/** §7.2 — the estimate/submit/poll/fetch/cancel split exists so the
 * orchestrator can place step boundaries correctly (§13.3). Never collapse
 * into a single execute(): a transport retry would submit a second paid job. */
export interface CapabilityImpl<Cfg = Record<string, unknown>> {
  readonly modality: string;
  readonly kind: 'sync' | 'async';
  slots(cfg: Cfg): SlotDef[];
  allowedOutputs(cfg: Cfg): OutputKind[];
  validate?(cfg: Cfg, stage: StageDef, caps: ModelCapabilities): ValidationIssue[];

  estimateCost(ctx: ExecCtx<Cfg>): Promise<CostEstimate>;
  submit(ctx: ExecCtx<Cfg>): Promise<JobHandle>;
  poll(handle: JobHandle): Promise<JobStatus>;
  fetch(handle: JobHandle, ctx: ExecCtx<Cfg>): Promise<ExecResult>;
  cancel?(handle: JobHandle): Promise<void>;
}
