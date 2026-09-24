import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobHandle, JobStatus, JsonSchema } from '@reelcraft/shared';
import type {
  CancelResult,
  ModelInfo,
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
} from '../provider-adapter.interface';
import type { EngineConfig } from '../../config/engine-config';
import { buildCodexPrompt } from './codex-command';
import type { CodexAppServerClient, CodexModel } from './codex-app-server.client';
import type { CodexJobLauncher } from './codex-job-launcher';
import { timelineOutputSchema } from './codex-output-schema';

type DurableStatus = {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  pid?: number;
  exitCode?: number | null;
  reason?: string;
  createdAt?: string;
};

const RESULT_LIMIT = 4 * 1024 * 1024;

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

export class CodexProviderAdapter implements ProviderAdapter {
  readonly id = 'codex';
  readonly modalities = ['text'];
  private readonly jobsRoot: string;

  constructor(
    config: Pick<EngineConfig, 'workspaceRoot'>,
    private readonly models: CodexAppServerClient,
    private readonly launcher: CodexJobLauncher,
  ) {
    this.jobsRoot = join(config.workspaceRoot, 'codex-jobs');
  }

  async listModels(): Promise<ModelInfo[]> {
    return (await this.models.listModels()).map((model) => ({
      modelId: model.modelId,
      label: model.label,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
      capabilities: {
        supportsSeed: false,
        supportsIdempotency: true,
        supportsStructuredOutput: true,
        supportsVision: false,
      },
    }));
  }

  async estimate(_req: ProviderRequest) {
    return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' as const };
  }

