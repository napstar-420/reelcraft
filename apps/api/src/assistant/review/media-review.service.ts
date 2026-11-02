import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { blob } from '../../db/schema/index';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { QcAudioService } from '../../qc/qc-audio';
import { detectShots, loudnessCurve } from '../../media-analysis/media-analysis';
import {
  keyframeTime,
  soundBetweenWords,
  wordsPerMinute,
  type Shot,
} from '../../media-analysis/media-analysis.logic';
import {
  clampTimes,
  evenTimes,
  gridFor,
  parseAudioStats,
  timedLines,
  type AudioStats,
} from './media-review.logic';

/** A video or audio file larger than this is not reviewed. */
const MAX_REVIEW_BYTES = 1024 * 1024 * 1024;
/** Width of one frame on a contact sheet. */
const FRAME_WIDTH = 480;
/** Longest stretch of audio transcribed for the assistant. */
const MAX_LISTEN_SEC = 15 * 60;

export interface ContactSheet {
  mime: 'image/jpeg';
  base64: string;
  /** The time of each frame, left to right, top to bottom. */
  times: number[];
  columns: number;
  durationSec: number | null;
}

/** Frames per keyframe sheet in `analyze`, and the most sheets it makes. */
export const KEYFRAMES_PER_SHEET = 12;
export const MAX_KEYFRAME_SHEETS = 4;

export interface VideoAnalysis {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  shots: Array<Shot & { keyframeSec: number; words: string | null }>;
  /** Contact sheets of one keyframe per shot, in shot order; `shots` lists which shots each holds
   * (when there are more shots than fit, they are sampled evenly). */
  sheets: Array<{ mime: 'image/jpeg'; base64: string; shots: number[]; columns: number }>;
  loudnessPerSecond: number[];
  transcript: {
    by: 'voicestudio' | 'deepgram';
    costUsd: number;
    text: string;
    lines: Array<{ atSec: number; text: string }>;
    wordsPerMinute: number | null;
  } | null;
  soundBetweenWords: { seconds: number; of: number; likelyMusic: boolean } | null;
}

export type Transcriber =
  | { available: true; by: 'voicestudio' | 'deepgram'; paid: boolean }
  | { available: false; reason: string };

export interface Listening {
  by: 'voicestudio' | 'deepgram';
  costUsd: number;
  durationSec: number | null;
  transcript: string;
  lines: Array<{ atSec: number; text: string }>;
  stats: AudioStats;
}

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, _out, stderr) => {
        if (error)
          reject(new Error(`${cmd} failed: ${stderr.toString().slice(-400) || error.message}`));
        else resolve({ stderr: stderr.toString() });
      },
    );
  });
}

/**
 * What the assistant needs to judge media it can't play: a contact sheet of a video's frames at
 * the times it asks for, and for sound a transcript with times plus loudness and silences. Files
 * are copied to a temporary folder for ffmpeg and removed after.
 */
@Injectable()
export class MediaReviewService {
  private readonly logger = new Logger(MediaReviewService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly audio: QcAudioService,
  ) {}

