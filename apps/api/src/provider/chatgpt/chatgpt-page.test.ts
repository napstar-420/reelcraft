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
  turns: Array<{
    text: string;
    copy?: boolean;
    complete?: boolean;
    copied?: string;
    contentOnTurn?: boolean;
    codeCopy?: boolean;
    duplicateCopy?: boolean;
  }>,
  options: { clipboard?: 'missing' | 'readonly'; generating?: boolean } = {},
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
          closest: (selector: string) =>
            selector === 'pre' ? (turns[i]!.codeCopy ? {} : null) : roots[i],
          compareDocumentPosition: (other: unknown) =>
            buttons.indexOf(other as never) > i ? 4 : 2,
        },
  );
  const roots = turns.map((turn, i) => ({
    innerText: turn.contentOnTurn ? turn.text : undefined,
    matches: (selector: string) =>
      !!turn.contentOnTurn && selector.includes('data-message-author-role'),
    querySelector: (selector: string) =>
      turn.contentOnTurn || !selector.includes('data-message-author-role') ? null : contents[i],
    compareDocumentPosition: (other: unknown) => (roots.indexOf(other as never) > i ? 4 : 2),
  }));
  const main = {
    querySelectorAll: (selector: string) => {
      if (selector === 'button[aria-label="Copy"]')
        return buttons.flatMap((button, i) =>
          button ? (turns[i]!.duplicateCopy ? [button, { ...button }] : [button]) : [],
        );
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
  const globals = {
    document,
    navigator: { clipboard: options.clipboard === 'missing' ? undefined : clipboard },
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    Date: { now: () => (now += 500) },
    setTimeout: (callback: () => void) => callback(),
    fetch: async () => ({ ok: true, json: async () => ({ user: {}, accessToken: 'token' }) }),
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
  return { run, clipboard, buttons };
}

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

  it.each([true, false])(
    'collects long structured content when the completed turn is the assistant node (Copy=%s)',
    async (copy) => {
      const json = JSON.stringify({
        scenes: Array.from({ length: 80 }, () => 'London雪🌍\n'.repeat(100)),
      });
      const { run } = replyFixture(
        [{ text: 'Earlier answer' }, { text: json, contentOnTurn: true, copy }],
        { clipboard: 'missing' },
      );
      expect(await run(pageStateScript(65))).toMatchObject({ replyCount: 2 });
      expect(await run(copyLastReplyScript(65, 1))).toBe(json);
    },
  );

  it('does not count a code-block Copy control as a completed response', async () => {
    const { run } = replyFixture([
      { text: 'Earlier answer' },
      { text: '{"partial":', codeCopy: true, complete: false },
    ]);
    expect(await run(pageStateScript(65))).toMatchObject({ replyCount: 1 });
    expect(await run(copyLastReplyScript(65, 1))).toBeNull();
  });

  it('reads the complete assistant response instead of copying only a code block', async () => {
    const { run, buttons } = replyFixture([
      { text: 'Full answer with code and explanation', codeCopy: true, copied: 'code only' },
    ]);
    expect(await run(pageStateScript(65))).toMatchObject({ replyCount: 1 });
    expect(await run(copyLastReplyScript(65))).toBe('Full answer with code and explanation');
    expect(buttons[0]?.click).not.toHaveBeenCalled();
  });

  it('counts one completed turn even if it has duplicate Copy controls', async () => {
    const { run } = replyFixture([{ text: 'Earlier answer', duplicateCopy: true }]);
    expect(await run(pageStateScript(65))).toMatchObject({ replyCount: 1 });
    expect(await run(copyLastReplyScript(65, 1))).toBeNull();
  });
});
