import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CostEstimate, JobHandle, JobStatus } from '@reefcraft/shared';
import type {
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
} from '../provider-adapter.interface';

interface FakeJobPayload {
  submittedAt: number;
  idempotencyKey: string;
  modelId: string;
  prompt?: string | undefined;
  failureMode?: string | undefined;
  /** `params.fakeOutput`, captured at submit time — see `fetch()`. */
  output?: unknown;
  /** Set once at `submit()` from `fail:<mode>:<N>`'s count. `undefined`
   * preserves the original unbounded-failure behavior (every `fetch()`
   * fails forever) for callers that don't pass a count. Only meaningful for
   * `failureMode === 'transport'` today. */
  failuresRemaining?: number | undefined;
  /** §11/phase 3 — `params.fakeCostUsd`, captured at submit time since
   * `fetch(handle)` (the interface, `provider-adapter.interface.ts`) takes
   * only the handle, unlike `estimate()` which sees `req.params` directly.
   * `undefined` preserves the original hardcoded `0.001` for every existing
   * caller that doesn't pass it. */
  costUsd?: number | undefined;
  /** §24 "slow, costly fake" — `slow:<N>` modelId suffix's remaining poll
   * count, decremented each `poll()` call. `undefined`/`0` means "not slow",
   * same as every other knob here defaulting to off. */
  pollsRemaining?: number | undefined;
}

/**
 * §22 — a fake provider is a first-class component, not a test fixture. It
 * lands in phase 1 so the retry loop, idempotency, and budget paths all
 * have a free, deterministic, injectable-failure counterpart from day one.
 *
 * Failure modes are selected via a `fake-text-1:fail:<mode>` modelId suffix:
 * `timeout`, `malformed`, `transport`, `schema` (valid JSON, wrong shape —
 * distinct from `malformed`'s literally-unparseable text), `poll_failed`
 * (`poll()` itself reports a failed job, as opposed to `fetch()` throwing).
 * A structured
 * `data`-shaped success payload is selected via `params.fakeOutput` instead
 * of a modelId suffix (see `fetch()`) — deterministic and caller-controlled.
 *
 * §24/phase 3 — the "slow, costly fake": `fake-text-1:slow:<N>` (its own
 * modelId suffix, independent of `fail:`) reports not-done for the first
 * `N` polls before succeeding; `params.fakeCeilingUsd`/`fakeExpectedUsd`
 * override `estimate()`'s token heuristic; `params.fakeCostUsd` overrides
 * `fetch()`'s hardcoded settled cost. Lets a test drive a real reservation
 * to a deterministic cap-hit and a real multi-cycle poll/backoff loop.
 */
@Injectable()
export class FakeProviderAdapter implements ProviderAdapter {
  readonly id = 'fake';
  readonly modalities = ['text', 'image', 'video', 'audio', 'media'];

