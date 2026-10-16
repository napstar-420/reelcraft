import { Injectable, Logger } from '@nestjs/common';
import type { JobHandle, JobStatus, ModelPin } from '@reelcraft/shared';
import { ProviderRegistry } from '../provider/provider.registry';
import type { QcEnvelope } from './qc-envelope';
import { buildQcPrompt } from './qc-prompt';
import { JudgeResponse, qcVerdictSchema, weightedScore } from './qc-verdict';

export interface QcVerdict {
  score: number;
  critique: string;
  dimensions?: Array<{ key: string; score: number; critique?: string }>;
  /** Clip lists only: indexes of the clips to make again. */
  failedClips?: number[];
  /** Candidate images only: the index of the image the judge chose and scored. */
  selectedImage?: number;
}

export type QcOutcome =
  | { status: 'passed'; verdict: QcVerdict; costUsd: number }
  | { status: 'failed'; verdict: QcVerdict; costUsd: number }
  /** `transient`: the judge could not be reached (network, unavailable
   * browser), so judging again after a pause may work, unlike an unparseable
   * verdict. */
  | { status: 'error'; reason: string; costUsd: number; transient?: boolean };

/** Pauses before judging again after a transient error (the last repeats). */
const TRANSIENT_BACKOFF_MS = [30_000, 120_000, 300_000];

/** How long to wait after the `errorsSoFar`-th errored judge call before the next. */
export function qcRetryDelayMs(outcome: QcOutcome, errorsSoFar: number): number {
  if (outcome.status !== 'error' || !outcome.transient) return 0;
  return TRANSIENT_BACKOFF_MS[Math.min(errorsSoFar, TRANSIENT_BACKOFF_MS.length) - 1] ?? 0;
}

/** A thrown provider error that a retry once the connection is back may clear. */
function isTransientError(err: unknown): boolean {
  return /unavailable|timed out|network|ECONN/i.test(describeError(err));
}

export const QC_POLL_BACKOFF_SEC = [5, 15, 30];
export const QC_JUDGE_DEADLINE_MS = 20 * 60_000;

export function qcDeadlineAt(): number {
  return Date.now() + QC_JUDGE_DEADLINE_MS;
}

export function qcPollLive(status: JobStatus, deadlineMs: number): boolean {
  return !status.done && Date.now() < Math.max(deadlineMs, status.deadlineMs ?? 0);
}

export interface QcCall {
  envelope: QcEnvelope;
  judge: ModelPin;
  threshold: number;
  idempotencyKey: string;
}

/**
 * §10 — runs a QC judge call against `ProviderRegistry` directly (not
 * through the capability layer — QC isn't a capability). Unit-testable
 * against `FakeProviderAdapter` with no DB, since `ProviderModule` has no DB
 * dependency.
 */
@Injectable()
export class QcRunner {
  private readonly logger = new Logger(QcRunner.name);

  constructor(private readonly providers: ProviderRegistry) {}

  async run(args: QcCall): Promise<QcOutcome> {
    const startedAt = Date.now();
    const submitted = await this.submit(args);
    let outcome: QcOutcome;
    if ('status' in submitted) outcome = submitted;
    else {
      const status = await this.poll(submitted.handle);
      if (!status.done) {
        await this.cancel(submitted.handle);
        outcome = { status: 'error', reason: 'qc judge requires durable polling', costUsd: 0 };
      } else if (status.outcome === 'failed') {
        outcome = {
          status: 'error',
          reason: status.reason,
          costUsd: 0,
          ...(status.failureClass === 'infrastructure' && { transient: true }),
        };
      } else outcome = await this.fetch(args, submitted.handle);
    }
    const fields = {
      provider: args.judge.provider,
      modelId: args.judge.modelId,
      threshold: args.threshold,
      costUsd: outcome.costUsd,
      durationMs: Date.now() - startedAt,
    };
    if (outcome.status === 'error') {
      this.logger.warn({ ...fields, reason: outcome.reason }, 'qc judge errored');
    } else if (outcome.status === 'failed') {
      this.logger.log({ ...fields, score: outcome.verdict.score }, 'qc verdict failed');
    } else {
      this.logger.debug({ ...fields, score: outcome.verdict.score }, 'qc verdict passed');
    }
    return outcome;
  }

  async submit(
    args: QcCall,
  ): Promise<{ handle: JobHandle } | Extract<QcOutcome, { status: 'error' }>> {
    const adapter = this.providers.get(args.judge.provider);
    const prompt = buildQcPrompt(args.envelope);
    const browserOrCodex = args.judge.provider === 'chatgpt' || args.judge.provider === 'codex';
    const params = browserOrCodex
      ? { ...args.judge.params }
      : { ...args.judge.params, temperature: 0 };

    try {
      const handle = await adapter.submit(
        {
          modality: 'text',
          modelId: args.judge.modelId,
          params: qcParams(params, args.envelope, args.judge.provider),
          renderedPrompt: prompt.user,
          system: prompt.system,
          ...(browserOrCodex && {
            output: {
              kind: 'data' as const,
              schemaName: 'qc_verdict',
              schema: qcVerdictSchema(args.envelope),
            },
          }),
        },
        args.idempotencyKey,
      );
      return { handle };
    } catch (err) {
      // A judge that cannot be reached is an errored judge call, not a crash of
      // the stage's own attempt: the caller retries it and then parks the output.
      return {
        status: 'error',
        reason: describeError(err),
        costUsd: 0,
        ...(isTransientError(err) && { transient: true }),
      };
    }
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    try {
      return await this.providers.get(handle.providerId).poll(handle);
    } catch (error) {
      return {
        done: true,
        outcome: 'failed',
        reason: describeError(error),
        retryable: true,
        failureClass: 'infrastructure',
      };
    }
  }

