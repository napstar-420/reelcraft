import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { AssistantAttachmentDto } from '@reelcraft/shared';
import { ulid } from '../../common/ulid';
import { unsafeUrlReason } from '../../common/safe-fetch';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { objectKey } from '../../storage/object-key';
import { AttachmentService } from '../attachments/attachment.service';
import {
  ATTACHMENT_LIMITS,
  MAX_ATTACHMENT_SECONDS,
  attachmentKind,
} from '../attachments/attachment.logic';

const execFileAsync = promisify(execFile);

const MAX_REDIRECTS = 5;
const HEADERS_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_DOWNLOAD_BYTES = ATTACHMENT_LIMITS.video;

/** What a downloaded link became, before it's stored. */
export interface Downloaded {
  file: string;
  name: string;
  mime: string;
  ext: string;
}

/** Runs yt-dlp; injectable so tests don't need the binary or the network. */
export type YtDlp = (args: string[], opts: { timeoutMs: number }) => Promise<{ stdout: string }>;

const defaultYtDlp: YtDlp = async (args, opts) =>
  execFileAsync('yt-dlp', args, {
    timeout: opts.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });

const MEDIA_TYPE = /^(image|video|audio)\//;

/** Downloads a picture, video or sound from a link into a chat attachment: a direct file over
 * HTTP, a video page (YouTube, TikTok, Instagram…) through yt-dlp. Never fetches an address on
 * this machine or the local network. */
@Injectable()
export class LinkImportService {
  private readonly logger = new Logger(LinkImportService.name);
  private ytDlp: YtDlp = defaultYtDlp;
  private fetchImpl: typeof fetch = (...args) => fetch(...args);
  private resolveHost: ((host: string) => Promise<string[]>) | undefined;

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly attachments: AttachmentService,
  ) {}

  /** Test seams. */
  useForTests(seams: {
    ytDlp?: YtDlp;
    fetch?: typeof fetch;
    resolve?: (host: string) => Promise<string[]>;
  }): void {
    if (seams.ytDlp) this.ytDlp = seams.ytDlp;
    if (seams.fetch) this.fetchImpl = seams.fetch;
    if (seams.resolve) this.resolveHost = seams.resolve;
  }

  async import(input: {
    ownerId: string;
    sessionId: string;
    url: string;
  }): Promise<AssistantAttachmentDto> {
    const unsafe = await unsafeUrlReason(input.url, this.resolveHost);
    if (unsafe) throw new BadRequestException(unsafe);
    const dir = await mkdtemp(join(tmpdir(), 'reelcraft-link-'));
    try {
      const downloaded =
        (await this.downloadDirect(input.url, dir)) ?? (await this.downloadPage(input.url, dir));
      return await this.store(input, downloaded);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** A link straight to a file. Null when the link is a web page (yt-dlp's job). */
  private async downloadDirect(url: string, dir: string): Promise<Downloaded | null> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (Reelcraft link import)' },
      }).catch((error: unknown) => {
        throw new BadRequestException(`The link could not be opened: ${String(error)}`);
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        await response.body?.cancel();
        if (!next) throw new BadRequestException('The link redirects nowhere.');
        current = new URL(next, current).toString();
        const unsafe = await unsafeUrlReason(current, this.resolveHost);
        if (unsafe)
          throw new BadRequestException(`The link redirects somewhere not allowed: ${unsafe}`);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new BadRequestException(`The link answered ${response.status}.`);
      }
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const ext = extFromUrl(current);
      if (!MEDIA_TYPE.test(type) && attachmentKind(type, ext) === 'file') {
        await response.body?.cancel();
        return null;
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_DOWNLOAD_BYTES) {
        await response.body?.cancel();
        throw new BadRequestException('That file is larger than 1 GB.');
      }
      const finalExt = ext || extFromType(type);
      const file = join(dir, `download.${finalExt || 'bin'}`);
      if (!response.body) throw new BadRequestException('The link sent nothing.');
      let bytes = 0;
      const limited = Readable.fromWeb(response.body as never).on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES)
          limited.destroy(new Error('That file is larger than 1 GB.'));
      });
      await pipeline(limited, createWriteStream(file)).catch((error: unknown) => {
        throw new BadRequestException(error instanceof Error ? error.message : String(error));
      });
      return { file, name: nameFromUrl(current, finalExt), mime: type, ext: finalExt || 'bin' };
    }
    throw new BadRequestException('The link redirects too many times.');
  }

  /** A web page with a video on it, downloaded with yt-dlp. */
  private async downloadPage(url: string, dir: string): Promise<Downloaded> {
    const available = await this.ytDlp(['--version'], { timeoutMs: 15_000 }).then(
      () => true,
      () => false,
    );
    if (!available) {
      throw new BadRequestException(
        'This link is a web page, not a file, and yt-dlp (which downloads videos from pages) is not installed. Update Reelcraft to a newer image, or ask the user to download the video and attach it.',
      );
    }
    let info: { title?: string } = {};
    try {
      const { stdout } = await this.ytDlp(
        [
          '--ignore-config',
          '--no-playlist',
          '--no-progress',
          '--no-cache-dir',
          '--no-mtime',
          '-f',
          'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b',
          '--merge-output-format',
          'mp4',
          '--max-filesize',
          '1024M',
          '--match-filter',
          `duration <= ${MAX_ATTACHMENT_SECONDS} & !is_live`,
          '--dump-json',
          '--no-simulate',
          '-o',
          join(dir, 'media.%(ext)s'),
          '--',
          url,
        ],
        { timeoutMs: DOWNLOAD_TIMEOUT_MS },
      );
      info = parseInfo(stdout);
    } catch (error) {
      const message = ytDlpError(error);
      this.logger.warn({ url, err: message }, 'yt-dlp could not download a link');
      throw new BadRequestException(message);
    }
    const files = (await readdir(dir)).filter(
      (f) => f.startsWith('media.') && !f.endsWith('.part'),
    );
    if (files.length === 0) {
      throw new BadRequestException(
        `Nothing was downloaded: the video is longer than ${MAX_ATTACHMENT_SECONDS / 60} minutes, a live stream, or not public.`,
      );
    }
    const file = join(dir, files[0]!);
    const ext = extFromUrl(file) || 'mp4';
    return {
      file,
      name: `${
        (info.title ?? 'video')
          .replace(/[\\/:*?"<>|]+/g, ' ')
          .trim()
          .slice(0, 150) || 'video'
      }.${ext}`,
      mime: ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : '',
      ext,
    };
  }

  private async store(
    input: { ownerId: string; sessionId: string; url: string },
    downloaded: Downloaded,
  ): Promise<AssistantAttachmentDto> {
    const blobId = ulid();
    const key = objectKey.assistantAttachment(input.ownerId, blobId, downloaded.ext);
    const hash = createHash('sha256');
    await pipeline(createReadStream(downloaded.file), hash);
    const { size } = await stat(downloaded.file);
    const put = await this.storage.put(key, createReadStream(downloaded.file), {
      mime: downloaded.mime || 'application/octet-stream',
    });
    return this.attachments.store({
      ownerId: input.ownerId,
      blobId,
      key,
      name: downloaded.name,
      mime: downloaded.mime,
      bytes: size,
      etag: put.etag,
      sha256: hash.digest('hex'),
      source: 'link',
      sourceUrl: input.url,
      sessionId: input.sessionId,
    });
  }
}

