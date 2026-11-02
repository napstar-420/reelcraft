import { describe, expect, it } from 'vitest';
import {
  actScript,
  closePageScript,
  lookScript,
  mediaScript,
  openPageScript,
  PRESSABLE_KEYS,
} from './browser-scripts';

/** Each script is the body of an async function Neo runs with `browser` in scope. */
const compiles = (body: string) => () =>
  new Function('browser', `return (async () => {\n${body}\n})();`);

describe('browser scripts', () => {
  it('all compile, whatever the values', () => {
    const nasty = `"); alert('x'); ("\`\${1}`;
    expect(compiles(openPageScript(`https://example.com/?q=${nasty}`))).not.toThrow();
    for (const scroll of [undefined, 'down', 'up', 'top', 'bottom', 1200] as const) {
      expect(compiles(lookScript(3, scroll))).not.toThrow();
    }
    expect(compiles(actScript(3, 'click', nasty, undefined))).not.toThrow();
    expect(compiles(actScript(3, 'type', 'Search', nasty))).not.toThrow();
    for (const key of PRESSABLE_KEYS)
      expect(compiles(actScript(3, 'press', undefined, key))).not.toThrow();
    expect(compiles(actScript(3, 'select', 'Country', nasty))).not.toThrow();
    expect(compiles(mediaScript(3))).not.toThrow();
    expect(compiles(closePageScript(3))).not.toThrow();
  });

  it('puts values in as JSON, never as code', () => {
    const script = actScript(3, 'type', 'Search', `'); evil(); ('`);
    expect(script).toContain(JSON.stringify(`'); evil(); ('`));
  });

  it('refuses bad page ids and unknown keys', () => {
    expect(() => lookScript(-1)).toThrow();
    expect(() => lookScript(1.5)).toThrow();
    expect(() => actScript(3, 'press', undefined, 'F13')).toThrow();
  });

  it('really drives a page through a fake Neo browser', async () => {
    const calls: Array<[string, unknown]> = [];
    const browser = {
      pages: { getInfo: async () => ({ targetId: 't1' }) },
      cdp: async (method: string, params: Record<string, unknown>) => {
        calls.push([method, params]);
        if (method === 'Target.attachToTarget') return { sessionId: 's1' };
        if (method === 'Page.captureScreenshot') return { data: 'SHOT' };
        if (method === 'Runtime.evaluate') {
          return {
            result: {
              value: {
                title: 'T',
                url: 'https://x',
                text: 'hi',
                textLength: 2,
                links: [],
                scrollY: 0,
                pageHeight: 1,
                viewportHeight: 1,
              },
            },
          };
        }
        return {};
      },
    };
    const run = new Function('browser', `return (async () => {\n${lookScript(3, 'down')}\n})();`);
    const view = await run(browser);
    expect(view).toMatchObject({ title: 'T', screenshot: 'SHOT' });
    expect(calls.map((c) => c[0])).toEqual([
      'Target.attachToTarget',
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Page.captureScreenshot',
      'Target.detachFromTarget',
    ]);
  });
});
