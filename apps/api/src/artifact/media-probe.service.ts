import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { Probe } from '@reelcraft/shared';

const execFileAsync = promisify(execFile);

/** Converts ffprobe's deliberately broad JSON into the compact, stable probe
 * stored by the engine. No shell is involved: paths are always argv values. */
@Injectable()
export class MediaProbeService {
  async probe(file: string): Promise<Probe> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate',
        '-of',
        'json',
        file,
      ]));
    } catch (error) {
      throw new Error(`MediaProbeService: ffprobe rejected media (${String(error)})`);
    }
    const parsed = JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<Record<string, string | number | undefined>>;
    };
    if (!parsed.format?.format_name) throw new Error('MediaProbeService: corrupt media');
    // Still images (png_pipe/jpeg_pipe/…) never report `format.duration` at
    // all — that's normal, not corruption, so an absent duration becomes 0
    // rather than failing the probe. A duration that *is* present but
    // negative or non-finite is a genuine corruption signal.
    const rawDuration = parsed.format?.duration;
    const durationSec = rawDuration === undefined ? 0 : Number(rawDuration);
    if (!Number.isFinite(durationSec) || durationSec < 0)
      throw new Error('MediaProbeService: corrupt or duration-less media');
    const streams = (parsed.streams ?? []).flatMap((stream) => {
      if (stream.codec_type !== 'video' && stream.codec_type !== 'audio') return [];
      const rate = typeof stream.r_frame_rate === 'string' ? stream.r_frame_rate.split('/') : [];
      const fps =
        rate.length === 2 && Number(rate[1]) ? Number(rate[0]) / Number(rate[1]) : undefined;
      return [
        {
          type: stream.codec_type,
          codec: String(stream.codec_name ?? 'unknown'),
          ...(stream.width !== undefined && { width: Number(stream.width) }),
          ...(stream.height !== undefined && { height: Number(stream.height) }),
          ...(fps !== undefined && Number.isFinite(fps) && { fps }),
          ...(stream.sample_rate !== undefined && { sampleRate: Number(stream.sample_rate) }),
        },
      ] as Probe['streams'];
    });
    if (!streams.length) throw new Error('MediaProbeService: media has no audio or video streams');
    return { container: parsed.format.format_name, durationSec, streams };
  }

  hasAudio(probe: Probe): boolean {
    return probe.streams.some((stream) => stream.type === 'audio');
  }
}
