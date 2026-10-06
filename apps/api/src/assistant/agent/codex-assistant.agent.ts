import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import {
  CodexRpcConnection,
  initializeCodexRpc,
  type SpawnCodex,
} from '../../provider/codex/codex-rpc';
import type { CodexAppServerClient } from '../../provider/codex/codex-app-server.client';
import type { CodexNeoRegistrar } from '../../provider/codex/codex-neo-registrar';
import {
  AssistantTurnError,
  type AssistantAgent,
  type AssistantModel,
  type AssistantToolDef,
  type AssistantTurnHandlers,
} from './assistant-agent.interface';
import { buildAssistantAppServerArgs } from './codex-app-server-args';

const execFileAsync = promisify(execFile);

/** Idle for this long and the shared `codex app-server` is stopped (it restarts on demand). */
export const CODEX_IDLE_MS = 10 * 60 * 1000;
/** After this many crashes within a minute the assistant reports itself unavailable for a minute. */
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60_000;
/** How long to wait for Codex to confirm an interrupt before giving up on the turn. */
const INTERRUPT_GRACE_MS = 5_000;

export interface CodexLoginCheck {
  installed: boolean;
  connected: boolean;
  detail: string | null;
}

export interface CodexAssistantAgentDeps {
  models: Pick<CodexAppServerClient, 'listModels' | 'onReset'>;
  registrar: Pick<CodexNeoRegistrar, 'listServers'>;
  /** Cheap check that Codex is installed and signed in (`codex login status`). */
  checkLogin?: () => Promise<CodexLoginCheck>;
  spawn?: SpawnCodex;
  /** Empty working directory for Codex (it has no file access anyway). */
  workDir?: string;
  idleMs?: number;
  interruptGraceMs?: number;
}

interface ActiveTurn {
  turnId: string | undefined;
  handlers: AssistantTurnHandlers;
  usage: { inputTokens: number; outputTokens: number };
  abortRequested: boolean;
  settle: (outcome: { ok: true } | { ok: false; error: AssistantTurnError }) => void;
}

type TurnCompleted = {
  threadId: string;
  turn: { id: string; status: string; error?: { message?: string } | null };
};

/** Codex reports some failures as the raw API body (`{"type":"error","error":{"message":…}}`). */
export function readableCodexError(message: string): string {
  try {
    const parsed = JSON.parse(message) as { error?: { message?: unknown }; detail?: unknown };
    const inner = parsed.error?.message ?? parsed.detail;
    if (typeof inner === 'string' && inner) return inner;
  } catch {
    // already plain text
  }
  return message;
}

async function defaultLoginCheck(): Promise<CodexLoginCheck> {
  try {
    const { stdout, stderr } = await execFileAsync('codex', ['login', 'status'], {
      timeout: 10_000,
    });
    return { installed: true, connected: true, detail: (stdout || stderr).trim() || null };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (err.code === 'ENOENT') return { installed: false, connected: false, detail: null };
    return {
      installed: true,
      connected: false,
      detail: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || null,
    };
  }
}

/**
 * The blueprint assistant on Codex: Reelcraft's tools are registered as Codex *dynamic tools*, so
 * when the model calls one, `codex app-server` sends us an `item/tool/call` request and we answer
 * it from the API process. One long-lived `codex app-server` serves every chat (threads resume by
 * id, in a new process too). It is locked down: built-in features off, every configured MCP server
 * off, read-only sandbox, no environment, and any request we don't expect is denied.
 */
export class CodexAssistantAgent implements AssistantAgent {
  readonly providerId = 'codex';
  private readonly logger = new Logger(CodexAssistantAgent.name);
  private readonly spawnCodex: SpawnCodex;
  private readonly checkLogin: () => Promise<CodexLoginCheck>;
  private readonly workDir: string;
  private readonly idleMs: number;
  private readonly interruptGraceMs: number;