  async submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle> {
    const catalog = await this.models.listModels();
    const selected = catalog.find((model) => model.modelId === req.modelId);
    if (!selected)
      throw new Error(`Codex model "${req.modelId}" is not available for the authenticated CLI`);
    const effort = req.params.reasoningEffort;
    this.assertEffort(selected, effort);

    const externalId = createHash('sha256').update(idempotencyKey).digest('hex');
    const handle: JobHandle = { providerId: this.id, externalId };
    const jobDir = this.jobDir(handle);
    await mkdir(this.jobsRoot, { recursive: true });
    try {
      await mkdir(jobDir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return handle;
      throw error;
    }

    const resultPath = join(jobDir, 'result.txt');
    const schema = this.outputSchema(req);
    const outputSchemaPath = schema ? join(jobDir, 'schema.json') : undefined;
    if (outputSchemaPath)
      await writeFile(outputSchemaPath, JSON.stringify(schema), { mode: 0o600 });
    const manifestPath = join(jobDir, 'manifest.json');
    await atomicJson(manifestPath, {
      modelId: req.modelId,
      reasoningEffort: effort,
      ...(outputSchemaPath && { outputSchemaPath }),
      params: this.sanitizeParams(req.params),
      outputKind: req.output?.kind ?? 'text',
      promptLength: buildCodexPrompt(req).length,
    });
    const runnerRequestPath = join(jobDir, 'runner-request.json');
    await atomicJson(runnerRequestPath, {
      modelId: req.modelId,
      reasoningEffort: effort,
      jobDir,
      resultPath,
      ...(outputSchemaPath && { outputSchemaPath }),
      params: req.params,
      prompt: buildCodexPrompt(req),
    });
    await atomicJson(join(jobDir, 'status.json'), {
      state: 'queued',
      createdAt: new Date().toISOString(),
    });
    try {
      const pid = await this.launcher.launch({ jobDir, manifestPath: runnerRequestPath });
      await atomicJson(join(jobDir, 'process.json'), { pid });
    } catch (error) {
      await atomicJson(join(jobDir, 'status.json'), { state: 'failed', reason: String(error) });
      throw error;
    }
    return handle;
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    const status = await this.readStatus(handle);
    if (status.state === 'queued') {
      const queuedAt = status.createdAt ? Date.parse(status.createdAt) : Number.NaN;
      if (Number.isFinite(queuedAt) && Date.now() - queuedAt > 30_000) {
        return {
          done: true,
          outcome: 'failed',
          reason: 'Codex runner never started',
          retryable: true,
          failureClass: 'infrastructure',
        };
      }
      return { done: false, phase: 'queued' };
    }
    if (status.state === 'running') {
      if (status.pid && !this.isAlive(status.pid)) {
        return {
          done: true,
          outcome: 'failed',
          reason: 'Codex runner was lost after API restart',
          retryable: true,
          failureClass: 'infrastructure',
        };
      }
      return { done: false, phase: 'running' };
    }
    if (status.state === 'succeeded') return { done: true, outcome: 'succeeded' };
    return {
      done: true,
      outcome: 'failed',
      reason:
        status.reason ?? (status.state === 'cancelled' ? 'Codex job cancelled' : 'Codex failed'),
      retryable: false,
      failureClass: 'provider',
    };
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const status = await this.readStatus(handle);
    if (status.state !== 'succeeded')
      throw new Error(`Codex job is not successful (${status.state})`);
    const jobDir = this.jobDir(handle);
    const resultPath = join(jobDir, 'result.txt');
    const resultStat = await stat(resultPath);
    if (resultStat.size > RESULT_LIMIT)
      throw new Error('Codex result exceeds the 4 MiB output limit');
    const text = await readFile(resultPath, 'utf8');
    const manifest = JSON.parse(await readFile(join(jobDir, 'manifest.json'), 'utf8')) as {
      outputKind?: string;
    };
    const output =
      manifest.outputKind === 'data' || manifest.outputKind === 'timeline'
        ? this.parseStructured(text)
        : text;
    return {
      output,
      costUsd: 0,
      repro: { level: 'approximate', providerVersion: 'codex-cli' },
      rawResponse: await this.sanitizedMetadata(jobDir, status),
    };
  }

  async cancel(handle: JobHandle): Promise<CancelResult> {
    const jobDir = this.jobDir(handle);
    const status = await this.readStatus(handle);
    if (status.state === 'cancelled') return { confirmed: true, billed: false };
    if (status.state === 'succeeded' || status.state === 'failed') {
      return {
        confirmed: true,
        billed: false,
        reason: `Codex job already ${status.state}`,
      };
    }
    const confirmed = await this.launcher.cancel(jobDir);
    if (confirmed)
      await atomicJson(join(jobDir, 'status.json'), {
        state: 'cancelled',
        reason: 'Cancelled by Reelcraft',
      });
    return {
      confirmed,
      billed: false,
      ...(!confirmed && { reason: 'Codex process termination was not confirmed' }),
    };
  }

  private assertEffort(model: CodexModel, effort: unknown): asserts effort is string {
    if (typeof effort !== 'string' || !model.supportedReasoningEfforts.includes(effort)) {
      throw new Error(
        `Unsupported reasoning effort "${String(effort)}" for Codex model "${model.modelId}"`,
      );
    }
  }

  private outputSchema(req: ProviderRequest): JsonSchema | undefined {
    if (req.output?.kind === 'data') return req.output.schema;
    if (req.output?.kind === 'timeline') return timelineOutputSchema;
    return undefined;
  }

  private parseStructured(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Codex returned malformed structured JSON');
    }
  }

  private jobDir(handle: JobHandle): string {
    if (handle.providerId !== this.id || !/^[a-f0-9]{64}$/.test(handle.externalId)) {
      throw new Error('Invalid Codex job handle');
    }
    return join(this.jobsRoot, handle.externalId);
  }

  private async readStatus(handle: JobHandle): Promise<DurableStatus> {
    try {
      return JSON.parse(
        await readFile(join(this.jobDir(handle), 'status.json'), 'utf8'),
      ) as DurableStatus;
    } catch (error) {
      throw new Error(`Codex job status is unavailable: ${(error as Error).message}`);
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async sanitizedMetadata(jobDir: string, status: DurableStatus): Promise<unknown> {
    let eventTypes: Record<string, number> = {};
    try {
      eventTypes = JSON.parse(
        await readFile(join(jobDir, 'events-summary.json'), 'utf8'),
      ) as Record<string, number>;
    } catch {
      eventTypes = {};
    }
    return { provider: 'codex', exitCode: status.exitCode ?? 0, eventTypes };
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        /(token|secret|password|authorization|cookie|api.?key)/i.test(key) ? '[REDACTED]' : value,
      ]),
    );
  }
}
