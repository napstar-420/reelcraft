import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { copyLastReplyScript, pageStateScript } from './chatgpt-page';

/** Execute the generated Neo code, including its page-world boundary and chunked result reads. */
function pageFixture(
  turns: Array<{ text: string; copy?: boolean; complete?: boolean; copied?: string }>,
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
        evaluate: async (_id: number, { code }: { code: string }) => ({
          value: await execute(code, globals),
        }),
      },
    });
  return { run, clipboard, buttons };
}

describe('ChatGPT completed reply collection', () => {
  it('recovers a completed structured reply when Copy does not reach the clipboard shim', async () => {
    const json = '{\n  "status": "ok",\n  "result": {"title": "Victorian London"}\n}';
    const { run, clipboard } = pageFixture([{ text: json }]);
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
      const { run } = pageFixture([{ text: 'Completed response' }], { clipboard });
      expect(await run(copyLastReplyScript(65))).toBe('Completed response');
    },
  );

  it('polls and collects a completed reply without a Copy control', async () => {
    const { run } = pageFixture([{ text: '{"result":42}', copy: false }]);
    expect(await run(pageStateScript(65))).toMatchObject({ replyDone: true, replyCount: 1 });
    expect(await run(copyLastReplyScript(65))).toBe('{"result":42}');
  });

  it('prefers copied markdown and restores both original clipboard methods', async () => {
    const { run, clipboard } = pageFixture([{ text: 'Title', copied: '**Title**' }]);
    const { write, writeText } = clipboard;
    expect(await run(copyLastReplyScript(65))).toBe('**Title**');
    expect(clipboard.write).toBe(write);
    expect(clipboard.writeText).toBe(writeText);
  });

  it('never substitutes the previous turn while waiting for a revision', async () => {
    const { run } = pageFixture([{ text: 'Earlier answer' }]);
    expect(await run(copyLastReplyScript(65, 1))).toBeNull();
  });

  it('reads only the latest completed assistant content across multiple turns', async () => {
    const { run } = pageFixture([
      { text: 'Earlier answer' },
      { text: '{"revision":2}', copy: false },
    ]);
    expect(await run(pageStateScript(65))).toMatchObject({ replyCount: 2 });
    expect(await run(copyLastReplyScript(65, 1))).toBe('{"revision":2}');
  });

  it('does not extract a streaming reply or an unfinished turn without Copy', async () => {
    const streaming = pageFixture([{ text: 'Partial answer' }], { generating: true });
    expect(await streaming.run(copyLastReplyScript(65))).toBeNull();
    const unfinished = pageFixture([{ text: 'Partial answer', copy: false, complete: false }]);
    expect(await unfinished.run(pageStateScript(65))).toMatchObject({ replyCount: 0 });
    expect(await unfinished.run(copyLastReplyScript(65))).toBeNull();
  });

  it('reads a long JSON reply through Neo result chunks without truncation', async () => {
    const json = JSON.stringify({ text: 'London\n'.repeat(1500) });
    const { run } = pageFixture([{ text: json }], { clipboard: 'missing' });
    expect(await run(copyLastReplyScript(65))).toBe(json);
  });
});
