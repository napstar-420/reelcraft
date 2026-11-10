import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  CDP_READ_UNSUPPORTED,
  copyLastReplyScript,
  enableWebSearchScript,
  inPage,
  openAttachmentMenuScript,
  pageStateScript,
  readParkedImageCdpScript,
  readParkedImageScript,
  signInStateScript,
} from './chatgpt-page';

/** Execute the generated run body against Neo's documented page-handle API.
 * No browser.evaluate or browser-level Target attachment is provided. */
function run(script: string, browser: unknown): Promise<unknown> {
  return new Function('browser', `return (async () => {\n${script}\n})();`)(browser);
}

/** Each evaluate gets a fresh JS world; only the DOM nodes persist between calls. */
function pageFixture() {
  type Node = { id: string; textContent: string; remove: () => void };
  const nodes = new Map<string, Node>();
  const document = {
    getElementById: (id: string) => nodes.get(id),
    createElement: () => {
      const node = { id: '', textContent: '', remove: () => nodes.delete(node.id) };
      return node;
    },
    body: {
      appendChild: (node: Node) => nodes.set(node.id, node),
    },
    querySelector: () => ({}),
  };
  const evaluateInPage = vi.fn(async (code: string) => ({
    value: await runInNewContext(`(async () => {\n${code}\n})()`, {
      document,
      fetch: async () => ({
        ok: true,
        json: async () => ({ user: {}, accessToken: '[REDACTED]' }),
      }),
    }),
    changed: false,
  }));
  const page = vi.fn(() => ({ evaluateInPage }));
  return { nodes, evaluateInPage, browser: { page }, page };
}

