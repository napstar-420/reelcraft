import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { CLAUDE_MODELS } from '../../provider/claude/claude-command';
import { readClaudeAuth, type ClaudeAuth } from '../../provider/claude/claude-runtime-readiness';
import {
  AssistantTurnError,
  type AssistantAgent,
  type AssistantModel,
  type AssistantToolDef,
  type AssistantTurnHandlers,
} from './assistant-agent.interface';
import { AssistantToolServer, type ToolEndpoint } from './assistant-tool-server';

/** Claude knows Reelcraft's MCP server by this name; its tools are `mcp__reelcraft__<tool>`. */
const SERVER = 'reelcraft';
const TOOL_PREFIX = `mcp__${SERVER}__`;

export type SpawnClaude = (
  args: string[],
  options: { cwd: string },
) => ChildProcessWithoutNullStreams;

export interface ClaudeAssistantAgentDeps {
  /** Chats' tool lists live under `<workspaceRoot>/claude-assistant`, so they outlive restarts. */
  workspaceRoot: string;
  checkLogin?: () => Promise<ClaudeAuth>;
  spawn?: SpawnClaude;
  tools?: AssistantToolServer;
}

/** What a chat needs between turns: Claude keeps the conversation, Reelcraft keeps the tools. */
interface SessionState {
  tools: AssistantToolDef[];
  /** Claude has the conversation (its first turn got as far as starting). */
  started: boolean;
  /** Claude's own id for the conversation, once the original one was abandoned (see `isBrokenHistory`). */
  claudeId?: string;
}

/** Claude Code stores a chat as a transcript it replays on `--resume`. If that history is
 * ever rejected by the API (an unpaired tool call), every later turn of the chat fails the
 * same way, so the agent starts a fresh Claude conversation instead of leaving it stuck. */
function isBrokenHistory(error: unknown): boolean {
  return (
    error instanceof AssistantTurnError &&
    /tool use concurrency|tool_history_mismatch/i.test(error.message)
  );
}

const RESTART_NOTE =
  "<reelcraft_context>This chat's earlier messages could not be loaded, so you start without them. The blueprint on the canvas is the source of truth: call get_blueprint first. If the request depends on something said earlier, say so and ask the user briefly.</reelcraft_context>";

/** The arguments for one assistant turn. Claude gets no built-in tools, no
 * settings, hooks, plugins, skills or CLAUDE.md, and no MCP server except
 * Reelcraft's; anything else it asks to use is denied without a prompt. */
export function buildAssistantClaudeArgs(input: {
  sessionId: string;
  resume: boolean;
  model: string;
  effort?: string | undefined;
  instructions: string;
  endpoint: Pick<ToolEndpoint, 'url' | 'token'>;
}): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model',
    input.model,
    ...(input.effort ? ['--effort', input.effort] : []),
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({
      mcpServers: {
        [SERVER]: {
          type: 'http',
          url: input.endpoint.url,
          headers: { Authorization: `Bearer ${input.endpoint.token}` },
        },
      },
    }),
    '--disable-slash-commands',
    '--tools',
    '',
    '--allowedTools',
    `mcp__${SERVER}`,
    '--permission-mode',
    'dontAsk',
    '--system-prompt',
    `${input.instructions}\n\nReelcraft's tools are named ${TOOL_PREFIX}<tool>: ${TOOL_PREFIX}ask_user is the ask_user tool, and so on.`,
    // the instructions change every turn (date, app version, blueprint name)
    '--system-prompt-snapshot',
    'off',
    ...(input.resume ? ['--resume', input.sessionId] : ['--session-id', input.sessionId]),
  ];
}

type StreamEvent = {
  type?: string;
  index?: number;
  message?: { id?: string };
  content_block?: { type?: string };
  delta?: { type?: string; text?: string };
};

