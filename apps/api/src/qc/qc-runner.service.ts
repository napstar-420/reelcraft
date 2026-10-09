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
  /** Clip lists only: indexes of the clips to make again. */
  failedClips?: number[];
  /** Candidate images only: the index of the image the judge chose and scored. */
  selectedImage?: number;
}

export type QcOutcome =
  | { status: 'passed'; verdict: QcVerdict; costUsd: number }
  | { status: 'failed'; verdict: QcVerdict; costUsd: number }
  | { status: 'error'; reason: string; costUsd: number };

/** Backoff between judge polls (the last step repeats). A real judge goes
 * through the same submit/poll adapter as the stage's own call and takes real
 * time: a ChatGPT judge thinks for minutes. The adapters fail a job that
 * outlives their own deadline, so this cap only guards a poll that never ends.
 * ponytail: still an inline blocking poll rather than `stage-attempt-loop.ts`'s
 * durable per-poll steps; revisit if judges routinely run this long. */
const POLL_BACKOFF_SEC = [5, 15, 30];
const JUDGE_DEADLINE_MS = 20 * 60_000;

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
        params: qcParams(params, args.envelope, args.judge.provider),
        renderedPrompt: prompt.user,
        system: prompt.system,
      },
      args.idempotencyKey,
    );

    let status = await adapter.poll(handle);
    const giveUpAt = Date.now() + JUDGE_DEADLINE_MS;
    for (let i = 0; !status.done && Date.now() < giveUpAt; i++) {
      await sleep(POLL_BACKOFF_SEC[Math.min(i, POLL_BACKOFF_SEC.length - 1)]! * 1000);
      status = await adapter.poll(handle);
    }

    if (!status.done) {
      // Don't leave the judge's page open (ChatGPT) or its job running.
      await adapter.cancel(handle).catch(() => undefined);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
