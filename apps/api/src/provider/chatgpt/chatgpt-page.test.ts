import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  CDP_READ_UNSUPPORTED,
  enableWebSearchScript,
  inPage,
  openAttachmentMenuScript,
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
