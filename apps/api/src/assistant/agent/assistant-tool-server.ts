import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AssistantToolDef, AssistantTurnHandlers } from './assistant-agent.interface';

interface Registration {
  tools: AssistantToolDef[];
  callTool: AssistantTurnHandlers['callTool'];
}

/** What a turn hands its CLI: where the tools are and the secret to reach them. */
export interface ToolEndpoint {
  url: string;
  token: string;
  release(): void;
}

/** Claude Code writes an MCP tool result over 50,000 characters to a file and hands the model a
 * 2 KB preview, however high MAX_MCP_OUTPUT_TOKENS is set. The assistant has no file tools, so
 * that result is lost to it. A tool can opt out with this `_meta` key (500,000 is Claude Code's
 * ceiling); the tools are written to keep results small, this is the net under them. */
const RESULT_SIZE_META = { 'anthropic/maxResultSizeChars': 500_000 };

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/**
 * Reelcraft's assistant tools as an MCP server on 127.0.0.1, for an agent CLI
 * that runs as a child process. Each turn registers its tools under a random
 * bearer token and releases it when it ends, so a request is only ever
 * answered for a running turn, and the server is unreachable from outside
 * this machine.
 */
export class AssistantToolServer {
  private readonly logger = new Logger(AssistantToolServer.name);
  private readonly turns = new Map<string, Registration>();
  private listening: Promise<{ http: HttpServer; url: string }> | undefined;

  async register(
    tools: AssistantToolDef[],
    callTool: AssistantTurnHandlers['callTool'],
  ): Promise<ToolEndpoint> {
    const { url } = await this.listen();
    const token = randomBytes(32).toString('hex');
    this.turns.set(token, { tools, callTool });
    return { url, token, release: () => this.turns.delete(token) };
  }

  close(): void {
    const listening = this.listening;
    this.listening = undefined;
    this.turns.clear();
    void listening?.then(({ http }) => http.close()).catch(() => undefined);
  }

  private listen(): Promise<{ http: HttpServer; url: string }> {
    this.listening ??= new Promise((resolve, reject) => {
      const http = createServer((req, res) => {
        void this.handle(req, res).catch((error: unknown) => {
          this.logger.warn({ err: error }, 'assistant tool request failed');
          if (!res.headersSent) res.writeHead(500).end();
        });
      });
      http.once('error', (error) => {
        this.listening = undefined;
        reject(error);
      });
      http.listen(0, '127.0.0.1', () => {
        http.unref();
        const { port } = http.address() as AddressInfo;
        resolve({ http, url: `http://127.0.0.1:${port}/mcp` });
      });
    });
    return this.listening;
  }

  private async handle(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const token = bearer(req);
    const registration = token ? this.turns.get(token) : undefined;
    if (!registration || new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') {
      res.writeHead(401).end();
      return;
    }
    // Stateless: a fresh MCP server per request, bound to this turn's tools.
    const server = new Server(
      { name: 'reelcraft', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: registration.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: 'object' },
        _meta: RESULT_SIZE_META,
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      let result;
      try {
        result = await registration.callTool(request.params.name, request.params.arguments ?? {});
      } catch (error) {
        result = { ok: false, text: error instanceof Error ? error.message : String(error) };
      }
      return {
        isError: !result.ok,
        content: [
          { type: 'text' as const, text: result.text },
          ...(result.images ?? []).map((image) => ({
            type: 'image' as const,
            data: image.base64,
            mimeType: image.mime,
          })),
        ],
      };
    });
    // Stateless (no session ids). The SDK's optional fields fail our `exactOptionalPropertyTypes`.
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    } as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport as unknown as Parameters<Server['connect']>[0]);
    await transport.handleRequest(req, res);
  }
}