describe('Neo page evaluation scripts', () => {
  it('executes the failing stage session check through the page handle', async () => {
    const f = pageFixture();
    await expect(run(signInStateScript(7), f.browser)).resolves.toEqual({
      signedIn: true,
      unknown: false,
      composer: true,
    });
    expect(f.page).toHaveBeenCalledWith(7);
  });

  it('keeps quotes, backslashes, newlines and code-like input as data', async () => {
    const f = pageFixture();
    const args = { code: `ABCD'); throw new Error('injected'); //\n\\"雪` };
    await expect(run(inPage(3, 'return args;', args), f.browser)).resolves.toEqual(args);
    expect(f.evaluateInPage).toHaveBeenCalledTimes(1);
    expect(f.nodes.size).toBe(0);
  });

  it('preserves null and undefined returns', async () => {
    const f = pageFixture();
    await expect(run(inPage(3, 'return null;'), f.browser)).resolves.toBeNull();
    await expect(run(inPage(3, 'return;'), f.browser)).resolves.toBeNull();
  });

  it('reassembles a long Unicode JSON result across multiple chunk batches and removes it', async () => {
    const f = pageFixture();
    const value = { text: '雪🌍"\\\n'.repeat(25_000) };
    await expect(run(inPage(3, 'return args;', value), f.browser)).resolves.toEqual(value);
    expect(f.evaluateInPage.mock.calls.length).toBeGreaterThan(27);
    expect(f.nodes.size).toBe(0);
  });

  it('rejects a missing evaluation value or result chunk', async () => {
    const f = pageFixture();
    f.evaluateInPage.mockResolvedValueOnce({ value: undefined, changed: false });
    await expect(run(inPage(3, 'return 7;'), f.browser)).rejects.toThrow('returned no value');
    f.evaluateInPage
      .mockResolvedValueOnce({ value: { length: 4_000 }, changed: false })
      .mockResolvedValueOnce({ value: undefined, changed: false });
    await expect(run(inPage(3, 'return 7;'), f.browser)).rejects.toThrow('lost a result chunk');
  });

  it('reads fallback image chunks through the same page API', async () => {
    const f = pageFixture();
    const text = 'AAAA'.repeat(3_000);
    f.nodes.set('__reelcraft_image', { id: '__reelcraft_image', textContent: text, remove() {} });
    await expect(run(readParkedImageScript(7, 500, 9_500), f.browser)).resolves.toBe(
      text.slice(500, 9_500),
    );
    expect(f.evaluateInPage).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])('opens the attachment menu when expanded=%s', async (expanded) => {
    const evaluateInPage = vi.fn(async (code: string) => ({
      value: runInNewContext(`(${code})()`, {
        document: { querySelector: () => ({ getAttribute: () => String(expanded) }) },
      }),
    }));
    const snapshot = vi.fn(async () => ({ refs: [{ name: 'Add files and more', ref: 'e12' }] }));
    const click = vi.fn();
    const waitForSelector = vi.fn(async () => ({ matched: true }));
    const browser = { page: () => ({ evaluateInPage, snapshot, click, waitForSelector }) };

    await expect(run(openAttachmentMenuScript(7), browser)).resolves.toBe(true);
    expect(click.mock.calls).toEqual(expanded ? [] : [['e12']]);
    expect(snapshot).toHaveBeenCalledTimes(expanded ? 0 : 1);
    expect(waitForSelector).toHaveBeenCalledWith(expect.stringContaining('input[type="file"]'), {
      timeout: 5000,
    });
  });

  it('validates page ids before inserting them into scripts', () => {
    for (const id of [-1, NaN, Infinity, 1.5]) {
      expect(() => inPage(id, 'return true;')).toThrow('Invalid BrowserOS page id');
      expect(() => enableWebSearchScript(id)).toThrow('Invalid BrowserOS page id');
      expect(() => readParkedImageCdpScript(id, 0, 1)).toThrow('Invalid BrowserOS page id');
    }
  });

  it('sends trusted search clicks through page-scoped CDP with JSON parameters', async () => {
    const evaluateInPage = vi
      .fn()
      .mockResolvedValueOnce({ value: false })
      .mockResolvedValueOnce({ value: { x: 10, y: 20 } })
      .mockResolvedValueOnce({ value: { x: 30, y: 40 } })
      .mockResolvedValueOnce({ value: true });
    const cdp = vi.fn(async (_method: string, params: string) => JSON.parse(params));
    await expect(
      run(enableWebSearchScript(7), { page: () => ({ evaluateInPage, cdp }) }),
    ).resolves.toBe(true);
    expect(cdp.mock.calls.map(([method, params]) => [method, JSON.parse(params)])).toEqual(
      [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ].flatMap((position) =>
        ['mouseMoved', 'mousePressed', 'mouseReleased'].map((type) => [
          'Input.dispatchMouseEvent',
          { type, ...position, button: 'left', clickCount: 1 },
        ]),
      ),
    );
  });

  it('reads an image slice through scoped CDP and rejects non-text results', async () => {
    const cdp = vi.fn(async (_method: string, params: string) => {
      const { expression, returnByValue } = JSON.parse(params);
      expect(returnByValue).toBe(true);
      return {
        result: {
          value: runInNewContext(expression, {
            document: { getElementById: () => ({ textContent: 'ABCDEFGH' }) },
          }),
        },
      };
    });
    const browser = { page: () => ({ cdp }) };
    await expect(run(readParkedImageCdpScript(7, 2, 6), browser)).resolves.toBe('CDEF');
    expect(cdp.mock.calls[0]?.[0]).toBe('Runtime.evaluate');
    await expect(
      run(readParkedImageCdpScript(7, 2, 6), {
        page: () => ({ cdp: async () => ({ result: {} }) }),
      }),
    ).rejects.toThrow(CDP_READ_UNSUPPORTED);
  });
});

