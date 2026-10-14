import { describe, expect, it, vi } from 'vitest';
import { BrowserAutomateCapability } from './browser-automate.capability';

describe('BrowserAutomateCapability', () => {
  it('submits an explicit browser request and forwards evidence', async () => {
    const adapter = {
      estimate: vi.fn().mockResolvedValue({ expectedUsd: 0, ceilingUsd: 0 }),
      submit: vi.fn().mockResolvedValue({ providerId: 'codex', externalId: 'job' }),
      poll: vi.fn(),
      fetch: vi.fn().mockResolvedValue({
        output: { title: 'done' },
        attachments: [
          {
            role: 'evidence',
            localPath: '/tmp/evidence.png',
            mime: 'image/png',
            filename: 'evidence.png',
          },
        ],
        costUsd: 0,
        repro: { level: 'approximate' },
      }),
    };
    const capability = new BrowserAutomateCapability({ get: () => adapter } as never);
    const ctx = {
      runId: 'run',
      stageKey: 'browse',
      attemptNo: 1,
      config: {
        provider: 'codex',
        modelId: 'gpt-example',
        startUrl: 'https://example.com',
        params: { reasoningEffort: 'low' },
      },
      slots: {},
      context: {},
      renderedPrompt: 'Read the title',
      output: { kind: 'data' as const, schema: { type: 'object' as const } },
      idempotencyKey: 'key',
      logger: { log: vi.fn(), error: vi.fn() },
    };
    const handle = await capability.submit(ctx);
    expect(adapter.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'browser',
        params: expect.objectContaining({ startUrl: 'https://example.com' }),
      }),
      'key',
    );
    await expect(capability.fetch(handle, ctx)).resolves.toEqual(
      expect.objectContaining({ attachments: [expect.objectContaining({ role: 'evidence' })] }),
    );
  });

  it('rejects non-http start URLs', () => {
    const capability = new BrowserAutomateCapability({} as never);
    expect(
      capability.validate(
        { provider: 'codex', modelId: 'gpt-example', startUrl: 'file:///etc/passwd' },
        { output: { kind: 'data', schema: { type: 'object' } } } as never,
      ),
    ).toEqual([expect.objectContaining({ path: 'config.startUrl', severity: 'error' })]);
  });

  describe('downloading files', () => {
    const attachment = (filename: string, mime: string, role = 'download') => ({
      role,
      localPath: `/jobs/outputs/${filename}`,
      mime,
      filename,
    });
    const file = (filename: string) => ({
      filename,
      label: `Label ${filename}`,
      sourceUrl: `https://cdn.example.com/${filename}`,
      pageUrl: 'https://example.com/page',
      license: 'CC0',
      author: 'Someone',
    });
    const manifest = (files: unknown[], status = 'completed', errorCode = '') => ({
      status,
      errorCode,
      errorMessage: status === 'error' ? 'Nothing found' : '',
      files,
    });
    const setup = (
      output: Record<string, unknown>,
      config: Record<string, unknown> = {},
      attachments: unknown[] = [],
    ) => {
      const adapter = {
        estimate: vi.fn().mockResolvedValue({ expectedUsd: 0, ceilingUsd: 0 }),
        submit: vi.fn().mockResolvedValue({ providerId: 'codex', externalId: 'job' }),
        poll: vi.fn(),
        fetch: vi.fn().mockResolvedValue({
          output: undefined,
          attachments,
          costUsd: 0,
          repro: { level: 'approximate' },
        }),
      };
      const capability = new BrowserAutomateCapability({ get: () => adapter } as never);
      const ctx = {
        runId: 'run',
        stageKey: 'sfx',
        attemptNo: 1,
        config: { provider: 'codex', modelId: 'gpt-example', ...config },
        slots: {},
        context: {},
        renderedPrompt: 'Find a short pencil scribble sound',
        systemPrompt: 'House rules',
        output,
        idempotencyKey: 'key',
        logger: { log: vi.fn(), error: vi.fn() },
      };
      return { adapter, capability, ctx: ctx as never };
    };
    const handle = { providerId: 'codex', externalId: 'job' };
    it('allows data and downloaded files as outputs', () => {
      const { capability } = setup({ kind: 'data' });
      expect(capability.allowedOutputs()).toEqual([
        'data',
        'media.audio',
        'media.image',
        'media.video',
        'media.image_list',
        'media.video_list',
      ]);
    });

    it('asks the agent for a download manifest and gives it download instructions', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.audio' });
      await capability.submit(ctx);
      const request = adapter.submit.mock.calls[0]![0];
      expect(request.output).toEqual(
        expect.objectContaining({
          kind: 'data',
          schema: expect.objectContaining({
            required: expect.arrayContaining(['status', 'files']),
          }),
        }),
      );
      expect(request.system).toContain('exactly one file');
      expect(request.system).toContain('House rules');
      expect(request.params).toEqual(
        expect.objectContaining({ timeoutMs: 1_200_000, maxSteps: 200 }),
      );
    });

    it('keeps the stage config in charge of the job limits', async () => {
      const { adapter, capability, ctx } = setup(
        { kind: 'media.video_list' },
        { params: { maxSteps: 40 } },
      );
      await capability.submit(ctx);
      expect(adapter.submit.mock.calls[0]![0].params).toEqual(
        expect.objectContaining({ maxSteps: 40 }),
      );
      expect(adapter.submit.mock.calls[0]![0].system).toContain('up to 10 files');
    });

    it('returns one downloaded audio file as the output with its licence in the log', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.audio' });
      adapter.fetch.mockResolvedValue({
        output: manifest([file('scribble.mp3')]),
        attachments: [
          attachment('scribble.mp3', 'audio/mpeg'),
          attachment('licence.png', 'image/png', 'evidence'),
        ],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.output).toEqual({
        kind: 'media.audio',
        localPath: '/jobs/outputs/scribble.mp3',
        mime: 'audio/mpeg',
        filename: 'scribble.mp3',
      });
      expect(result.attachments).toEqual([expect.objectContaining({ filename: 'licence.png' })]);
      expect(result.providerMeta).toEqual({
        downloads: [expect.objectContaining({ license: 'CC0', author: 'Someone' })],
      });
      expect(result.rejection).toBeUndefined();
    });

    it('returns an image list in the shape the runner reads', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.image_list' });
      adapter.fetch.mockResolvedValue({
        output: manifest([file('a.png'), file('b.png')]),
        attachments: [attachment('a.png', 'image/png'), attachment('b.png', 'image/png')],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.output).toEqual({
        images: [
          expect.objectContaining({ kind: 'media.image', filename: 'a.png' }),
          expect.objectContaining({ kind: 'media.image', filename: 'b.png' }),
        ],
      });
    });

    it('returns a video list with the licence kept on each clip', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.video_list' });
      adapter.fetch.mockResolvedValue({
        output: manifest([file('001.mp4')]),
        attachments: [attachment('001.mp4', 'video/mp4')],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.output).toEqual({
        clips: [
          {
            index: 0,
            label: 'Label 001.mp4',
            prompt: 'Licence: CC0. Author: Someone. Source: https://example.com/page',
            source: expect.objectContaining({ kind: 'media.video', filename: '001.mp4' }),
          },
        ],
      });
    });

    it('rejects a download whose type does not match the output', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.audio' });
      adapter.fetch.mockResolvedValue({
        output: manifest([file('page.html')]),
        attachments: [attachment('page.html', 'text/html')],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.rejection).toContain('text/html');
    });

    it('rejects a listed file that was not attached', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.audio' });
      adapter.fetch.mockResolvedValue({
        output: manifest([file('missing.mp3')]),
        attachments: [],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.rejection).toContain('missing.mp3');
    });

    it('rejects more files than the stage allows', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.image_list' }, { maxFiles: 1 });
      adapter.fetch.mockResolvedValue({
        output: manifest([file('a.png'), file('b.png')]),
        attachments: [attachment('a.png', 'image/png'), attachment('b.png', 'image/png')],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.rejection).toContain('allows 1');
    });

    it('passes on what the agent says went wrong', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.audio' });
      adapter.fetch.mockResolvedValue({
        output: manifest([], 'error', 'input_mismatch'),
        attachments: [],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.modelError).toEqual({ code: 'input_mismatch', message: 'Nothing found' });
    });

    it('fails a finished run that downloaded nothing', async () => {
      const { adapter, capability, ctx } = setup({ kind: 'media.audio' });
      adapter.fetch.mockResolvedValue({
        output: manifest([]),
        attachments: [],
        costUsd: 0,
        repro: { level: 'approximate' },
      });
      const result = await capability.fetch(handle, ctx);
      expect(result.modelError?.code).toBe('task_impossible');
    });

    it('validates download stages', () => {
      const { capability } = setup({ kind: 'data' });
      const stage = (overrides: Record<string, unknown>) =>
        ({ output: { kind: 'media.audio' }, ...overrides }) as never;
      const config = { provider: 'codex', modelId: 'gpt-example' };
      expect(capability.validate(config, stage({}))).toEqual([
        expect.objectContaining({ path: 'instructions.template' }),
      ]);
      expect(
        capability.validate(config, stage({ instructions: { template: 'Find a whoosh' } })),
      ).toEqual([]);
      expect(
        capability
          .validate(
            config,
            stage({
              output: { kind: 'media.video_list' },
              instructions: { template: 'Find clips' },
              iterate: { over: { from: 'input', inputKey: 'x' } },
              writes: { clips: '$' },
            }),
          )
          .map((issue) => issue.path),
      ).toEqual(['iterate', 'writes']);
      expect(capability.validate(config, stage({ output: { kind: 'timeline' } }))).toEqual([
        expect.objectContaining({ path: 'output.kind' }),
      ]);
      expect(
        capability.validate({ ...config, maxFiles: 0 }, stage({ instructions: { template: 'x' } })),
      ).toEqual([expect.objectContaining({ path: 'config.maxFiles' })]);
    });
  });
});