function extFromUrl(value: string): string {
  const path = (() => {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  })();
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(path);
  return match ? match[1]!.toLowerCase() : '';
}

function extFromType(type: string): string {
  const sub = type.split('/')[1] ?? '';
  return (
    (
      { jpeg: 'jpg', quicktime: 'mov', mpeg: 'mp3', 'x-m4a': 'm4a', 'svg+xml': 'svg' } as Record<
        string,
        string
      >
    )[sub] ?? sub.replace(/[^a-z0-9]/g, '').slice(0, 5)
  );
}

function nameFromUrl(url: string, ext: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    if (last) return last.slice(0, 150);
    return `${new URL(url).hostname}${ext ? `.${ext}` : ''}`;
  } catch {
    return `download${ext ? `.${ext}` : ''}`;
  }
}

function parseInfo(stdout: string): { title?: string } {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('{'));
  if (!line) return {};
  try {
    const parsed = JSON.parse(line) as { title?: unknown };
    return typeof parsed.title === 'string' ? { title: parsed.title } : {};
  } catch {
    return {};
  }
}

/** yt-dlp's own last error line, without its "ERROR:" prefix. */
export function ytDlpError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr ?? '';
  const killed = (error as { killed?: boolean }).killed;
  if (killed) return 'The download took longer than 10 minutes and was stopped.';
  const line = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERROR:'))
    .pop();
  return line
    ? `The video could not be downloaded: ${line.replace(/^ERROR:\s*/, '').slice(0, 300)}`
    : 'The video could not be downloaded.';
}
