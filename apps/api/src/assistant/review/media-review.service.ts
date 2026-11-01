import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../../db/drizzle.provider';
import { blob } from '../../db/schema/index';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { QcAudioService } from '../../qc/qc-audio';
import {
  clampTimes,
  evenTimes,
  gridFor,
  parseAudioStats,
  timedLines,
  type AudioStats,
} from './media-review.logic';

/** A video or audio file larger than this is not reviewed. */
const MAX_REVIEW_BYTES = 600 * 1024 * 1024;
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
