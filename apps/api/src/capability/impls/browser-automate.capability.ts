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
import {
  BROWSER_MEDIA_OUTPUTS,
  DEFAULT_MAX_FILES,
  DOWNLOAD_MIME_PREFIX,
  DOWNLOAD_RESULT_SCHEMA,
  MAX_FILES_LIMIT,
  buildDownloadSystemPrompt,
  isBrowserMediaOutput,
  type BrowserMediaOutput,
  type DownloadResult,
} from './browser-automate.prompt';

interface BrowserAutomationConfig {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
  startUrl?: string;
  /** Most files a list output may download (default 10). */
  maxFiles?: number;
}

const MINUTE_MS = 60_000;

@Capability('browser.automate')
@Injectable()
export class BrowserAutomateCapability implements CapabilityImpl<BrowserAutomationConfig> {
  readonly modality = 'browser' as const;
  readonly kind = 'async' as const;
  readonly label = 'Automate Browser';
  readonly description =
    'Use Codex or Claude with BrowserOS Neo and its persistent signed-in browser profile. Returns data, or files it downloads (audio, images, videos).';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      startUrl: { type: 'string' },
      maxFiles: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_FILES_LIMIT,
        description: `Most files a list output downloads (default ${DEFAULT_MAX_FILES})`,
      },
    },
  };

  constructor(private readonly providers: ProviderRegistry) {}

  slots(): SlotDef[] {
    return [];
  }

  allowedOutputs(): OutputKind[] {
    return ['data', ...BROWSER_MEDIA_OUTPUTS];
  }

  validate(config: BrowserAutomationConfig, stage: StageDef): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const kind = stage.output.kind;
    if (kind !== 'data' && !isBrowserMediaOutput(kind)) {
      issues.push({
        path: 'output.kind',
        message:
          'browser automation produces data, or files it downloads: audio, an image, a video, or a list of images or videos',
        severity: 'error',
      });
    }
    if (isBrowserMediaOutput(kind)) {
      if (!stage.instructions?.template?.trim()) {
        issues.push({
          path: 'instructions.template',
          message: 'a browser stage that downloads files needs a template that says what to find',
          severity: 'error',
        });
      }
      if (kind.endsWith('_list')) {
        if (stage.iterate) {
          issues.push({
            path: 'iterate',
            message:
              'a browser stage that downloads a list gets all its files in one run; it cannot iterate',
            severity: 'error',
          });
        }
        if (stage.writes && Object.keys(stage.writes).length > 0) {
          issues.push({
            path: 'writes',
            message: 'a list of files cannot be written to memory; bind it from the next stage',
            severity: 'error',
          });
        }
      }
    }
    if (
      config.maxFiles !== undefined &&
      !(
        Number.isInteger(config.maxFiles) &&
        config.maxFiles >= 1 &&
        config.maxFiles <= MAX_FILES_LIMIT
      )
    ) {
      issues.push({
        path: 'config.maxFiles',
        message: `Most files must be 1 to ${MAX_FILES_LIMIT}`,
        severity: 'error',
      });
    }
    if (!config.startUrl) return issues;
    try {
      const url = new URL(config.startUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') return issues;
    } catch {
      // Report the same authoring error for malformed and unsupported URLs.
    }
    issues.push({
      path: 'config.startUrl',
      message: 'browser startUrl must use HTTP or HTTPS',
      severity: 'error',
    });
    return issues;
  }

  estimateCost(ctx: ExecCtx<BrowserAutomationConfig>): Promise<CostEstimate> {
    return this.providers.get(ctx.config.provider).estimate(this.request(ctx));
  }

  submit(ctx: ExecCtx<BrowserAutomationConfig>): Promise<JobHandle> {
    return this.providers.get(ctx.config.provider).submit(this.request(ctx), ctx.idempotencyKey);
  }

  poll(handle: JobHandle): Promise<JobStatus> {
    return this.providers.get(handle.providerId).poll(handle);
  }

  async fetch(handle: JobHandle, ctx: ExecCtx<BrowserAutomationConfig>): Promise<ExecResult> {
    const result = await this.providers.get(handle.providerId).fetch(handle);
    const base = { costUsd: result.costUsd, repro: result.repro };
    const kind = ctx.output?.kind;
    if (!kind || !isBrowserMediaOutput(kind)) {
      return {
        output: result.output,
        ...(result.attachments && { attachments: result.attachments }),
        ...base,
      };
    }
    return this.downloads(
      kind,
      result.output as DownloadResult,
      result.attachments ?? [],
      ctx,
      base,
    );
  }

  cancel(handle: JobHandle) {
    return this.providers.get(handle.providerId).cancel(handle);
  }

  /** Turns the agent's manifest and its downloaded files into the stage's output. */
  private downloads(
    kind: BrowserMediaOutput,
    manifest: DownloadResult,
    attachments: NonNullable<ExecResult['attachments']>,
    ctx: ExecCtx<BrowserAutomationConfig>,
    base: Pick<ExecResult, 'costUsd' | 'repro'>,
  ): ExecResult {
    if (manifest.status === 'error') {
      const code = ModelErrorCode.safeParse(manifest.errorCode);
      return {
        output: manifest,
        ...base,
        modelError: {
          code: code.success ? code.data : 'task_impossible',
          message: manifest.errorMessage.trim() || 'The browser reported an error without details.',
        },
      };
    }
    const single = !kind.endsWith('_list');
    const maxFiles = single ? 1 : (ctx.config.maxFiles ?? DEFAULT_MAX_FILES);
    if (!manifest.files.length) {
      return {
        output: manifest,
        ...base,
        modelError: {
          code: 'task_impossible',
          message: 'The browser finished without downloading any file.',
        },
      };
    }
    // A single-file stage takes the first file; extra downloads are evidence.
    const wanted = manifest.files.slice(0, maxFiles);
    if (!single && manifest.files.length > maxFiles) {
      return {
        output: manifest,
        ...base,
        rejection: `The browser downloaded ${manifest.files.length} files but this stage allows ${maxFiles}`,
      };
    }
    const downloaded = new Map(
      attachments
        .filter((file) => file.role === 'download')
        .map((file) => [basename(file.filename), file]),
    );
    const prefix = DOWNLOAD_MIME_PREFIX[kind];
    const sourceKind = kind.startsWith('media.audio')
      ? ('media.audio' as const)
      : kind.startsWith('media.image')
        ? ('media.image' as const)
        : ('media.video' as const);
    const sources: MediaSource[] = [];
    for (const file of wanted) {
      const attachment = downloaded.get(basename(file.filename));
      if (!attachment?.localPath) {
        return {
          output: manifest,
          ...base,
          rejection: `The browser listed "${file.filename}" but did not attach the downloaded file`,
        };
      }
      if (!attachment.mime.startsWith(prefix)) {
        return {
          output: manifest,
          ...base,
          rejection: `"${file.filename}" is ${attachment.mime}, not ${prefix}* as this stage's output needs`,
        };
      }
      sources.push({
        kind: sourceKind,
        localPath: attachment.localPath,
        mime: attachment.mime,
        filename: attachment.filename,
      });
    }
    const used = new Set(wanted.map((file) => basename(file.filename)));
    const evidence = attachments.filter(
      (file) => !(file.role === 'download' && used.has(basename(file.filename))),
    );
    // The artifact holds the files; where each came from is kept in the stage log.
    const providerMeta = {
      downloads: wanted.map(({ filename, label, sourceUrl, pageUrl, license, author }) => ({
        filename,
        label,
        sourceUrl,
        pageUrl,
        license,
        author,
      })),
    };
    const output =
      kind === 'media.image_list'
        ? { images: sources }
        : kind === 'media.video_list'
          ? {
              clips: sources.map((source, index) => ({
                index,
                label: wanted[index]!.label || `Clip ${index}`,
                prompt: provenance(wanted[index]!),
                source,
              })),
            }
          : sources[0];
    return {
      output,
      ...base,
      providerMeta,
      ...(evidence.length && { attachments: evidence }),
    };
  }

  private request(ctx: ExecCtx<BrowserAutomationConfig>) {
    const kind = ctx.output?.kind;
    const media = kind && isBrowserMediaOutput(kind) ? kind : undefined;
    return {
      modality: 'browser' as const,
      modelId: ctx.config.modelId,
      params: {
        // Finding and downloading a file takes longer than reading a page.
        ...(media && { timeoutMs: 20 * MINUTE_MS, maxSteps: 200 }),
        ...(ctx.config.params ?? {}),
        ...(ctx.config.startUrl && { startUrl: ctx.config.startUrl }),
      },
      renderedPrompt: ctx.renderedPrompt,
      system: media
        ? [
            buildDownloadSystemPrompt(
              media,
              media.endsWith('_list') ? (ctx.config.maxFiles ?? DEFAULT_MAX_FILES) : 1,
            ),
            ctx.systemPrompt,
          ]
            .filter(Boolean)
            .join('\n\n')
        : ctx.systemPrompt,
      output: media ? { kind: 'data' as const, schema: DOWNLOAD_RESULT_SCHEMA } : ctx.output,
    };
  }
}

/** One line saying where a file came from and under what licence. */
function provenance(file: DownloadResult['files'][number]): string {
  return [
    file.license && `Licence: ${file.license}`,
    file.author && `Author: ${file.author}`,
    (file.pageUrl || file.sourceUrl) && `Source: ${file.pageUrl || file.sourceUrl}`,
  ]
    .filter(Boolean)
    .join('. ');
}
