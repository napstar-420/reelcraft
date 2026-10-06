import { toTomlValue } from '../../provider/codex/codex-command';
import type { CodexMcpServer } from '../../provider/codex/codex-neo-registrar';

/**
 * Codex built-ins the assistant must not have: shell, files, browser and computer use, web search,
 * image generation, plugins, hooks, memories, sub-agents, apps. Verified against codex-cli 0.160.0
 * (see docs/codex-provider.md): with these off the model sees only Reelcraft's tools plus `wait`,
 * `request_user_input` and the `collaboration.*` helpers.
 *
 * `code_mode_host` is deliberately NOT here: dynamic tools run through it, and turning it off
 * breaks them ("code-mode host is disabled").
 */
export const DISABLED_CODEX_FEATURES = [
  'apps',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'goals',
  'hooks',
  'image_generation',
  'memories',
  'multi_agent',
  'plugins',
  'remote_plugin',
  'shell_tool',
  'unified_exec',
  'skill_search',
  'tool_suggest',
  'sleep_tool',
  'skill_mcp_dependency_install',
] as const;

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Arguments for the assistant's `codex app-server`. Every MCP server in the user's Codex config is
 * switched off: BrowserOS Neo is registered there with the user's signed-in accounts, and the
 * assistant must never reach it. `-c mcp_servers.<n>.enabled=false` alone makes Codex exit
 * ("invalid transport"), so each override repeats the server's own command or url next to
 * `enabled = false` (secrets such as `env` are not copied; they merge from the original entry).
 *
 * Throws when a server can't be switched off safely (an unknown kind or an odd name).
 */
export function buildAssistantAppServerArgs(
  servers: Array<CodexMcpServer | { name: string; transport: null }>,
): string[] {
  const overrides = servers.flatMap((server) => {
    if (!SERVER_NAME.test(server.name)) {
      throw new Error(`Codex MCP server "${server.name}" has a name the assistant can't disable`);
    }
    if (!server.transport) {
      throw new Error(`Codex MCP server "${server.name}" is of a kind the assistant can't disable`);
    }
    const transport =
      server.transport.type === 'stdio'
        ? { command: server.transport.command }
        : { url: server.transport.url };
    return ['-c', `mcp_servers.${server.name}=${toTomlValue({ ...transport, enabled: false })}`];
  });
  return [
    'app-server',
    '--stdio',
    ...DISABLED_CODEX_FEATURES.flatMap((feature) => ['--disable', feature]),
    '-c',
    'web_search="disabled"',
    ...overrides,
  ];
}
