import { Injectable } from '@nestjs/common';
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

/** Only meaningful in tests against `FakeProviderAdapter`; a real judge
 * call is a fast text completion and should resolve on the first poll. */
const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 20;

/**
 * §10 — runs a QC judge call against `ProviderRegistry` directly (not
 * through the capability layer — QC isn't a capability). Unit-testable
 * against `FakeProviderAdapter` with no DB, since `ProviderModule` has no DB
 * dependency.
 */
@Injectable()
export class QcRunner {
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
    let attempts = 0;
    // §13.3-class shortcut, same as stage-runner.service.ts's documented
    // ExecCtx.config TODO: a QC judge call is a fast text call, so this
    // polls a bounded number of times inline rather than its own
    // step-per-poll loop. A slow judge model would need this revisited.
    while (!status.done && attempts < MAX_POLL_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS);
      status = await adapter.poll(handle);
      attempts += 1;
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
