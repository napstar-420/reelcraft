import { describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter, ProviderRequest } from '../provider/provider-adapter.interface';
import { ProviderRegistry } from '../provider/provider.registry';
import { FakeProviderAdapter } from '../provider/fake/fake-provider.adapter';
import { QcRunner } from './qc-runner.service';
import { buildQcEnvelope } from './qc-envelope';

function makeRunner() {
  const registry = new ProviderRegistry();
  const fake = new FakeProviderAdapter();
  registry.register(fake);
  return { runner: new QcRunner(registry), fake };
}

const envelope = buildQcEnvelope({
  criteria: 'Is this engaging?',
  artifactKind: 'text',
  artifactData: 'a script about coral reefs',
  includeInputs: false,
});

describe('QcRunner', () => {
  it('passes when the judge score meets the threshold', async () => {
    const { runner } = makeRunner();
    const outcome = await runner.run({
      envelope,
      judge: {
        provider: 'fake',
        modelId: 'fake-judge-1',
        params: { fakeOutput: { score: 90, critique: 'Great hook.' } },
      },
      threshold: 70,
      idempotencyKey: 'qc-1',
    });
    expect(outcome.status).toBe('passed');
    if (outcome.status === 'passed') {
      expect(outcome.verdict).toEqual({ score: 90, critique: 'Great hook.' });
    }
  });

  it('fails when the judge score is below the threshold', async () => {
    const { runner } = makeRunner();
    const outcome = await runner.run({
      envelope,
      judge: {
        provider: 'fake',
        modelId: 'fake-judge-1',
        params: { fakeOutput: { score: 50, critique: 'Weak hook.' } },
      },
      threshold: 70,
      idempotencyKey: 'qc-2',
    });
    expect(outcome.status).toBe('failed');
  });

  it("computes the score as the weighted mean of per-dimension scores, not the judge's own top-level score", async () => {
    const { runner } = makeRunner();
    const dimensionedEnvelope = buildQcEnvelope({
      criteria: 'Is this engaging?',
      artifactKind: 'text',
      artifactData: 'x',
      includeInputs: false,
      dimensions: [
        { key: 'hook', description: 'hook', weight: 0.6 },
        { key: 'clarity', description: 'clarity', weight: 0.4 },
      ],
    });
    const outcome = await runner.run({
      envelope: dimensionedEnvelope,
      judge: {
        provider: 'fake',
        modelId: 'fake-judge-1',
        params: {
          fakeOutput: {
            score: 10, // deliberately wrong/ignored — dimensions must win
            critique: 'Mixed.',
            dimensions: [
              { key: 'hook', score: 80 },
              { key: 'clarity', score: 60 },
            ],
          },
        },
      },
      threshold: 0,
      idempotencyKey: 'qc-3',
    });
    expect(outcome.status).toBe('passed');
    if (outcome.status === 'passed') {
      expect(outcome.verdict.score).toBe(72); // 80*0.6 + 60*0.4
    }
  });

  it('reports status "error" when the judge output does not parse as JudgeResponse', async () => {
    const { runner } = makeRunner();
    const outcome = await runner.run({
      envelope,
      judge: { provider: 'fake', modelId: 'fake-judge-1', params: {} }, // no fakeOutput -> plain string echo
      threshold: 70,
      idempotencyKey: 'qc-4',
    });
    expect(outcome.status).toBe('error');
  });

  it("forces temperature to 0 regardless of the pin's own params", async () => {
    const { runner, fake } = makeRunner();
    const before = fake.submittedJobCount();
    await runner.run({
      envelope,
      judge: {
        provider: 'fake',
        modelId: 'fake-judge-1',
        params: { temperature: 0.9, fakeOutput: { score: 80, critique: 'x' } },
      },
      threshold: 0,
      idempotencyKey: 'qc-temp',
    });
    expect(fake.submittedJobCount()).toBe(before + 1);
  });

  it("using the stage's own idempotency key would misfire — QC must use a distinct one", async () => {
    const { runner, fake } = makeRunner();
    const stageKey = 'shared-key-do-not-reuse';

    // The "stage" submits and completes first, under its own key.
    await fake.submit(
      { modelId: 'fake-text-1', renderedPrompt: 'write a script', params: {} },
      stageKey,
    );

    // If QC reused the same key, it would get the stage's own job back
    // (FakeProviderAdapter memoizes by idempotency key) and "judge" a plain
    // string echo, which fails to parse as JudgeResponse -> status 'error'.
    const misusedOutcome = await runner.run({
      envelope,
      judge: { provider: 'fake', modelId: 'fake-judge-1', params: {} },
      threshold: 70,
      idempotencyKey: stageKey,
    });
    expect(misusedOutcome.status).toBe('error');

    // Using a distinct key (the documented contract) works correctly.
    const correctOutcome = await runner.run({
      envelope,
      judge: {
        provider: 'fake',
        modelId: 'fake-judge-1',
        params: { fakeOutput: { score: 90, critique: 'ok' } },
      },
      threshold: 70,
      idempotencyKey: `${stageKey}:qc`,
    });
    expect(correctOutcome.status).toBe('passed');
  });

  it('attaches the artifact image via params.slots when the envelope carries media (§10.3)', async () => {
    const registry = new ProviderRegistry();
    const submit = vi.fn(async (_req: ProviderRequest, _idempotencyKey: string) => ({
      providerId: 'stub-vision',
      externalId: 'job-1',
      payload: {},
    }));
    const stub: ProviderAdapter = {
      id: 'stub-vision',
      modalities: ['text'],
      listModels: async () => [],
      estimate: async () => ({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' }),
      submit,
      poll: async () => ({ done: true, outcome: 'succeeded' }),
      fetch: async () => ({
        output: JSON.stringify({ score: 90, critique: 'Looks right.' }),
        costUsd: 0,
        repro: { level: 'none' },
        rawResponse: {},
      }),
      cancel: async () => ({ confirmed: true }),
    };
    registry.register(stub);
    const runner = new QcRunner(registry);

    const mediaEnvelope = buildQcEnvelope({
      criteria: 'Is this a lighthouse at sunset?',
      artifactKind: 'media.image',
      artifactData: undefined,
      includeInputs: false,
      media: { sourceKey: 'run/abc/blob-1.png', mime: 'image/png' },
    });

    const outcome = await runner.run({
      envelope: mediaEnvelope,
      judge: { provider: 'stub-vision', modelId: 'stub', params: {} },
      threshold: 70,
      idempotencyKey: 'qc-media-1',
    });

    expect(outcome.status).toBe('passed');
    const [request] = submit.mock.calls[0]!;
    expect(request.params).toMatchObject({
      slots: { qcArtifact: { sourceKey: 'run/abc/blob-1.png' } },
    });
  });

  it('attaches every clip of a video list and keeps only the failed clip indexes it judged', async () => {
    const registry = new ProviderRegistry();
    const submit = vi.fn(async (_req: ProviderRequest, _key: string) => ({
      providerId: 'stub-video',
      externalId: 'job-1',
    }));
    registry.register({
      id: 'stub-video',
      modalities: ['text'],
      listModels: async () => [],
      estimate: async () => ({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' }),
      submit,
      poll: async () => ({ done: true, outcome: 'succeeded' }),
      fetch: async () => ({
        output: JSON.stringify({
          score: 40,
          critique: 'Scene 2 has the wrong background.',
          failedClips: [2, 2, 9],
        }),
        costUsd: 0,
        repro: { level: 'none' },
        rawResponse: {},
      }),
      cancel: async () => ({ confirmed: true }),
    } as ProviderAdapter);
    const clipEnvelope = buildQcEnvelope({
      criteria: 'Same character and studio in every clip',
      artifactKind: 'media.video_list',
      artifactData: { clips: [] },
      includeInputs: false,
      clips: [
        { sourceKey: 'run/a/1.mp4', mime: 'video/mp4', index: 1, label: 'Scene 1' },
        { sourceKey: 'run/a/2.mp4', mime: 'video/mp4', index: 2, label: 'Scene 2' },
      ],
    });

    const outcome = await new QcRunner(registry).run({
      envelope: clipEnvelope,
      judge: { provider: 'stub-video', modelId: 'stub', params: {} },
      threshold: 70,
      idempotencyKey: 'qc-clips-1',
    });

    const [request] = submit.mock.calls[0]!;
    expect(request.params).toMatchObject({
      __inspectFiles: true,
      slots: { qcClip1: { sourceKey: 'run/a/1.mp4' }, qcClip2: { sourceKey: 'run/a/2.mp4' } },
    });
    expect(request.system).toContain('Scene 1 (index 1), Scene 2 (index 2)');
    expect(request.system).toContain('failedClips');
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.verdict.failedClips).toEqual([2]);
  });

  it('judges an image list as one set with one verdict', async () => {
    const registry = new ProviderRegistry();
    const submit = vi.fn(async (_req: ProviderRequest, _key: string) => ({
      providerId: 'stub-images',
      externalId: 'job-1',
    }));
    registry.register({
      id: 'stub-images',
      modalities: ['text'],
      listModels: async () => [],
      estimate: async () => ({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' }),
      submit,
      poll: async () => ({ done: true, outcome: 'succeeded' }),
      fetch: async () => ({
        output: JSON.stringify({
          score: 85,
          critique: 'Image 2 is off style but the set works.',
          // Only a clip list can name pieces to redo; a whole set is one verdict.
          failedClips: [1],
        }),
        costUsd: 0,
        repro: { level: 'none' },
        rawResponse: {},
      }),
      cancel: async () => ({ confirmed: true }),
    } as ProviderAdapter);
    const envelope = buildQcEnvelope({
      criteria: 'One consistent look',
      artifactKind: 'media.image_list',
      artifactData: { images: [] },
      includeInputs: false,
      images: [
        { sourceKey: 'run/a/1.png', mime: 'image/png', index: 0, label: 'Image 1' },
        { sourceKey: 'run/a/2.png', mime: 'image/png', index: 1, label: 'Image 2' },
      ],
    });

    const outcome = await new QcRunner(registry).run({
      envelope,
      judge: { provider: 'stub-images', modelId: 'stub', params: {} },
      threshold: 70,
      idempotencyKey: 'qc-images-1',
    });

    const [request] = submit.mock.calls[0]!;
    expect(request.params).toMatchObject({
      slots: { qcImage1: { sourceKey: 'run/a/1.png' }, qcImage2: { sourceKey: 'run/a/2.png' } },
    });
    // A judge other than Codex gets the images attached, not asked to open files.
    expect(request.params).not.toHaveProperty('__inspectFiles');
    expect(request.system).toContain('set of 2 images');
    expect(request.system).toContain('Image 1 (index 0), Image 2 (index 1)');
    expect(request.system).toContain('accepted or rejected together');
    expect(request.system).not.toContain('Add "failedClips"');
    expect(outcome.status).toBe('passed');
    if (outcome.status === 'passed') expect(outcome.verdict).not.toHaveProperty('failedClips');
  });

  describe('picking the best of several candidate images', () => {
    function judgeReturning(output: Record<string, unknown>) {
      const registry = new ProviderRegistry();
      const submit = vi.fn(async (_req: ProviderRequest, _key: string) => ({
        providerId: 'stub-pick',
        externalId: 'job-1',
      }));
      registry.register({
        id: 'stub-pick',
        modalities: ['text'],
        listModels: async () => [],
        estimate: async () => ({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' }),
        submit,
        poll: async () => ({ done: true, outcome: 'succeeded' }),
        fetch: async () => ({
          output: JSON.stringify(output),
          costUsd: 0,
          repro: { level: 'none' },
          rawResponse: {},
        }),
        cancel: async () => ({ confirmed: true }),
      } as ProviderAdapter);
      return { runner: new QcRunner(registry), submit };
    }
    const envelope = buildQcEnvelope({
      criteria: 'Sharp',
      artifactKind: 'media.image',
      artifactData: undefined,
      includeInputs: false,
      selectBest: true,
      images: [
        { sourceKey: 'run/a/1.png', mime: 'image/png', index: 0, label: 'Image 1' },
        { sourceKey: 'run/a/3.png', mime: 'image/png', index: 2, label: 'Image 3' },
      ],
    });
    const run = (runner: QcRunner) =>
      runner.run({
        envelope,
        judge: { provider: 'stub-pick', modelId: 'stub', params: {} },
        threshold: 70,
        idempotencyKey: 'qc-pick-1',
      });

    it('asks the judge to choose and returns the image it chose', async () => {
      const { runner, submit } = judgeReturning({ score: 90, critique: 'Best', bestImage: 2 });
      const outcome = await run(runner);
      const [request] = submit.mock.calls[0]!;
      expect(request.system).toContain('2 candidates');
      expect(request.system).toContain('"bestImage"');
      expect(request.params).toMatchObject({
        slots: { qcImage1: { sourceKey: 'run/a/1.png' }, qcImage2: { sourceKey: 'run/a/3.png' } },
      });
      expect(outcome.status).toBe('passed');
      if (outcome.status === 'passed') expect(outcome.verdict.selectedImage).toBe(2);
    });

    it('still reports the best candidate when it scores under the threshold', async () => {
      const { runner } = judgeReturning({ score: 40, critique: 'All soft', bestImage: 0 });
      const outcome = await run(runner);
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') expect(outcome.verdict.selectedImage).toBe(0);
    });

    it('is a judge error when it names no candidate, or one it was not shown', async () => {
      for (const output of [
        { score: 90, critique: 'Fine' },
        { score: 90, critique: 'Fine', bestImage: 1 },
      ]) {
        const outcome = await run(judgeReturning(output).runner);
        expect(outcome.status).toBe('error');
      }
    });
  });

  it('has a Codex judge open the images of a list itself', async () => {
    const registry = new ProviderRegistry();
    const submit = vi.fn(async (_req: ProviderRequest, _key: string) => ({
      providerId: 'codex',
      externalId: 'job-1',
    }));
    registry.register({
      id: 'codex',
      modalities: ['text'],
      listModels: async () => [],
      estimate: async () => ({ expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' }),
      submit,
      poll: async () => ({ done: true, outcome: 'succeeded' }),
      fetch: async () => ({
        output: JSON.stringify({ score: 90, critique: 'fine' }),
        costUsd: 0,
        repro: { level: 'none' },
        rawResponse: {},
      }),
      cancel: async () => ({ confirmed: true }),
    } as ProviderAdapter);
    const envelope = buildQcEnvelope({
      criteria: 'One consistent look',
      artifactKind: 'media.image_list',
      artifactData: { images: [] },
      includeInputs: false,
      images: [{ sourceKey: 'run/a/1.png', mime: 'image/png', index: 0, label: 'Image 1' }],
    });

    await new QcRunner(registry).run({
      envelope,
      judge: { provider: 'codex', modelId: 'gpt-example', params: {} },
      threshold: 70,
      idempotencyKey: 'qc-images-codex',
    });

    const [request] = submit.mock.calls[0]!;
    expect(request.params).toMatchObject({
      __inspectFiles: true,
      slots: { qcImage1: { sourceKey: 'run/a/1.png' } },
    });
  });
});
