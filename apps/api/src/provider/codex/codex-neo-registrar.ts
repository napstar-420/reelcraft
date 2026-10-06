import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CodexNeoRegistration } from '@reelcraft/shared';
import { EngineConfig } from '../../config/engine-config';
import { SETTING, SettingsService } from '../../settings/settings.service';

const execFileAsync = promisify(execFile);

export type RunCodex = (args: string[]) => Promise<string>;

type McpEntry = {
  name?: unknown;
  transport?: { type?: unknown; url?: unknown; command?: unknown };
};

/** An MCP server in Codex's config, as far as disabling it needs to know. */
export interface CodexMcpServer {
  name: string;
  transport: { type: 'stdio'; command: string } | { type: 'streamable_http'; url: string };
}

/**
 * Registers BrowserOS Neo as an MCP server in Codex's own config, which is
 * how Codex browser stages reach it. It only adds the entry, or updates one
 * it added itself (recorded in the `codex.neoMcpUrl` setting); an entry the
 * user configured is left alone.
 */
@Injectable()
export class CodexNeoRegistrar {
  private readonly logger = new Logger(CodexNeoRegistrar.name);
  private readonly runCodex: RunCodex;

  constructor(
    private readonly config: EngineConfig,
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'browserOsUrl' | 'get' | 'set'>,
    runCodex?: RunCodex,
  ) {
    this.runCodex =
      runCodex ??
      (async (args) => {
        const { stdout } = await execFileAsync('codex', args, {
          timeout: 15_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        return stdout;
      });
  }

  async status(): Promise<CodexNeoRegistration> {
    try {
      const entry = await this.entry();
      if (!entry) return 'missing';
      return (await this.ownedBy(entry)) ? 'reelcraft' : 'user';
    } catch (error) {
      this.logger.warn({ err: error }, 'codex mcp list failed');
      return 'unknown';
    }
  }

  /** Adds Neo to Codex's MCP servers, or points Reelcraft's own entry at the
   * current Neo address. Never throws; returns the resulting state. */
  async ensure(): Promise<CodexNeoRegistration> {
    const name = this.config.codexBrowserExtension;
    try {
      const url = await this.settings.browserOsUrl();
      const entry = await this.entry();
      if (entry && !(await this.ownedBy(entry))) return 'user';
      if (entry && entry.transport?.url === url) return 'reelcraft';
      if (entry) await this.runCodex(['mcp', 'remove', name]);
      await this.runCodex(['mcp', 'add', name, '--url', url]);
      await this.settings.set(SETTING.codexNeoMcpUrl, url);
      this.logger.log({ name, url }, 'registered BrowserOS Neo with Codex');
      return 'reelcraft';
    } catch (error) {
      this.logger.warn({ err: error }, 'could not register BrowserOS Neo with Codex');
      return 'unknown';
    }
  }

  /** Every MCP server in Codex's config (enabled or not). A server of a kind we can't describe
   * is returned with `transport: null` so the caller can refuse to run rather than guess. */
  async listServers(): Promise<Array<CodexMcpServer | { name: string; transport: null }>> {
    const list = JSON.parse(await this.runCodex(['mcp', 'list', '--json'])) as unknown;
    if (!Array.isArray(list)) throw new Error('codex mcp list --json returned no list');
    const servers: Array<CodexMcpServer | { name: string; transport: null }> = [];
    for (const item of list as McpEntry[]) {
      if (typeof item.name !== 'string') continue;
      const t = item.transport;
      if (t?.type === 'stdio' && typeof t.command === 'string') {
        servers.push({ name: item.name, transport: { type: 'stdio', command: t.command } });
      } else if (t?.type === 'streamable_http' && typeof t.url === 'string') {
        servers.push({ name: item.name, transport: { type: 'streamable_http', url: t.url } });
      } else {
        servers.push({ name: item.name, transport: null });
      }
    }
    return servers;
  }

  private async entry(): Promise<McpEntry | undefined> {
    const list = JSON.parse(await this.runCodex(['mcp', 'list', '--json'])) as unknown;
    if (!Array.isArray(list)) throw new Error('codex mcp list --json returned no list');
    return (list as McpEntry[]).find((item) => item.name === this.config.codexBrowserExtension);
  }

  private async ownedBy(entry: McpEntry): Promise<boolean> {
    const managed = await this.settings.get(SETTING.codexNeoMcpUrl);
    return (
      managed !== undefined &&
      entry.transport?.type === 'streamable_http' &&
      entry.transport.url === managed
    );
  }
}
