import { describe, expect, it, vi } from 'vitest';
import type { OutputDef } from '@reelcraft/shared';
import type { ExecCtx } from '../capability.interface';
import type { FileInput } from '../../common/file-inputs';
import { TextGenerateCapability, readModelReply } from './text-generate.capability';

function setup(output: OutputDef, files: FileInput[] = [], reply: unknown = 'ok') {
  const submit = vi.fn().mockResolvedValue({ providerId: 'fake', externalId: 'job-1' });
  const fetch = vi.fn().mockResolvedValue({
    output: reply,
    costUsd: 0.01,
    repro: { level: 'none' },
    rawResponse: {},
  });
  const capability = new TextGenerateCapability({ get: () => ({ submit, fetch }) } as never);
  const ctx: ExecCtx<{ provider: string; modelId: string; params?: Record<string, unknown> }> = {
    runId: 'run-1',
    stageKey: 'caption',
    attemptNo: 1,
    config: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 50 } },
    slots: {},
    context: {},
    files,
    renderedPrompt: 'Caption the shoe',
    output,
    idempotencyKey: 'key-1',
    logger: { log: () => {}, error: () => {} },
  };
  return { capability, ctx, submit, fetch };
}

const schema = {
  type: 'object' as const,
  properties: { caption: { type: 'string' as const } },
  required: ['caption'],
};

describe('TextGenerateCapability', () => {
  it('uses retained start and continuation only for a supporting adapter', async () => {
    const start = vi.fn().mockResolvedValue({ providerId: 'chatgpt', externalId: 'one' });
    const resume = vi.fn().mockResolvedValue({ providerId: 'chatgpt', externalId: 'two' });
    const submit = vi.fn();
    const capability = new TextGenerateCapability({
      get: () => ({ submit, continuation: { supports: () => true, start, continue: resume } }),
    } as never);
    const { ctx } = setup({ kind: 'text' });
    await capability.submit({ ...ctx, continuation: { retain: true } });
    await capability.submit({
      ...ctx,
      continuation: {
        retain: true,
        previousHandle: { providerId: 'chatgpt', externalId: 'one' },
        revisionPrompt: 'fix hook',
      },
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'fix hook', 'key-1');
    expect(submit).not.toHaveBeenCalled();
  });

  it('forwards attached files to the provider, in params.slots', async () => {
    const shoe = { name: 'shoe', kind: 'media.image', sourceKey: 'assets/shoe.png' };
    const { capability, ctx, submit } = setup({ kind: 'text' }, [shoe]);

    await capability.submit(ctx);

    expect(submit.mock.calls[0]?.[0].params).toEqual({
      max_tokens: 50,
      slots: { files: [shoe] },
    });
  });

  it('asks Claude and Codex to open attached files themselves, but not other providers', async () => {
    const shoe = { name: 'shoe', kind: 'media.image', sourceKey: 'assets/shoe.png' };
    for (const [provider, inspects] of [
      ['claude', true],
      ['codex', true],
      ['chatgpt', false],
    ] as const) {
      const { capability, ctx, submit } = setup({ kind: 'text' }, [shoe]);
      ctx.config.provider = provider;
      await capability.submit(ctx);
      expect(submit.mock.calls[0]?.[0].params.__inspectFiles === true).toBe(inspects);
    }
  });

  it('leaves params untouched when no files are attached', async () => {
    const { capability, ctx, submit } = setup({ kind: 'text' });
    await capability.submit(ctx);
    expect(submit.mock.calls[0]?.[0].params).toEqual({ max_tokens: 50 });
  });

  it('wraps a data schema in the error envelope and unwraps the result', async () => {
    const { capability, ctx, submit } = setup({ kind: 'data', schema }, [], {
      status: 'ok',
      message: '',
      result: { caption: 'Step into red' },
    });

    await capability.submit(ctx);
    const sent = submit.mock.calls[0]?.[0].output;
    expect(sent.schema.required).toEqual(['status', 'message', 'result']);
    expect(sent.schema.properties.result).toEqual(schema);

    const result = await capability.fetch({ providerId: 'fake', externalId: 'job-1' }, ctx);
    expect(result.output).toEqual({ caption: 'Step into red' });
    expect(result.modelError).toBeUndefined();
  });

  it('reports a data-envelope error as modelError', async () => {
    const { capability, ctx } = setup({ kind: 'data', schema }, [], {
      status: 'input_unreadable',
      message: 'The shoe image is blank.',
      result: { caption: '' },
    });
    const result = await capability.fetch({ providerId: 'fake', externalId: 'job-1' }, ctx);
    expect(result.modelError).toEqual({
      code: 'input_unreadable',
      message: 'The shoe image is blank.',
    });
  });
});

describe('readModelReply', () => {
  it('detects a text error reply, including inside a code fence', () => {
    const reply = '{"reelcraft_error":{"code":"input_missing","message":"No script provided."}}';
    expect(readModelReply(reply, 'text').modelError).toEqual({
      code: 'input_missing',
      message: 'No script provided.',
    });
    expect(readModelReply('```json\n' + reply + '\n```', 'text').modelError?.code).toBe(
      'input_missing',
    );
  });

  it('detects an already-parsed error object (e.g. a JSON timeline reply)', () => {
    const reply = { reelcraft_error: { code: 'task_impossible', message: 'No clips given.' } };
    expect(readModelReply(reply, 'timeline').modelError?.code).toBe('task_impossible');
  });

  it('never flags ordinary output that merely mentions an error', () => {
    for (const output of [
      'We fixed the error in the script.',
      '{"reelcraft_error": "not the contract shape"}',
      { status: 'shipped', result: 1 },
    ]) {
      expect(readModelReply(output, 'text').modelError).toBeUndefined();
    }
    const dataWithStatus = { status: 'published', message: 'x', result: 1 };
    expect(readModelReply(dataWithStatus, 'data')).toEqual({ output: dataWithStatus });
  });
});
