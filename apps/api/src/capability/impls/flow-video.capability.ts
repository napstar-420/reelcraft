import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ModelErrorCode } from '@reelcraft/shared';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  MediaSource,
  OutputKind,
  SlotDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';
import { ProviderRegistry } from '../../provider/provider.registry';
import { collectSourceKeys } from '../../provider/source-keys';
import {
  FLOW_MODELS,
  FLOW_RESULT_SCHEMA,
  FLOW_START_URL,
  FLOW_SYSTEM_PROMPT,
  buildFlowSystemPrompt,
} from './flow-video.prompt';

interface FlowVideoConfig {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
  aspectRatio?: string;
  flowModel?: string;
}

interface FlowResult {
  status: 'completed' | 'credits_exhausted' | 'error';
  resetAt: string;
  errorCode: string;
  errorMessage: string;
  clips: Array<{ index: number; label: string; prompt: string; filename: string }>;
}

const ASPECT_RATIOS = ['16:9', '9:16'];
const MINUTE_MS = 60_000;
/** Used when Flow does not say when credits come back. */
const DEFAULT_WAIT_MS = 6 * 60 * MINUTE_MS;
const MIN_WAIT_MS = 5 * MINUTE_MS;
const MAX_WAIT_MS = 35 * 24 * 60 * MINUTE_MS;

/** When to resume after every account ran out of credits: Flow's own reset
 * time (plus a minute's margin), kept within sane bounds. A wrong estimate
 * only costs another pause: the next attempt defers again. */
export function quotaResumeAt(resetAt: string, now = Date.now()): string {
  const parsed = Date.parse(resetAt);
  const wait = Number.isFinite(parsed) ? parsed + MINUTE_MS - now : DEFAULT_WAIT_MS;
  return new Date(now + Math.min(Math.max(wait, MIN_WAIT_MS), MAX_WAIT_MS)).toISOString();
}