  private connection: CodexRpcConnection | undefined;
  private starting: Promise<CodexRpcConnection> | undefined;
  private readonly loaded = new Set<string>();
  private readonly active = new Map<string, ActiveTurn>();
  private crashes: number[] = [];
  private unavailableUntil = 0;
  private unavailableText: string | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: CodexAssistantAgentDeps) {
    this.spawnCodex = deps.spawn ?? (nodeSpawn as SpawnCodex);
    this.checkLogin = deps.checkLogin ?? defaultLoginCheck;
    this.workDir = deps.workDir ?? join(tmpdir(), 'reelcraft-assistant');
    this.idleMs = deps.idleMs ?? CODEX_IDLE_MS;
    this.interruptGraceMs = deps.interruptGraceMs ?? INTERRUPT_GRACE_MS;
    // a sign-in or sign-out changes what the running process is logged in as
    deps.models.onReset(() => this.shutdown());
  }

  // ---- AssistantAgent --------------------------------------------------------------------

  async unavailableReason(): Promise<string | null> {
    if (this.unavailableText && Date.now() < this.unavailableUntil) return this.unavailableText;
    const login = await this.checkLogin();
    if (!login.installed) return 'The Codex CLI is not installed.';
    if (!login.connected) {
      return login.detail
        ? `Codex is not signed in (${login.detail}). Connect it in Settings → Codex.`
        : 'Codex is not signed in. Connect it in Settings → Codex.';
    }
    return null;
  }

  async listModels(): Promise<AssistantModel[]> {
    return this.deps.models.listModels();
  }

  async startSession(options: {
    instructions: string;
    tools: AssistantToolDef[];
  }): Promise<string> {
    const connection = await this.ensureConnection();
    const started = await connection.request<{ thread: { id: string } }>(
      'thread/start',
      {
        approvalPolicy: 'never',
        sandbox: 'read-only',
        environments: [],
        ephemeral: false,
        cwd: this.workDir,
        developerInstructions: options.instructions,
        dynamicTools: options.tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
      30_000,
    );
    this.loaded.add(started.thread.id);
    return started.thread.id;
  }

  async runTurn(options: Parameters<AssistantAgent['runTurn']>[0]): Promise<void> {
    const threadId = options.sessionId;
    if (this.active.has(threadId)) {
      throw new AssistantTurnError('failed', 'A turn is already running in this chat.');
    }
    const connection = await this.ensureConnection();
    this.clearIdle();
    if (!this.loaded.has(threadId)) {
      await connection.request(
        'thread/resume',
        {
          threadId,
          excludeTurns: true,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          cwd: this.workDir,
          developerInstructions: options.instructions,
        },
        30_000,
      );
      this.loaded.add(threadId);
    }

    let settle!: ActiveTurn['settle'];
    const finished = new Promise<{ ok: true } | { ok: false; error: AssistantTurnError }>(
      (resolve) => (settle = resolve),
    );
    const turn: ActiveTurn = {
      turnId: undefined,
      handlers: options.handlers,
      usage: { inputTokens: 0, outputTokens: 0 },
      abortRequested: false,
      settle,
    };
    this.active.set(threadId, turn);

    const onAbort = () => {
      turn.abortRequested = true;
      if (turn.turnId) void this.interrupt(connection, threadId, turn);
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (options.signal.aborted) throw new AssistantTurnError('interrupted', 'Stopped');
      const started = await connection.request<{ turn: { id: string } }>(
        'turn/start',
        {
          threadId,
          // `environments` isn't kept across a resume: send it on every turn
          environments: [],
          model: options.model,
          ...(options.effort && { effort: options.effort }),
          input: [{ type: 'text', text: options.text }],
        },
        30_000,
      );
      turn.turnId = started.turn.id;
      if (turn.abortRequested) void this.interrupt(connection, threadId, turn);
      const outcome = await finished;
      if (!outcome.ok) throw outcome.error;
    } catch (error) {
      if (error instanceof AssistantTurnError) throw error;
      if (options.signal.aborted) throw new AssistantTurnError('interrupted', 'Stopped');
      throw new AssistantTurnError(
        'failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      options.signal.removeEventListener('abort', onAbort);
      this.active.delete(threadId);
      this.scheduleIdle();
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.loaded.delete(sessionId);
    // don't start Codex just to forget a thread
    if (!this.connection) return;
    await this.connection.request('thread/delete', { threadId: sessionId }, 15_000);
  }

  // ---- the shared process ----------------------------------------------------------------

  private ensureConnection(): Promise<CodexRpcConnection> {
    if (Date.now() < this.unavailableUntil && this.unavailableText) {
      return Promise.reject(new AssistantTurnError('failed', this.unavailableText));
    }
    if (this.connection) return Promise.resolve(this.connection);
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(): Promise<CodexRpcConnection> {
    mkdirSync(this.workDir, { recursive: true, mode: 0o700 });
    let args: string[];
    try {
      args = buildAssistantAppServerArgs(await this.deps.registrar.listServers());
    } catch (error) {
      throw this.markUnavailable(
        `The assistant can't start Codex safely: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const connection = CodexRpcConnection.open(this.spawnCodex, args, {
      logger: this.logger,
      defaultTimeoutMs: 15_000,
      cwd: this.workDir,
    });
    connection.onNotification((method, params) => this.onNotification(method, params));
    connection.onServerRequest((method, params) => this.onServerRequest(method, params));
    void connection.exited.then((exit) => this.onExit(connection, exit.code));
    try {
      await initializeCodexRpc(connection);
      await this.selfCheck(connection);
    } catch (error) {
      connection.close();
      if (error instanceof AssistantTurnError) throw error;
      throw new AssistantTurnError(
        'failed',
        `Codex could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.connection = connection;
    return connection;
  }

  /** Refuse to run if any MCP server still offers tools or resources: that would mean the model
   * could reach BrowserOS Neo (signed-in accounts) or another server the user configured. */
  private async selfCheck(connection: CodexRpcConnection): Promise<void> {
    const status = await connection.request<{
      data?: Array<{ name: string; tools?: object; resources?: unknown[] }>;
    }>('mcpServerStatus/list', {});
    const exposed = (status.data ?? []).filter(
      (server) => Object.keys(server.tools ?? {}).length > 0 || (server.resources ?? []).length > 0,
    );
    if (exposed.length > 0) {
      throw this.markUnavailable(
        `Codex still has MCP servers enabled (${exposed.map((s) => s.name).join(', ')}), so the assistant refuses to run.`,
      );
    }
  }

  private markUnavailable(reason: string): AssistantTurnError {
    this.logger.error({ reason }, 'codex assistant unavailable');
    this.unavailableText = reason;
    this.unavailableUntil = Date.now() + CRASH_WINDOW_MS;
    return new AssistantTurnError('failed', reason);
  }

  private onExit(connection: CodexRpcConnection, code: number | null): void {
    if (this.connection !== connection) return;
    this.connection = undefined;
    this.loaded.clear();
    if (connection.isClosing) return;
    this.logger.warn(
      { code, stderr: connection.stderrTail.slice(-400) },
      'codex app-server exited',
    );
    for (const turn of this.active.values()) {
      turn.settle({
        ok: false,
        error: new AssistantTurnError(
          'failed',
          'Codex stopped unexpectedly. Send your message again.',
        ),
      });
    }
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (this.crashes.length >= MAX_CRASHES) {
      this.markUnavailable(
        'Codex keeps stopping. Check Settings → Codex, then try again in a minute.',
      );
    }
  }

  /** Stops the shared `codex app-server` (it restarts on demand). */
  close(): void {
    this.shutdown();
  }

  private shutdown(): void {
    this.clearIdle();
    const connection = this.connection;
    if (!connection) return;
    this.connection = undefined;
    this.loaded.clear();
    connection.close();
    for (const turn of this.active.values()) {
      turn.settle({
        ok: false,
        error: new AssistantTurnError('failed', 'Codex was reconnected. Send your message again.'),
      });
    }
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (!this.connection || this.active.size > 0) return;
    this.idleTimer = setTimeout(() => this.shutdown(), this.idleMs);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  // ---- protocol --------------------------------------------------------------------------

  private async interrupt(
    connection: CodexRpcConnection,
    threadId: string,
    turn: ActiveTurn,
  ): Promise<void> {
    try {
      await connection.request('turn/interrupt', { threadId, turnId: turn.turnId }, 10_000);
    } catch (error) {
      this.logger.warn({ err: error, threadId }, 'turn/interrupt failed');
    }
    // if Codex never confirms, don't leave the chat stuck
    setTimeout(() => {
      if (this.active.get(threadId) === turn) {
        turn.settle({ ok: false, error: new AssistantTurnError('interrupted', 'Stopped') });
      }
    }, this.interruptGraceMs).unref?.();
  }

  private onNotification(method: string, raw: unknown): void {
    const params = raw as { threadId?: string } & Record<string, unknown>;
    const turn = params.threadId ? this.active.get(params.threadId) : undefined;
    if (!turn) return; // other threads (sub-agents) and unrelated events
    switch (method) {
      case 'item/agentMessage/delta': {
        const { itemId, delta } = params as unknown as { itemId: string; delta: string };
        turn.handlers.onEvent({ type: 'message.delta', itemKey: itemId, text: delta });
        return;
      }
      case 'item/completed': {
        const item = (params as { item?: { type?: string; id?: string; text?: string } }).item;
        if (item?.type === 'agentMessage' && item.id && typeof item.text === 'string') {
          turn.handlers.onEvent({ type: 'message', itemKey: item.id, text: item.text });
        }
        return;
      }
      case 'thread/tokenUsage/updated': {
        const last = (
          params as { tokenUsage?: { last?: { inputTokens?: number; outputTokens?: number } } }
        ).tokenUsage?.last;
        if (last) {
          turn.usage.inputTokens += last.inputTokens ?? 0;
          turn.usage.outputTokens += last.outputTokens ?? 0;
          turn.handlers.onEvent({ type: 'usage', ...turn.usage });
        }
        return;
      }
      case 'turn/completed': {
        const { turn: done } = params as unknown as TurnCompleted;
        if (turn.turnId && done.id !== turn.turnId) return;
        if (done.status === 'completed') turn.settle({ ok: true });
        else if (done.status === 'interrupted') {
          turn.settle({ ok: false, error: new AssistantTurnError('interrupted', 'Stopped') });
        } else {
          turn.settle({
            ok: false,
            error: new AssistantTurnError(
              'failed',
              readableCodexError(done.error?.message ?? 'The turn failed.'),
            ),
          });
        }
        return;
      }
      default:
        return;
    }
  }

  /** The only request we answer is our own tools' `item/tool/call`, and only for a turn we are
   * running. Approvals, user-input prompts and everything else are denied. */
  private async onServerRequest(method: string, raw: unknown): Promise<unknown> {
    const params = raw as {
      threadId?: string;
      tool?: string;
      namespace?: string | null;
      arguments?: unknown;
    };
    const turn = params.threadId ? this.active.get(params.threadId) : undefined;
    if (method !== 'item/tool/call' || !turn || params.namespace || !params.tool) {
      this.logger.warn({ method, threadId: params.threadId }, 'denied a request from codex');
      throw new Error('Denied by Reelcraft');
    }
    let result: { ok: boolean; text: string };
    try {
      result = await turn.handlers.callTool(params.tool, params.arguments);
    } catch (error) {
      result = { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
    return { success: result.ok, contentItems: [{ type: 'inputText', text: result.text }] };
  }
}
