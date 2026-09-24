import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface CodexModel {
  modelId: string;
  label: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
}

type SpawnCodex = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;
type RpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

export class CodexAppServerClient {
  private cached?: { expiresAt: number; models: CodexModel[] };

  constructor(
    private readonly spawnCodex: SpawnCodex = nodeSpawn as SpawnCodex,
    private readonly timeoutMs = 10_000,
    private readonly cacheTtlMs = 30_000,
  ) {}

  async listModels(): Promise<CodexModel[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.models;
    const models = await this.queryModels();
    this.cached = { expiresAt: Date.now() + this.cacheTtlMs, models };
    return models;
  }

  private async queryModels(): Promise<CodexModel[]> {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = this.spawnCodex('codex', ['app-server', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`Codex CLI is unavailable: ${String(error)}`);
    }
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    let nextId = 1;
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_384);
    });
    const lines = createInterface({ input: proc.stdout });
    lines.on('line', (line) => {
      let message: RpcResponse;
      try {
        message = JSON.parse(line) as RpcResponse;
      } catch {
        return;
      }
      if (message.id === undefined) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error)
        waiter.reject(new Error(message.error.message ?? 'Codex app-server error'));
      else waiter.resolve(message.result);
    });
    const rejectPending = (reason: string) => {
      for (const waiter of pending.values()) waiter.reject(new Error(reason));
      pending.clear();
    };
    proc.on('error', (error) => rejectPending(`Codex CLI is unavailable: ${error.message}`));
    proc.on('exit', (code) =>
      rejectPending(
        `Codex app-server exited (${code ?? 'signal'}): ${stderr || 'check Codex authentication'}`,
      ),
    );
    const request = (method: string, params: Record<string, unknown>) => {
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex app-server ${method} timed out; check login and CLI health`));
        }, this.timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    };
    try {
      await request('initialize', {
        clientInfo: { name: 'reelcraft', version: '0.0.0' },
        capabilities: { experimentalApi: true },
      });
      proc.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
      const models: CodexModel[] = [];
      let cursor: string | null | undefined;
      do {
        const result = (await request('model/list', {
          ...(cursor ? { cursor } : {}),
          includeHidden: false,
        })) as {
          data?: Array<Record<string, unknown>>;
          nextCursor?: string | null;
        };
        for (const model of result.data ?? []) {
          if (model.hidden === true) continue;
          const modelId = String(model.model ?? model.id ?? '');
          const efforts = Array.isArray(model.supportedReasoningEfforts)
            ? model.supportedReasoningEfforts.map((entry) =>
                String((entry as { reasoningEffort?: unknown }).reasoningEffort ?? entry),
              )
            : [];
          if (modelId)
            models.push({
              modelId,
              label: String(model.displayName ?? modelId),
              supportedReasoningEfforts: efforts,
              defaultReasoningEffort: String(
                model.defaultReasoningEffort ?? efforts[0] ?? 'medium',
              ),
            });
        }
        cursor = result.nextCursor;
      } while (cursor);
      return models;
    } catch (error) {
      throw new Error(`Unable to query Codex models: ${(error as Error).message}`);
    } finally {
      lines.close();
      proc.kill();
    }
  }
}