/** Execute the generated Neo code, including its page-world boundary and chunked result reads. */
function replyFixture(
  turns: Array<{ text: string; copy?: boolean; complete?: boolean; copied?: string }>,
  options: {
    clipboard?: 'missing' | 'readonly';
    generating?: boolean;
    conversation?: unknown;
    conversationStatus?: number;
    pageUrl?: string;
  } = {},
) {
  const clipboard = { write: vi.fn(), writeText: vi.fn() };
  if (options.clipboard === 'readonly') Object.freeze(clipboard);
  const contents = turns.map(({ text }) => ({ innerText: text }));
  const buttons = turns.map(({ copy, copied }, i) =>
    copy === false
      ? null
      : {
          // With no copied value, model a handler in a separate JS world: it never calls our shim.
          click: vi.fn(() => {
            if (copied !== undefined) clipboard.writeText(copied);
          }),
          closest: () => roots[i],
          compareDocumentPosition: (other: unknown) =>
            buttons.indexOf(other as never) > i ? 4 : 2,
        },
  );
  const roots = turns.map((_, i) => ({
    querySelector: () => contents[i],
    compareDocumentPosition: (other: unknown) => (roots.indexOf(other as never) > i ? 4 : 2),
  }));
  const main = {
    querySelectorAll: (selector: string) => {
      if (selector === 'button[aria-label="Copy"]') return buttons.filter(Boolean);
      if (selector === '[data-talvt-turn-state="complete"]')
        return roots.filter((_, i) => turns[i]!.complete !== false);
      return [];
    },
  };
  const parked = new Map<string, { id: string; textContent: string; remove: () => void }>();
  const document = {
    querySelector: (selector: string) => {
      if (selector === 'main') return main;
      if (selector === 'button[aria-label="Stop"]' && options.generating) return {};
      return null;
    },
    // Old collector uses this selector directly.
    querySelectorAll: () => buttons.filter(Boolean),
    getElementById: (id: string) => parked.get(id),
    createElement: () => ({
      id: '',
      textContent: '',
      remove() {
        parked.delete(this.id);
      },
    }),
    body: {
      appendChild: (node: { id: string; textContent: string; remove: () => void }) =>
        parked.set(node.id, node),
    },
  };
  let now = 0;
  const fetch = vi.fn(async (url: string) => ({
    ok: url === '/api/auth/session' || (options.conversationStatus ?? 200) === 200,
    json: async () =>
      url === '/api/auth/session' ? { user: {}, accessToken: 'token' } : options.conversation,
  }));
  const globals = {
    document,
    navigator: { clipboard: options.clipboard === 'missing' ? undefined : clipboard },
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    Date: { now: () => (now += 500) },
    setTimeout: (callback: () => void) => callback(),
    fetch,
    URL,
    AbortSignal,
    location: { href: options.pageUrl ?? 'https://chatgpt.com/' },
  };
  const execute = (code: string, context: object) =>
    runInNewContext(`(async () => { ${code}\n })()`, context) as Promise<unknown>;
  const run = (code: string) =>
    execute(code, {
      browser: {
        page: () => ({
          evaluateInPage: async (code: string) => ({ value: await execute(code, globals) }),
        }),
      },
    });
  return { run, clipboard, buttons, fetch };
}

const conversationUrl = 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111';
const userMessage = (text: string) => ({
  author: { role: 'user' },
  content: { content_type: 'text', parts: [text] },
});
const finalMessage = (text: string, over: Record<string, unknown> = {}) => ({
  author: { role: 'assistant' },
  recipient: 'all',
  channel: 'final',
  status: 'finished_successfully',
  end_turn: true,
  content: { content_type: 'text', parts: [text] },
  ...over,
});
function conversation(messages: unknown[]) {
  return {
    current_node: String(messages.length - 1),
    mapping: Object.fromEntries(
      messages.map((message, index) => [
        String(index),
        { parent: index ? String(index - 1) : null, message },
      ]),
    ),
  };
}

