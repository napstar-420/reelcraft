import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CodexProviderAdapter } from './codex-provider.adapter';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reelcraft-codex-provider-'));
  const models = {
    listModels: vi.fn().mockResolvedValue([
      {
        modelId: 'gpt-example',
        label: 'Example',
        supportedReasoningEfforts: ['low', 'high'],
        defaultReasoningEffort: 'low',
      },
    ]),
  };
  const launcher = {
    launch: vi.fn(async ({ jobDir }: { jobDir: string }) => {
      await writeFile(
        join(jobDir, 'status.json'),
        JSON.stringify({ state: 'succeeded', exitCode: 0 }),
      );
      await writeFile(join(jobDir, 'result.txt'), 'hello');
      return 123;
    }),
    cancel: vi.fn().mockResolvedValue(true),
  };
  const adapter = new CodexProviderAdapter(
    { workspaceRoot: root } as never,
    models as never,
    launcher as never,
  );
  return { root, models, launcher, adapter };
}

describe('CodexProviderAdapter', () => {
  it('advertises text models with structured output and reasoning metadata', async () => {
    const { adapter } = await fixture();
    await expect(adapter.listModels()).resolves.toEqual([
      expect.objectContaining({
        modelId: 'gpt-example',
        supportedReasoningEfforts: ['low', 'high'],
        defaultReasoningEffort: 'low',
        modalities: ['text', 'image', 'browser'],
        capabilities: expect.objectContaining({ supportsStructuredOutput: true }),
      }),
    ]);
  });

  it('returns generated image files from the confined output directory', async () => {
    const { adapter, launcher } = await fixture();
    launcher.launch.mockImplementationOnce(async ({ jobDir }: { jobDir: string }) => {
      await writeFile(join(jobDir, 'outputs', 'image.png'), 'png-bytes');
      await writeFile(
        join(jobDir, 'result.json'),
        JSON.stringify({
          version: 1,
          output: { path: 'outputs/image.png', mime: 'image/png', filename: 'image.png' },
        }),
      );
      await writeFile(join(jobDir, 'status.json'), JSON.stringify({ state: 'succeeded' }));
      return 321;
    });
    const handle = await adapter.submit(
      {
        modality: 'image',
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        output: { kind: 'media.image' },
      },
      'image-key',
    );
    await expect(adapter.fetch(handle)).resolves.toEqual(
      expect.objectContaining({
        output: expect.objectContaining({
          kind: 'media.image',
          mime: 'image/png',
          filename: 'image.png',
        }),
      }),
    );
  });

  it('returns structured browser data and supporting evidence', async () => {
    const { adapter, launcher } = await fixture();
    launcher.launch.mockImplementationOnce(async ({ jobDir }: { jobDir: string }) => {
      await writeFile(join(jobDir, 'outputs', 'final.png'), 'screenshot');
      await writeFile(
        join(jobDir, 'result.json'),
        JSON.stringify({
          version: 1,
          output: { title: 'Done' },
          attachments: [
            {
              path: 'outputs/final.png',
              mime: 'image/png',
              filename: 'final.png',
              role: 'evidence',
            },
          ],
        }),
      );
      await writeFile(join(jobDir, 'status.json'), JSON.stringify({ state: 'succeeded' }));
      return 654;
    });
    const handle = await adapter.submit(
      {
        modality: 'browser',
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low', startUrl: 'https://example.com' },
        output: {
          kind: 'data',
          schema: { type: 'object', properties: { title: { type: 'string' } } },
        },
      },
      'browser-key',
    );
    await expect(adapter.fetch(handle)).resolves.toEqual(
      expect.objectContaining({
        output: { title: 'Done' },
        attachments: [expect.objectContaining({ role: 'evidence', filename: 'final.png' })],
      }),
    );
  });

  it('uses zero-cost accounting and launches once per idempotency key', async () => {
    const { adapter, launcher } = await fixture();
    const req = {
      modelId: 'gpt-example',
      params: { reasoningEffort: 'high' },
      renderedPrompt: 'hello',
      output: { kind: 'text' as const },
    };
    await expect(adapter.estimate(req)).resolves.toEqual({
      expectedUsd: 0,
      ceilingUsd: 0,
      basis: 'configured_ceiling',
    });
    const first = await adapter.submit(req, 'same-key');
    const second = await adapter.submit(req, 'same-key');
    expect(second).toEqual(first);
    expect(launcher.launch).toHaveBeenCalledTimes(1);
    await expect(adapter.poll(first)).resolves.toEqual({ done: true, outcome: 'succeeded' });
    await expect(adapter.fetch(first)).resolves.toEqual(
      expect.objectContaining({ output: 'hello', costUsd: 0 }),
    );
  });

  it('parses structured output and writes the requested schema', async () => {
    const { adapter, launcher } = await fixture();
    launcher.launch.mockImplementationOnce(async ({ jobDir }: { jobDir: string }) => {
      await writeFile(
        join(jobDir, 'status.json'),
        JSON.stringify({ state: 'succeeded', exitCode: 0 }),
      );
      await writeFile(join(jobDir, 'result.txt'), '{"answer":42}');
      return 456;
    });
    const handle = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low', apiKey: 'must-not-persist' },
        renderedPrompt:
          'answer\n\n<output_contract>\n<stage_output_instructions>\nBe concise.\n</stage_output_instructions>\n</output_contract>',
        output: {
          kind: 'data',
          schemaName: 'answer',
          schema: {
            type: 'object',
            properties: { answer: { type: 'number' } },
            required: ['answer'],
          },
        },
      },
      'structured-key',
    );
    await expect(adapter.fetch(handle)).resolves.toEqual(
      expect.objectContaining({ output: { answer: 42 } }),
    );
    const manifest = JSON.parse(
      await readFile(
        join((launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir, 'manifest.json'),
        'utf8',
      ),
    ) as { outputSchemaPath?: string; params: Record<string, unknown> };
    expect(manifest.outputSchemaPath).toMatch(/schema\.json$/);
    expect(manifest.params.apiKey).toBe('[REDACTED]');
    const runnerRequest = JSON.parse(
      await readFile(
        join(
          (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir,
          'runner-request.json',
        ),
        'utf8',
      ),
    ) as { outputSchemaPath?: string; prompt: string };
    expect(runnerRequest.outputSchemaPath).toMatch(/schema\.json$/);
    expect(runnerRequest.prompt).toContain(
      '<user_prompt>\nanswer\n\n<output_contract>\n<stage_output_instructions>\nBe concise.\n</stage_output_instructions>\n</output_contract>\n</user_prompt>',
    );
  });

  it('rejects unsupported efforts before launching', async () => {
    const { adapter, launcher } = await fixture();
    await expect(
      adapter.submit(
        {
          modelId: 'gpt-example',
          params: { reasoningEffort: 'ultra' },
          renderedPrompt: 'hello',
          output: { kind: 'text' },
        },
        'bad-effort',
      ),
    ).rejects.toThrow(/unsupported reasoning effort/i);
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('cancels repeatedly without billing', async () => {
    const { adapter, launcher } = await fixture();
    const handle = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        output: { kind: 'text' },
      },
      'cancel-key',
    );
    const jobDir = (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir;
    await writeFile(join(jobDir, 'status.json'), JSON.stringify({ state: 'running', pid: 123 }));
    await expect(adapter.cancel(handle)).resolves.toEqual({ confirmed: true, billed: false });
    await expect(adapter.cancel(handle)).resolves.toEqual({ confirmed: true, billed: false });
    expect(launcher.cancel).toHaveBeenCalledTimes(1);
  });

  it('recovers a completed durable job after an API restart', async () => {
    const { root, models, launcher, adapter } = await fixture();
    const request = {
      modelId: 'gpt-example',
      params: { reasoningEffort: 'low' },
      output: { kind: 'text' as const },
    };
    const handle = await adapter.submit(request, 'restart-key');
    const restarted = new CodexProviderAdapter(
      { workspaceRoot: root } as never,
      models as never,
      launcher as never,
    );
    await expect(restarted.poll(handle)).resolves.toEqual({ done: true, outcome: 'succeeded' });
    await expect(restarted.fetch(handle)).resolves.toEqual(
      expect.objectContaining({ output: 'hello' }),
    );
  });

  it('classifies a lost runner after restart as retryable infrastructure failure', async () => {
    const { adapter, launcher } = await fixture();
    const handle = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        output: { kind: 'text' },
      },
      'lost-key',
    );
    const jobDir = (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir;
    await writeFile(
      join(jobDir, 'status.json'),
      JSON.stringify({ state: 'queued', createdAt: new Date(0).toISOString() }),
    );
    await expect(adapter.poll(handle)).resolves.toEqual(
      expect.objectContaining({
        done: true,
        outcome: 'failed',
        retryable: true,
        failureClass: 'infrastructure',
      }),
    );
    await writeFile(
      join(jobDir, 'status.json'),
      JSON.stringify({ state: 'running', pid: 999_999_999 }),
    );
    await expect(adapter.poll(handle)).resolves.toEqual(
      expect.objectContaining({
        done: true,
        outcome: 'failed',
        retryable: true,
        failureClass: 'infrastructure',
      }),
    );
  });

  it('surfaces provider process failures and malformed structured output', async () => {
    const { adapter, launcher } = await fixture();
    const failed = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        output: { kind: 'text' },
      },
      'failed-key',
    );
    const failedDir = (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir;
    await writeFile(
      join(failedDir, 'status.json'),
      JSON.stringify({ state: 'failed', reason: 'exit 7' }),
    );
    await expect(adapter.poll(failed)).resolves.toEqual(
      expect.objectContaining({ done: true, outcome: 'failed', retryable: false }),
    );

    const malformed = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        output: { kind: 'data', schema: { type: 'object' } },
      },
      'malformed-key',
    );
    const malformedDir = (launcher.launch.mock.calls[1]?.[0] as { jobDir: string }).jobDir;
    await writeFile(join(malformedDir, 'result.txt'), '{not-json');
    await expect(adapter.fetch(malformed)).rejects.toThrow(/malformed structured JSON/i);
  });

  it('rejects final messages above the durable output limit', async () => {
    const { adapter, launcher } = await fixture();
    const handle = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        output: { kind: 'text' },
      },
      'oversized-key',
    );
    const jobDir = (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir;
    await writeFile(join(jobDir, 'result.txt'), 'x'.repeat(4 * 1024 * 1024 + 1));
    await expect(adapter.fetch(handle)).rejects.toThrow(/4 MiB output limit/i);
  });
});
