import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantTurnError, type AgentEvent } from './assistant-agent.interface';
import { CodexAssistantAgent, type CodexAssistantAgentDeps } from './codex-assistant.agent';

type Json = Record<string, unknown>;
type Responder = (params: Json, message: Json) => unknown;

/** A scripted `codex app-server`. The message shapes were recorded from codex-cli 0.160.0. */
class FakeCodex {
  readonly proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  readonly received: Json[] = [];
  /** What `mcpServerStatus/list` returns: servers that still expose tools make the agent refuse. */
  mcpStatus: Json = { data: [] };
  private readonly replies = new Map<number, (message: Json) => void>();
  private nextServerId = 100;

  constructor(readonly responders: Record<string, Responder> = {}) {
    this.proc.stdin = new PassThrough();
    this.proc.stdout = new PassThrough();
    this.proc.stderr = new PassThrough();
    this.proc.kill = vi.fn(() => {
      queueMicrotask(() => this.proc.emit('exit', 0, null));
      return true;
    });
    this.proc.stdin.on('data', (chunk) => {
      for (const line of chunk.toString().trim().split('\n')) this.onClientLine(JSON.parse(line));
    });
  }

  private onClientLine(message: Json): void {
    this.received.push(message);
    if (message.method === undefined && typeof message.id === 'number') {
      this.replies.get(message.id)?.(message);
      return;
    }
    if (typeof message.id !== 'number') return; // notification (initialized)
    const method = message.method as string;
    const responder = this.responders[method];
    const result =
      method === 'initialize'
        ? { userAgent: 'fake', codexHome: '/tmp/codex' }
        : method === 'mcpServerStatus/list'
          ? this.mcpStatus
          : responder
            ? responder((message.params ?? {}) as Json, message)
            : {};
    this.send({ id: message.id, result });
  }

  send(message: Json): void {
    this.proc.stdout.write(`${JSON.stringify(message)}\n`);
  }

  notify(method: string, params: Json): void {
    this.send({ method, params });
  }

  /** Server → client request; resolves with the client's reply message. */
  serverRequest(method: string, params: Json): Promise<Json> {
    const id = this.nextServerId++;
    return new Promise((resolve) => {
      this.replies.set(id, resolve);
      this.send({ id, method, params });
    });
  }

  requests(method: string): Json[] {
    return this.received.filter((m) => m.method === method);
  }

  crash(): void {
    this.proc.emit('exit', 1, null);
  }
}

const THREAD = 'thread-1';

function setup(
  opts: {
    fakes?: FakeCodex[];
    deps?: Partial<CodexAssistantAgentDeps>;
    servers?: Awaited<ReturnType<CodexAssistantAgentDeps['registrar']['listServers']>>;
  } = {},
) {
  const fakes = opts.fakes ?? [fakeWithThread()];
  let spawned = 0;
  const spawn = vi.fn(() => {
    const fake = fakes[Math.min(spawned++, fakes.length - 1)]!;
    return fake.proc as never;
  });
  let onReset: () => void = () => undefined;
  const agent = new CodexAssistantAgent({
    models: {
      listModels: async () => [
        {
          modelId: 'gpt-x',
          label: 'GPT X',
          supportedReasoningEfforts: ['low'],
          defaultReasoningEffort: 'low',
          isDefault: true,
        },
      ],
      onReset: (cb: () => void) => (onReset = cb),
    },
    registrar: { listServers: async () => opts.servers ?? [] },
    checkLogin: async () => ({ installed: true, connected: true, detail: 'Logged in' }),
    spawn: spawn as never,
    workDir: '/tmp/reelcraft-assistant-test',
    idleMs: 60_000,
    interruptGraceMs: 30,
    ...opts.deps,
  });
  return { agent, fakes, spawn, reset: () => onReset() };
}

function fakeWithThread(extra: Record<string, Responder> = {}): FakeCodex {
  return new FakeCodex({
    'thread/start': () => ({ thread: { id: THREAD } }),
    'thread/resume': () => ({ thread: { id: THREAD } }),
    'turn/start': () => ({ turn: { id: 'turn-1', status: 'inProgress' } }),
    ...extra,
  });
}

const tool = { name: 'get_blueprint', description: 'd', inputSchema: { type: 'object' } };
const turnArgs = (overrides: Record<string, unknown> = {}) => ({
  sessionId: THREAD,
  text: 'hello',
  model: 'gpt-x',
  effort: 'low',
  instructions: 'be helpful',
  applyMode: 'manual' as const,
  signal: new AbortController().signal,
  handlers: { callTool: vi.fn(async () => ({ ok: true, text: '{}' })), onEvent: vi.fn() },
  ...overrides,
});

