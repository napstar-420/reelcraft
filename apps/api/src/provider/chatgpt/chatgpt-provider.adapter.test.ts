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
import {
  CDP_READ_BUDGET,
  CDP_READ_UNSUPPORTED,
  RUN_RESULT_BUDGET,
  archiveChatScript,
  pageStateScript,
  parkImageScript,
  readParkedImageCdpScript,
  signInStateScript,
  stripCitations,
  type PageState,
} from './chatgpt-page';

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

  it('does not call a failed session check "signed out": a retryable infrastructure failure instead', async () => {
    const { adapter, closed } = fixture([7, { signedIn: false, unknown: true, composer: true }]);
    const handle = await adapter.submit(textReq, 'k');
    expect(handle.payload).toEqual({ unreachable: true });
    expect(closed()).toBe(1);
    await expect(adapter.poll(handle)).resolves.toMatchObject({
      done: true,
      outcome: 'failed',
      retryable: true,
      failureClass: 'infrastructure',
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
      { length: 12 },
      { ok: true },
      { value: 0 },
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
    expect(scripts[2]).toContain(Buffer.from('png-bytes').toString('base64'));
    expect(scripts[3]).toContain('1-ref.jpg');
    expect(scripts[3]).toContain('image/jpeg');
    expect(scripts[3]).not.toContain(Buffer.from('png-bytes').toString('base64'));
  });

  it('uploads large references in chunks that each fit a Neo request', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    const { adapter, scripts, storage } = fixture([
      8,
      signedIn,
      { length: 0 },
      { length: 0 },
      { length: 0 },
      { ok: true },
      { value: 0 },
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
    const chunks = scripts.slice(2, 5).map((s) => {
      const match = /\\"chunk\\":\\"([A-Za-z0-9+/=]*)\\"/.exec(s);
      if (!match) throw new Error('chunk not found');
      return match[1];
    });
    expect(chunks.join('')).toBe(base64);
    expect(scripts[5]).toContain(`"length\\":${base64.length}`);
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

  it('waits for the rest of a multi-image reply, then accepts what arrived', () => {
    const list = { ...image, imageCount: 3 };
    const two = state({ images: 2, replyDone: true });
    expect(decidePoll(state({ images: 3, replyDone: true }), list, undefined, 0)).toEqual({
      done: true,
      outcome: 'succeeded',
    });
    expect(decidePoll(two, list, undefined, 0)).toBe('imageless');
    expect(decidePoll(two, list, 0, 10_000)).toMatchObject({ done: false });
    expect(decidePoll(two, list, 0, 30_000)).toEqual({ done: true, outcome: 'succeeded' });
    // A single-image request is never held back.
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

  it('keeps a text tab open when the reply is not valid JSON', async () => {
    const { adapter, closed } = fixture(['not json']);
    await expect(adapter.fetch(job({ outputKind: 'data' }))).rejects.toThrow(/not valid JSON/);
    expect(closed()).toBe(0);
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

  it('returns every image of the reply as a list when several were asked for', async () => {
    const { adapter, closed } = fixture([
      { mime: 'image/png', length: 3 },
      'AAA',
      { mime: 'image/webp', length: 3 },
      'BBB',
      { mime: 'image/png', length: 3 },
      'CCC',
      null,
    ]);
    const result = await adapter.fetch(
      job({ modality: 'image', outputKind: 'media.image_list', imageCount: 2 }),
    );
    expect(result.output).toEqual({
      images: [
        { kind: 'media.image', base64: 'AAA', mime: 'image/png', filename: 'chatgpt-image-1.png' },
        {
          kind: 'media.image',
          base64: 'BBB',
          mime: 'image/webp',
          filename: 'chatgpt-image-2.webp',
        },
      ],
    });
    expect(result.attachments).toBeUndefined();
    expect(closed()).toBe(1);
  });

  it('fails a list request whose reply has no image', async () => {
    const { adapter, closed } = fixture([null]);
    await expect(
      adapter.fetch(job({ modality: 'image', outputKind: 'media.image_list', imageCount: 2 })),
    ).rejects.toThrow('no generated image');
    expect(closed()).toBe(0);
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

describe('chatgpt page image lookup', () => {
  it('reads every image of a multi-image reply from its thumbnail strip, in order, and falls back to the lone image', () => {
    // Both the poll and the download share one page-side lookup.
    for (const script of [pageStateScript(7), parkImageScript(7, 1)]) {
      expect(script).toContain('generatedImages()');
      expect(script).toContain('Generated images');
      expect(script).toContain('img[alt^=');
    }
  });
});

const imageJob = () => job({ modality: 'image', outputKind: 'media.image' });
const unsupported = new Error(`BrowserOS Neo script failed: Error: ${CDP_READ_UNSUPPORTED}`);

describe('ChatgptProviderAdapter image download', () => {
  it('reads an image bigger than one CDP read across several runs', async () => {
    const big = CDP_READ_BUDGET;
    const { adapter, scripts } = fixture([
      { mime: 'image/png', length: big + 3 },
      'a'.repeat(big),
      'bcd',
      null,
    ]);
    const result = await adapter.fetch(imageJob());
    expect((result.output as { base64: string }).base64).toBe(`${'a'.repeat(big)}bcd`);
    // park image 0, two CDP reads, then park image 1 (none left)
    expect(scripts.filter((code) => code.includes('__reelcraft_image'))).toHaveLength(4);
    expect(scripts.filter((code) => code.includes('Runtime.evaluate'))).toHaveLength(2);
  });

  it('falls back to evaluate slices when Neo does not return the CDP text, and keeps using them', async () => {
    const big = RUN_RESULT_BUDGET;
    const { adapter, scripts } = fixture([
      { mime: 'image/png', length: big + 3 },
      unsupported,
      'a'.repeat(big),
      'bcd',
      { mime: 'image/png', length: 2 },
      'ef', // the next image goes straight to the slices
      null,
    ]);
    const result = await adapter.fetch(imageJob());
    expect((result.output as { base64: string }).base64).toBe(`${'a'.repeat(big)}bcd`);
    expect(scripts.filter((code) => code.includes('Runtime.evaluate'))).toHaveLength(1);
    // two slice reads for the first image, one for the second; no more CDP reads
    expect(
      scripts.filter((code) =>
        code.includes('getElementById("__reelcraft_image").textContent.slice('),
      ),
    ).toHaveLength(3);
  });

  it('falls back when a CDP read comes back short', async () => {
    const { adapter } = fixture([{ mime: 'image/png', length: 5 }, 'abc', 'abcde', null]);
    const result = await adapter.fetch(imageJob());
    expect((result.output as { base64: string }).base64).toBe('abcde');
  });

  it('rejects a truncated download and leaves the tab open for the retry', async () => {
    const { adapter, closed } = fixture([{ mime: 'image/png', length: 5 }, 'abc', 'abc']);
    await expect(adapter.fetch(imageJob())).rejects.toThrow(/incomplete/);
    expect(closed()).toBe(0);
  });

  it('keeps the tab open when a read fails, so the retried fetch reads the same tab and then archives', async () => {
    const { adapter, closed, archived, archivedBeforeClose } = fixture([
      { mime: 'image/png', length: 3 },
      new Error('BrowserOS Neo script failed: run exceeded 30000ms'),
      { mime: 'image/png', length: 3 },
      'AAA',
      null,
    ]);
    const handle = imageJob();
    await expect(adapter.fetch(handle)).rejects.toThrow('run exceeded 30000ms');
    expect(closed()).toBe(0);
    expect(archived()).toBe(0);

    const result = await adapter.fetch(handle);
    expect((result.output as { base64: string }).base64).toBe('AAA');
    expect(archived()).toBe(1);
    expect(closed()).toBe(1);
    expect(archivedBeforeClose()).toBe(true);
  });
});

describe('readParkedImageCdpScript', () => {
  it('reads one slice over a raw CDP Runtime.evaluate and always detaches', () => {
    const script = readParkedImageCdpScript(7, 10, 20);
    expect(script).toContain("browser.cdp('Runtime.evaluate'");
    expect(script).toContain('returnByValue');
    expect(script).toContain('.slice(10, 20)');
    expect(script).toContain('__reelcraft_image');
    expect(script).toContain('Target.detachFromTarget');
    expect(script).toContain(CDP_READ_UNSUPPORTED);
  });

  it("keeps one read under Neo's 2 MB result cap and rejects a bad range", () => {
    expect(CDP_READ_BUDGET).toBeLessThan(2_000_000);
    expect(() => readParkedImageCdpScript(7, 0, CDP_READ_BUDGET + 1)).toThrow(/Invalid parked/);
    expect(() => readParkedImageCdpScript(7, -1, 5)).toThrow(/Invalid parked/);
    expect(() => readParkedImageCdpScript(7, 9, 5)).toThrow(/Invalid parked/);
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

  it('does not block stages when the sign-in probe could not tell', async () => {
    const { adapter } = fixture([3, { signedIn: false, unknown: true, composer: false }]);
    const [model] = await adapter.listModels();
    expect(model).toMatchObject({ modalities: ['text', 'image'] });
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

describe('decidePoll error banner classes', () => {
  const text = { modality: 'text' as const, submittedAt: 1_000 };
  const failure = (errorSignal: string) =>
    decidePoll(state({ errorShown: true, errorSignal, tail: 'x' }), text, undefined, 0);

  it('treats a Retry button and delivery or network errors as infrastructure, which a retry can clear', () => {
    for (const signal of [
      'button: Retry',
      'button: Try again',
      'text: Message delivery timed out',
      'text: network error',
    ]) {
      expect(failure(signal), signal).toMatchObject({ failureClass: 'infrastructure' });
    }
  });

  it('keeps other banners as provider errors', () => {
    expect(failure('text: error generating')).toMatchObject({ failureClass: 'provider' });
    expect(failure('text: something went wrong')).toMatchObject({ failureClass: 'provider' });
  });
});

describe('chatgpt sign-in scripts', () => {
  it('only a session check that answered can say signed out', () => {
    // A failed check must not read as the user's doing (it stays signed in / unknown).
    expect(pageStateScript(7)).toContain('if (r.ok) {');
    expect(signInStateScript(7)).toContain('unknown = false');
    expect(signInStateScript(7)).toContain('unknown = true');
  });
});

describe('ChatgptProviderAdapter sending in turns', () => {
  it('lets one tab finish setting effort and sending before the next starts, and survives a failed turn', async () => {
    const { adapter } = fixture([]);
    const exclusive = (
      adapter as unknown as {
        exclusive: <T>(work: () => Promise<T>) => Promise<T>;
      }
    ).exclusive.bind(adapter);
    const order: string[] = [];
    const turn = (name: string, ms: number, fail = false) =>
      exclusive(async () => {
        order.push(`${name} start`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push(`${name} end`);
        if (fail) throw new Error(`${name} failed`);
        return name;
      });

    const results = await Promise.allSettled([turn('a', 20, true), turn('b', 5), turn('c', 1)]);
    expect(order).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
  });
});

describe('ChatgptProviderAdapter reference uploads and the turn lock', () => {
  /** A fake Neo that answers by script content, with a slow reference upload. */
  function slowUploadNeo() {
    const order: string[] = [];
    let nextPage = 10;
    const neo = {
      run: vi.fn(async (code: string) => {
        if (code.includes('browser.pages.newPage')) return nextPage++;
        if (code.includes('/api/auth/session')) return signedIn;
        if (code.includes('__reelcraft_upload_') && code.includes('args.chunk')) {
          order.push('upload');
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { length: 12 };
        }
        if (code.includes('input[type=file]')) {
          order.push('attach');
          return { ok: true };
        }
        if (code.includes('ArrowLeft')) {
          order.push('effort');
          return { value: 0 };
        }
        if (code.includes('document.execCommand')) {
          order.push('send');
          return { url: 'https://chatgpt.com/c/x' };
        }
        return true;
      }),
    };
    const storage = {
      getStream: vi.fn(async () => Readable.from([Buffer.from('png-bytes')])),
      stat: vi.fn(async () => ({ bytes: 9, etag: 'e', mime: 'application/octet-stream' })),
    };
    return { adapter: new ChatgptProviderAdapter(neo as never, storage as never), order };
  }
  const withRef = {
    modality: 'text' as const,
    modelId: 'chatgpt',
    params: { reasoningEffort: 'instant', slots: { ref: { sourceKey: 'assets/ref.jpg' } } },
    renderedPrompt: 'judge this',
  };
  const plain = { ...withRef, params: { reasoningEffort: 'instant' }, renderedPrompt: 'hello' };

  it("does not hold another tab's effort-then-send behind a slow reference upload", async () => {
    const { adapter, order } = slowUploadNeo();
    await Promise.all([adapter.submit(withRef, 'a'), adapter.submit(plain, 'b')]);
    // b's whole turn (effort, send) runs while a is still uploading its images.
    expect(order.indexOf('send')).toBeLessThan(order.lastIndexOf('send'));
    expect(order.indexOf('send')).toBeLessThan(order.indexOf('attach'));
  });

  it('attaches before the turn when web search is off, and inside it when web search is on', async () => {
    const off = slowUploadNeo();
    await off.adapter.submit(withRef, 'a');
    expect(off.order).toEqual(['upload', 'attach', 'effort', 'send']);

    const on = slowUploadNeo();
    await on.adapter.submit({ ...withRef, params: { ...withRef.params, webSearch: true } }, 'b');
    expect(on.order).toEqual(['effort', 'upload', 'attach', 'send']);
  });
});

describe('error banner detection', () => {
  it('names what tripped it in the failure reason', () => {
    const status = decidePoll(
      state({ errorShown: true, errorSignal: 'button: Retry', tail: 'oops' }),
      { modality: 'image' as const, submittedAt: 1_000 },
      undefined,
      0,
    );
    expect(status).toMatchObject({ reason: 'ChatGPT reported an error (button: Retry): oops' });
  });

  it('only looks inside <main>, not at the sidebar\'s own Retry ("Unable to load history")', () => {
    const script = pageStateScript(7);
    expect(script).toContain("main.querySelectorAll('button')");
    expect(script).not.toContain("document.querySelectorAll('button')");
  });

  it('waits for a saved chat id before archiving, since a fresh chat sits on a local placeholder', () => {
    expect(archiveChatScript(7)).toContain('await waitFor(() => location.pathname.match(');
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
