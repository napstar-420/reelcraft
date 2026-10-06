import { describe, expect, it } from 'vitest';
import { DISABLED_CODEX_FEATURES, buildAssistantAppServerArgs } from './codex-app-server-args';

describe('buildAssistantAppServerArgs', () => {
  it('turns the built-in features off and keeps code mode (dynamic tools need it)', () => {
    const args = buildAssistantAppServerArgs([]);
    expect(args.slice(0, 2)).toEqual(['app-server', '--stdio']);
    for (const feature of DISABLED_CODEX_FEATURES) {
      expect(args.join(' ')).toContain(`--disable ${feature}`);
    }
    expect(args).not.toContain('code_mode_host');
    expect(args.join(' ')).toContain('web_search="disabled"');
    for (const needed of ['shell_tool', 'unified_exec', 'plugins', 'browser_use', 'computer_use']) {
      expect(DISABLED_CODEX_FEATURES).toContain(needed);
    }
  });

  it('disables each configured MCP server by repeating its own transport (a bare enabled=false makes Codex exit)', () => {
    const args = buildAssistantAppServerArgs([
      {
        name: 'browseros-neo',
        transport: { type: 'streamable_http', url: 'http://127.0.0.1:9010/mcp' },
      },
      { name: 'agentmemory', transport: { type: 'stdio', command: 'npx' } },
    ]);
    expect(args).toContain(
      'mcp_servers.browseros-neo={ url = "http://127.0.0.1:9010/mcp", enabled = false }',
    );
    expect(args).toContain('mcp_servers.agentmemory={ command = "npx", enabled = false }');
    // every override is introduced by -c
    const i = args.indexOf('mcp_servers.agentmemory={ command = "npx", enabled = false }');
    expect(args[i - 1]).toBe('-c');
  });

  it('refuses a server it cannot disable safely', () => {
    expect(() => buildAssistantAppServerArgs([{ name: 'weird', transport: null }])).toThrow(
      /can't disable/,
    );
    expect(() =>
      buildAssistantAppServerArgs([{ name: 'a.b"c', transport: { type: 'stdio', command: 'x' } }]),
    ).toThrow(/name/);
  });
});