  /** One image of `count` frames spread over the video, or of the frames at `at` seconds. */
  async contactSheet(
    blobId: string,
    options: { count?: number | undefined; at?: number[] | undefined },
  ): Promise<ContactSheet | null> {
    return this.withFile(blobId, 'video/', async (file) => {
      const durationSec = await this.duration(file);
      const times = options.at?.length
        ? clampTimes(options.at, durationSec ?? 0).slice(0, 12)
        : evenTimes(durationSec ?? 0, Math.min(Math.max(options.count ?? 6, 1), 12));
      const dir = join(file, '..');
      for (const [i, t] of times.entries()) {
        await run('ffmpeg', [
          '-v',
          'error',
          '-y',
          '-ss',
          String(t),
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          `scale=${FRAME_WIDTH}:-2`,
          join(dir, `f${String(i).padStart(2, '0')}.jpg`),
        ]);
      }
      const { columns, rows } = gridFor(times.length);
      const out = join(dir, 'sheet.jpg');
      await run('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-framerate',
        '1',
        '-i',
        join(dir, 'f%02d.jpg'),
        '-vf',
        `tile=${columns}x${rows}:padding=6:color=black`,
        '-frames:v',
        '1',
        '-q:v',
        '4',
        out,
      ]);
      return {
        mime: 'image/jpeg',
        base64: (await readFile(out)).toString('base64'),
        times,
        columns,
        durationSec,
      };
    });
  }

  /** Who would transcribe, without transcribing (to ask first when it costs money). */
  async transcriber(): Promise<Transcriber> {
    const mode = await this.audio.transcriber();
    if (mode.mode === 'transcribe')
      return { available: true, by: mode.by, paid: mode.by === 'deepgram' };
    return {
      available: false,
      reason: mode.mode === 'unavailable' ? mode.reason : 'No transcriber.',
    };
  }

  /** Listens to an audio file, or a video's soundtrack: transcript with times, loudness and
   * silences. */
  async listen(blobId: string, by: 'voicestudio' | 'deepgram'): Promise<Listening | null> {
    return this.withFile(blobId, '', async (file, mime) => {
      const durationSec = await this.duration(file);
      const audioFile = await this.extractSound(file);
      const report = await run(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostats',
          '-i',
          audioFile,
          '-af',
          'volumedetect,silencedetect=noise=-40dB:d=0.7',
          '-f',
          'null',
          '-',
        ],
        300_000,
      );
      const stats = parseAudioStats(report.stderr, durationSec ?? undefined);
      const heard = await this.audio.transcribeBuffer(await readFile(audioFile), 'audio/mp4', by);
      this.logger.log({ blobId, mime, by: heard.by, costUsd: heard.costUsd }, 'assistant listened');
      return {
        by: heard.by,
        costUsd: heard.costUsd,
        durationSec,
        transcript: heard.transcript,
        lines: timedLines(heard.words),
        stats,
      };
    });
  }

  /** Breaks a video into what it's made of: its format, its shots (with a keyframe of each, as
   * contact sheets), its loudness every second, and (when `by` is given) a timed transcript with
   * the words of each shot and the speaking pace. */
  async analyze(
    blobId: string,
    by: 'voicestudio' | 'deepgram' | null,
  ): Promise<VideoAnalysis | null> {
    return this.withFile(blobId, 'video/', async (file) => {
      const facts = await this.streams(file);
      const durationSec = facts.durationSec ?? 0;
      const { shots } = await detectShots(file, durationSec);
      const loudness = facts.hasAudio ? await loudnessCurve(file, durationSec) : [];
      let transcript: VideoAnalysis['transcript'] = null;
      let words: Array<{ text: string; startSec: number; endSec: number }> = [];
      if (by && facts.hasAudio) {
        const heard = await this.audio.transcribeBuffer(
          await readFile(await this.extractSound(file)),
          'audio/mp4',
          by,
        );
        words = heard.words;
        transcript = {
          by: heard.by,
          costUsd: heard.costUsd,
          text: heard.transcript,
          lines: timedLines(heard.words),
          wordsPerMinute: wordsPerMinute(heard.words),
        };
      }
      const withWords = shots.map((shot) => {
        const said = words
          .filter((w) => w.startSec >= shot.startSec && w.startSec < shot.endSec)
          .map((w) => w.text)
          .join(' ');
        return {
          ...shot,
          keyframeSec: keyframeTime(shot),
          words: transcript ? said || null : null,
        };
      });
      const sheets = await this.keyframeSheets(file, withWords);
      this.logger.log({ blobId, shots: shots.length, by }, 'assistant analysed a video');
      return {
        ...facts,
        shots: withWords,
        sheets,
        loudnessPerSecond: loudness,
        transcript,
        soundBetweenWords:
          transcript && loudness.length ? soundBetweenWords(loudness, words) : null,
      };
    });
  }

  /** A video's format, how many shots it has and how loud it is, without pictures or words (to
   * compare two videos). */
  async facts(blobId: string): Promise<{
    durationSec: number | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    hasAudio: boolean;
    shots: number;
    averageShotSec: number | null;
    loudnessLufs: number | null;
  } | null> {
    return this.withFile(blobId, 'video/', async (file) => {
      const facts = await this.streams(file);
      const durationSec = facts.durationSec ?? 0;
      const { shots } = await detectShots(file, durationSec);
      const loudness = facts.hasAudio ? await loudnessCurve(file, durationSec) : [];
      const heard = loudness.filter((l) => l > -70);
      return {
        ...facts,
        shots: shots.length,
        averageShotSec: shots.length ? Math.round((durationSec / shots.length) * 100) / 100 : null,
        loudnessLufs: heard.length
          ? Math.round(heard.reduce((a, b) => a + b, 0) / heard.length)
          : null,
      };
    });
  }

  /** One frame per shot (sampled evenly when there are more than fit), tiled into sheets. */
  private async keyframeSheets(
    file: string,
    shots: Array<{ index: number; keyframeSec: number }>,
  ): Promise<VideoAnalysis['sheets']> {
    const room = KEYFRAMES_PER_SHEET * MAX_KEYFRAME_SHEETS;
    const picked =
      shots.length <= room
        ? shots
        : Array.from({ length: room }, (_, i) => shots[Math.floor((i * shots.length) / room)]!);
    const dir = join(file, '..');
    const sheets: VideoAnalysis['sheets'] = [];
    for (let start = 0; start < picked.length; start += KEYFRAMES_PER_SHEET) {
      const group = picked.slice(start, start + KEYFRAMES_PER_SHEET);
      const sheetDir = join(dir, `sheet-${start}`);
      await mkdir(sheetDir, { recursive: true });
      for (const [i, shot] of group.entries()) {
        await run('ffmpeg', [
          '-v',
          'error',
          '-y',
          '-ss',
          String(shot.keyframeSec),
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          `scale=${FRAME_WIDTH}:-2`,
          join(sheetDir, `f${String(i).padStart(2, '0')}.jpg`),
        ]);
      }
      const { columns, rows } = gridFor(group.length);
      const out = join(sheetDir, 'sheet.jpg');
      await run('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-framerate',
        '1',
        '-i',
        join(sheetDir, 'f%02d.jpg'),
        '-vf',
        `tile=${columns}x${rows}:padding=6:color=black`,
        '-frames:v',
        '1',
        '-q:v',
        '4',
        out,
      ]);
      sheets.push({
        mime: 'image/jpeg',
        base64: (await readFile(out)).toString('base64'),
        shots: group.map((s) => s.index),
        columns,
      });
    }
    return sheets;
  }

  /** The soundtrack as mono AAC (at most 15 minutes), next to the source file. */
  private async extractSound(file: string): Promise<string> {
    const audioFile = join(file, '..', 'sound.m4a');
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        file,
        '-vn',
        '-t',
        String(MAX_LISTEN_SEC),
        '-ac',
        '1',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        audioFile,
      ],
      300_000,
    );
    return audioFile;
  }

  /** Length, size, frame rate and whether there is sound. */
  private async streams(file: string): Promise<{
    durationSec: number | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    hasAudio: boolean;
  }> {
    return new Promise((resolve) => {
      execFile(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,width,height,r_frame_rate:format=duration',
          '-of',
          'json',
          file,
        ],
        { timeout: 30_000 },
        (error, stdout) => {
          const empty = {
            durationSec: null,
            width: null,
            height: null,
            fps: null,
            hasAudio: false,
          };
          if (error) return resolve(empty);
          try {
            const parsed = JSON.parse(String(stdout)) as {
              streams?: Array<{
                codec_type?: string;
                width?: number;
                height?: number;
                r_frame_rate?: string;
              }>;
              format?: { duration?: string };
            };
            const video = parsed.streams?.find((st) => st.codec_type === 'video');
            const [num, den] = (video?.r_frame_rate ?? '0/1').split('/').map(Number);
            const duration = Number(parsed.format?.duration);
            resolve({
              durationSec: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : null,
              width: video?.width ?? null,
              height: video?.height ?? null,
              fps: num && den ? Math.round((num / den) * 100) / 100 : null,
              hasAudio: parsed.streams?.some((st) => st.codec_type === 'audio') ?? false,
            });
          } catch {
            resolve(empty);
          }
        },
      );
    });
  }

  /** Copies a blob to a temporary folder for `fn`, when it exists, is small enough and is of the
   * expected kind (`mimePrefix`, or audio/video when empty). */
  private async withFile<T>(
    blobId: string,
    mimePrefix: string,
    fn: (file: string, mime: string) => Promise<T>,
  ): Promise<T | null> {
    const [row] = await this.db.select().from(blob).where(eq(blob.id, blobId)).limit(1);
    if (!row || row.deletedAt || row.bytes > MAX_REVIEW_BYTES) return null;
    const kindOk = mimePrefix
      ? row.mime.startsWith(mimePrefix)
      : row.mime.startsWith('audio/') || row.mime.startsWith('video/');
    if (!kindOk) return null;
    const dir = await mkdtemp(join(tmpdir(), 'reelcraft-review-'));
    try {
      const file = join(dir, 'source');
      await pipeline(await this.storage.getStream(row.objectKey), createWriteStream(file));
      return await fn(file, row.mime);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async duration(file: string): Promise<number | null> {
    return new Promise((resolve) => {
      execFile(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        { timeout: 30_000 },
        (error, stdout) => {
          const value = Number(String(stdout).trim());
          resolve(error || !Number.isFinite(value) ? null : value);
        },
      );
    });
  }
}
