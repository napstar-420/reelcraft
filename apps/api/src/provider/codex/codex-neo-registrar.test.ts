import { describe, expect, it } from 'vitest';
import type { EngineConfig } from '../../config/engine-config';
import { CodexNeoRegistrar } from './codex-neo-registrar';

const config = { codexBrowserExtension: 'browseros-neo' } as EngineConfig;

function fixture(opts: { entries: unknown[]; managed?: string; url?: string }) {
  const store = new Map<string, string>();
  if (opts.managed) store.set('codex.neoMcpUrl', opts.managed);
  const calls: string[][] = [];
  let entries = opts.entries;
  const registrar = new CodexNeoRegistrar(
    config,
    {
      browserOsUrl: async () => opts.url ?? 'http://host.docker.internal:9010/mcp',
      get: async (key: string) => store.get(key),
      set: async (key: string, value: string) => void store.set(key, value),
    },
    async (args) => {
      calls.push(args);
      if (args[1] === 'list') return JSON.stringify(entries);
      if (args[1] === 'remove') entries = [];
      return '';
    },
  );
  return { registrar, calls, store };
}

const http = (url: string) => ({
  name: 'browseros-neo',
  transport: { type: 'streamable_http', url },
});

describe('CodexNeoRegistrar', () => {
  it('adds Neo when Codex has no entry and remembers it added it', async () => {
    const { registrar, calls, store } = fixture({ entries: [] });
    await expect(registrar.status()).resolves.toBe('missing');
    await expect(registrar.ensure()).resolves.toBe('reelcraft');
    expect(calls).toContainEqual([
      'mcp',
      'add',
      'browseros-neo',
      '--url',
      'http://host.docker.internal:9010/mcp',
    ]);
    expect(store.get('codex.neoMcpUrl')).toBe('http://host.docker.internal:9010/mcp');
  });

  it('does nothing when its own entry already has the address', async () => {
    const url = 'http://host.docker.internal:9010/mcp';
    const { registrar, calls } = fixture({ entries: [http(url)], managed: url });
    await expect(registrar.ensure()).resolves.toBe('reelcraft');
    expect(calls.filter((c) => c[1] !== 'list')).toEqual([]);
  });

  it('moves its own entry to a new address', async () => {
    const { registrar, calls } = fixture({
      entries: [http('http://old:9010/mcp')],
      managed: 'http://old:9010/mcp',
      url: 'http://new:9010/mcp',
    });
    await expect(registrar.ensure()).resolves.toBe('reelcraft');
    expect(calls.filter((c) => c[1] !== 'list')).toEqual([
      ['mcp', 'remove', 'browseros-neo'],
      ['mcp', 'add', 'browseros-neo', '--url', 'http://new:9010/mcp'],
    ]);
  });

  it('leaves an entry the user configured alone', async () => {
    const { registrar, calls } = fixture({ entries: [http('http://mine:1/mcp')] });
    await expect(registrar.status()).resolves.toBe('user');
    await expect(registrar.ensure()).resolves.toBe('user');
    expect(calls.filter((c) => c[1] !== 'list')).toEqual([]);
  });

  it('reports unknown when the codex CLI fails', async () => {
    const registrar = new CodexNeoRegistrar(
      config,
      { browserOsUrl: async () => 'x', get: async () => undefined, set: async () => undefined },
      async () => {
        throw new Error('spawn codex ENOENT');
      },
    );
    await expect(registrar.status()).resolves.toBe('unknown');
    await expect(registrar.ensure()).resolves.toBe('unknown');
  });

  it('lists every MCP server with the transport needed to disable it', async () => {
    const { registrar } = fixture({
      entries: [
        http('http://x:1/mcp'),
        { name: 'agentmemory', transport: { type: 'stdio', command: 'npx', args: ['-y', 'x'] } },
        { name: 'strange', transport: { type: 'something-new' } },
        { transport: { type: 'stdio', command: 'nameless' } },
      ],
    });
    await expect(registrar.listServers()).resolves.toEqual([
      { name: 'browseros-neo', transport: { type: 'streamable_http', url: 'http://x:1/mcp' } },
      { name: 'agentmemory', transport: { type: 'stdio', command: 'npx' } },
      { name: 'strange', transport: null },
    ]);
  });
});
