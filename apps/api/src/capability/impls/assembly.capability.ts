import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { Timeline, TimingMap } from '@reefcraft/shared';
import type {
  CostEstimate,
  JobHandle,
  JobStatus,
  JsonSchema,
  MediaSource,
  OutputKind,
  SlotDef,
} from '@reefcraft/shared';
import { ComputeJobService, type ComputeHandle } from '../../storage/compute-job.service';
import { EngineConfig } from '../../config/engine-config';
import { Capability } from '../capability.decorator';
import type { CancelResult, CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';

type MediaDescriptor = {
  handle: string;
  kind: string;
  sourceKey: string;
  durationSec?: number;
  hasAudio?: boolean;
  format?: string;
};

type ConcatConfig = {
  transition?: 'cut' | 'crossfade';
  transitionDurationSec?: number;
  audioMode?: 'keep' | 'replace';
  burnSubtitles?: boolean;
  maxWaitSec?: number;
};

type RenderConfig = { quality?: 'draft' | 'final'; maxWaitSec?: number };

const estimate: CostEstimate = {
  expectedUsd: 0,
  ceilingUsd: 0,
  basis: 'configured_ceiling',
};

const unwrap = (handle: JobHandle): ComputeHandle => handle.payload as ComputeHandle;

abstract class LocalComputeCapability<Cfg> implements CapabilityImpl<Cfg> {
  abstract readonly modality: string;
  abstract readonly label: string;
  abstract readonly description: string;
  readonly kind = 'async' as const;
  abstract readonly configSchema: JsonSchema;
  constructor(protected readonly compute: ComputeJobService) {}
  abstract slots(cfg: Cfg): SlotDef[];
  abstract allowedOutputs(cfg: Cfg): OutputKind[];
  abstract submit(ctx: ExecCtx<Cfg>): Promise<JobHandle>;
  abstract fetch(handle: JobHandle, ctx: ExecCtx<Cfg>): Promise<ExecResult>;
  async estimateCost(): Promise<CostEstimate> {
    return estimate;
  }
  async poll(handle: JobHandle): Promise<JobStatus> {
    return this.compute.poll(unwrap(handle));
  }
  async cancel(handle: JobHandle): Promise<CancelResult> {
    await this.compute.cancel(unwrap(handle));
    return { confirmed: true, billed: false };
  }
  async cleanup(handle: JobHandle): Promise<void> {
    await this.compute.cleanup(unwrap(handle).jobId);
  }
  protected jobHandle(handle: ComputeHandle): JobHandle {
    return { providerId: 'local-compute', externalId: handle.jobId, payload: handle };
  }
}

@Capability('video.concat')
@Injectable()
export class VideoConcatCapability extends LocalComputeCapability<ConcatConfig> {
  readonly modality = 'compute' as const;
  readonly label = 'Concatenate Video';
  readonly description = 'Combine media sources into one video, locally.';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      transition: { type: 'string', enum: ['cut', 'crossfade'] },
      transitionDurationSec: { type: 'number', minimum: 0 },
      audioMode: { type: 'string', enum: ['keep', 'replace'] },
      burnSubtitles: { type: 'boolean' },
      maxWaitSec: { type: 'number', minimum: 1 },
    },
  };
  slots(): SlotDef[] {
    return [
      { name: 'clips', accepts: ['media.video'], required: true, cardinality: 'many' },
      { name: 'audio', accepts: ['media.audio'], required: false, cardinality: 'one' },
      { name: 'subtitles', accepts: ['file.subtitles'], required: false, cardinality: 'one' },
    ];
  }
  allowedOutputs(): OutputKind[] {
    return ['media.video'];
  }
  async submit(ctx: ExecCtx<ConcatConfig>): Promise<JobHandle> {
    const clips = (Array.isArray(ctx.slots.clips) ? ctx.slots.clips : [ctx.slots.clips]) as
      MediaDescriptor[] | undefined;
    if (!clips?.length || clips.some((clip) => !clip?.sourceKey)) {
      throw new Error('video.concat requires one or more resolved clip blobs');
    }
    const audio = ctx.slots.audio as MediaDescriptor | undefined;
    const subtitles = ctx.slots.subtitles as MediaDescriptor | undefined;
    const inputs = clips.map((clip, index) => ({
      sourceKey: clip.sourceKey,
      asFilename: `clip-${index}.mp4`,
    }));
    if (audio?.sourceKey) inputs.push({ sourceKey: audio.sourceKey, asFilename: 'audio.m4a' });
    if (subtitles?.sourceKey)
      inputs.push({
        sourceKey: subtitles.sourceKey,
        asFilename: `captions.${subtitles.format === 'vtt' ? 'vtt' : 'srt'}`,
      });
    const args = this.ffmpegArgs(clips, ctx.config, Boolean(audio?.sourceKey), subtitles);
    const handle = await this.compute.spawn(ctx.idempotencyKey, {
      command: 'ffmpeg',
      args,
      inputs,
      outputFilename: 'assembled.mp4',
      maxWaitSec: ctx.config.maxWaitSec ?? 900,
    });
    return this.jobHandle(handle);
  }
  async fetch(handle: JobHandle): Promise<ExecResult<MediaSource>> {
    return {
      output: {
        kind: 'media.video',
        localPath: await this.compute.collect(unwrap(handle)),
        filename: 'assembled.mp4',
        mime: 'video/mp4',
      },
      costUsd: 0,
      repro: { level: 'exact', providerVersion: 'ffmpeg' },
    };
  }

  private ffmpegArgs(
    clips: MediaDescriptor[],
    config: ConcatConfig,
    hasReplacementAudio: boolean,
    subtitles?: MediaDescriptor,
  ): string[] {
    const args = ['-y'];
    clips.forEach((_clip, index) => args.push('-i', `{input:clip-${index}.mp4}`));
    if (hasReplacementAudio) args.push('-i', '{input:audio.m4a}');
    const duration = Math.max(0.01, config.transitionDurationSec ?? 0.35);
    const crossfade = config.transition === 'crossfade' && clips.length > 1;
    const allHaveAudio = clips.every((clip) => clip.hasAudio);
    const subtitleFilename =
      config.burnSubtitles && subtitles?.sourceKey
        ? subtitles.format === 'vtt'
          ? 'captions.vtt'
          : 'captions.srt'
        : undefined;
    if (crossfade) {
      const filters: string[] = [];
      let offset = (clips[0]?.durationSec ?? 1) - duration;
      let previous = '[0:v]';
      for (let index = 1; index < clips.length; index += 1) {
        const output = index === clips.length - 1 ? '[vout]' : `[vx${index}]`;
        filters.push(
          `${previous}[${index}:v]xfade=transition=fade:duration=${duration}:offset=${Math.max(0, offset)}${output}`,
        );
        previous = output;
        offset += (clips[index]?.durationSec ?? 1) - duration;
      }
      const videoLabel = subtitleFilename ? '[vsub]' : '[vout]';
      if (subtitleFilename) filters.push(`[vout]subtitles={input:${subtitleFilename}}[vsub]`);
      args.push('-filter_complex', filters.join(';'), '-map', videoLabel);
    } else {
      const includeClipAudio = allHaveAudio && !hasReplacementAudio;
      const streams = clips
        .map((_clip, index) => `[${index}:v:0]${includeClipAudio ? `[${index}:a:0]` : ''}`)
        .join('');
      const videoLabel = subtitleFilename ? '[vsub]' : '[vout]';
      const filters = [
        `${streams}concat=n=${clips.length}:v=1:a=${includeClipAudio ? 1 : 0}[vout]${includeClipAudio ? '[aout]' : ''}`,
      ];
      if (subtitleFilename) filters.push(`[vout]subtitles={input:${subtitleFilename}}[vsub]`);
      args.push('-filter_complex', filters.join(';'), '-map', videoLabel);
      if (includeClipAudio) args.push('-map', '[aout]');
    }
    if (hasReplacementAudio) args.push('-map', `${clips.length}:a:0`, '-shortest');
    else if (crossfade) args.push('-an');
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '{output}');
    return args;
  }
}