type ResultEvent = {
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  errors?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

/**
 * The blueprint assistant on Claude Code. Each turn is one `claude -p`
 * process that resumes the chat's conversation by id; Reelcraft's tools are
 * served to it over a loopback MCP endpoint that only answers that turn.
 * There is no long-lived process: stopping a turn stops its process.
 */
export class ClaudeAssistantAgent implements AssistantAgent {
  readonly providerId = 'claude';
  private readonly logger = new Logger(ClaudeAssistantAgent.name);
  private readonly stateDir: string;
  private readonly workDir: string;
  private readonly checkLogin: () => Promise<ClaudeAuth>;
  private readonly spawnClaude: SpawnClaude;
  private readonly tools: AssistantToolServer;
  private readonly active = new Set<string>();

  constructor(deps: ClaudeAssistantAgentDeps) {
    const root = resolve(deps.workspaceRoot, 'claude-assistant');
    this.stateDir = join(root, 'sessions');
    // Claude's working directory: empty, and it has no file tools anyway.
    this.workDir = join(root, 'work');
    this.checkLogin = deps.checkLogin ?? (() => readClaudeAuth());
    this.spawnClaude =
      deps.spawn ??
      ((args, options) =>
        nodeSpawn('claude', args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] }));
    this.tools = deps.tools ?? new AssistantToolServer();
  }

  async unavailableReason(): Promise<string | null> {
    const login = await this.checkLogin();
    if (!login.installed) return 'The Claude Code CLI is not installed.';
    if (!login.connected) return 'Claude is not signed in. Connect it in Settings → Claude.';
    return null;
  }

  async listModels(): Promise<AssistantModel[]> {
    return CLAUDE_MODELS.map(({ modelId, label, isDefault, ...efforts }) => ({
      modelId,
      label,
      isDefault,
      supportedReasoningEfforts: efforts.supportedReasoningEfforts,
      defaultReasoningEffort: efforts.defaultReasoningEffort,
    }));
  }

  async startSession(options: {
    instructions: string;
    tools: AssistantToolDef[];
  }): Promise<string> {
    const id = randomUUID();
    await this.writeState(id, { tools: options.tools, started: false });
    return id;
  }

  async runTurn(options: Parameters<AssistantAgent['runTurn']>[0]): Promise<void> {
    const sessionId = options.sessionId;
    if (this.active.has(sessionId)) {
      throw new AssistantTurnError('failed', 'A turn is already running in this chat.');
    }
    const state = await this.readState(sessionId);
    if (options.signal.aborted) throw new AssistantTurnError('interrupted', 'Stopped');
    this.active.add(sessionId);
    // output or tool calls already seen by the user: too late to start over silently
    let progressed = false;
    const { handlers } = options;
    const watched = {
      ...options,
      handlers: {
        callTool: (tool: string, args: unknown) => {
          progressed = true;
          return handlers.callTool(tool, args);
        },
        onEvent: (event: Parameters<AssistantTurnHandlers['onEvent']>[0]) => {
          if (event.type !== 'usage') progressed = true;
          handlers.onEvent(event);
        },
      },
    };
    const endpoint = await this.tools.register(state.tools, watched.handlers.callTool);
    try {
      await mkdir(this.workDir, { recursive: true, mode: 0o700 });
      try {
        await this.runProcess(sessionId, state, endpoint, watched, options.text);
      } catch (error) {
        if (!state.started || progressed || !isBrokenHistory(error)) throw error;
        this.logger.warn({ err: error }, 'claude chat history was rejected: starting a new one');
        const fresh: SessionState = { tools: state.tools, started: false, claudeId: randomUUID() };
        await this.writeState(sessionId, fresh);
        await this.runProcess(
          sessionId,
          fresh,
          endpoint,
          watched,
          `${RESTART_NOTE}\n\n${options.text}`,
        );
      }
    } finally {
      endpoint.release();
      this.active.delete(sessionId);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return;
    await rm(this.statePath(sessionId), { force: true });
  }

  close(): void {
    this.tools.close();
  }

  private runProcess(
    sessionId: string,
    state: SessionState,
    endpoint: ToolEndpoint,
    options: Parameters<AssistantAgent['runTurn']>[0],
    text: string,
  ): Promise<void> {
    const child = this.spawnClaude(
      buildAssistantClaudeArgs({
        sessionId: state.claudeId ?? sessionId,
        resume: state.started,
        model: options.model,
        effort: options.effort,
        instructions: options.instructions,
        endpoint,
      }),
      { cwd: this.workDir },
    );
    const handlers: AssistantTurnHandlers = options.handlers;
    return new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;
      let stderr = '';
      let buffer = '';
      let outcome: { ok: true } | { ok: false; error: AssistantTurnError } | undefined;
      // the next turn must see that the conversation exists: finish saving before settling
      let saving: Promise<void> = Promise.resolve();
      // Claude streams text per content block; number the text blocks of each message so the
      // streamed deltas and the finished message land on the same item.
      const streamed = new Map<string, number>();
      const finished = new Map<string, number>();
      let streamMessage = '';
      const streamKeys = new Map<number, string>();

      const settle = (result: { ok: true } | { ok: false; error: AssistantTurnError }) => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener('abort', onAbort);
        if (result.ok) resolvePromise();
        else rejectPromise(result.error);
      };
      const fail = (message: string) => {
        outcome = { ok: false, error: new AssistantTurnError('failed', message) };
        child.kill('SIGTERM');
      };
      const onAbort = () => {
        child.kill('SIGTERM');
        settle({ ok: false, error: new AssistantTurnError('interrupted', 'Stopped') });
      };
      options.signal.addEventListener('abort', onAbort, { once: true });

      const onEvent = (event: Record<string, unknown>) => {
        if (event.type === 'system' && event.subtype === 'init') {
          const problem = this.lockdownProblem(event);
          if (problem) {
            this.logger.error({ problem }, 'claude assistant refused to run');
            fail(`The assistant refused to run Claude: ${problem}`);
            return;
          }
          if (!state.started) {
            state.started = true;
            saving = this.writeState(sessionId, state).catch((error: unknown) =>
              this.logger.warn({ err: error }, 'claude chat state not saved'),
            );
          }
          return;
        }
        if (event.type === 'stream_event') {
          const stream = event.event as StreamEvent | undefined;
          if (stream?.type === 'message_start') {
            streamMessage = stream.message?.id ?? '';
            streamKeys.clear();
          } else if (
            stream?.type === 'content_block_start' &&
            stream.content_block?.type === 'text' &&
            typeof stream.index === 'number'
          ) {
            const ordinal = (streamed.get(streamMessage) ?? 0) + 1;
            streamed.set(streamMessage, ordinal);
            streamKeys.set(stream.index, `${streamMessage}:${ordinal}`);
          } else if (
            stream?.type === 'content_block_delta' &&
            stream.delta?.type === 'text_delta' &&
            typeof stream.index === 'number'
          ) {
            const itemKey = streamKeys.get(stream.index);
            if (itemKey && stream.delta.text) {
              handlers.onEvent({ type: 'message.delta', itemKey, text: stream.delta.text });
            }
          }
          return;
        }
        if (event.type === 'assistant') {
          const message = event.message as
            | { id?: string; model?: string; content?: Array<{ type?: string; text?: string }> }
            | undefined;
          // Claude Code reports an API error as a made-up assistant message ahead of the failed
          // `result`: it is the error, not something the model said.
          if (message?.model === '<synthetic>' || event.error) return;
          const id = message?.id ?? '';
          for (const block of message?.content ?? []) {
            if (block.type !== 'text' || typeof block.text !== 'string') continue;
            const ordinal = (finished.get(id) ?? 0) + 1;
            finished.set(id, ordinal);
            handlers.onEvent({ type: 'message', itemKey: `${id}:${ordinal}`, text: block.text });
          }
          return;
        }
        if (event.type === 'result') {
          const result = event as ResultEvent;
          const usage = result.usage;
          if (usage) {
            handlers.onEvent({
              type: 'usage',
              inputTokens:
                (usage.input_tokens ?? 0) +
                (usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0),
              outputTokens: usage.output_tokens ?? 0,
            });
          }
          outcome =
            result.is_error || result.subtype !== 'success'
              ? { ok: false, error: new AssistantTurnError('failed', resultError(result)) }
              : { ok: true };
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            onEvent(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // not JSON: ignore
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-4096);
      });
      child.on('error', (error) => {
        settle({
          ok: false,
          error: new AssistantTurnError('failed', `Could not start Claude: ${error.message}`),
        });
      });
      child.on('close', (code) => {
        if (buffer.trim()) {
          try {
            onEvent(JSON.parse(buffer) as Record<string, unknown>);
          } catch {
            // incomplete last line
          }
        }
        if (!outcome) {
          this.logger.warn({ code, stderr: stderr.slice(-400) }, 'claude assistant turn exited');
          outcome = {
            ok: false,
            error: new AssistantTurnError(
              'failed',
              stderr.trim().split('\n').at(-1) || `Claude stopped unexpectedly (exit ${code}).`,
            ),
          };
        }
        const final = outcome;
        void saving.then(() => settle(final));
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(text);
    });
  }

  /** Refuse to run if Claude reports any tool or MCP server other than Reelcraft's. */
  private lockdownProblem(init: Record<string, unknown>): string | null {
    const tools = Array.isArray(init.tools) ? (init.tools as unknown[]) : [];
    const foreign = tools.filter(
      (tool) => typeof tool !== 'string' || !tool.startsWith(TOOL_PREFIX),
    );
    if (foreign.length > 0) return `it offers tools besides Reelcraft's (${foreign.join(', ')})`;
    const servers = Array.isArray(init.mcp_servers) ? (init.mcp_servers as unknown[]) : [];
    const others = servers
      .map((server) => (server as { name?: unknown }).name)
      .filter((name) => name !== SERVER);
    if (others.length > 0) return `it has other MCP servers (${others.join(', ')})`;
    return null;
  }

  private statePath(sessionId: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error('Invalid Claude chat id');
    return join(this.stateDir, `${sessionId}.json`);
  }

  private async readState(sessionId: string): Promise<SessionState> {
    try {
      return JSON.parse(await readFile(this.statePath(sessionId), 'utf8')) as SessionState;
    } catch {
      throw new AssistantTurnError(
        'failed',
        'This Claude chat can no longer be continued. Start a new chat.',
      );
    }
  }

  private async writeState(sessionId: string, state: SessionState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await writeFile(this.statePath(sessionId), JSON.stringify(state), { mode: 0o600 });
  }
}

function resultError(result: ResultEvent): string {
  if (typeof result.result === 'string' && result.result.trim()) return result.result.trim();
  if (Array.isArray(result.errors)) {
    const errors = result.errors.filter((e): e is string => typeof e === 'string' && !!e.trim());
    if (errors.length > 0) return errors.join('; ');
  }
  return `Claude stopped (${result.subtype ?? 'error'}).`;
}
