import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from './codex-app-server.client';

function fakeProcess(pages: Array<Record<string, unknown>>) {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  let page = 0;
  proc.stdin.on('data', (chunk) => {
    for (const line of chunk.toString().trim().split('\n')) {
      const message = JSON.parse(line) as { id: number; method: string };
      if (message.method === 'initialize') {
        proc.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
      }
      if (message.method === 'model/list') {
        proc.stdout.write(
          `${JSON.stringify({ id: message.id, result: pages[page++] ?? { data: [] } })}\n`,
        );
      }
    }
  });
  return proc;
}

describe('CodexAppServerClient', () => {
  it('paginates models, removes hidden entries, and exposes effort metadata', async () => {
    const spawn = vi.fn(() =>
      fakeProcess([
        {
          data: [
            {
              id: 'visible',
              model: 'gpt-visible',
              displayName: 'Visible',
              hidden: false,
              defaultReasoningEffort: 'medium',
              supportedReasoningEfforts: [
                { reasoningEffort: 'low', description: 'Fast' },
                { reasoningEffort: 'medium', description: 'Balanced' },
              ],
            },
            {
              id: 'hidden',
              model: 'gpt-hidden',
              displayName: 'Hidden',
              hidden: true,
              defaultReasoningEffort: 'high',
              supportedReasoningEfforts: [],
            },
          ],
          nextCursor: 'next',
        },
        {
          data: [
            {
              id: 'second',
              model: 'gpt-second',
              displayName: 'Second',
              hidden: false,
              defaultReasoningEffort: 'high',
              supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep' }],
            },
          ],
          nextCursor: null,
        },
      ]),
    );
    const client = new CodexAppServerClient(spawn as never, 1_000);

    await expect(client.listModels()).resolves.toEqual([
      {
        modelId: 'gpt-visible',
        label: 'Visible',
        supportedReasoningEfforts: ['low', 'medium'],
        defaultReasoningEffort: 'medium',
      },
      {
        modelId: 'gpt-second',
        label: 'Second',
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
      },
    ]);
  });

  it('caches the authenticated catalog briefly and refreshes after expiry', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    const spawn = vi.fn(() => fakeProcess([{ data: [], nextCursor: null }]));
    const client = new CodexAppServerClient(spawn as never, 1_000, 30_000);
    await client.listModels();
    await client.listModels();
    expect(spawn).toHaveBeenCalledTimes(1);
    now.mockReturnValue(30_101);
    await client.listModels();
    expect(spawn).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('reports authentication failures clearly', async () => {
    const spawn = vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdin = new PassThrough();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = vi.fn();
      proc.stdin.on('data', (chunk) => {
        for (const line of chunk.toString().trim().split('\n')) {
          const message = JSON.parse(line) as { id?: number; method: string };
          if (message.method === 'initialize') {
            proc.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
          } else if (message.method === 'model/list') {
            proc.stdout.write(
              `${JSON.stringify({ id: message.id, error: { message: 'not logged in' } })}\n`,
            );
          }
        }
      });
      return proc;
    });
    const client = new CodexAppServerClient(spawn as never, 1_000);
    await expect(client.listModels()).rejects.toThrow(/not logged in/i);
  });
});