describe('ChatGPT saved final reply collection', () => {
  // Attempt 4: final text was complete JSON, but model_dil_v2 rendered null and
  // fallbackMarkdown was empty. The temporary chat could be read via this GET
  // even after reopening its UI failed. No prompt or script content is retained.
  it('recovers a finished answer with a blank UI render through the job conversation URL', async () => {
    const text = JSON.stringify({ status: 'ok', result: 'London\n'.repeat(3000) });
    const saved = conversation([
      userMessage('Write the documentary'),
      finalMessage('', { end_turn: false, content: { content_type: 'thoughts' } }),
      finalMessage('', { end_turn: false, channel: null, recipient: 'web.run' }),
      { author: { role: 'tool' }, content: { content_type: 'execution_output' } },
      finalMessage('', { end_turn: false, content: { content_type: 'reasoning_recap' } }),
      finalMessage(text, {
        metadata: { model_dil_v2: { code: 'DIL.render(() => null)', fallbackMarkdown: '' } },
      }),
    ]);
    const f = replyFixture([{ text: '' }], { conversation: saved, clipboard: 'missing' });
    expect(
      await f.run(pageStateScript(120, 'Write the documentary', conversationUrl)),
    ).toMatchObject({
      replyDone: true,
      replyCount: 1,
      replyAfterLastUser: true,
      lastUserPromptMatches: true,
      generating: false,
    });
    expect(await f.run(copyLastReplyScript(120, 0, conversationUrl))).toBe(text);
    expect(f.fetch).toHaveBeenCalledWith(
      '/backend-api/conversation/11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        credentials: 'include',
        headers: { authorization: 'Bearer token' },
      }),
    );
  });

  it('uses the resolved page URL when submission captured a local-chatgpt placeholder', async () => {
    const f = replyFixture([{ text: '' }], {
      pageUrl: conversationUrl,
      conversation: conversation([userMessage('prompt'), finalMessage('Recovered')]),
    });
    expect(
      await f.run(copyLastReplyScript(120, 0, 'https://chatgpt.com/c/local-chatgpt%3A123')),
    ).toBe('Recovered');
  });

  it.each([
    { end_turn: false },
    { status: 'in_progress' },
    { status: 'finished_partial' },
    { status: 'error' },
    { channel: 'analysis' },
    { recipient: 'container.exec' },
    { content: { content_type: 'thoughts', parts: ['Reasoning'] } },
    { content: { content_type: 'text', parts: [''] } },
    { content: { content_type: 'text', parts: [{ text: 'Not plain text' }] } },
  ])('does not accept a non-final, failed, partial or empty message: %j', async (over) => {
    const f = replyFixture([{ text: '' }], {
      conversation: conversation([userMessage('prompt'), finalMessage('Unusable', over)]),
    });
    expect(await f.run(pageStateScript(120, undefined, conversationUrl))).toMatchObject({
      replyDone: false,
      replyCount: 0,
    });
    expect(await f.run(copyLastReplyScript(120, undefined, conversationUrl))).toBeNull();
  });

  it('waits through long reasoning without a Stop button and ignores old/alternate replies', async () => {
    const saved = conversation([
      userMessage('first'),
      finalMessage('old answer'),
      userMessage('revision'),
      finalMessage('thinking', {
        end_turn: false,
        channel: null,
        content: { content_type: 'thoughts' },
      }),
    ]);
    Object.assign(saved.mapping, {
      unused: { parent: '2', message: finalMessage('wrong branch') },
    });
    const f = replyFixture([{ text: 'old answer' }], { conversation: saved });
    expect(await f.run(pageStateScript(120, 'revision', conversationUrl))).toMatchObject({
      generating: true,
      replyDone: false,
      replyCount: 1,
      replyAfterLastUser: false,
      lastUserPromptMatches: true,
    });
    expect(await f.run(copyLastReplyScript(120, 1, conversationUrl))).toBeNull();
    expect(await f.run(copyLastReplyScript(120, undefined, conversationUrl))).toBeNull();
  });

  it('collects only the revised final on the active branch with a stable turn count', async () => {
    const f = replyFixture([{ text: '' }], {
      conversation: conversation([
        userMessage('first'),
        finalMessage('old answer'),
        userMessage('revision'),
        finalMessage('{"revision":2}'),
      ]),
    });
    expect(await f.run(pageStateScript(120, undefined, conversationUrl))).toMatchObject({
      replyCount: 2,
    });
    expect(await f.run(copyLastReplyScript(120, 1, conversationUrl))).toBe('{"revision":2}');
    expect(await f.run(copyLastReplyScript(120, 2, conversationUrl))).toBeNull();
  });

  it('falls back to readable DOM content on an unavailable endpoint, but never a blank completion', async () => {
    const readable = replyFixture([{ text: 'Completed' }], { conversationStatus: 403 });
    expect(await readable.run(copyLastReplyScript(120, 0, conversationUrl))).toBe('Completed');
    const blank = replyFixture([{ text: '' }], { conversationStatus: 404 });
    expect(await blank.run(pageStateScript(120, undefined, conversationUrl))).toMatchObject({
      replyDone: false,
    });
    expect(await blank.run(copyLastReplyScript(120, 0, conversationUrl))).toBeNull();
  });
});