@Capability('timeline.render')
@Injectable()
export class TimelineRenderCapability extends LocalComputeCapability<RenderConfig> {
  readonly modality = 'compute' as const;
  readonly label = 'Render Timeline';
  readonly description = 'Render a timeline into a final video, locally.';
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: {
      quality: { type: 'string', enum: ['draft', 'final'] },
      maxWaitSec: { type: 'number', minimum: 1 },
    },
  };
  constructor(
    compute: ComputeJobService,
    private readonly config: EngineConfig,
  ) {
    super(compute);
  }
  slots(): SlotDef[] {
    return [{ name: 'timeline', accepts: ['timeline'], required: true, cardinality: 'one' }];
  }
  allowedOutputs(): OutputKind[] {
    return ['media.video'];
  }
  async submit(ctx: ExecCtx<RenderConfig>): Promise<JobHandle> {
    const timeline = Timeline.parse(ctx.slots.timeline);
    const resources = ctx.resources ?? {};
    const inputs: Array<{ sourceKey: string; asFilename: string }> = [];
    const resourceFiles: Record<string, string> = {};
    const timingMaps: Record<string, import('@reefcraft/shared').TimingMap> = {};
    let index = 0;
    for (const [handle, resource] of Object.entries(resources)) {
      if (!resource.kind.startsWith('media.')) {
        const timing = TimingMap.safeParse(resource.data);
        if (timing.success) timingMaps[handle] = timing.data;
        continue;
      }
      if (!resource.sourceKey) continue;
      const sourceExtension = path.extname(resource.sourceKey).replace(/^\./, '');
      const fallbackExtension =
        resource.kind === 'media.image' ? 'png' : resource.kind === 'media.audio' ? 'm4a' : 'mp4';
      const extension = /^[a-zA-Z0-9]{1,8}$/.test(sourceExtension)
        ? sourceExtension
        : fallbackExtension;
      const asFilename = `resource-${index}.${extension}`;
      inputs.push({ sourceKey: resource.sourceKey, asFilename });
      resourceFiles[handle] = asFilename;
      index += 1;
    }
    const missing = timeline.tracks
      .flatMap((track) => track.items)
      .filter((item) => item.type === 'media' && !resourceFiles[item.handle]);
    if (missing.length)
      throw new Error(`timeline.render cannot resolve ${missing.length} media item(s)`);
    const worker = path.resolve(__dirname, '../../../../render-worker/dist/cli.js');
    const quality = ctx.config.quality ?? 'final';
    const args = [
      worker,
      '{input:timeline.json}',
      '{input:resources.json}',
      quality,
      '{output}',
      ...(this.config.remotionBrowserExecutable ? [this.config.remotionBrowserExecutable] : []),
    ];
    const handle = await this.compute.spawn(ctx.idempotencyKey, {
      command: process.execPath,
      args,
      inputs,
      files: [
        { asFilename: 'timeline.json', contents: JSON.stringify(timeline) },
        {
          asFilename: 'resources.json',
          contents: JSON.stringify({ media: resourceFiles, timing: timingMaps }),
        },
      ],
      outputFilename: 'timeline.mp4',
      maxWaitSec: ctx.config.maxWaitSec ?? 1_800,
    });
    return this.jobHandle(handle);
  }
  async fetch(handle: JobHandle): Promise<ExecResult<MediaSource>> {
    return {
      output: {
        kind: 'media.video',
        localPath: await this.compute.collect(unwrap(handle)),
        filename: 'timeline.mp4',
        mime: 'video/mp4',
      },
      costUsd: 0,
      repro: { level: 'exact', providerVersion: 'remotion-4.0.526' },
    };
  }
}
