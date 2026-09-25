import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import type { JobHandle, JobStatus, JsonSchema, Modality } from '@reelcraft/shared';
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
import type { CodexRuntimeReadiness } from './codex-runtime-readiness';
import type { CodexInputMaterializer } from './codex-input-materializer';

type DurableStatus = {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  pid?: number;
  exitCode?: number | null;
  reason?: string;
  createdAt?: string;
};

type ToolResultManifest = {
  version: 1;
  output:
    unknown | { path: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; filename: string };
  attachments?: Array<{
    path: string;
    mime: string;
    filename: string;
    role: 'evidence' | 'download';
  }>;
};

const TEXT_RESULT_LIMIT = 4 * 1024 * 1024;

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

export class CodexProviderAdapter implements ProviderAdapter {
  readonly id = 'codex';
  readonly modalities: Modality[] = ['text', 'image', 'browser'];
  private readonly jobsRoot: string;
  private readonly profile: string;
  private readonly resultLimit: number;
  private readonly jobTimeoutMs: number;
  private readonly browserMaxSteps: number;

  constructor(
    config: Pick<EngineConfig, 'workspaceRoot'> & Partial<EngineConfig>,
    private readonly models: CodexAppServerClient,
    private readonly launcher: CodexJobLauncher,
    private readonly readiness?: CodexRuntimeReadiness,
    private readonly inputMaterializer?: CodexInputMaterializer,
  ) {
    this.jobsRoot = join(config.workspaceRoot, 'codex-jobs');
    this.profile = config.codexProfile ?? 'reelcraft';
    this.resultLimit = config.codexOutputMaxBytes ?? 16 * 1024 * 1024;
    this.jobTimeoutMs = config.codexJobTimeoutMs ?? 900_000;
    this.browserMaxSteps = config.codexBrowserMaxSteps ?? 50;
  }

  async listModels(): Promise<ModelInfo[]> {
    const status = this.readiness
      ? await this.readiness.inspect()
      : { modalities: this.modalities, unavailable: {} };
    const modalities = [...status.modalities];
    return (await this.models.listModels()).map((model) => ({
      modelId: model.modelId,
      label: model.label,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
      modalities,
      ...(Object.keys(status.unavailable).length > 0 && {
        unavailableModalities: status.unavailable,
      }),
      capabilities: {
        supportsSeed: false,
        supportsIdempotency: true,
        supportsStructuredOutput: true,
        supportsVision: modalities.includes('image'),
        ...(modalities.includes('image') && {
          maxRefs: 5,
          image: { formats: ['png', 'jpeg', 'webp'], maxReferences: 5 },
        }),
      },
    }));
  }

  async estimate(_req: ProviderRequest) {
    return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' as const };
  }

