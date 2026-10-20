import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeProviderAdapter } from './claude-provider.adapter';

async function fixture(neoUrl = 'http://127.0.0.1:9010/mcp') {
  const root = await mkdtemp(join(tmpdir(), 'reelcraft-claude-provider-'));
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
  const adapter = new ClaudeProviderAdapter({ workspaceRoot: root } as never, launcher as never, {
    browserOsUrl: async () => neoUrl,
  });
  const runnerRequest = async () => {
    const { jobDir } = launcher.launch.mock.calls.at(-1)![0];
    return JSON.parse(await readFile(join(jobDir, 'runner-request.json'), 'utf8'));
  };
  return { root, launcher, adapter, runnerRequest };
}

describe('ClaudeProviderAdapter', () => {
  it('offers text, browser and code, never image generation', async () => {
    const { adapter, launcher } = await fixture();
    expect(adapter.modalities).toEqual(['text', 'browser', 'code']);
    await expect(
      adapter.submit(
        { modality: 'image', modelId: 'sonnet', params: { reasoningEffort: 'medium' } },
        'image',
      ),
    ).rejects.toThrow('Claude does not support modality "image"');
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('sets up the folder of a code job from its workspace, keeping it out of the job params', async () => {
    const { adapter, runnerRequest, launcher } = await fixture();
    await adapter.submit(
      {
        modality: 'code',
        modelId: 'sonnet',
        params: {
          reasoningEffort: 'medium',
          __allowedCommands: ['node preview.mjs'],
          __workspace: {
            files: [
              { path: 'GUIDE.md', contents: '# guide' },
              { path: 'tools/run.mjs', contents: 'run', executable: true },
            ],
          },
        },
        output: { kind: 'data', schema: { type: 'object', properties: {} } },
      },
      'code',
    );
    const { jobDir } = launcher.launch.mock.calls.at(-1)![0];
    expect(await readFile(join(jobDir, 'GUIDE.md'), 'utf8')).toBe('# guide');
    expect(await readFile(join(jobDir, 'tools/run.mjs'), 'utf8')).toBe('run');
    const request = await runnerRequest();
    expect(request.params.__workspace).toBeUndefined();
    expect(request.params.__allowedCommands).toEqual(['node preview.mjs']);
    expect(request.prompt).toContain('There are no input files.');
    expect(request.prompt).toContain('role "download"');
  });

  it.each(['../escape.txt', 'outputs/scene.py', 'status.json', '/etc/passwd'])(
    'refuses a code workspace file at %s',
    async (path) => {
      const { adapter } = await fixture();
      await expect(
        adapter.submit(
          {
            modality: 'code',
            modelId: 'sonnet',
            params: {
              reasoningEffort: 'medium',
              __workspace: { files: [{ path, contents: 'x' }] },
            },
          },
          `bad-${path}`,
        ),
      ).rejects.toThrow(/is not allowed/);
    },
  );

  it('lists the model aliases with their efforts and structured output', async () => {
    const { adapter } = await fixture();
    const models = await adapter.listModels();
    expect(models.map((model) => model.modelId)).toEqual(['sonnet', 'opus', 'fable', 'haiku']);
    expect(models[0]).toMatchObject({
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: 'medium',
      capabilities: { supportsStructuredOutput: true },
    });
    expect(models[0]!.capabilities.image).toBeUndefined();
  });

  it('runs text jobs through the Claude runner dialect at $0', async () => {
    const { adapter, root, runnerRequest } = await fixture();
    const handle = await adapter.submit(
      { modality: 'text', modelId: 'sonnet', params: { reasoningEffort: 'high' } },
      'text',
    );
    expect(handle.providerId).toBe('claude');
    expect(await runnerRequest()).toMatchObject({
      cli: 'claude',
      modelId: 'sonnet',
      reasoningEffort: 'high',
      jobDir: join(root, 'claude-jobs', handle.externalId),
    });
    expect(await adapter.estimate({} as never)).toMatchObject({ expectedUsd: 0, ceilingUsd: 0 });
    await expect(adapter.fetch(handle)).resolves.toMatchObject({ output: 'hello', costUsd: 0 });
  });

  it('sends the authored schema as is (no strict-mode rewrite)', async () => {
    const { adapter, launcher } = await fixture();
    const schema = { type: 'object' as const };
    await adapter.submit(
      {
        modality: 'text',
        modelId: 'sonnet',
        params: { reasoningEffort: 'medium' },
        output: { kind: 'data', schemaName: 'free', schema },
      },
      'data',
    );
    const { jobDir } = launcher.launch.mock.calls[0]![0];
    expect(JSON.parse(await readFile(join(jobDir, 'schema.json'), 'utf8'))).toEqual(schema);
  });

  it('hands browser jobs the Neo address from Settings, as loopback for Neo', async () => {
    const { adapter, runnerRequest } = await fixture('http://host.docker.internal:9010/mcp');
    await adapter.submit(
      { modality: 'browser', modelId: 'sonnet', params: { reasoningEffort: 'medium' } },
      'browser',
    );
    expect((await runnerRequest()).mcpServers).toEqual({
      'browseros-neo': {
        type: 'http',
        url: 'http://host.docker.internal:9010/mcp',
        headers: { Host: '127.0.0.1:9010' },
      },
    });
  });

  it('rejects an effort the model does not take', async () => {
    const { adapter } = await fixture();
    await expect(
      adapter.submit(
        { modality: 'text', modelId: 'sonnet', params: { reasoningEffort: 'turbo' } },
        'effort',
      ),
    ).rejects.toThrow('Unsupported reasoning effort "turbo" for Claude model "sonnet"');
  });
});
