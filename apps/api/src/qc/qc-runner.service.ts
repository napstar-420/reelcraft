import { Injectable, Logger } from '@nestjs/common';
import type { ModelPin } from '@reelcraft/shared';
import { ProviderRegistry } from '../provider/provider.registry';
import type { QcEnvelope } from './qc-envelope';
import { buildQcPrompt } from './qc-prompt';
import { JudgeResponse, weightedScore } from './qc-verdict';

export interface QcVerdict {
  score: number;
  critique: string;
  dimensions?: Array<{ key: string; score: number; critique?: string }>;
}

export type QcOutcome =
  | { status: 'passed'; verdict: QcVerdict; costUsd: number }
  | { status: 'failed'; verdict: QcVerdict; costUsd: number }
  | { status: 'error'; reason: string; costUsd: number };

/** Same backoff sequence as the main attempt loop's `POLL_BACKOFF_SEC`
 * (`stage-attempt-loop.ts`) — a real judge call goes through the same
 * submit/poll provider adapter as the stage's own generation call and needs
 * real round-trip time, not the ~200ms `FakeProviderAdapter` resolves on.
 * ponytail: still an inline blocking poll (~50s ceiling) rather than
 * `stage-attempt-loop.ts`'s durable per-poll steps — revisit with that same
 * step-per-poll treatment if a judge model routinely needs longer. */
const POLL_BACKOFF_SEC = [5, 15, 30];

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

  async run(args: {
    envelope: QcEnvelope;
    /** Resolved by the CALLER from `EffectiveStageConfig`, never read off
     * `QcDef` directly — `run.overrides` can change `qc.model` at run time. */
    judge: ModelPin;
    /** Resolved by the CALLER — same reasoning as `judge` (`qc.threshold`). */
    threshold: number;
    /** MUST be distinct from the stage's own idempotency key — reusing it
     * makes `FakeProviderAdapter` (and any real idempotent adapter) hand
     * back the STAGE's job, so QC would "judge" the stage's own completion
     * and fail with a message pointing nowhere near the real cause. */
    idempotencyKey: string;
  }): Promise<QcOutcome> {
    const startedAt = Date.now();
    const outcome = await this.judge(args);
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

  private async judge(args: Parameters<QcRunner['run']>[0]): Promise<QcOutcome> {
    const adapter = this.providers.get(args.judge.provider);
    const prompt = buildQcPrompt(args.envelope);
    // §10 — pinned model, temperature forced to 0: a judge's determinism
    // matters more than any author-set creativity knob on the pin.
    const params = { ...args.judge.params, temperature: 0 };

    const handle = await adapter.submit(
      {
        modality: 'text',
        modelId: args.judge.modelId,
        params,
        renderedPrompt: prompt.user,
        system: prompt.system,
      },
      args.idempotencyKey,
    );

    let status = await adapter.poll(handle);
    // §13.3-class shortcut, same as stage-runner.service.ts's documented
    // ExecCtx.config TODO: this polls a bounded backoff sequence inline
    // rather than its own step-per-poll loop (see the ponytail note above).
    for (const backoffSec of POLL_BACKOFF_SEC) {
      if (status.done) break;
      await sleep(backoffSec * 1000);
      status = await adapter.poll(handle);
    }

    if (!status.done) {
      return { status: 'error', reason: 'qc judge call did not complete in time', costUsd: 0 };
    }
    if (status.outcome === 'failed') {
      return { status: 'error', reason: status.reason, costUsd: 0 };
    }

    let result;
    try {
      result = await adapter.fetch(handle);
    } catch (err) {
      return { status: 'error', reason: describeError(err), costUsd: 0 };
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

    const verdict = toVerdict(parsed, args.envelope);
    return verdict.score >= args.threshold
      ? { status: 'passed', verdict, costUsd: result.costUsd }
      : { status: 'failed', verdict, costUsd: result.costUsd };
  }
}

function toVerdict(response: JudgeResponse, envelope: QcEnvelope): QcVerdict {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