describe('ChatGPT completed reply collection', () => {
  it('recovers a completed structured reply when Copy does not reach the clipboard shim', async () => {
    const json = '{\n  "status": "ok",\n  "result": {"title": "Victorian London"}\n}';
    const { run, clipboard } = replyFixture([{ text: json }]);
    const reply = await run(copyLastReplyScript(65));
    expect(reply).toBe(json);
    expect(JSON.parse(reply as string)).toEqual({
      status: 'ok',
      result: { title: 'Victorian London' },
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it.each(['missing', 'readonly'] as const)(
    'recovers when the clipboard is %s',
    async (clipboard) => {
      const { run } = replyFixture([{ text: 'Completed response' }], { clipboard });
      expect(await run(copyLastReplyScript(65))).toBe('Completed response');
    },
  );

  it('polls and collects a completed reply without a Copy control', async () => {
    const { run } = replyFixture([{ text: '{"result":42}', copy: false }]);
    expect(await run(pageStateScript(65))).toMatchObject({ replyDone: true, replyCount: 1 });
    expect(await run(copyLastReplyScript(65))).toBe('{"result":42}');
  });

  it('prefers copied markdown and restores both original clipboard methods', async () => {
    const { run, clipboard } = replyFixture([{ text: 'Title', copied: '**Title**' }]);
    const { write, writeText } = clipboard;
    expect(await run(copyLastReplyScript(65))).toBe('**Title**');
    expect(clipboard.write).toBe(write);
    expect(clipboard.writeText).toBe(writeText);
  });

  it('never substitutes the previous turn while waiting for a revision', async () => {
    const { run } = replyFixture([{ text: 'Earlier answer' }]);
    expect(await run(copyLastReplyScript(65, 1))).toBeNull();
  });

  it('reads only the latest completed assistant content across multiple turns', async () => {
    const { run } = replyFixture([
      { text: 'Earlier answer' },
      { text: '{"revision":2}', copy: false },
    ]);
    expect(await run(pageStateScript(65))).toMatchObject({ replyCount: 2 });
    expect(await run(copyLastReplyScript(65, 1))).toBe('{"revision":2}');
  });

  it('does not extract a streaming reply or an unfinished turn without Copy', async () => {
    const streaming = replyFixture([{ text: 'Partial answer' }], { generating: true });
    expect(await streaming.run(copyLastReplyScript(65))).toBeNull();
    const unfinished = replyFixture([{ text: 'Partial answer', copy: false, complete: false }]);
    expect(await unfinished.run(pageStateScript(65))).toMatchObject({ replyCount: 0 });
    expect(await unfinished.run(copyLastReplyScript(65))).toBeNull();
  });

  it('reads a long JSON reply through Neo result chunks without truncation', async () => {
    const json = JSON.stringify({ text: 'London\n'.repeat(1500) });
    const { run } = replyFixture([{ text: json }], { clipboard: 'missing' });
    expect(await run(copyLastReplyScript(65))).toBe(json);
  });
});
