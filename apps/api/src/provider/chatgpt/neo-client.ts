import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EngineConfig } from '../../config/engine-config';

const AGENT_NAME = 'reelcraft';

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: { ok?: boolean; value?: unknown; error?: unknown };
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

  constructor(private readonly config: EngineConfig) {}

  /** Runs an async JS body against Neo's `browser` SDK (30s hard cap per call). */
  async run<T>(code: string): Promise<T> {
    const result = await this.call('run', { code, timeout: 30_000 });
    const structured = result.structuredContent;
    if (!structured) throw new Error(`BrowserOS Neo run returned no result: ${text(result)}`);
    if (structured.ok === false || result.isError) {
      throw new Error(`BrowserOS Neo script failed: ${String(structured.error ?? text(result))}`);
    }
    return structured.value as T;
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
    retried = false,
  ): Promise<ToolResult> {
    try {
      const client = await this.connect();
      return (await client.callTool({
        name,
        arguments: { agentName: AGENT_NAME, ...args },
      })) as ToolResult;
    } catch (error) {
      // Drop the connection so the next call reconnects (e.g. after a Neo restart).
      this.client = undefined;
      // Neo expires idle sessions with a 404 before running anything, so that
      // one case is safe to replay on a fresh session. Never replay otherwise:
      // a timed-out call may already have clicked Send.
      if (!retried && error instanceof StreamableHTTPError && error.code === 404) {
        return this.call(name, args, true);
      }
      this.logger.warn({ err: error, tool: name }, 'neo call failed');
      throw new Error(`BrowserOS Neo is unavailable: ${(error as Error).message}`);
    }
  }

  private connect(): Promise<Client> {
    this.client ??= (async () => {
      const client = new Client({ name: AGENT_NAME, version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(this.config.codexBrowserOsUrl));
      // The SDK's own `sessionId?: string` fails our `exactOptionalPropertyTypes`.
      await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
      return client;
    })().catch((error: unknown) => {
      this.client = undefined;
      throw error;
    });
    return this.client;
  }
}

function text(result: ToolResult): string {
  return (result.content ?? [])
    .map((item) => item.text ?? '')
    .join('\n')
    .slice(0, 300);
}