  /** idempotency key -> job, so a transport retry submitting twice is
   * observable in tests as "one job per key". */
  private readonly submittedKeys = new Map<string, JobHandle>();
  private readonly jobs = new Map<string, FakeJobPayload>();
  /** Keyed by the exact `fail:poll_failed:<N>` modelId string. Unlike
   * `transport`'s per-job `failuresRemaining` (bounded across repeated
   * calls on the SAME job/handle — an Inngest step retry re-running one
   * step), `poll_failed` is meant to be bounded across separate
   * semantic-retry ATTEMPTS, each of which submits a brand new job under a
   * fresh idempotency key — so this counter lives on the adapter instance,
   * not on a `FakeJobPayload`, and survives across jobs. */
  private readonly pollFailedRemaining = new Map<string, number>();

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        modelId: 'fake-text-1',
        label: 'Fake Text 1',
        capabilities: {
          supportsSeed: true,
          supportsIdempotency: true,
          supportsStructuredOutput: true,
          supportsVision: false,
        },
      },
      {
        modelId: 'fake-text-no-structured',
        label: 'Fake Text (no structured output)',
        capabilities: {
          supportsSeed: false,
          supportsIdempotency: true,
          supportsStructuredOutput: false,
        },
      },
      {
        modelId: 'fake-text-no-idempotency',
        label: 'Fake Text (no idempotency)',
        capabilities: { supportsSeed: false, supportsIdempotency: false },
      },
      {
        modelId: 'fake-video-1',
        label: 'Fake Video 1',
        capabilities: {
          supportsSeed: true,
          supportsIdempotency: true,
          video: {
            durationsSec: [5, 10],
            aspectRatios: ['9:16', '16:9'],
            maxResolution: '1080x1920',
            inputs: ['text', 'startFrame', 'references'],
          },
        },
      },
      {
        modelId: 'fake-image-1', label: 'Fake Image 1', capabilities: {
          supportsSeed: true, supportsIdempotency: true, image: { formats: ['png'], resolutions: ['1x1'] },
        },
      },
      {
        modelId: 'fake-audio-1', label: 'Fake Audio 1', capabilities: { supportsSeed: true, supportsIdempotency: true },
      },
    ];
  }

  async estimate(req: ProviderRequest): Promise<CostEstimate> {
    // §11/phase 3 — `params.fakeCeilingUsd` overrides the token heuristic
    // entirely, letting a test drive `LedgerService.reserve()` to a
    // deterministic run/stage-cap outcome instead of a computed guess.
    const fakeCeilingUsd = req.params.fakeCeilingUsd as number | undefined;
    if (fakeCeilingUsd !== undefined) {
      const fakeExpectedUsd = req.params.fakeExpectedUsd as number | undefined;
      return {
        expectedUsd: fakeExpectedUsd ?? fakeCeilingUsd,
        ceilingUsd: fakeCeilingUsd,
        basis: 'configured_ceiling',
      };
    }
    const tokens = (req.renderedPrompt ?? '').length / 4;
    const expectedUsd = Math.max(0.001, tokens * 0.000_002);
    return { expectedUsd, ceilingUsd: expectedUsd * 3, basis: 'token_estimate' };
  }

  async submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle> {
    const existing = this.submittedKeys.get(idempotencyKey);
    if (existing) {
      return existing;
    }
    const externalId = randomUUID();
    const parsed = this.parseFailureMode(req.modelId);
    const payload: FakeJobPayload = {
      submittedAt: Date.now(),
      idempotencyKey,
      modelId: req.modelId,
      prompt: req.renderedPrompt,
      failureMode: parsed?.mode,
      failuresRemaining: parsed?.count,
      output: req.params.fakeOutput,
      costUsd: req.params.fakeCostUsd as number | undefined,
      pollsRemaining: this.parseSlow(req.modelId),
    };
    // The fake is used by the local restart acceptance harness. Persist the
    // provider's opaque job snapshot in the existing handle payload so a new
    // API process can poll/fetch a job submitted by the old one, just as it
    // would for a real external provider.
    const handle: JobHandle = { providerId: this.id, externalId, payload };
    this.jobs.set(externalId, payload);
    this.submittedKeys.set(idempotencyKey, handle);
    return handle;
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    const job = this.jobFor(handle);
    if (!job) {
      return { done: true, outcome: 'failed', reason: 'unknown job', retryable: false };
    }
    if (job.failureMode === 'timeout') {
      return { done: false, phase: 'running' };
    }
    // §24 "slow, costly fake" — distinct from `timeout` (which never
    // completes): proves a reservation survives multiple real poll/backoff
    // cycles and settles normally once `pollsRemaining` runs out.
    if (job.pollsRemaining !== undefined && job.pollsRemaining > 0) {
      job.pollsRemaining -= 1;
      return { done: false, phase: 'running' };
    }
    if (job.failureMode === 'poll_failed' && this.shouldFailPoll(job.modelId)) {
      return { done: true, outcome: 'failed', reason: 'fake poll failure', retryable: true };
    }
    return { done: true, outcome: 'succeeded' };
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const job = this.jobFor(handle);
    if (!job) {
      throw new Error(`FakeProviderAdapter.fetch: unknown job ${handle.externalId}`);
    }
    if (job.failureMode === 'transport') {
      if (job.failuresRemaining === undefined || job.failuresRemaining > 0) {
        if (job.failuresRemaining !== undefined) job.failuresRemaining -= 1;
        throw new Error('fake transport error');
      }
      // Bounded failure exhausted — fall through to a normal success below,
      // proving a bounded transport blip is absorbed by Inngest's own step
      // retry without ever incrementing attempt_no (§13.2 Rule 2).
    }
    if (job.failureMode === 'malformed') {
      return {
        output: '{not valid json',
        costUsd: job.costUsd ?? 0.001,
        repro: { level: 'exact', seed: '42', providerVersion: job.modelId },
        rawResponse: { fake: true, malformed: true },
      };
    }
    if (job.failureMode === 'schema') {
      // Valid JSON, wrong shape — distinct from 'malformed' (literally
      // unparseable text). Gives the implicit Ajv check (§4.2) something
      // real to reject: a `SchemaViolation` with a real path, not a parse
      // error.
      return {
        output: { unexpectedField: 'not what the schema asked for' },
        costUsd: job.costUsd ?? 0.001,
        repro: { level: 'exact', seed: '42', providerVersion: job.modelId },
        rawResponse: { fake: true, schemaViolation: true },
      };
    }
    if (job.output !== undefined) {
      // Deterministic caller-controlled output via `params.fakeOutput` —
      // flows ProviderRequest.params -> ExecCtx.config -> here, so a
      // blueprint pinning `model.params.fakeOutput` gets that exact value
      // back. Lets a `data`-output stage (or a QC judge call) produce a
      // real structured payload instead of always a string echo. Combines
      // freely with `fakeCostUsd` — a structured payload with a real,
      // non-trivial settled cost.
      return {
        output: job.output,
        costUsd: job.costUsd ?? 0.001,
        repro: { level: 'exact', seed: '42', providerVersion: job.modelId },
        rawResponse: { fake: true, modelId: job.modelId },
      };
    }
    if (job.modelId.startsWith('fake-image-')) {
      return {
        output: { kind: 'media.image', mime: 'image/png', filename: 'fixture.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==' },
        costUsd: job.costUsd ?? 0, repro: { level: 'exact', seed: '42', providerVersion: job.modelId }, rawResponse: { fake: true, fixture: 'png' },
      };
    }
    if (job.modelId.startsWith('fake-audio-')) {
      return {
        output: { kind: 'media.audio', mime: 'audio/wav', filename: 'fixture.wav', base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' },
        costUsd: job.costUsd ?? 0, repro: { level: 'exact', seed: '42', providerVersion: job.modelId }, rawResponse: { fake: true, fixture: 'wav' },
      };
    }
    return {
      output: job.prompt ? `[fake completion for] ${job.prompt}` : '[fake completion]',
      costUsd: job.costUsd ?? 0.001,
      repro: { level: 'exact', seed: '42', providerVersion: job.modelId },
      rawResponse: { fake: true, modelId: job.modelId, prompt: job.prompt },
    };
  }

  async cancel(handle: JobHandle) {
    const job = this.jobFor(handle);
    if (job?.failureMode === 'cancel_unknown') {
      return { confirmed: false, reason: 'fake provider could not confirm cancellation' };
    }
    this.jobs.delete(handle.externalId);
    return { confirmed: true, billed: false };
  }

  /** Test/debug helper — number of distinct jobs actually submitted. */
  submittedJobCount(): number {
    return this.jobs.size;
  }

  /** `fake-text-1:slow:2` reports `{done:false}` for the first two `poll()`
   * calls, then succeeds normally on the third — independent of and
   * combinable with the `fail:`/`fakeOutput`/`fakeCostUsd` knobs (own regex,
   * never matches a `fail:` suffix). */
  private parseSlow(modelId: string): number | undefined {
    const match = /^fake-.*:slow:(\d+)$/.exec(modelId);
    return match ? Number(match[1]) : undefined;
  }

  private jobFor(handle: JobHandle): FakeJobPayload | undefined {
    const inMemory = this.jobs.get(handle.externalId);
    if (inMemory) return inMemory;
    const payload = handle.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    const candidate = payload as Partial<FakeJobPayload>;
    if (typeof candidate.modelId !== 'string' || typeof candidate.idempotencyKey !== 'string')
      return undefined;
    // Keep the reconstructed job locally so subsequent polls retain their
    // slow-provider countdown within the restarted process.
    const restored = candidate as FakeJobPayload;
    this.jobs.set(handle.externalId, restored);
    return restored;
  }

  /** `fake-text-1:fail:transport:2` fails the first two `fetch()` calls,
   * then succeeds — an optional count suffix on top of the original
   * unbounded `fake-text-1:fail:transport` form (count omitted = fail
   * forever, unchanged for existing callers). */
  private parseFailureMode(modelId: string): { mode: string; count?: number } | undefined {
    const match = /^fake-.*:fail:(\w+)(?::(\d+))?$/.exec(modelId);
    if (!match) return undefined;
    const mode = match[1]!;
    const count = match[2] !== undefined ? Number(match[2]) : undefined;
    return count !== undefined ? { mode, count } : { mode };
  }

  /** `undefined` count (`fail:poll_failed` with no suffix) fails forever,
   * matching every other unbounded failure mode's convention. */
  private shouldFailPoll(modelId: string): boolean {
    const parsed = this.parseFailureMode(modelId);
    if (parsed?.mode !== 'poll_failed') return false;
    if (parsed.count === undefined) return true;
    const remaining = this.pollFailedRemaining.get(modelId) ?? parsed.count;
    if (remaining <= 0) return false;
    this.pollFailedRemaining.set(modelId, remaining - 1);
    return true;
  }
}