  async submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle> {
    const modality = req.modality ?? 'text';
    if (!this.modalities.includes(modality)) {
      throw new Error(`Codex does not support modality "${modality}"`);
    }
    await this.readiness?.assertAvailable(modality);
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

    const resultPath = join(jobDir, modality === 'text' ? 'result.txt' : 'result.json');
    const outputDir = join(jobDir, 'outputs');
    await mkdir(outputDir, { mode: 0o700 });
    const referenceFiles =
      modality === 'image' && this.inputMaterializer
        ? await this.inputMaterializer.materialize(jobDir, req.params.slots)
        : [];
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
      modality,
      promptLength: buildCodexPrompt({ ...req, modality }).length,
    });
    const runnerRequestPath = join(jobDir, 'runner-request.json');
    await atomicJson(runnerRequestPath, {
      modelId: req.modelId,
      reasoningEffort: effort,
      jobDir,
      resultPath,
      outputDir,
      modality,
      profile: this.profile,
      timeoutMs: this.jobTimeoutMs,
      browserMaxSteps: this.browserMaxSteps,
      sessionName: `reelcraft-${externalId.slice(0, 12)}`,
      ...(outputSchemaPath && { outputSchemaPath }),
      params: req.params,
      prompt: buildCodexPrompt({
        ...req,
        modality,
        params: {
          ...req.params,
          __sessionName: `reelcraft-${externalId.slice(0, 12)}`,
          __browserMaxSteps: this.browserMaxSteps,
          __referenceFiles: referenceFiles,
        },
      }),
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
    const storedManifest = JSON.parse(await readFile(join(jobDir, 'manifest.json'), 'utf8')) as {
      outputKind?: string;
      modality?: Modality;
    };
    const modality = storedManifest.modality ?? 'text';
    const resultPath = join(jobDir, modality === 'text' ? 'result.txt' : 'result.json');
    const resultStat = await stat(resultPath);
    const resultLimit = modality === 'text' ? TEXT_RESULT_LIMIT : this.resultLimit;
    if (resultStat.size > resultLimit)
      throw new Error(
        modality === 'text'
          ? 'Codex result exceeds the 4 MiB output limit'
          : `Codex result exceeds the ${resultLimit} byte output limit`,
      );
    const text = await readFile(resultPath, 'utf8');
    if (modality === 'image') {
      const manifest = this.parseToolManifest(text);
      const image = manifest.output as {
        path?: unknown;
        mime?: unknown;
        filename?: unknown;
      };
      const source = await this.validatedOutputFile(jobDir, image, [
        'image/png',
        'image/jpeg',
        'image/webp',
      ]);
      return {
        output: { kind: 'media.image', ...source },
        costUsd: 0,
        repro: { level: 'none', providerVersion: 'codex-cli' },
        rawResponse: await this.sanitizedMetadata(jobDir, status),
      };
    }
    if (modality === 'browser') {
      const manifest = this.parseToolManifest(text);
      if ((manifest.attachments?.length ?? 0) > 20) {
        throw new Error('Codex browser result exceeds the 20 attachment limit');
      }
      const attachments = await Promise.all(
        (manifest.attachments ?? []).map(async (attachment) => ({
          role: attachment.role,
          ...(await this.validatedOutputFile(jobDir, attachment)),
        })),
      );
      return {
        output: manifest.output,
        attachments,
        costUsd: 0,
        repro: { level: 'approximate', providerVersion: 'codex-cli-browseros-neo' },
        rawResponse: await this.sanitizedMetadata(jobDir, status),
      };
    }
    const output =
      storedManifest.outputKind === 'data' || storedManifest.outputKind === 'timeline'
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
    if (req.modality === 'image') {
      return {
        type: 'object',
        properties: {
          version: { type: 'number', enum: [1] },
          output: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              mime: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
              filename: { type: 'string' },
            },
            required: ['path', 'mime', 'filename'],
          },
        },
        required: ['version', 'output'],
      };
    }
    if (req.modality === 'browser') {
      return {
        type: 'object',
        properties: {
          version: { type: 'number', enum: [1] },
          output: req.output?.kind === 'data' ? req.output.schema : { type: 'object' },
          attachments: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                mime: { type: 'string' },
                filename: { type: 'string' },
                role: { type: 'string', enum: ['evidence', 'download'] },
              },
              required: ['path', 'mime', 'filename', 'role'],
            },
          },
        },
        required: ['version', 'output'],
      };
    }
    if (req.output?.kind === 'data') return req.output.schema;
    if (req.output?.kind === 'timeline') return timelineOutputSchema;
    return undefined;
  }

  private parseToolManifest(text: string): ToolResultManifest {
    const parsed = this.parseStructured(text) as Partial<ToolResultManifest>;
    if (parsed.version !== 1 || parsed.output === undefined) {
      throw new Error('Codex returned an invalid tool result manifest');
    }
    return parsed as ToolResultManifest;
  }

  private async validatedOutputFile(
    jobDir: string,
    value: { path?: unknown; mime?: unknown; filename?: unknown },
    allowedMimes?: string[],
  ): Promise<{ localPath: string; mime: string; filename: string }> {
    if (
      typeof value.path !== 'string' ||
      typeof value.mime !== 'string' ||
      typeof value.filename !== 'string'
    ) {
      throw new Error('Codex tool result contains malformed file metadata');
    }
    if (allowedMimes && !allowedMimes.includes(value.mime)) {
      throw new Error(`Codex tool result has unsupported MIME type "${value.mime}"`);
    }
    const outputRoot = await realpath(join(jobDir, 'outputs'));
    const candidate = resolve(jobDir, value.path);
    const localPath = await realpath(candidate);
    const within = relative(outputRoot, localPath);
    if (within.startsWith('..') || resolve(outputRoot, within) !== localPath) {
      throw new Error('Codex tool result path escapes the job output directory');
    }
    const fileStat = await stat(localPath);
    if (!fileStat.isFile() || fileStat.size > this.resultLimit) {
      throw new Error('Codex tool result file is invalid or exceeds the output limit');
    }
    return { localPath, mime: value.mime, filename: basename(value.filename) };
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
