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
      await writeFile(join(jobDir, 'status.json'), JSON.stringify({ state: 'succeeded', exitCode: 0 }));
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
        capabilities: expect.objectContaining({ supportsStructuredOutput: true }),
      }),
    ]);
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
      await writeFile(join(jobDir, 'status.json'), JSON.stringify({ state: 'succeeded', exitCode: 0 }));
      await writeFile(join(jobDir, 'result.txt'), '{"answer":42}');
      return 456;
    });
    const handle = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        renderedPrompt: 'answer',
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
      await readFile(join((launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir, 'manifest.json'), 'utf8'),
    ) as { outputSchemaPath?: string };
    expect(manifest.outputSchemaPath).toMatch(/schema\.json$/);
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
    await expect(adapter.cancel(handle)).resolves.toEqual({ confirmed: true, billed: false });
    await expect(adapter.cancel(handle)).resolves.toEqual({ confirmed: true, billed: false });
    expect(launcher.cancel).toHaveBeenCalledTimes(1);
  });
});
