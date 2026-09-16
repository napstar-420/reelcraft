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
}

/**
 * §22 — a fake provider is a first-class component, not a test fixture. It
 * lands in phase 1 so the retry loop, idempotency, and budget paths all
 * have a free, deterministic, injectable-failure counterpart from day one.
 *
 * Failure modes are selected via a `fake-text-1:fail:<mode>` modelId suffix:
 * `timeout`, `malformed`, `transport`.
 */
@Injectable()
export class FakeProviderAdapter implements ProviderAdapter {
  readonly id = 'fake';
  readonly modalities = ['text', 'image', 'video'];

  /** idempotency key -> job, so a transport retry submitting twice is
   * observable in tests as "one job per key". */
  private readonly submittedKeys = new Map<string, JobHandle>();
  private readonly jobs = new Map<string, FakeJobPayload>();

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
    ];
  }

  async estimate(req: ProviderRequest): Promise<CostEstimate> {
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
    const handle: JobHandle = { providerId: this.id, externalId };
    this.jobs.set(externalId, {
      submittedAt: Date.now(),
      idempotencyKey,
      modelId: req.modelId,
      prompt: req.renderedPrompt,
      failureMode: this.parseFailureMode(req.modelId),
    });
    this.submittedKeys.set(idempotencyKey, handle);
    return handle;
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    const job = this.jobs.get(handle.externalId);
    if (!job) {
      return { done: true, outcome: 'failed', reason: 'unknown job', retryable: false };
    }
    if (job.failureMode === 'timeout') {
      return { done: false, phase: 'running' };
    }
    return { done: true, outcome: 'succeeded' };
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const job = this.jobs.get(handle.externalId);
    if (!job) {
      throw new Error(`FakeProviderAdapter.fetch: unknown job ${handle.externalId}`);
    }
    if (job.failureMode === 'transport') {
      throw new Error('fake transport error');
    }
    if (job.failureMode === 'malformed') {
      return {
        output: '{not valid json',
        costUsd: 0.001,
        repro: { level: 'exact', seed: '42', providerVersion: job.modelId },
        rawResponse: { fake: true, malformed: true },
      };
    }
    return {
      output: job.prompt ? `[fake completion for] ${job.prompt}` : '[fake completion]',
      costUsd: 0.001,
      repro: { level: 'exact', seed: '42', providerVersion: job.modelId },
      rawResponse: { fake: true, modelId: job.modelId, prompt: job.prompt },
    };
  }

  async cancel(handle: JobHandle): Promise<void> {
    this.jobs.delete(handle.externalId);
  }

  /** Test/debug helper — number of distinct jobs actually submitted. */
  submittedJobCount(): number {
    return this.jobs.size;
  }

  private parseFailureMode(modelId: string): string | undefined {
    const match = /^fake-.*:fail:(\w+)$/.exec(modelId);
    return match?.[1];
  }
}
