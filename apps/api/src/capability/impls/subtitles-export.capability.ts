import { Injectable } from '@nestjs/common';
import { TimingMap } from '@reefcraft/shared';
import type {
  CostEstimate,
  FileSource,
  JobHandle,
  JobStatus,
  JsonSchema,
  OutputKind,
  SlotDef,
} from '@reefcraft/shared';
import { Capability } from '../capability.decorator';
import type { CapabilityImpl, ExecCtx, ExecResult } from '../capability.interface';

type SubtitleConfig = { format?: 'srt' | 'vtt' };

const timestamp = (seconds: number, separator: ',' | '.') => {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(ms).padStart(3, '0')}`;
};

@Capability('subtitles.export')
@Injectable()
export class SubtitlesExportCapability implements CapabilityImpl<SubtitleConfig> {
  readonly modality = 'compute' as const;
  readonly kind = 'sync' as const;
  readonly configSchema: JsonSchema = {
    type: 'object',
    properties: { format: { type: 'string', enum: ['srt', 'vtt'] } },
  };

  slots(): SlotDef[] {
    return [{ name: 'timing', accepts: [{ type: 'object' }], required: true, cardinality: 'one' }];
  }
  allowedOutputs(): OutputKind[] {
    return ['file.subtitles'];
  }
  async estimateCost(): Promise<CostEstimate> {
    return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' };
  }
  async submit(ctx: ExecCtx<SubtitleConfig>): Promise<JobHandle> {
    const timing = TimingMap.parse(ctx.slots.timing);
    const format = ctx.config.format ?? 'srt';
    const separator = format === 'srt' ? ',' : '.';
    const body = timing.sentences
      .map(
        (sentence, index) =>
          `${format === 'srt' ? `${index + 1}\n` : ''}${timestamp(sentence.startSec, separator)} --> ${timestamp(sentence.endSec, separator)}\n${sentence.text}`,
      )
      .join('\n\n');
    return {
      providerId: 'local-sync',
      externalId: ctx.idempotencyKey,
      payload: { format, text: format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n` },
    };
  }
  async poll(): Promise<JobStatus> {
    return { done: true, outcome: 'succeeded' };
  }
  async fetch(handle: JobHandle): Promise<ExecResult<FileSource>> {
    const payload = handle.payload as { format: 'srt' | 'vtt'; text: string };
    return {
      output: {
        kind: 'file.subtitles',
        format: payload.format,
        text: payload.text,
        filename: `captions.${payload.format}`,
        mime: payload.format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
      },
      costUsd: 0,
      repro: { level: 'exact' },
    };
  }
}
