import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
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

  it('reports a deadline derived from startedAt plus the job timeout while running', async () => {
    const { adapter, launcher } = await fixture();
    const handle = await adapter.submit(
      {
        modelId: 'gpt-example',
        params: { reasoningEffort: 'low' },
        output: { kind: 'text' },
      },
      'deadline-key',
    );
    const jobDir = (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir;
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    await writeFile(
      join(jobDir, 'status.json'),
      JSON.stringify({ state: 'running', pid: process.pid, startedAt }),
    );
    const status = await adapter.poll(handle);
    expect(status).toEqual(
      expect.objectContaining({ done: false, phase: 'running', deadlineMs: expect.any(Number) }),
    );
    if (status.done) throw new Error('expected an in-progress status');
    // Default jobTimeoutMs is 900_000ms (15 minutes) — see engine-config.ts.
    expect(status.deadlineMs).toBeCloseTo(Date.parse(startedAt) + 900_000, -2);
  });

  describe('text jobs that inspect files', () => {
    const slots = { qcClip1: { sourceKey: 'run/a/1.mp4' } };
    const request = (params: Record<string, unknown>) => ({
      modelId: 'gpt-example',
      params: { reasoningEffort: 'low', slots, ...params },
      output: { kind: 'text' as const },
    });

    it('still refuses attached files unless the job is a file inspection', async () => {
      const { adapter } = await fixture();
      await expect(adapter.submit(request({}), 'plain')).rejects.toThrow(
        /cannot read attached files/,
      );
    });

    it('materializes the files for a file inspection and lists them in the prompt', async () => {
      const { root, launcher } = await fixture();
      const materialize = vi.fn(async () => ['inputs/1-1.mp4']);
      const adapter = new CodexProviderAdapter(
        { workspaceRoot: root } as never,
        {
          listModels: async () => [
            { modelId: 'gpt-example', label: 'x', supportedReasoningEfforts: ['low'] },
          ],
        } as never,
        launcher as never,
        undefined,
        { materialize } as never,
      );
      await adapter.submit(request({ __inspectFiles: true }), 'inspect');
      expect(materialize).toHaveBeenCalledWith(expect.any(String), slots, 20);
      const jobDir = (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir;
      const runner = JSON.parse(await readFile(join(jobDir, 'runner-request.json'), 'utf8'));
      expect(runner.prompt).toContain('Files to inspect, in order: inputs/1-1.mp4');
    });
  });

  describe('browser jobs with a progress directory', () => {
    const request = (extra: Record<string, unknown> = {}) => ({
      modality: 'browser' as const,
      modelId: 'gpt-example',
      params: { reasoningEffort: 'low', progressKey: 'a'.repeat(32), ...extra },
      output: {
        kind: 'data' as const,
        schema: { type: 'object' as const, properties: { ok: { type: 'string' as const } } },
      },
    });

    it('shares one progress directory across attempts and returns files saved in it', async () => {
      const { adapter, launcher, root } = await fixture();
      const dirs: string[] = [];
      launcher.launch.mockImplementation(async ({ jobDir }: { jobDir: string }) => {
        dirs.push(jobDir);
        await mkdir(join(jobDir, 'progress', 'clips'), { recursive: true });
        await writeFile(join(jobDir, 'progress', 'clips', '001.mp4'), 'clip');
        await writeFile(
          join(jobDir, 'result.json'),
          JSON.stringify({
            version: 1,
            output: { ok: 'yes' },
            attachments: [
              {
                path: 'progress/clips/001.mp4',
                mime: 'video/mp4',
                filename: '001.mp4',
                role: 'download',
              },
            ],
          }),
        );
        await writeFile(join(jobDir, 'status.json'), JSON.stringify({ state: 'succeeded' }));
        return 1;
      });
      const first = await adapter.submit(request(), 'attempt-1');
      const second = await adapter.submit(request(), 'attempt-2');
      expect(dirs).toHaveLength(2);
      expect(await realpath(join(dirs[0]!, 'progress'))).toBe(
        await realpath(join(dirs[1]!, 'progress')),
      );
      expect(await realpath(join(dirs[0]!, 'progress'))).toBe(
        await realpath(join(root, 'codex-jobs', 'progress', 'a'.repeat(32))),
      );
      const result = await adapter.fetch(second);
      expect(result.attachments).toEqual([
        expect.objectContaining({ role: 'download', filename: '001.mp4' }),
      ]);
      expect(first.externalId).not.toBe(second.externalId);
    });

    it('still refuses paths outside outputs/ and progress/', async () => {
      const { adapter, launcher, root } = await fixture();
      await writeFile(join(root, 'secret.txt'), 'nope');
      launcher.launch.mockImplementationOnce(async ({ jobDir }: { jobDir: string }) => {
        await writeFile(
          join(jobDir, 'result.json'),
          JSON.stringify({
            version: 1,
            output: { ok: 'yes' },
            attachments: [
              { path: '../../secret.txt', mime: 'text/plain', filename: 's.txt', role: 'download' },
            ],
          }),
        );
        await writeFile(join(jobDir, 'status.json'), JSON.stringify({ state: 'succeeded' }));
        return 1;
      });
      const handle = await adapter.submit(request(), 'escape');
      await expect(adapter.fetch(handle)).rejects.toThrow(/escapes the job output directory/);
    });

    it('ignores a malformed progress key and honours per-job limits', async () => {
      const { adapter, launcher } = await fixture();
      const handle = await adapter.submit(
        request({ progressKey: '../../etc', timeoutMs: 3_600_000, maxSteps: 900 }),
        'limits',
      );
      const jobDir = (launcher.launch.mock.calls[0]?.[0] as { jobDir: string }).jobDir;
      await expect(realpath(join(jobDir, 'progress'))).rejects.toThrow();
      const runner = JSON.parse(await readFile(join(jobDir, 'runner-request.json'), 'utf8'));
      expect(runner).toMatchObject({ timeoutMs: 3_600_000, browserMaxSteps: 900 });
      const startedAt = new Date(Date.now() - 1000).toISOString();
      await writeFile(
        join(jobDir, 'status.json'),
        JSON.stringify({ state: 'running', pid: process.pid, startedAt }),
      );
      const status = await adapter.poll(handle);
      if (status.done) throw new Error('expected running');
      expect(status.deadlineMs).toBeCloseTo(Date.parse(startedAt) + 3_600_000, -2);
    });
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
