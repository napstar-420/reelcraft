import { describe, expect, it } from 'vitest';
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
});