@Capability('browser.flow_video')
@Injectable()
export class FlowVideoCapability implements CapabilityImpl<FlowVideoConfig> {
  readonly modality = 'browser' as const;
  readonly kind = 'async' as const;
  readonly label = 'Generate Video with Flow';
  readonly description =
    'Generate clips in Google Flow with Codex and BrowserOS Neo, switching accounts when one runs out of credits and waiting when they all do.';
  readonly lockedSystemPrompt = FLOW_SYSTEM_PROMPT;
  readonly requiresTemplate = true;
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      aspectRatio: { type: 'string', enum: ASPECT_RATIOS },
      flowModel: { type: 'string', enum: [...FLOW_MODELS] },
    },
  };

  constructor(private readonly providers: ProviderRegistry) {}

  slots(): SlotDef[] {
    return [{ name: 'references', accepts: ['media.image'], required: false, cardinality: 'many' }];
  }

  allowedOutputs(): OutputKind[] {
    return ['media.video_list'];
  }

  validate(config: FlowVideoConfig, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!stage.instructions?.template?.trim()) {
      issues.push({
        path: 'instructions.template',
        message: 'Flow needs a template prompt that says which clips to generate',
        severity: 'error',
      });
    }
    if (stage.output.kind !== 'media.video_list') {
      issues.push({
        path: 'output.kind',
        message: 'Generate Video with Flow produces a video list',
        severity: 'error',
      });
    }
    if (stage.iterate) {
      issues.push({
        path: 'iterate',
        message: 'Generate Video with Flow makes all its clips in one run; it cannot iterate',
        severity: 'error',
      });
    }
    if (stage.writes && Object.keys(stage.writes).length > 0) {
      issues.push({
        path: 'writes',
        message: 'a video list cannot be written to memory; bind it from the next stage with prev',
        severity: 'error',
      });
    }
    if (config.aspectRatio && !ASPECT_RATIOS.includes(config.aspectRatio)) {
      issues.push({
        path: 'config.aspectRatio',
        message: `Flow supports ${ASPECT_RATIOS.join(' and ')}`,
        severity: 'error',
      });
    }
    return issues;
  }

  estimateCost(ctx: ExecCtx<FlowVideoConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate(this.request(ctx));
  }

  submit(ctx: ExecCtx<FlowVideoConfig>): Promise<JobHandle> {
    return this.providers.get(ctx.config.provider).submit(this.request(ctx), ctx.idempotencyKey);
  }

  poll(handle: JobHandle): Promise<JobStatus> {
    return this.providers.get(handle.providerId).poll(handle);
  }

  async fetch(handle: JobHandle): Promise<ExecResult> {
    const result = await this.providers.get(handle.providerId).fetch(handle);
    const flow = result.output as FlowResult;
    const base = { costUsd: result.costUsd, repro: result.repro };
    if (flow.status === 'error') {
      const code = ModelErrorCode.safeParse(flow.errorCode);
      return {
        output: flow,
        ...base,
        modelError: {
          code: code.success ? code.data : 'task_impossible',
          message: flow.errorMessage.trim() || 'Flow reported an error without details.',
        },
      };
    }
    if (flow.status === 'credits_exhausted') {
      // Finished clips stay in the job's progress directory for the next attempt.
      return { output: flow, ...base, deferUntil: quotaResumeAt(flow.resetAt) };
    }
    if (!flow.clips.length) throw new Error('Flow finished without any clips');

    const files = new Map(
      (result.attachments ?? []).map((file) => [basename(file.filename), file]),
    );
    const clips = [...flow.clips]
      .sort((a, b) => a.index - b.index)
      .map((clip) => {
        const file = files.get(basename(clip.filename));
        if (!file?.localPath) throw new Error(`Flow clip ${clip.index} has no downloaded file`);
        const source: MediaSource = {
          kind: 'media.video',
          localPath: file.localPath,
          mime: file.mime,
          filename: file.filename,
        };
        return { index: clip.index, label: clip.label, prompt: clip.prompt, source };
      });
    const clipFiles = new Set(clips.map((clip) => clip.source.filename));
    const evidence = (result.attachments ?? []).filter((file) => !clipFiles.has(file.filename));
    return { output: { clips }, ...base, ...(evidence.length && { attachments: evidence }) };
  }

  cancel(handle: JobHandle) {
    return this.providers.get(handle.providerId).cancel(handle);
  }

  private request(ctx: ExecCtx<FlowVideoConfig>) {
    const references = [...new Set(collectSourceKeys(ctx.slots))].map((sourceKey, index) => ({
      file: `inputs/${index + 1}-${basename(sourceKey)}`,
      name: referenceName(ctx.slots.references, sourceKey),
    }));
    return {
      modality: 'browser' as const,
      modelId: ctx.config.modelId,
      params: {
        // A long job: many clips, each rendering for minutes.
        timeoutMs: 3 * 60 * MINUTE_MS,
        maxSteps: 1500,
        ...(ctx.config.params ?? {}),
        startUrl: FLOW_START_URL,
        slots: ctx.slots,
        // Stable across attempts so a retry or resume finds the finished clips.
        progressKey: createHash('sha256')
          .update(`${ctx.stageExecutionId ?? ctx.runId}:${ctx.stageKey}:${ctx.itemIndex ?? ''}`)
          .digest('hex')
          .slice(0, 32),
      },
      renderedPrompt: ctx.renderedPrompt,
      system: buildFlowSystemPrompt({
        aspectRatio: ctx.config.aspectRatio ?? ctx.layer?.format?.aspectRatio ?? undefined,
        flowModel: ctx.config.flowModel,
        accounts: ctx.layer?.flow?.accounts ?? [],
        references,
      }),
      output: { kind: 'data' as const, schema: FLOW_RESULT_SCHEMA },
    };
  }
}

function referenceName(references: unknown, sourceKey: string): string | undefined {
  if (!Array.isArray(references)) return undefined;
  const match = references.find(
    (ref): ref is { characterName?: string; caption?: string } =>
      typeof ref === 'object' &&
      ref !== null &&
      (ref as { sourceKey?: unknown }).sourceKey === sourceKey,
  );
  return match?.characterName ?? match?.caption;
}
