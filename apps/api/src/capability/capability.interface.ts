import type {
  ConfigLayer,
  JsonSchema,
  ModelCapabilities,
  ModelError,
  OutputDef,
  OutputKind,
  SlotDef,
  StageDef,
  TimingMap,
  ValidationIssue,
} from '@reelcraft/shared';
import type { CostEstimate, JobHandle, JobStatus } from '@reelcraft/shared';
import type { FileInput } from '../common/file-inputs';

/**
 * §7.2/Appendix A — deliberately absent: database access, the run object,
 * other stages, and any memory-write capability. Enforced by this type, not
 * by convention: a capability physically cannot reach those things because
 * nothing here provides them.
 */
export interface ExecCtx<Cfg> {
  runId: string;
  stageExecutionId?: string | undefined;
  stageKey: string;
  attemptNo: number;
  itemIndex?: number | undefined;
  config: Cfg;
  slots: Record<string, unknown>;
  context: Record<string, unknown>;
  /** Files from the stage's `attach` context keys, in attachment order. */
  files?: FileInput[] | undefined;
  renderedPrompt?: string | undefined;
  systemPrompt?: string | undefined;
  output?: OutputDef | undefined;
  idempotencyKey: string;
  /** The merged run config layer, for capabilities that read shared
   * defaults (e.g. the Flow stage's account list). */
  layer?: Pick<ConfigLayer, 'format'> | undefined;
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
  /** Word timings of generated speech, kept with the audio artifact. */
  timing?: TimingMap;
  /** Provider-side diagnostics (token usage, exit code, stderr tail…) shown
   * in the stage log. Never the output itself. */
  providerMeta?: Record<string, unknown>;
  /** The model declined the task with a structured error reply; the stage
   * fails with this message instead of persisting `output`. */
  modelError?: ModelError;
  /** The provider is out of quota until this time (ISO): the attempt is
   * recorded as `deferred` and the run pauses until then instead of failing. */
  deferUntil?: string;
  attachments?: Array<{
    role: 'evidence' | 'download';
    localPath?: string;
    base64?: string;
    sourceUrl?: string;
    mime: string;
    filename: string;
  }>;
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
  /** Short human-facing name for the stage picker, e.g. "Generate Text". */
  readonly label: string;
  /** One-sentence explanation shown alongside `label` in the stage picker. */
  readonly description: string;
  readonly interaction?: { kind: 'form' | 'timeline_editor' };
  /** A system prompt the capability owns: shown read-only in the stage
   * editor, and always used in place of the stage's own. */
  readonly lockedSystemPrompt?: string;
  /** The stage cannot run without a template prompt. */
  readonly requiresTemplate?: boolean;
  /** The stage's work is fixed, so it takes no system prompt or template and the editor hides them. */
  readonly noInstructions?: boolean;
  /** §4.2/§16.2 — the restricted-dialect shape of `StageDef.config` this
   * capability accepts, backing `GET /capabilities` (`CapabilityDto`,
   * `packages/shared/src/dto/capability.dto.ts`) and save-time validation.
   * Describes the AUTHORED `StageDef.config` shape, not the merged runtime
   * `Cfg` this interface is generic over — e.g. `TextGenerateCapability`'s `provider`/
   * `modelId` arrive from the resolved model pin layer
   * (`ConfigResolverService`), not from `StageDef.config` itself; its
   * `configSchema` must not require them. A capability with no config
   * declares `{type: 'object'}`. */
  readonly configSchema: JsonSchema;
  slots(cfg: Cfg): SlotDef[];
  allowedOutputs(cfg: Cfg): OutputKind[];
  validate?(cfg: Cfg, stage: StageDef, caps: ModelCapabilities): ValidationIssue[];

  /** Derive the exact request context used for both cost estimation and
   * submission. The stage runner persists this context's prompt for audit. */
  prepare?(ctx: ExecCtx<Cfg>): ExecCtx<Cfg>;

  estimateCost(ctx: ExecCtx<Cfg>): Promise<CostEstimate>;
  submit(ctx: ExecCtx<Cfg>): Promise<JobHandle>;
  poll(handle: JobHandle): Promise<JobStatus>;
  fetch(handle: JobHandle, ctx: ExecCtx<Cfg>): Promise<ExecResult>;
  cancel?(handle: JobHandle): Promise<CancelResult>;
  cleanup?(handle: JobHandle): Promise<void>;
}
