import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { SettingsService } from '../../settings/settings.service';
import { PROVIDER_UNAVAILABLE_PREFIX } from '../provider-unavailable';
import { browserOsFetch, browserOsHostHeaders } from './browseros-host';

const AGENT_NAME = 'reelcraft';
/** Neo's largest inline `run` result, in UTF-8 bytes. */
const NEO_MAX_CHARS = 2_000_000;

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: { ok?: boolean; value?: unknown; error?: unknown; writtenToFile?: boolean };
  isError?: boolean;
};

/**
 * Minimal BrowserOS Neo MCP client. The MCP connection is the Neo session;
 * sessions only scope tab ownership (any session can drive any tab by page
 * id), so one connection per API process is enough and a reconnect after a
 * Neo restart loses nothing.
 */
@Injectable()
export class NeoClient {
  private readonly logger = new Logger(NeoClient.name);
  private client?: Promise<Client> | undefined;
  private clientUrl?: string | undefined;

  constructor(
    @Inject(SettingsService) private readonly settings: Pick<SettingsService, 'browserOsUrl'>,
  ) {}

  /** Runs an async JS body against Neo's `browser` SDK (30s hard cap per call). */
  async run<T>(code: string, retried = false): Promise<T> {
    // Neo keeps only 25 KB inline by default and writes the rest to a file on its own machine.
    const used: { client?: Promise<Client> } = {};
    const result = await this.call(
      'run',
      { code, timeout: 30_000, maxChars: NEO_MAX_CHARS },
      false,
      used,
    );
    const structured = result.structuredContent;
    if (!structured) throw new Error(`BrowserOS Neo run returned no result: ${text(result)}`);
    if (structured.ok === false || result.isError) {
      const error = String(structured.error ?? text(result));
      // Closing a session's last tab deletes its tab group, and Neo then refuses to open
      // pages in that session. The session holds no tabs and the refused call opened
      // nothing, so a fresh session (with a fresh group) can safely replay it.
      if (!retried && error.startsWith('group_out_of_scope')) {
        // Only the connection that served this call: a concurrent call may already have replaced it.
        this.dropClient(used.client);
        return this.run(code, true);
      }
      throw new Error(`BrowserOS Neo script failed: ${error}`);
    }
    if (structured.writtenToFile) {
      throw new Error(`BrowserOS Neo result exceeded ${NEO_MAX_CHARS} bytes and was not returned`);
    }
    return structured.value as T;
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
    retried = false,
    used?: { client?: Promise<Client> },
  ): Promise<ToolResult> {
    try {
      const connecting = this.connect(await this.settings.browserOsUrl());
      if (used) used.client = connecting;
      const client = await connecting;
      return (await client.callTool({
        name,
        arguments: { agentName: AGENT_NAME, ...args },
      })) as ToolResult;
    } catch (error) {
      // Drop the connection so the next call reconnects (e.g. after a Neo restart).
      // Not for a call that merely timed out or that Neo answered with an error:
      // the connection is fine, and other tabs' calls are running on it.
      if (!(error instanceof McpError) || error.code === ErrorCode.ConnectionClosed) {
        this.client = undefined;
      }
      // Neo expires idle sessions with a 404 before running anything, so that
      // one case is safe to replay on a fresh session. Never replay otherwise:
      // a timed-out call may already have clicked Send.
      if (!retried && error instanceof StreamableHTTPError && error.code === 404) {
        return this.call(name, args, true);
      }
      this.logger.warn({ err: error, tool: name }, 'neo call failed');
      throw new Error(`${PROVIDER_UNAVAILABLE_PREFIX}: ${(error as Error).message}`);
    }
  }

  /** Connects to Neo at `url` (or the configured address) and lists its
   * tools, for the Settings page's connection test. */
  async probe(url?: string): Promise<void> {
    const client = await open(url ?? (await this.settings.browserOsUrl()));
    try {
      const { tools } = await client.listTools();
      if (!tools.some((tool) => tool.name === 'run')) {
        throw new Error('this MCP server is not BrowserOS Neo (it has no "run" tool)');
      }
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /** Closes the cached connection; with `only`, just when it is still that one. */
  private dropClient(only?: Promise<Client>): void {
    const old = this.client;
    if (only && old !== only) return;
    this.client = undefined;
    void old?.then((client) => client.close()).catch(() => undefined);
  }

  private connect(url: string): Promise<Client> {
    // The address changed in Settings: drop the old connection.
    if (this.client && this.clientUrl !== url) this.dropClient();
    if (!this.client) {
      this.clientUrl = url;
      this.client = open(url).catch((error: unknown) => {
        this.client = undefined;
        throw error;
      });
    }
    return this.client;
  }
}

async function open(url: string): Promise<Client> {
  const client = new Client({ name: AGENT_NAME, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: browserOsHostHeaders(url) },
    fetch: browserOsFetch,
  });
  // The SDK's own `sessionId?: string` fails our `exactOptionalPropertyTypes`.
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  return client;
}

function text(result: ToolResult): string {
  return (result.content ?? [])
    .map((item) => item.text ?? '')
    .join('\n')
    .slice(0, 300);
}
