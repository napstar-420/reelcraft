import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { AssistantTurnError, type AgentEvent } from './assistant-agent.interface';
import { AssistantToolServer } from './assistant-tool-server';
import { buildAssistantClaudeArgs, ClaudeAssistantAgent } from './claude-assistant.agent';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  kill = vi.fn(() => {
    setImmediate(() => this.emit('close', null));
    return true;
  });
  /** Prints these events, one per line, then exits. */
  replay(events: object[], code = 0) {
    setImmediate(() => {
      for (const event of events)
        this.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`));
      this.emit('close', code);
    });
  }
}

const init = {
  type: 'system',
  subtype: 'init',
  tools: ['mcp__reelcraft__get_blueprint'],
  mcp_servers: [{ name: 'reelcraft', status: 'connected' }],
};
const success = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Done',
  usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 3 },
};

async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'reelcraft-claude-agent-'));
  const children: FakeChild[] = [];
  const spawn = vi.fn((_args: string[]) => {
    const child = new FakeChild();
    children.push(child);
    return child as never;
  });
  const tools = {
    register: vi.fn(async () => ({ url: 'http://127.0.0.1:1/mcp', token: 't', release: vi.fn() })),
    close: vi.fn(),
  };
  const agent = new ClaudeAssistantAgent({
    workspaceRoot,
    spawn,
    tools: tools as never,
    checkLogin: async () => ({ installed: true, connected: true, detail: null }),
  });
  const sessionId = await agent.startSession({
    instructions: 'x',
    tools: [{ name: 'get_blueprint', description: 'd', inputSchema: { type: 'object' } }],
  });
  const events: AgentEvent[] = [];
  const turn = (signal = new AbortController().signal) =>
    agent.runTurn({
      sessionId,
      text: 'hello',
      model: 'sonnet',
      effort: 'low',
      instructions: 'Be helpful',
      mode: 'manual',
      signal,
      handlers: { callTool: vi.fn(), onEvent: (event) => events.push(event) },
    });
  return { agent, spawn, children, tools, sessionId, events, turn };
}

describe('buildAssistantClaudeArgs', () => {
  it('gives Claude only Reelcraft tools, with every customization off', () => {
    const args = buildAssistantClaudeArgs({
      sessionId: 'id',
      resume: false,
      model: 'sonnet',
      instructions: 'Be helpful',
      endpoint: { url: 'http://127.0.0.1:1/mcp', token: 'secret' },
    });
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(flag('--tools')).toBe('');
    expect(flag('--setting-sources')).toBe('');
    expect(flag('--allowedTools')).toBe('mcp__reelcraft');
    expect(flag('--permission-mode')).toBe('dontAsk');
    expect(flag('--session-id')).toBe('id');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--disable-slash-commands');
    expect(args).not.toContain('--effort');
    expect(JSON.parse(flag('--mcp-config')!)).toEqual({
      mcpServers: {
        reelcraft: {
          type: 'http',
          url: 'http://127.0.0.1:1/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
      },
    });
  });
});

describe('ClaudeAssistantAgent', () => {
  it('starts the conversation, then resumes it on later turns', async () => {
    const { spawn, children, turn, sessionId } = await fixture();
    const first = turn();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]!.replay([init, success]);
    await first;
    expect(spawn.mock.calls[0]![0]).toEqual(expect.arrayContaining(['--session-id', sessionId]));
    expect(children[0]!.stdin.end).toHaveBeenCalledWith('hello');

    const second = turn();
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1]!.replay([init, success]);
    await second;
    expect(spawn.mock.calls[1]![0]).toEqual(expect.arrayContaining(['--resume', sessionId]));
  });

  describe('when Claude rejects the stored history', () => {
    const message = 'API Error: 400 due to tool use concurrency issues.';
    // what Claude Code really prints: the error as a made-up assistant message, then the result
    const synthetic = {
      type: 'assistant',
      error: 'invalid_request',
      message: { id: 'x', model: '<synthetic>', content: [{ type: 'text', text: message }] },
    };
    const rejected = { type: 'result', is_error: true, result: message };

    it('starts a new Claude conversation, tells it, and retries the turn once', async () => {
      const { spawn, children, turn, sessionId, events } = await fixture();
      const first = turn();
      await vi.waitFor(() => expect(children).toHaveLength(1));
      children[0]!.replay([init, success]);
      await first;
      events.length = 0;

      const second = turn();
      await vi.waitFor(() => expect(children).toHaveLength(2));
      children[1]!.replay([init, synthetic, rejected], 1);
      await vi.waitFor(() => expect(children).toHaveLength(3));
      children[2]!.replay([init, success]);
      await second;
      // the error text is never shown as something the assistant said
      expect(events).toEqual([{ type: 'usage', inputTokens: 15, outputTokens: 3 }]);

      expect(spawn.mock.calls[1]![0]).toEqual(expect.arrayContaining(['--resume', sessionId]));
      const retry = spawn.mock.calls[2]![0];
      const freshId = retry[retry.indexOf('--session-id') + 1];
      expect(freshId).toMatch(/^[0-9a-f-]{36}$/);
      expect(freshId).not.toBe(sessionId);
      expect(retry).not.toContain('--resume');
      const sent = children[2]!.stdin.end.mock.calls[0]![0] as string;
      expect(sent).toContain('earlier messages could not be loaded');
      expect(sent).toContain('hello');

      // later turns resume the new conversation, not the broken one
      const third = turn();
      await vi.waitFor(() => expect(children).toHaveLength(4));
      children[3]!.replay([init, success]);
      await third;
      expect(spawn.mock.calls[3]![0]).toEqual(expect.arrayContaining(['--resume', freshId]));
      expect(children[3]!.stdin.end).toHaveBeenCalledWith('hello');
    });

    it('does not start over once the user has seen output, and fails other errors as before', async () => {
      const { children, turn } = await fixture();
      const first = turn();
      await vi.waitFor(() => expect(children).toHaveLength(1));
      children[0]!.replay([init, success]);
      await first;

      const second = turn();
      await vi.waitFor(() => expect(children).toHaveLength(2));
      children[1]!.replay([
        init,
        { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hi' }] } },
        rejected,
      ]);
      await expect(second).rejects.toThrow(/tool use concurrency/);
      expect(children).toHaveLength(2);

      const third = turn();
      await vi.waitFor(() => expect(children).toHaveLength(3));
      children[2]!.replay([init, { type: 'result', is_error: true, result: 'Not logged in' }], 1);
      await expect(third).rejects.toThrow('Not logged in');
      expect(children).toHaveLength(3);
    });

    it('gives up after one fresh start', async () => {
      const { children, turn } = await fixture();
      const first = turn();
      await vi.waitFor(() => expect(children).toHaveLength(1));
      children[0]!.replay([init, success]);
      await first;
      const second = turn();
      await vi.waitFor(() => expect(children).toHaveLength(2));
      children[1]!.replay([init, rejected], 1);
      await vi.waitFor(() => expect(children).toHaveLength(3));
      children[2]!.replay([init, rejected], 1);
      await expect(second).rejects.toThrow(/tool use concurrency/);
      expect(children).toHaveLength(3);
    });
  });

  it('streams text and the finished message under one item, and reports usage', async () => {
    const { children, turn, events } = await fixture();
    const done = turn();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const stream = (event: object) => ({ type: 'stream_event', event });
    children[0]!.replay([
      init,
      stream({ type: 'message_start', message: { id: 'm1' } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      stream({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
      stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi ' } }),
      stream({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'there' },
      }),
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking' }] } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hi there' }] } },
      success,
    ]);
    await done;
    expect(events).toEqual([
      { type: 'message.delta', itemKey: 'm1:1', text: 'Hi ' },
      { type: 'message.delta', itemKey: 'm1:1', text: 'there' },
      { type: 'message', itemKey: 'm1:1', text: 'Hi there' },
      { type: 'usage', inputTokens: 15, outputTokens: 3 },
    ]);
  });

  it('refuses to run when Claude offers any other tool or MCP server', async () => {
    const { children, turn } = await fixture();
    const done = turn();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]!.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ ...init, tools: [...init.tools, 'Bash'] })}\n`),
    );
    await expect(done).rejects.toThrow(/refused to run Claude: .*Bash/);
    expect(children[0]!.kill).toHaveBeenCalled();
  });

  it('fails the turn with the error Claude reports', async () => {
    const { children, turn } = await fixture();
    const done = turn();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]!.replay([init, { type: 'result', is_error: true, result: 'Not logged in' }], 1);
    await expect(done).rejects.toEqual(new AssistantTurnError('failed', 'Not logged in'));
  });

  it('stops the process when the turn is interrupted', async () => {
    const { children, turn } = await fixture();
    const controller = new AbortController();
    const done = turn(controller.signal);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    controller.abort();
    await expect(done).rejects.toMatchObject({ kind: 'interrupted' });
    expect(children[0]!.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('cannot continue a chat it has no state for', async () => {
    const { agent } = await fixture();
    await expect(
      agent.runTurn({
        sessionId: '12345678-1234-1234-1234-123456789abc',
        text: 'hi',
        model: 'sonnet',
        instructions: '',
        mode: 'manual',
        signal: new AbortController().signal,
        handlers: { callTool: vi.fn(), onEvent: vi.fn() },
      }),
    ).rejects.toThrow(/Start a new chat/);
  });
});

describe('AssistantToolServer', () => {
  it('answers only a registered turn, with its tools, text and images', async () => {
    const server = new AssistantToolServer();
    const callTool = vi.fn(async () => ({
      ok: true,
      text: 'ok',
      images: [{ mime: 'image/png' as const, base64: 'AAAA' }],
    }));
    const endpoint = await server.register(
      [{ name: 'get_blueprint', description: 'd', inputSchema: { type: 'object' } }],
      callTool,
    );
    const connect = async (token: string) => {
      const client = new Client({ name: 'test', version: '1' });
      const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
      return client;
    };
    try {
      await expect(connect('wrong')).rejects.toThrow();
      const client = await connect(endpoint.token);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['get_blueprint']);
      const result = await client.callTool({ name: 'get_blueprint', arguments: { a: 1 } });
      expect(callTool).toHaveBeenCalledWith('get_blueprint', { a: 1 });
      expect(result.content).toEqual([
        { type: 'text', text: 'ok' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ]);
      await client.close();
      endpoint.release();
      await expect(connect(endpoint.token)).rejects.toThrow();
    } finally {
      server.close();
    }
  });

  it('lets a large tool result through whole: every tool opts out of Claude Code spilling it to a file', async () => {
    const server = new AssistantToolServer();
    const big = 'x'.repeat(400_000);
    const endpoint = await server.register(
      [{ name: 'get_blueprint', description: 'd', inputSchema: { type: 'object' } }],
      async () => ({ ok: true, text: big }),
    );
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint.url), {
        requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } },
      }) as unknown as Parameters<Client['connect']>[0],
    );
    try {
      const [tool] = (await client.listTools()).tools;
      // Claude Code reads this key; without it a result over 50,000 characters becomes a 2 KB preview
      expect(tool?._meta).toEqual({ 'anthropic/maxResultSizeChars': 500_000 });
      const result = await client.callTool({ name: 'get_blueprint', arguments: {} });
      expect(result.content).toEqual([{ type: 'text', text: big }]);
    } finally {
      await client.close();
      server.close();
    }
  });
});