  async cancel(handle: JobHandle): Promise<void> {
    await this.providers
      .get(handle.providerId)
      .cancel(handle)
      .catch(() => undefined);
  }

  async fetch(args: QcCall, handle: JobHandle): Promise<QcOutcome> {
    const adapter = this.providers.get(handle.providerId);
    let result;
    try {
      result = await adapter.fetch(handle);
    } catch (err) {
      return {
        status: 'error',
        reason: describeError(err),
        costUsd: 0,
        ...(isTransientError(err) && { transient: true }),
      };
    }

    let parsed: JudgeResponse;
    try {
      const raw = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
      parsed = JudgeResponse.parse(raw);
    } catch (err) {
      return {
        status: 'error',
        reason: `qc judge returned unparseable output: ${describeError(err)}`,
        costUsd: result.costUsd,
      };
    }

    const selectedImage = selectedImageOf(parsed, args.envelope);
    if (args.envelope.selectBest && selectedImage === undefined) {
      return {
        status: 'error',
        reason: 'qc judge did not choose one of the candidate images',
        costUsd: result.costUsd,
      };
    }
    const verdict = {
      ...toVerdict(parsed, args.envelope),
      ...(selectedImage !== undefined && { selectedImage }),
    };
    return verdict.score >= args.threshold
      ? { status: 'passed', verdict, costUsd: result.costUsd }
      : { status: 'failed', verdict, costUsd: result.costUsd };
  }
}

/** The judge's request params: the attached image or audio, or a clip list's
 * videos or an image list's images. A judge given clips must open the files
 * itself (`__inspectFiles`); so must Codex given images, while other judges
 * get the images attached. */
function qcParams(
  params: Record<string, unknown>,
  envelope: QcEnvelope,
  judgeProvider: string,
): Record<string, unknown> {
  if (envelope.clips?.length) {
    return {
      ...params,
      __inspectFiles: true,
      slots: Object.fromEntries(
        envelope.clips.map((clip, i) => [`qcClip${i + 1}`, { sourceKey: clip.sourceKey }]),
      ),
    };
  }
  if (envelope.images?.length) {
    return {
      ...params,
      // Codex can't be sent files; it opens them itself. Other judges get them attached.
      ...(judgeProvider === 'codex' && { __inspectFiles: true }),
      slots: Object.fromEntries(
        envelope.images.map((image, i) => [`qcImage${i + 1}`, { sourceKey: image.sourceKey }]),
      ),
    };
  }
  return envelope.media
    ? { ...params, slots: { qcArtifact: { sourceKey: envelope.media.sourceKey } } }
    : params;
}

/** Only indexes of clips that were actually judged count. */
function failedClipsOf(response: JudgeResponse, envelope: QcEnvelope): number[] | undefined {
  if (!envelope.clips) return undefined;
  const known = new Set(envelope.clips.map((clip) => clip.index));
  return [...new Set((response.failedClips ?? []).filter((index) => known.has(index)))];
}

/** The candidate the judge chose, when it was asked to choose; only an index it was shown counts. */
function selectedImageOf(response: JudgeResponse, envelope: QcEnvelope): number | undefined {
  if (!envelope.selectBest) return undefined;
  const chosen = response.bestImage;
  return chosen !== undefined && envelope.images?.some((image) => image.index === chosen)
    ? chosen
    : undefined;
}

function toVerdict(response: JudgeResponse, envelope: QcEnvelope): QcVerdict {
  const failedClips = failedClipsOf(response, envelope);
  const verdict = scoreOf(response, envelope);
  return failedClips ? { ...verdict, failedClips } : verdict;
}

function scoreOf(response: JudgeResponse, envelope: QcEnvelope): QcVerdict {
  if (response.dimensions && envelope.dimensions) {
    const weightByKey = new Map(envelope.dimensions.map((d) => [d.key, d.weight]));
    const joined = response.dimensions
      .map((d) => {
        const weight = weightByKey.get(d.key);
        return weight === undefined ? undefined : { score: d.score, weight };
      })
      .filter((d): d is { score: number; weight: number } => d !== undefined);
    return {
      score: weightedScore(joined),
      critique: response.critique,
      dimensions: response.dimensions.map((d) => ({
        key: d.key,
        score: d.score,
        ...(d.critique !== undefined && { critique: d.critique }),
      })),
    };
  }
  return { score: response.score ?? 0, critique: response.critique };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
