import { spawn as nodeSpawn } from 'node:child_process';
import { Logger } from '@nestjs/common';
import { CodexRpcConnection, initializeCodexRpc, type SpawnCodex } from './codex-rpc';

export interface CodexModel {
  modelId: string;
  label: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
}

export class CodexAppServerClient {
  private readonly logger = new Logger(CodexAppServerClient.name);
  private cached?: { expiresAt: number; models: CodexModel[] } | undefined;

  constructor(
    private readonly spawnCodex: SpawnCodex = nodeSpawn as SpawnCodex,
    private readonly timeoutMs = 10_000,
    private readonly cacheTtlMs = 30_000,
  ) {}

  private readonly resetListeners: Array<() => void> = [];

  /** Forgets the cached model list, after Codex's login changed. */
  reset(): void {
    this.cached = undefined;
    for (const listener of this.resetListeners) listener();
  }

  /** Called whenever the login changed, so long-lived Codex processes can restart. */
  onReset(listener: () => void): void {
    this.resetListeners.push(listener);
  }

  async listModels(): Promise<CodexModel[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.models;
    const models = await this.queryModels();
    this.cached = { expiresAt: Date.now() + this.cacheTtlMs, models };
    return models;
  }

  private async queryModels(): Promise<CodexModel[]> {
    const startedAt = Date.now();
    const connection = CodexRpcConnection.open(this.spawnCodex, ['app-server', '--stdio'], {
      logger: this.logger,
      defaultTimeoutMs: this.timeoutMs,
    });
    try {
      await initializeCodexRpc(connection);
      const models: CodexModel[] = [];
      let cursor: string | null | undefined;
      do {
        const result = await connection.request<{
          data?: Array<Record<string, unknown>>;
          nextCursor?: string | null;
        }>('model/list', {
          ...(cursor ? { cursor } : {}),
          includeHidden: false,
        });
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
      this.logger.debug(
        { modelCount: models.length, durationMs: Date.now() - startedAt },
        'codex models listed',
      );
      return models;
    } catch (error) {
      this.logger.warn(
        { durationMs: Date.now() - startedAt, err: error },
        'codex model query failed',
      );
      throw new Error(`Unable to query Codex models: ${(error as Error).message}`);
    } finally {
      connection.close();
    }
  }
}