const completed = (status = 'completed', error?: { message: string }) => ({
  threadId: THREAD,
  turn: { id: 'turn-1', status, error: error ?? null },
});
const tick = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => vi.useRealTimers());

describe('CodexAssistantAgent.startSession', () => {
  it('starts a locked-down thread with the tools as dynamic tools', async () => {
    const { agent, fakes, spawn } = setup({
      servers: [
        { name: 'browseros-neo', transport: { type: 'streamable_http', url: 'http://x/mcp' } },
      ],
    });
    const id = await agent.startSession({ instructions: 'be helpful', tools: [tool] });
    expect(id).toBe(THREAD);

    const args = (spawn.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args).toEqual(
      expect.arrayContaining(['app-server', '--stdio', '--disable', 'shell_tool']),
    );
    expect(args).toContain('mcp_servers.browseros-neo={ url = "http://x/mcp", enabled = false }');

    const [start] = fakes[0]!.requests('thread/start');
    expect(start!.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      environments: [],
      ephemeral: false,
      developerInstructions: 'be helpful',
      dynamicTools: [
        {
          type: 'function',
          name: 'get_blueprint',
          description: 'd',
          inputSchema: { type: 'object' },
        },
      ],
    });
    const initialize = fakes[0]!.requests('initialize')[0]!;
    expect(initialize.params).toMatchObject({ capabilities: { experimentalApi: true } });
  });

  it('refuses to run when an MCP server still exposes tools', async () => {
    const fake = fakeWithThread();
    fake.mcpStatus = { data: [{ name: 'browseros-neo', tools: { click: {} }, resources: [] }] };
    const { agent } = setup({ fakes: [fake] });
    await expect(agent.startSession({ instructions: 'i', tools: [tool] })).rejects.toThrow(
      /MCP servers enabled \(browseros-neo\)/,
    );
    expect(fake.proc.kill).toHaveBeenCalled();
    expect(await agent.unavailableReason()).toMatch(/refuses to run/);
  });

  it("won't start when a configured MCP server can't be switched off", async () => {
    const { agent, spawn } = setup({ servers: [{ name: 'odd', transport: null }] });
    await expect(agent.startSession({ instructions: 'i', tools: [tool] })).rejects.toThrow(
      /can't disable/,
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('CodexAssistantAgent.runTurn', () => {
  async function started() {
    const ctx = setup();
    await ctx.agent.startSession({ instructions: 'i', tools: [tool] });
    return ctx;
  }

  it('maps messages and usage, answers tool calls, and resolves on turn/completed', async () => {
    const { agent, fakes } = await started();
    const fake = fakes[0]!;
    const events: AgentEvent[] = [];
    const callTool = vi.fn(async () => ({ ok: true, text: '{"name":"Probe"}' }));
    const args = turnArgs({ handlers: { callTool, onEvent: (e: AgentEvent) => events.push(e) } });

    const done = agent.runTurn(args as never);
    await tick();
    const [turnStart] = fake.requests('turn/start');
    expect(turnStart!.params).toMatchObject({
      threadId: THREAD,
      environments: [],
      model: 'gpt-x',
      effort: 'low',
      input: [{ type: 'text', text: 'hello' }],
    });

    fake.notify('item/agentMessage/delta', {
      threadId: THREAD,
      turnId: 'turn-1',
      itemId: 'msg-1',
      delta: 'Hel',
    });
    fake.notify('item/agentMessage/delta', {
      threadId: THREAD,
      turnId: 'turn-1',
      itemId: 'msg-1',
      delta: 'lo',
    });
    const reply = await fake.serverRequest('item/tool/call', {
      threadId: THREAD,
      turnId: 'turn-1',
      callId: 'c1',
      namespace: null,
      tool: 'get_blueprint',
      arguments: { a: 1 },
    });
    expect(callTool).toHaveBeenCalledWith('get_blueprint', { a: 1 });
    expect(reply.result).toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: '{"name":"Probe"}' }],
    });
    fake.notify('item/completed', {
      threadId: THREAD,
      turnId: 'turn-1',
      item: { type: 'agentMessage', id: 'msg-1', text: 'Hello' },
    });
    for (const [input, output] of [
      [100, 10],
      [50, 5],
    ] as const) {
      fake.notify('thread/tokenUsage/updated', {
        threadId: THREAD,
        turnId: 'turn-1',
        tokenUsage: { total: {}, last: { inputTokens: input, outputTokens: output } },
      });
    }
    fake.notify('turn/completed', completed());
    await done;

    expect(events).toEqual([
      { type: 'message.delta', itemKey: 'msg-1', text: 'Hel' },
      { type: 'message.delta', itemKey: 'msg-1', text: 'lo' },
      { type: 'message', itemKey: 'msg-1', text: 'Hello' },
      { type: 'usage', inputTokens: 100, outputTokens: 10 },
      { type: 'usage', inputTokens: 150, outputTokens: 15 },
    ]);
  });

  it('reports a tool that failed to Codex as unsuccessful', async () => {
    const { agent, fakes } = await started();
    const fake = fakes[0]!;
    const callTool = vi.fn(async () => ({ ok: false, text: '{"error":"bad"}' }));
    const done = agent.runTurn(turnArgs({ handlers: { callTool, onEvent: vi.fn() } }) as never);
    await tick();
    const reply = await fake.serverRequest('item/tool/call', {
      threadId: THREAD,
      turnId: 'turn-1',
      callId: 'c',
      namespace: null,
      tool: 'propose_draft',
      arguments: {},
    });
    expect(reply.result).toMatchObject({ success: false });
    fake.notify('turn/completed', completed());
    await done;
  });

  it('denies tools from other threads, namespaced tools and every other request', async () => {
    const { agent, fakes } = await started();
    const fake = fakes[0]!;
    const callTool = vi.fn(async () => ({ ok: true, text: '{}' }));
    const done = agent.runTurn(turnArgs({ handlers: { callTool, onEvent: vi.fn() } }) as never);
    await tick();

    const other = await fake.serverRequest('item/tool/call', {
      threadId: 'sub-agent-thread',
      turnId: 't',
      callId: 'c',
      namespace: null,
      tool: 'get_blueprint',
      arguments: {},
    });
    const namespaced = await fake.serverRequest('item/tool/call', {
      threadId: THREAD,
      turnId: 'turn-1',
      callId: 'c',
      namespace: 'shell',
      tool: 'exec',
      arguments: {},
    });
    const approvals = await Promise.all(
      [
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
        'item/permissions/requestApproval',
        'mcpServer/elicitation/request',
        'item/tool/requestUserInput',
      ].map((method) => fake.serverRequest(method, { threadId: THREAD })),
    );
    for (const reply of [other, namespaced, ...approvals]) {
      expect(reply.error).toMatchObject({ code: -32601, message: 'Denied by Reelcraft' });
    }
    expect(callTool).not.toHaveBeenCalled();
    fake.notify('turn/completed', completed());
    await done;
  });

  it('ignores events of other threads and of other turns', async () => {
    const { agent, fakes } = await started();
    const fake = fakes[0]!;
    const onEvent = vi.fn();
    const done = agent.runTurn(turnArgs({ handlers: { callTool: vi.fn(), onEvent } }) as never);
    await tick();
    fake.notify('item/agentMessage/delta', {
      threadId: 'other',
      turnId: 'x',
      itemId: 'm',
      delta: 'no',
    });
    fake.notify('turn/completed', {
      threadId: THREAD,
      turn: { id: 'older-turn', status: 'completed' },
    });
    await tick();
    fake.notify('turn/completed', completed());
    await done;
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('rejects with the turn error when Codex reports a failure', async () => {
    const { agent, fakes } = await started();
    const done = agent.runTurn(turnArgs() as never);
    await tick();
    fakes[0]!.notify('turn/completed', completed('failed', { message: 'usage limit reached' }));
    await expect(done).rejects.toMatchObject({ kind: 'failed', message: 'usage limit reached' });
  });

  it("shows a readable message for Codex's raw API errors", async () => {
    const { agent, fakes } = await started();
    const done = agent.runTurn(turnArgs() as never);
    await tick();
    fakes[0]!.notify(
      'turn/completed',
      completed('failed', {
        message:
          '{"type":"error","error":{"message":"model \'x\' is not enabled","type":"invalid_request_error"},"status":400}',
      }),
    );
    await expect(done).rejects.toMatchObject({ message: "model 'x' is not enabled" });
  });

  it('interrupts the turn when the signal aborts', async () => {
    const { agent, fakes } = await started();
    const fake = fakes[0]!;
    fake.responders['turn/interrupt'] = () => ({});
    const controller = new AbortController();
    const done = agent.runTurn(turnArgs({ signal: controller.signal }) as never);
    await tick();
    controller.abort();
    await tick();
    expect(fake.requests('turn/interrupt')[0]!.params).toEqual({
      threadId: THREAD,
      turnId: 'turn-1',
    });
    fake.notify('turn/completed', completed('interrupted'));
    await expect(done).rejects.toMatchObject({ kind: 'interrupted' });
  });

  it('gives up on a turn Codex never confirms as interrupted', async () => {
    const { agent, fakes } = await started();
    fakes[0]!.responders['turn/interrupt'] = () => ({});
    const controller = new AbortController();
    const done = agent.runTurn(turnArgs({ signal: controller.signal }) as never);
    await tick();
    controller.abort();
    await expect(done).rejects.toBeInstanceOf(AssistantTurnError);
  });

  it('fails the turn when the process dies, then restarts and resumes the thread', async () => {
    const second = fakeWithThread();
    const { agent, fakes, spawn } = setup({ fakes: [fakeWithThread(), second] });
    await agent.startSession({ instructions: 'i', tools: [tool] });
    const done = agent.runTurn(turnArgs() as never);
    await tick();
    fakes[0]!.crash();
    await expect(done).rejects.toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('stopped unexpectedly'),
    });

    const next = agent.runTurn(turnArgs({ instructions: 'fresh instructions' }) as never);
    await tick();
    await tick();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(second.requests('thread/resume')[0]!.params).toMatchObject({
      threadId: THREAD,
      excludeTurns: true,
      sandbox: 'read-only',
      developerInstructions: 'fresh instructions',
    });
    expect(second.requests('turn/start')[0]!.params).toMatchObject({ environments: [] });
    second.notify('turn/completed', completed());
    await next;
  });

  it('allows one turn per chat', async () => {
    const { agent, fakes } = await started();
    const first = agent.runTurn(turnArgs() as never);
    await tick();
    await expect(agent.runTurn(turnArgs() as never)).rejects.toThrow(/already running/);
    fakes[0]!.notify('turn/completed', completed());
    await first;
  });

  it('stops reporting itself available after repeated crashes', async () => {
    const fakes = [fakeWithThread(), fakeWithThread(), fakeWithThread()];
    const { agent } = setup({ fakes });
    for (const fake of fakes) {
      await agent.startSession({ instructions: 'i', tools: [tool] });
      fake.crash();
      await tick();
    }
    expect(await agent.unavailableReason()).toMatch(/keeps stopping/);
    await expect(agent.startSession({ instructions: 'i', tools: [tool] })).rejects.toThrow(
      /keeps stopping/,
    );
  });
});

