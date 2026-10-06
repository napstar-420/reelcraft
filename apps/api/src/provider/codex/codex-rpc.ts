import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { Logger } from '@nestjs/common';

export type SpawnCodex = (
  command: string,
  args: string[],
  options: {
    stdio: ['pipe', 'pipe', 'pipe'];
    cwd?: string | undefined;
    env?: NodeJS.ProcessEnv | undefined;
  },
) => ChildProcessWithoutNullStreams;

type RpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

export interface RpcExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

/** Answers a request the server sends to us (`item/tool/call`, approvals…). Throw to reply with a
 * JSON-RPC error. */
export type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown>;

/**
 * One `codex app-server --stdio` child and its JSON-RPC conversation: requests with timeouts,
 * notifications, requests the server sends us, and the process ending. Shared by model listing
 * (short-lived) and the blueprint assistant (long-lived).
 */
export class CodexRpcConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly notificationHandlers: Array<(method: string, params: unknown) => void> = [];
  private serverRequestHandler: ServerRequestHandler | undefined;
  private readonly lines: Interface;
  private stderr = '';
  private closing = false;
  /** Resolves once, when the process has ended (also when it never started). */
  readonly exited: Promise<RpcExit>;

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly logger: Logger,
    private readonly defaultTimeoutMs: number,
  ) {
    proc.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_384);
    });
    this.lines = createInterface({ input: proc.stdout });
    this.lines.on('line', (line) => this.onLine(line));
    this.exited = new Promise<RpcExit>((resolve) => {
      proc.on('error', (error) => {
        this.rejectPending(`Codex CLI is unavailable: ${error.message}`);
        resolve({ code: null, signal: null, stderr: this.stderr });
      });
      proc.on('exit', (code, signal) => {
        if (this.pending.size > 0) {
          this.logger.warn(
            { exitCode: code, signal },
            'codex app-server exited with pending requests',
          );
        }
        this.rejectPending(
          `Codex app-server exited (${code ?? 'signal'}): ${this.stderr || 'check Codex authentication'}`,
        );
        resolve({ code, signal, stderr: this.stderr });
      });
    });
  }

  static open(
    spawnCodex: SpawnCodex,
    args: string[],
    options: {
      logger: Logger;
      defaultTimeoutMs: number;
      cwd?: string | undefined;
      env?: NodeJS.ProcessEnv | undefined;
    },
  ): CodexRpcConnection {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawnCodex('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(options.cwd && { cwd: options.cwd }),
        ...(options.env && { env: options.env }),
      });
    } catch (error) {
      options.logger.warn({ err: error }, 'codex app-server spawn failed');
      throw new Error(`Codex CLI is unavailable: ${String(error)}`);
    }
    return new CodexRpcConnection(proc, options.logger, options.defaultTimeoutMs);
  }

  get stderrTail(): string {
    return this.stderr;
  }

  /** True once `close()` was called: an exit after that is expected, not a crash. */
  get isClosing(): boolean {
    return this.closing;
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandlers.push(handler);
  }

  onServerRequest(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server ${method} timed out; check login and CLI health`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.write({ method, params });
  }

  close(): void {
    this.closing = true;
    this.lines.close();
    this.proc.kill();
  }

  private write(message: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rejectPending(reason: string): void {
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason));
    this.pending.clear();
  }

  private onLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.logger.debug({ lineLength: line.length }, 'codex app-server emitted non-json line');
      return;
    }
    if (message.method !== undefined) {
      if (message.id !== undefined) void this.answerServerRequest(message);
      else for (const handler of this.notificationHandlers) handler(message.method, message.params);
      return;
    }
    if (message.id === undefined) return;
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message ?? 'Codex app-server error'));
    else waiter.resolve(message.result);
  }

  private async answerServerRequest(message: RpcMessage): Promise<void> {
    const id = message.id!;
    try {
      if (!this.serverRequestHandler) throw new Error('Denied by Reelcraft');
      const result = await this.serverRequestHandler(message.method!, message.params);
      this.write({ id, result });
    } catch (error) {
      this.write({
        id,
        error: { code: -32601, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

/** `initialize` + `initialized`, opting into the experimental API (dynamic tools need it). */
export async function initializeCodexRpc(
  connection: CodexRpcConnection,
  clientName = 'reelcraft',
): Promise<void> {
  await connection.request('initialize', {
    clientInfo: { name: clientName, version: '0.0.0' },
    capabilities: { experimentalApi: true },
  });
  connection.notify('initialized', {});
}
