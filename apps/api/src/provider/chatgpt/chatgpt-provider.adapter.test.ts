import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { JobHandle } from '@reelcraft/shared';
import {
  CHATGPT_SIGN_IN_MESSAGE,
  ChatgptProviderAdapter,
  decidePoll,
  isIdle,
  parseJsonReply,
} from './chatgpt-provider.adapter';
import { stripCitations, type PageState } from './chatgpt-page';

/** Fake Neo: `run` answers scripted results in call order and records every script. */
function fixture(results: unknown[], archive: unknown = { archived: true }) {
  const scripts: string[] = [];
  const neo = {
    run: vi.fn(async (code: string) => {
      scripts.push(code);
      if (code.includes('browser.pages.close')) return true;
      if (code.includes('is_archived')) {
        if (archive instanceof Error) throw archive;
        return archive;
      }
      if (results.length === 0) throw new Error(`unexpected script: ${code.slice(0, 80)}`);
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const storage = {
    getStream: vi.fn(async () => Readable.from([Buffer.from('png-bytes')])),
    // Untyped upload: the loader falls back to the key's extension.
    stat: vi.fn(async () => ({ bytes: 9, etag: 'e', mime: 'application/octet-stream' })),
  };
  const adapter = new ChatgptProviderAdapter(neo as never, storage as never);
  const closed = () => scripts.filter((s) => s.includes('browser.pages.close')).length;
  const archived = () => scripts.filter((s) => s.includes('is_archived')).length;
  /** Whether the archive ran before the (only) tab close. */
  const archivedBeforeClose = () =>
    scripts.findIndex((s) => s.includes('is_archived')) <
    scripts.findIndex((s) => s.includes('browser.pages.close'));
  return { adapter, neo, storage, scripts, closed, archived, archivedBeforeClose };
}

const signedIn = { signedIn: true, composer: true };
const textReq = {
  modality: 'text' as const,
  modelId: 'chatgpt',
  params: { reasoningEffort: 'high', webSearch: true },
  system: 'Be terse',
  renderedPrompt: 'Summarise the news',
  output: { kind: 'text' as const, instructions: '' },
};
const job = (over: Record<string, unknown> = {}): JobHandle => ({
  providerId: 'chatgpt',
  externalId: 'k1',
  payload: {
    pageId: 7,
    conversationUrl: 'https://chatgpt.com/c/abc',
    modality: 'text',
    outputKind: 'text',
    submittedAt: Date.now(),
    pastedPrompt: 'p',
    ...over,
  },
});
const state = (over: Partial<PageState> = {}): PageState => ({
  signedIn: true,
  generating: false,
  replyDone: false,
  images: 0,
  imagesLoading: false,
  errorShown: false,
  tail: '',
  ...over,
});

describe('ChatgptProviderAdapter.submit', () => {
  it('opens a temporary chat, sets effort, turns web search on, then pastes the prompt', async () => {
    const { adapter, scripts } = fixture([
      7, // open tab
      signedIn,
      { value: 2 }, // effort High
      true, // web search pill showing
      { url: 'https://chatgpt.com/c/abc?temporary-chat=true' },
    ]);
    const handle = await adapter.submit(textReq, 'key-1');

    expect(scripts[0]).toContain('temporary-chat=true');
    expect(scripts[3]).toContain('Input.dispatchMouseEvent');
    expect(scripts[2]).toContain('\\"stop\\":2');
    expect(scripts[4]).toContain('Summarise the news');
    expect(scripts[4]).toContain('Be terse');
    expect(handle).toMatchObject({
      providerId: 'chatgpt',
      externalId: 'key-1',
      payload: { pageId: 7, modality: 'text', conversationUrl: expect.stringContaining('/c/abc') },
    });
  });

  it('rejects an unknown effort before touching the browser', async () => {
    const { adapter, neo } = fixture([]);
    await expect(
      adapter.submit({ ...textReq, params: { reasoningEffort: 'xhigh' } }, 'k'),
    ).rejects.toThrow(/Unsupported ChatGPT effort/);
    expect(neo.run).not.toHaveBeenCalled();
  });

  it('closes the tab and defers a signed-out session to a no-retry poll failure', async () => {
    const { adapter, closed } = fixture([7, { signedIn: false, composer: true }]);
    const handle = await adapter.submit(textReq, 'k');
    expect(handle.payload).toEqual({ signedOut: true });
    expect(closed()).toBe(1);
    await expect(adapter.poll(handle)).resolves.toEqual({
      done: true,
      outcome: 'failed',
      reason: CHATGPT_SIGN_IN_MESSAGE,
      retryable: false,
      failureClass: 'user_action',
    });
  });

  it('fails when the search hint did not turn web search on', async () => {
    const { adapter, closed } = fixture([7, signedIn, { value: 2 }, false]);
    await expect(adapter.submit(textReq, 'k')).rejects.toThrow(
      /Could not turn on ChatGPT web search/,
    );
    expect(closed()).toBe(1);
  });

  it('closes the tab and names UI drift when a control is missing', async () => {
    const { adapter, closed } = fixture([
      7,
      signedIn,
      { error: 'ChatGPT effort slider not found' },
    ]);
    await expect(adapter.submit(textReq, 'k')).rejects.toThrow(
      'ChatGPT effort slider not found — the ChatGPT UI may have changed',
    );
    expect(closed()).toBe(1);
  });

  it('uses a regular chat and attaches references for image stages', async () => {
    const { adapter, scripts, storage } = fixture([
      8,
      signedIn,
      { value: 0 },
      { length: 12 },
      { ok: true },
      { url: 'https://chatgpt.com/c/img' },
    ]);
    await adapter.submit(
      {
        modality: 'image',
        modelId: 'chatgpt',
        params: {
          reasoningEffort: 'instant',
          slots: { references: [{ sourceKey: 'assets/ref.jpg' }] },
        },
        renderedPrompt: 'A red circle',
      },
      'k',
    );
    expect(scripts[0]).toContain('"https://chatgpt.com/"');
    expect(storage.getStream).toHaveBeenCalledWith('assets/ref.jpg');
    expect(scripts[3]).toContain(Buffer.from('png-bytes').toString('base64'));
    expect(scripts[4]).toContain('1-ref.jpg');
    expect(scripts[4]).toContain('image/jpeg');
    expect(scripts[4]).not.toContain(Buffer.from('png-bytes').toString('base64'));
  });

  it('uploads large references in chunks that each fit a Neo request', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    const { adapter, scripts, storage } = fixture([
      8,
      signedIn,
      { value: 0 },
      { length: 0 },
      { length: 0 },
      { length: 0 },
      { ok: true },
      { url: 'https://chatgpt.com/c/img' },
    ]);
    storage.getStream.mockImplementation(async () => Readable.from([big]));
    await adapter.submit(
      {
        modality: 'image',
        modelId: 'chatgpt',
        params: { reasoningEffort: 'instant', slots: { ref: { sourceKey: 'assets/big.png' } } },
        renderedPrompt: 'A red circle',
      },
      'k',
    );
    const base64 = big.toString('base64');
    const chunks = scripts.slice(3, 6).map((s) => {
      const match = /\\"chunk\\":\\"([A-Za-z0-9+/=]*)\\"/.exec(s);
      if (!match) throw new Error('chunk not found');
      return match[1];
    });
    expect(chunks.join('')).toBe(base64);
    expect(scripts[6]).toContain(`"length\\":${base64.length}`);
    expect(Math.max(...scripts.map((s) => s.length))).toBeLessThan(4 * 1024 * 1024);
  });
});

describe('decidePoll', () => {
  const text = { modality: 'text' as const, submittedAt: 1_000 };
  const image = { modality: 'image' as const, submittedAt: 1_000 };

  it('keeps running while ChatGPT generates, with a provider deadline', () => {
    expect(decidePoll(state({ generating: true }), text, undefined, 2_000)).toMatchObject({
      done: false,
      deadlineMs: 1_000 + 45 * 60_000,
    });
  });

  it('succeeds a text job once the reply has its copy button', () => {
    expect(decidePoll(state({ replyDone: true }), text, undefined, 2_000)).toEqual({
      done: true,
      outcome: 'succeeded',
    });
  });

  it('fails with user_action when signed out mid-run', () => {
    expect(
      decidePoll(state({ signedIn: false, generating: true }), text, undefined, 0),
    ).toMatchObject({
      done: true,
      outcome: 'failed',
      failureClass: 'user_action',
      retryable: false,
    });
  });

  it('waits for images after the Stop button is gone', () => {
    expect(decidePoll(state({ imagesLoading: true }), image, undefined, 0)).toMatchObject({
      done: false,
    });
    expect(decidePoll(state({ images: 1, replyDone: true }), image, undefined, 0)).toEqual({
      done: true,
      outcome: 'succeeded',
    });
  });

  it('gives an imageless image reply a grace period before failing', () => {
    const finished = state({ replyDone: true });
    expect(decidePoll(finished, image, undefined, 0)).toBe('imageless');
    expect(decidePoll(finished, image, 0, 10_000)).toMatchObject({ done: false });
    expect(decidePoll(finished, image, 0, 30_000)).toMatchObject({
      done: true,
      outcome: 'failed',
      reason: 'ChatGPT did not produce an image',
    });
  });

  it('reports a ChatGPT error as retryable', () => {
    expect(
      decidePoll(state({ errorShown: true, tail: 'Something went wrong' }), text, undefined, 0),
    ).toMatchObject({
      outcome: 'failed',
      retryable: true,
      reason: expect.stringMatching(/went wrong/),
    });
  });
});

describe('ChatgptProviderAdapter.fetch', () => {
  it('returns the copied markdown without citation tokens and closes the tab', async () => {
    const { adapter, closed } = fixture([
      'Headline here. :chatgpt-content-reference{index="0"}\nDONE',
    ]);
    const result = await adapter.fetch(job());
    expect(result.output).toBe('Headline here.\nDONE');
    expect(result.rawResponse).toMatchObject({ pastedPrompt: 'p' });
    expect(closed()).toBe(1);
  });

  it('replays the same result for a second fetch() on the same handle instead of re-reading the closed tab', async () => {
    const { adapter, closed } = fixture(['Headline here.\nDONE']);
    const handle = job();
    const first = await adapter.fetch(handle);
    const second = await adapter.fetch(handle);
    expect(second).toBe(first);
    expect(closed()).toBe(1);
  });

  it('parses JSON replies for data output, tolerating code fences', async () => {
    const { adapter } = fixture(['```json\n{"title":"x"}\n```']);
    const result = await adapter.fetch(job({ outputKind: 'data' }));
    expect(result.output).toEqual({ title: 'x' });
  });

  it('returns the first image as the output and the rest as attachments', async () => {
    const { adapter, closed } = fixture([
      { mime: 'image/png', length: 3 },
      'AAA',
      { mime: 'image/webp', length: 3 },
      'BBB',
      null,
    ]);
    const result = await adapter.fetch(job({ modality: 'image', outputKind: 'media.image' }));
    expect(result.output).toEqual({
      kind: 'media.image',
      base64: 'AAA',
      mime: 'image/png',
      filename: 'chatgpt-image-1.png',
    });
    expect(result.attachments).toEqual([
      { role: 'download', base64: 'BBB', mime: 'image/webp', filename: 'chatgpt-image-2.webp' },
    ]);
    expect(closed()).toBe(1);
  });
});

describe('ChatgptProviderAdapter image chat archive', () => {
  const imageJob = () => job({ modality: 'image', outputKind: 'media.image' });
  const download = [{ mime: 'image/png', length: 3 }, 'AAA', null];

  it('archives the chat before closing the tab, once the images are downloaded', async () => {
    const { adapter, closed, archived, archivedBeforeClose } = fixture([...download]);
    const result = await adapter.fetch(imageJob());
    expect(result.output).toMatchObject({ kind: 'media.image', base64: 'AAA' });
    expect(archived()).toBe(1);
    expect(closed()).toBe(1);
    expect(archivedBeforeClose()).toBe(true);
  });

  it('still returns the image and closes the tab when archiving fails', async () => {
    for (const archive of [new Error('boom'), { archived: false, reason: 'HTTP 403' }]) {
      const { adapter, closed } = fixture([...download], archive);
      await expect(adapter.fetch(imageJob())).resolves.toMatchObject({
        output: { base64: 'AAA' },
      });
      expect(closed()).toBe(1);
    }
  });

  it('never archives a text job, which already used a temporary chat', async () => {
    const { adapter, archived } = fixture(['hello']);
    await adapter.fetch(job());
    expect(archived()).toBe(0);
  });

  it('archives an image chat whose generation failed', async () => {
    const { adapter, closed, archived, archivedBeforeClose } = fixture([
      state({ errorShown: true }),
    ]);
    const status = await adapter.poll(imageJob());
    expect(status).toMatchObject({ done: true, outcome: 'failed' });
    expect(archived()).toBe(1);
    expect(closed()).toBe(1);
    expect(archivedBeforeClose()).toBe(true);
  });

  it('archives an image chat on cancel', async () => {
    const { adapter, closed, archived, archivedBeforeClose } = fixture([true]);
    await adapter.cancel(imageJob());
    expect(archived()).toBe(1);
    expect(closed()).toBe(1);
    expect(archivedBeforeClose()).toBe(true);
  });
});

describe('ChatgptProviderAdapter image download', () => {
  it('reads an image bigger than one run result across several runs', async () => {
    const big = 1_500_000;
    const { adapter, scripts } = fixture([
      { mime: 'image/png', length: big + 3 },
      'a'.repeat(big),
      'bcd',
      null,
    ]);
    const result = await adapter.fetch(job({ modality: 'image', outputKind: 'media.image' }));
    expect((result.output as { base64: string }).base64).toBe(`${'a'.repeat(big)}bcd`);
    // park image 0, two reads, then park image 1 (none left)
    expect(scripts.filter((code) => code.includes('__reelcraft_image'))).toHaveLength(4);
  });

  it('rejects a truncated download', async () => {
    const { adapter } = fixture([{ mime: 'image/png', length: 5 }, 'abc']);
    await expect(
      adapter.fetch(job({ modality: 'image', outputKind: 'media.image' })),
    ).rejects.toThrow(/incomplete/);
  });
});

describe('ChatgptProviderAdapter readiness and cancel', () => {
  it('marks every modality unavailable with the sign-in message, cached', async () => {
    const { adapter, neo } = fixture([3, { signedIn: false, composer: true }]);
    const [model] = await adapter.listModels();
    expect(model).toMatchObject({
      modelId: 'chatgpt',
      modalities: [],
      unavailableModalities: { text: CHATGPT_SIGN_IN_MESSAGE, image: CHATGPT_SIGN_IN_MESSAGE },
      supportedReasoningEfforts: ['instant', 'medium', 'high'],
    });
    const calls = neo.run.mock.calls.length;
    await adapter.listModels();
    expect(neo.run.mock.calls.length).toBe(calls);
  });

  it('reports Neo being down as the unavailable reason', async () => {
    const { adapter } = fixture([new Error('ECONNREFUSED')]);
    const [model] = await adapter.listModels();
    expect(model?.unavailableModalities?.text).toMatch(/BrowserOS Neo is unavailable/);
  });

  it('stops generation and closes the tab on cancel', async () => {
    const { adapter, closed } = fixture([true]);
    await expect(adapter.cancel(job())).resolves.toEqual({ confirmed: true, billed: false });
    expect(closed()).toBe(1);
  });
});

describe('reply helpers', () => {
  it('strips both citation token formats', () => {
    expect(stripCitations('A. :contentReference[oaicite:0]{index=0} B.')).toBe('A. B.');
  });

  it('names the bad reply when JSON parsing fails', () => {
    expect(() => parseJsonReply('Sure! Here it is')).toThrow(/not valid JSON: Sure!/);
  });
});

describe('ChatgptProviderAdapter.poll stall', () => {
  it('cancels a tab that sat idle for minutes so the stage retries it as an infrastructure error', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, closed } = fixture([state(), state(), state()]);
      const handle = job({ submittedAt: Date.now() });
      // Idle, but not for long yet.
      await expect(adapter.poll(handle)).resolves.toMatchObject({ done: false });
      vi.advanceTimersByTime(3 * 60_000);
      await expect(adapter.poll(handle)).resolves.toMatchObject({ done: false });
      expect(closed()).toBe(0);
      vi.advanceTimersByTime(2 * 60_000);
      await expect(adapter.poll(handle)).resolves.toMatchObject({
        done: true,
        outcome: 'failed',
        retryable: true,
        failureClass: 'infrastructure',
      });
      expect(closed()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting while the tab is generating, however long it takes', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, closed } = fixture([
        state({ generating: true }),
        state({ generating: true }),
      ]);
      const handle = job({ submittedAt: Date.now() });
      await adapter.poll(handle);
      vi.advanceTimersByTime(30 * 60_000);
      await expect(adapter.poll(handle)).resolves.toMatchObject({ done: false });
      expect(closed()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('decidePoll error banner', () => {
  const text = { modality: 'text' as const, submittedAt: 1_000 };
  it("fails at once on ChatGPT's error banner, even with a stale Stop or Copy button", () => {
    for (const stale of [{ generating: true }, { replyDone: true }, {}]) {
      expect(
        decidePoll(
          state({
            errorShown: true,
            tail: 'Message delivery timed out. Please try again.',
            ...stale,
          }),
          text,
          undefined,
          0,
        ),
      ).toMatchObject({ done: true, outcome: 'failed', failureClass: 'provider' });
    }
  });
});

describe('isIdle', () => {
  it('is true only when nothing is generating and nothing has come of it', () => {
    expect(isIdle(state({}))).toBe(true);
    for (const busy of [
      { generating: true },
      { replyDone: true },
      { errorShown: true },
      { imagesLoading: true },
      { images: 1 },
    ]) {
      expect(isIdle(state(busy))).toBe(false);
    }
  });
});