describe('CodexAssistantAgent lifecycle', () => {
  it('stops Codex when the login changes and resumes on the next turn', async () => {
    const { agent, fakes, reset, spawn } = setup({ fakes: [fakeWithThread(), fakeWithThread()] });
    await agent.startSession({ instructions: 'i', tools: [tool] });
    reset();
    await tick();
    expect(fakes[0]!.proc.kill).toHaveBeenCalled();
    const done = agent.runTurn(turnArgs() as never);
    await tick();
    await tick();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(fakes[1]!.requests('thread/resume')).toHaveLength(1);
    fakes[1]!.notify('turn/completed', completed());
    await done;
  });

  it('stops an idle Codex process', async () => {
    const { agent, fakes } = setup({ deps: { idleMs: 10 } });
    await agent.startSession({ instructions: 'i', tools: [tool] });
    const done = agent.runTurn(turnArgs() as never);
    await tick();
    fakes[0]!.notify('turn/completed', completed());
    await done;
    await new Promise((r) => setTimeout(r, 40));
    expect(fakes[0]!.proc.kill).toHaveBeenCalled();
  });

  it('deletes a thread only if Codex is already running', async () => {
    const { agent, fakes, spawn } = setup();
    await agent.deleteSession('x');
    expect(spawn).not.toHaveBeenCalled();
    fakes[0]!.responders['thread/delete'] = () => ({});
    await agent.startSession({ instructions: 'i', tools: [tool] });
    await agent.deleteSession(THREAD);
    expect(fakes[0]!.requests('thread/delete')[0]!.params).toEqual({ threadId: THREAD });
  });

  it('reports why Codex is unavailable, and lists models', async () => {
    const noCli = setup({
      deps: { checkLogin: async () => ({ installed: false, connected: false, detail: null }) },
    });
    expect(await noCli.agent.unavailableReason()).toMatch(/not installed/);
    const signedOut = setup({
      deps: {
        checkLogin: async () => ({ installed: true, connected: false, detail: 'Not logged in' }),
      },
    });
    expect(await signedOut.agent.unavailableReason()).toMatch(/Not logged in.*Settings → Codex/);
    const ok = setup();
    expect(await ok.agent.unavailableReason()).toBeNull();
    expect(await ok.agent.listModels()).toEqual([
      {
        modelId: 'gpt-x',
        label: 'GPT X',
        supportedReasoningEfforts: ['low'],
        defaultReasoningEffort: 'low',
        isDefault: true,
      },
    ]);
  });
});
